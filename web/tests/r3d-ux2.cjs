// Round 3 part D (17 Oct 2026): UX walkthrough 2 #20 (lump sum: lower EMI or finish sooner;
// Profile balance drops logged) and #23 (dark mode, offline, slow network, two tabs).
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
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── #20 lump sum: "lower your EMI or finish sooner?" ──────────────────────────
test('#20: the lower EMI is the same loan re-worked over the months left (hand check)', () => {
  const { lowerEmiAfter, asksPrepayChoice } = lib('prepay-choice.ts');
  const home = { loan_type: 'home_loan', outstanding: '4000000', nominal_rate: '0.085', tenure_months_remaining: 240, scheduled_emi: '34713' };
  // pmt(35,00,000, 8.5%/12, 240) = 30,373.81 (engine/tests/test_prepay_choice.py golden)
  assert.ok(Math.abs(lowerEmiAfter(home, 500000) - 30373.81) < 0.01);
  // Never above today's EMI, none when the payment clears the loan, none for a card.
  for (const paid of [1, 1000, 100000, 3999999]) assert.ok(lowerEmiAfter(home, paid) <= 34713);
  assert.equal(lowerEmiAfter(home, 4000000), null);
  assert.equal(asksPrepayChoice({ ...home, loan_type: 'credit_card', scheduled_emi: '0' }), false);
});

test('#20: the question says what each country\'s lender does (India asks; US recast)', () => {
  const { prepayChoiceNote, prepayLabel } = lib('prepay-choice.ts');
  assert.match(prepayChoiceNote('IN'), /bank asks which one/i);
  assert.match(prepayChoiceNote('IN'), /no instruction/);
  assert.match(prepayChoiceNote('US'), /recast/);
  assert.match(prepayChoiceNote('US'), /FHA, VA and USDA/);
  assert.match(prepayLabel('reduce_emi', 'US'), /payment/);
  assert.match(prepayLabel('reduce_emi', 'IN'), /EMI/);
});

test('#20: no answer is picked silently in What-if or Activity', () => {
  const what = src('components/WhatIfPanel.tsx');
  assert.match(what, /useState<PrepayMode \| null>\(null\)/);
  assert.match(what, /if \(lumpAsks && !lumpMode\) \{\s*setLumpModeTried\(true\);\s*return;/);
  assert.match(what, /\.\.\.\(lumpMode \? \{ lump_sum_mode: lumpMode \} : \{\}\)/);
  const dlg = src('components/activity/LogDialog.tsx');
  assert.match(dlg, /prepay: asksPrepay && !prepayMode \?/);
  assert.match(dlg, /useState<PrepayMode \| null>\(edit\?\.prepayMode \?\? null\)/);
});

const home = (extra = {}) => ({ id: 'L1', loan_type: 'home_loan', bank: 'SBI', outstanding: '3500000', nominal_rate: '0.085', tenure_months_remaining: 240, scheduled_emi: '34713', ...extra });

test('#20: a balance lowered in Profile is logged as the prepayment or correction it was, and never taken off twice', () => {
  const { balanceEditEntries, overdueAmount } = lib('activity.ts');
  const { activityDeltas } = lib('activity-cookie.ts');
  const { paymentState } = lib('payment-state.ts');
  const recordedAt = '2026-10-17T07:30:00.000Z';
  const today = '2026-10-17';
  const before = [home({ outstanding: '4000000' })];
  const after = [home({ balance_as_of: today, balance_recorded_at: recordedAt })];
  for (const reason of ['prepayment', 'correction']) {
    const [e, ...rest] = balanceEditEntries(before, after, { L1: reason }, today, recordedAt);
    assert.equal(rest.length, 0);
    assert.equal(e.amount, '500000.00');
    assert.equal(e.kind, reason === 'prepayment' ? 'paid_extra' : 'balance_correction');
    assert.deepEqual(e.fromProfileEdit, { from: '4000000', to: '3500000' });
    assert.ok(Date.parse(e.loggedAt) < Date.parse(recordedAt));
    // The new balance already includes it: no delta moves the plan.
    const deltas = activityDeltas([{ ...e, id: 'x' }], after, 'IN', new Date('2026-10-17T09:00:00Z'));
    assert.equal(deltas.filter((d) => Number(d.principalReduction || 0) > 0 || Number(d.overdue) > 0).length, 0, reason);
    // Neither marks this month's EMI as paid; a correction is no money at all.
    assert.equal(paymentState([{ ...e, id: 'x' }], 34713, 34713), reason === 'prepayment' ? 'due' : 'due');
    if (reason === 'correction') assert.equal(overdueAmount({ ...e, id: 'x' }), '0');
  }
  // No reason given, a rise, a card, or a new loan: nothing logged.
  assert.equal(balanceEditEntries(before, after, {}, today, recordedAt).length, 0);
  assert.equal(balanceEditEntries(after, before, { L1: 'prepayment' }, today, recordedAt).length, 0);
  assert.equal(balanceEditEntries([], after, { L1: 'prepayment' }, today, recordedAt).length, 0);
});

test('#20: Profile asks why an EMI loan balance went down and will not save without an answer', () => {
  const p = src('app/profile/ProfileClient.tsx');
  assert.match(p, /dropErrors\.every\(\(e\) => !e\) &&/);
  assert.match(p, /l\.loan_type === 'credit_card'/);
  assert.match(p, /logBalanceDrops\(savedBefore, stampedUser, dropReasons/);
  // The entries are logged before the new balance's stamp (same recordedAt).
  assert.match(p, /stampBalanceDates\(userWithFx\.loans, savedBefore, localIsoDate\(getCountryToday\(country\)\), recordedAt\)/);
});
