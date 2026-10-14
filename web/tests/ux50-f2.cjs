const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
    module._compile(output, file);
  };
const lib = (name) => require(path.join(root, 'lib', name));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// UX50 round, fix agent F2 (Setup, Home, Plan): ux50/B.md.

test('B-10: Setup steps have their own URL and the draft survives a reload', () => {
  const d = lib('setup-draft.ts');
  assert.equal(d.stepToParam(0), 'you');
  assert.equal(d.stepToParam(1), 'loans');
  assert.equal(d.stepToParam(2), 'plan');
  assert.equal(d.stepFromParam('plan'), 2);
  assert.equal(d.stepFromParam('nonsense'), null);
  assert.equal(d.stepFromParam(null), null);
  assert.equal(d.urlWithStep('https://rightdue.app/onboarding?x=1', 1), '/onboarding?x=1&step=loans');
  const now = 1_760_000_000_000;
  const raw = d.serializeDraft({ takeHome: '95000', spend: '38000', loans: [{ outstanding: '3200000' }] }, 1, now);
  const back = d.parseDraft(raw, now + 60_000);
  assert.equal(back.step, 1);
  assert.equal(back.state.takeHome, '95000');
  assert.equal(back.state.loans[0].outstanding, '3200000');
  // Too old, broken or from another version: dropped.
  assert.equal(d.parseDraft(raw, now + d.SETUP_DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(d.parseDraft('{not json', now), null);
  assert.equal(d.parseDraft(JSON.stringify({ v: 2, savedAt: now, step: 0, state: {} }), now), null);
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /history\.pushState/);
  assert.match(qs, /addEventListener\('popstate'/);
  assert.match(qs, /sessionStorage\.setItem\(SETUP_DRAFT_KEY/);
  assert.match(qs, /sessionStorage\.removeItem\(SETUP_DRAFT_KEY\)/);
});

test('B-35: blank spending is not a silent zero; a typed zero needs a yes', () => {
  const { checkSpend, SPEND_COPY } = lib('setup-draft.ts');
  assert.equal(checkSpend('', false), 'blank');
  assert.equal(checkSpend('   ', true), 'blank');
  assert.equal(checkSpend('abc', false), 'invalid');
  assert.equal(checkSpend('0', false), 'zero-unconfirmed');
  assert.equal(checkSpend('0', true), 'ok');
  assert.equal(checkSpend('38000', false), 'ok');
  assert.match(SPEND_COPY.blank, /rough number is fine/);
  assert.match(SPEND_COPY.zero('₹'), /₹0 spending\?/);
  assert.doesNotMatch(src('components/setup/QuickSetup.tsx'), /leave it blank for none/);
});

test('B-02: saving Setup records the visit, so Home does not ask "is it yours?"', () => {
  const { shouldAskGuest, LAST_SEEN_KEY } = lib('guest-return.ts');
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /localStorage\.setItem\(LAST_SEEN_KEY, String\(Date\.now\(\)\)\)/);
  // Guests only, and sign-out clears it: a signed-in browser keeps nothing after sign-out.
  assert.match(qs, /if \(!signedInAccount\(\)\) window\.localStorage\.setItem\(LAST_SEEN_KEY/);
  assert.match(src('lib/server-sync.ts'), /LOCAL_PER_USER_KEYS = \[[^\]]*'rightdue_guest_last_seen'/);
  const now = Date.now();
  // What Home reads right after that save.
  assert.equal(shouldAskGuest({ signedIn: false, hasSavedProfile: true, lastSeenMs: now - 5000, nowMs: now, answeredThisTab: false }), false);
  assert.equal(LAST_SEEN_KEY, 'rightdue_guest_last_seen');
});

test('R5-2: Setup preview requests carry no balance_recorded_at', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /delete c\.balance_recorded_at/);
  const { stableKey } = lib('engine-requests.ts');
  if (stableKey) {
    const strip = (l) => { const c = { ...l }; delete c.balance_recorded_at; return c; };
    const a = { user: { loans: [strip({ outstanding: '1', balance_recorded_at: '2026-10-13T10:00:00Z' })] } };
    const b = { user: { loans: [strip({ outstanding: '1', balance_recorded_at: '2026-10-13T10:00:05Z' })] } };
    assert.equal(stableKey('baseline', a), stableKey('baseline', b));
  }
});

test('B-36: an unanswered EMI question is a question, not a missing number; dates in words', () => {
  const { setupSummaryLine, formatAsOfDate } = lib('loan-gaps.ts');
  assert.equal(
    setupSummaryLine({ emiTooSmall: false, missing: false, fx: false, unanswered: 1, monthName: 'October' }),
    'One loan needs an answer: whether October’s EMI has gone out. It’s marked above.',
  );
  assert.match(setupSummaryLine({ emiTooSmall: false, missing: false, fx: false, unanswered: 2, monthName: 'October' }), /^2 loans need an answer/);
  assert.equal(setupSummaryLine({ emiTooSmall: false, missing: true, fx: false, unanswered: 1 }), 'Some loans are missing a number. They’re marked above.');
  assert.equal(formatAsOfDate('2026-10-10'), '10 Oct 2026');
  assert.equal(formatAsOfDate('oops'), 'oops');
});

test('B-11: Home says what to do this month in one line', () => {
  const { homeThisMonthLine, lowerName } = lib('home-this-month.ts');
  const money = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const row = (o) => ({ key: o.name, loanIndex: 0, card: false, currency: 'INR', ...o, amountUser: o.amount });
  const data = {
    rows: [
      row({ name: 'Credit card', loanIndex: 2, kind: 'extra', amount: 12500, minimum: 4250, extra: 8250, card: true }),
      row({ name: 'Home loan', loanIndex: 0, kind: 'emi', amount: 30000, minimum: 30000, extra: 0 }),
      row({ name: 'Car loan', loanIndex: 1, kind: 'emi', amount: 14500, minimum: 14500, extra: 0 }),
    ],
    total: 57000, leftOver: 0, extraUser: 8250, budget: 0,
  };
  const ok = homeThisMonthLine(data, 0, money);
  assert.equal(ok.tone, 'ok');
  assert.equal(ok.text, 'This month: pay ₹57,000. Every EMI and card minimum (₹48,750), plus ₹8,250 extra on your credit card.');
  const short = homeThisMonthLine({ ...data, extraUser: 0, total: 48750 }, 500, money);
  assert.equal(short.tone, 'short');
  assert.match(short.text, /^This month you’re ₹500 short\. Pay every EMI and card minimum first \(Credit card, Home loan and Car loan\)/);
  assert.equal(homeThisMonthLine(null, 0, money), null);
  assert.equal(lowerName('HDFC Bank credit card'), 'HDFC Bank credit card');
  assert.equal(lowerName('Car loan'), 'car loan');
  assert.match(src('components/home/LedgerHome.tsx'), /\{thisMonth\}\s*<ContextLine/);
});

test('B-01: the extra row is tagged in words, stays after paid, and both Home lists share one order', () => {
  const p = src('components/home/PayThisMonth.tsx');
  assert.match(p, /'EXTRA PAID' : 'EXTRA GOES HERE'/);
  assert.match(p, /lStrip\(done \? 'positive' : 'accent'\)/);
  assert.doesNotMatch(p, /row === firstExtra && !st \? lStrip/);
  // Numbered as in "Your loans and cards" (open loans in entry order).
  assert.match(p, /openNo\.set\(i, openNo\.size \+ 1\)/);
  assert.match(src('lib/derived.ts'), /l\.outstanding\.gt\(0\) && \(l\.loan\.planned_effective_month \?\? 1\) <= 1/);
});

test('B-12: a card marked paid moves on Home (an estimate until the statement)', () => {
  const { owedNow } = lib('owed-now.ts');
  const card = { id: 'c', loan_type: 'credit_card', outstanding: '85000', nominal_rate: '0.42', scheduled_emi: '0', balance_as_of: '2026-10-01' };
  const entry = (o) => ({ id: 'e', loanIndex: 0, loanId: 'c', kind: 'paid_extra', date: '2026-10-13', amount: '12500', scheduledEmi: '4250', loggedAt: '2026-10-13T10:00:00Z', ...o });
  const [r] = owedNow([card], [entry({})], '2026-10');
  assert.equal(r.owed.toFixed(0), '72500');
  assert.equal(r.cardBefore.toFixed(0), '85000');
  assert.equal(r.status, null);
  // Last month's payment, or one before the balance was entered, doesn't count.
  assert.equal(owedNow([card], [entry({ date: '2026-09-20' })], '2026-10')[0].owed.toFixed(0), '85000');
  assert.equal(owedNow([card], [entry({ date: '2026-09-30' })], '2026-10')[0].cardBefore, undefined);
  assert.equal(owedNow([{ ...card, balance_as_of: '2026-10-14' }], [entry({})], '2026-10')[0].owed.toFixed(0), '85000');
  // A missed one isn't a payment.
  assert.equal(owedNow([card], [entry({ kind: 'missed', amount: '0' })], '2026-10')[0].owed.toFixed(0), '85000');
});

test('B-13: Setup, Home and Plan tell one short-month story', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  // Live re-test 7 R7-2: the wording moved into lib/plan-gap's shortGapLine,
  // shared with Plan and Home (tests/r7-fixes.cjs checks the words).
  assert.match(qs, /shortGapLine\(\{/);
  // Audit 80 B4: the row is the likely-baseline one (lib/savings-baseline).
  assert.match(qs, /\[LIKELY_LABEL, '—', 'needs a payoff date first'\]/);
  const home = src('components/home/HomeDebtFree.tsx');
  assert.match(home, /shortLine=\{/);
  assert.match(src('components/home/HomeProgress.tsx'), /shortLine \?\? 'Once the plan has a debt-free date/);
});

test('B-08, B-16, B-17, B-26, B-33: one order, quieter table, honest share and tenure copy, readable CSV', () => {
  const { STRATEGIES } = lib('strategy.ts');
  assert.deepEqual(STRATEGIES, ['avalanche', 'snowball', 'rules']);
  assert.match(src('components/plan/PlanSchedule.tsx'), /background: expanded && r\.event \? L_T\.highlight/);
  const { shareLines } = lib('share-card.ts');
  assert.deepEqual(shareLines({ debtFreeLabel: 'May 2034', monthsShaved: 0, loansCleared: 0, loansTotal: 3 }), ['Debt-free by May 2034', 'Started my payoff plan']);
  assert.deepEqual(shareLines({ debtFreeLabel: 'May 2034', monthsShaved: 0, loansCleared: 1, loansTotal: 3 }), ['Debt-free by May 2034', '1 of 3 loans cleared']);
  const { tenureWhatIfCopy } = lib('tenure-whatif-copy.ts');
  const money = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const c = tenureWhatIfCopy({ baselineShortfall: 0, scenarioShortfall: 0, freed: 1461, extraInterest: -3247, neverClears: false, scenarioNeverClears: false, money });
  assert.match(c.interest, /^On this loan alone, a longer tenure means more interest\. Only if you put the ₹1,461/);
  const csv = lib('schedule-csv.ts');
  assert.equal(csv.scheduleCsvFilename('2026-10-13'), 'rightdue-plan-2026-10-13.csv');
  assert.deepEqual(
    csv.scheduleCsvHeader([{ loan_type: 'home_loan' }, { loan_type: 'credit_card', bank: 'HDFC Bank' }, { loan_type: 'home_loan' }], 'IN', 'inr'),
    ['Month', 'Date', 'Home loan 1 (₹)', 'HDFC Bank credit card (₹)', 'Home loan 2 (₹)', 'Extra (₹)', 'Interest (₹)', 'Principal (₹)', 'Owed after (₹)', 'Event'],
  );
});
