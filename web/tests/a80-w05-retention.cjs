// Audit 80, W5: retention + measurement (A8, A12, A13, A14/E8, A15, A18).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── A12: no label promises a reminder that nothing sends ────────────────────

test('A12: "Remind me next month" is gone everywhere; the snooze says what it does', () => {
  const offenders = walk(root).filter((f) => /Remind me next month/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
  assert.match(src('components/home/HomeProgress.tsx'), /Hide until next month/);
});

test('A12: any "remind" wording in Home components is tied to a real email feature', () => {
  for (const f of walk(path.join(root, 'components/home'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/>[^<{]*\bremind[^<{]*</gi)) {
      // Visible text that says "remind" must live in an email feature component.
      assert.match(path.basename(f), /Deadline|Payday|Email|RateMove/, `${path.basename(f)}: ${m[0]}`);
    }
  }
});

// ── A8: the assistant prompt checks advice and keeps Copy my plan ───────────

test('A8: the second-opinion prompt is now a paste-in checker; Copy my plan stays with a link back', () => {
  const { monthlyPrompts } = lib('monthly-prompts.ts');
  const p = monthlyPrompts({ today: new Date(2026, 9, 20), country: 'IN', loansWithPayments: 1, activityDates: ['2026-09-02'], pendingUpi: [], snoozed: [] })
    .find((x) => x.key === 'ask_assistant');
  assert.equal(p.action, 'check_advice');
  assert.match(p.text, /Paste it and we’ll check it against your loans and RBI rules/);
  const hp = src('components/home/HomeProgress.tsx');
  assert.match(hp, /COPY MY PLAN/);
  assert.match(hp, /CHECK ADVICE/);
  const { planContext } = lib('plan-context.ts');
  const text = planContext({ country: 'IN', monthLabel: 'October', debtFreeLabel: 'Jan 2029', pay: { rows: [], total: 0 }, loans: [], strategy: 'avalanche', fmt: (v) => `₹${v}`, checkUrl: 'https://rightdue.app/?check=advice#advice-check' });
  assert.match(text, /paste your reply into RightDue to check its numbers.*https:\/\/rightdue\.app\/\?check=advice#advice-check/);
  assert.doesNotMatch(planContext({ country: 'IN', monthLabel: 'x', debtFreeLabel: null, pay: { rows: [], total: 0 }, loans: [], strategy: 'a', fmt: String }), /paste your reply/);
});

// ── A14 / E8: share only after a real move ──────────────────────────────────

test('A14: the share card needs real progress (months sooner or a loan cleared), never day 1', () => {
  const { hasRealProgress } = require(path.join(root, 'components/home/HomeProgress.tsx'));
  assert.equal(hasRealProgress(0, 0), false);
  assert.equal(hasRealProgress(-2, 0), false);       // the date slipped: nothing to celebrate
  assert.equal(hasRealProgress(3, 0), true);
  assert.equal(hasRealProgress(0, 1), true);
  const hp = src('components/home/HomeProgress.tsx');
  assert.match(hp, /\{ym && realMove && \(/);
  assert.match(hp, /ritual === 'payday'|get\('ritual'\) === 'payday'/);
});

// ── A15: counts only ────────────────────────────────────────────────────────

test('A15: funnel bodies carry only known keys and letters-only field names', () => {
  const { funnelBody, fieldKey } = lib('funnel.ts');
  assert.equal(fieldKey('Months left'), 'months_left');
  assert.equal(fieldKey('EMI (₹) 45,000 HDFC'), 'emi_hdfc');      // digits and symbols never ride along
  assert.equal(fieldKey('₹ 12,34,567'), '');
  assert.equal(funnelBody('field_focus', { step: 2, field: '₹ 50000' }), '');   // nothing left: not sent
  assert.deepEqual(JSON.parse(funnelBody('field_filled', { step: 22, field: 'Rate %', loan_kind: 'home_loan', country: 'IN' })),
    { event: 'field_filled', field: 'rate', step: 9, loan_kind: 'home_loan', country: 'IN' });
  assert.deepEqual(JSON.parse(funnelBody('plan_saved', { field: 'x', step: 2, country: 'US' })), { event: 'plan_saved', country: 'US' });
  assert.deepEqual(JSON.parse(funnelBody('plan_saved', { loan_kind: 'Home Loan ₹5L' })), { event: 'plan_saved' });
});

test('A15: month-2 return is the calendar month after the first plan on this device', () => {
  const { monthsSinceFirstPlan } = lib('funnel.ts');
  assert.equal(monthsSinceFirstPlan(null, '2026-11'), null);
  assert.equal(monthsSinceFirstPlan('2026-10', '2026-10'), 0);
  assert.equal(monthsSinceFirstPlan('2026-10', '2026-11'), 1);
  assert.equal(monthsSinceFirstPlan('2026-12', '2027-01'), 1);
  assert.equal(monthsSinceFirstPlan('bad', '2027-01'), null);
});

test('A15: the funnel request sends no cookies and is off unless NEXT_PUBLIC_FUNNEL=1', () => {
  const f = src('lib/funnel.ts');
  assert.match(f, /credentials: 'omit'/);
  assert.match(f, /process\.env\.NEXT_PUBLIC_FUNNEL === '1'/);
  assert.match(src('components/setup/QuickSetup.tsx'), /track\('plan_saved'/);
  assert.match(src('app/onboarding/page.tsx'), /<SetupFunnel>/);
});

// ── A18: fake doors ─────────────────────────────────────────────────────────

test('A18: letter-pack door only on a Loan Check finding of ₹5,000 or more', () => {
  const { findingWorth } = require(path.join(root, 'components/retention/LoanCheckSignals.tsx'));
  const { FINDING_THRESHOLD_INR } = lib('funnel.ts');
  assert.equal(FINDING_THRESHOLD_INR, 5000);
  assert.equal(findingWorth({ status: 'no_issue', claim_amount: '90000', amount_at_stake_this_year: '0' }), 0);
  assert.equal(findingWorth({ status: 'issues_found', claim_amount: '4999', amount_at_stake_this_year: '1200' }), 4999);
  assert.equal(findingWorth({ status: 'issues_found', claim_amount: '3000', amount_at_stake_this_year: '6400' }), 6400);
  const door = src('components/retention/FakeDoor.tsx');
  assert.match(door, /₹299/);
  assert.match(door, /₹99\/mo/);
  assert.doesNotMatch(door, /type="email"|<input/);       // counts only: no email collected
  assert.match(src('components/home/HomeProgress.tsx'), /sinceFirst >= 1 && <FakeDoor door="plus" \/>/);
});

// ── A13: which loans the rate-move email offers ─────────────────────────────

test('A13: rate-move opt-in lists floating rupee loans; bank home/car/education loans pre-ticked as repo-linked', () => {
  const { retentionInputs } = lib('retention-inputs.ts');
  const L = (o) => ({ loan_type: 'home_loan', bank: 'SBI', outstanding: '5000000', nominal_rate: '0.085', rate_type: 'floating', tenure_months_remaining: 240, scheduled_emi: '43391', ...o });
  const loans = [
    L({}),
    L({ bank: 'LIC HFL', lender_type: 'hfc' }),
    L({ loan_type: 'credit_card', bank: 'HDFC', nominal_rate: '0.42', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '0' }),
    L({ loan_type: 'personal_loan', bank: 'Bajaj', rate_type: 'fixed' }),
    L({ outstanding: '0' }),
  ];
  const pay = { rows: [{ loanIndex: 2, kind: 'extra' }, { loanIndex: 0, kind: 'emi' }], total: 0 };
  const r = retentionInputs(loans, pay, 'IN');
  assert.deepEqual(r.rateLoans.map((x) => [x.name.split(' ')[0], x.likelyRepo]), [['SBI', true], ['LIC', false]]);
  assert.equal(r.rateLoans[0].rate, 0.085);
  assert.equal(r.adviceLoans.length, 4);                   // the cleared loan is left out
  assert.equal(r.extraTarget, 2);                          // the card, as Pay this month says
  assert.deepEqual(retentionInputs(loans, pay, 'US').rateLoans, []);
});
