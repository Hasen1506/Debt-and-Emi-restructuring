// Founder decision 17 Oct 2026 (FOUNDER-RECORDS B17; engine/debt_status.py):
// behind loans are caught up first, collections loans build a settlement pot,
// the user's own split wins, and the payday email lists neither as a normal due.
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
const { payThisMonth } = require(path.join(root, 'lib', 'pay-this-month.ts'));
const { paydaySnapshot } = require(path.join(root, 'lib', 'payday-snapshot.ts'));
const { overdueOf, catchUpProgress } = require(path.join(root, 'lib', 'loan-status-core.ts'));
const { LEGAL_REVIEW } = require(path.join(root, 'lib', 'legal-review.ts'));
const status = require(path.join(root, 'lib', 'loan-status.ts'));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const plan = (loans, perLoan, mins, ds, extra = {}) => ({
  live: true,
  user: { country: 'IN', income_type: 'business_owner', monthly_income: '100000', fixed_expenses: '40000', variable_expenses: '0', loans },
  monthlyPayments: [{ month: 1, perLoan }],
  trajectory: [{ month: 1, balancesByLoanIndex: Object.fromEntries(Object.keys(perLoan).map((k) => [k, '100000'])) }],
  firstMonthMinimums: mins,
  debtStatusMonth1: ds,
  surplusAllocation: { efSlice: 0, goalSlice: 0, surplus: 40000 },
  surplus: 40000, shortfall: 0, fxRatesUsed: {}, debtBudget: '', advanceTaxSchedule: null, ...extra,
});
const car = { id: 'car', loan_type: 'auto_loan', bank: 'HDFC', outstanding: '600000', nominal_rate: '0.09', scheduled_emi: '10000' };
const card = { id: 'card', loan_type: 'credit_card', bank: 'SBI', outstanding: '50000', nominal_rate: '0.42', scheduled_emi: '0', debt_status: 'collections' };

test('item 1: blank overdue = one EMI, marked as an estimate; a typed amount is used as is', () => {
  assert.deepEqual(overdueOf({ scheduled_emi: '10000' }), { amount: 10000, estimated: true });
  assert.deepEqual(overdueOf({ scheduled_emi: '10000', overdue_amount: '25000' }), { amount: 25000, estimated: false });
  assert.deepEqual(overdueOf({ scheduled_emi: '10000', overdue_amount: '' }), { amount: 10000, estimated: true });
  const ui = src('components/setup/LoanExtras.tsx');
  assert.match(ui, /status === 'behind' && \(/);
  assert.match(ui, /data-testid="setup-overdue-amount"/);
  assert.equal(status.OVERDUE_LABEL, 'How much are you behind?');
  assert.match(status.OVERDUE_HINT, /one EMI as an estimate/);
  // Used by both Setup and Profile.
  assert.match(src('components/setup/QuickSetup.tsx'), /<LoanExtras /);
  assert.match(src('app/profile/ProfileClient.tsx'), /<LoanExtras /);
});

test('item 2: Home lists "₹X to catch up on <loan>" on the behind loan, which is ticked as usual', () => {
  const behind = { ...car, debt_status: 'behind', overdue_amount: '25000' };
  const d = payThisMonth(plan([behind], { 0: '35000' }, { 0: '10000' }, { catchUp: { 0: '25000' }, pot: {} }), '2026-10-17');
  const r = d.rows.find((x) => x.loanIndex === 0);
  assert.equal(r.catchUp, 25000);
  assert.equal(r.estimated, false);
  assert.equal(r.held, undefined);
  assert.equal(r.behind, true);
  assert.equal(r.amount, 35000);
  const ui = src('components/home/PayThisMonth.tsx');
  assert.match(ui, /to catch up on \{row\.name\}/);
  assert.match(ui, /estimate: one EMI/);
});

test('item 2: once logged payments cover the overdue, Home asks to set it back to normal', () => {
  const loan = { ...car, debt_status: 'behind', overdue_amount: '25000', overdue_as_of: '2026-10-05' };
  const e = (date, amount, kind = 'paid_full') => ({ loanIndex: 0, loanId: 'car', kind, date, amount });
  assert.equal(catchUpProgress(loan, 0, [e('2026-10-10', '20000')], '2026-10-17').caughtUp, false);
  const p = catchUpProgress(loan, 0, [e('2026-10-01', '90000'), e('2026-10-10', '20000'), e('2026-10-12', '5000', 'paid_extra')], '2026-10-17');
  assert.equal(p.logged, 25000, 'payments before it was marked behind do not count');
  assert.equal(p.caughtUp, true);
  assert.equal(catchUpProgress({ ...loan, debt_status: 'normal' }, 0, [e('2026-10-10', '90000')], '2026-10-17').caughtUp, false);
  // Blank overdue: one EMI.
  assert.equal(catchUpProgress({ ...loan, overdue_amount: undefined }, 0, [e('2026-10-10', '10000')], '2026-10-17').caughtUp, true);
  const ui = src('components/home/CatchUpCheck.tsx');
  assert.match(ui, /SET IT BACK TO PAYING NORMALLY/);
  assert.match(ui, /debt_status: undefined, overdue_amount: undefined/);
  assert.match(src('components/home/HomeDebtHelp.tsx'), /<CatchUpCheck /);
});

test('item 3: the settlement pot is a set-aside row on Home with its one line why, marked DRAFT', () => {
  const d = payThisMonth(plan([car, card], { 0: '10000', 1: '2500' }, { 0: '10000', 1: '2500' }, { catchUp: {}, pot: { 1: '27500' } }, { surplus: 27500, surplusAllocation: { efSlice: 0, goalSlice: 0, surplus: 27500 } }), '2026-10-17');
  const pot = d.rows.find((r) => r.kind === 'pot');
  assert.equal(pot.amount, 27500);
  assert.equal(pot.potFor, 1);
  assert.equal(pot.loanIndex, null);
  assert.match(pot.name, /^Settlement pot · /);
  assert.equal(d.rows.find((r) => r.loanIndex === 1).held, 'collections');
  assert.equal(d.leftOver, 0, 'the pot is not "left over"');
  assert.match(status.POT_WHY, /weakens your hand/);
  assert.match(status.POT_WHY, /doesn’t count it as paid/);
  assert.equal(LEGAL_REVIEW['settlement-pot'], 'pending');
  assert.match(src('components/home/PayThisMonth.tsx'), /<DraftLegalMarker id="settlement-pot" \/>/);
});

test('item 4: MY SPLIT can send money to a collections loan, with one note and no block', () => {
  const ui = src('app/tools/windfall/tool.tsx');
  assert.match(ui, /collections: true/);
  assert.match(ui, /t\.collections && v > 0/);
  assert.doesNotMatch(ui, /blocked: [^,]*collections/);
  assert.match(status.COLLECTIONS_SPLIT_NOTE, /Your choice stands/);
});

test('item 5: payday snapshot sends catch-up and collections lines, not normal dues', () => {
  const behind = { ...car, debt_status: 'behind' };
  const d = payThisMonth(plan([behind, card], { 0: '20000', 1: '2500' }, { 0: '10000', 1: '2500' }, { catchUp: { 0: '10000' }, pot: { 1: '17500' } }), '2026-10-17');
  const s = paydaySnapshot(d, 'IN', '2026-10-17');
  const kinds = Object.fromEntries(s.rows.map((r) => [r.name, r.kind]));
  assert.equal(kinds['HDFC auto loan'] ?? Object.values(kinds)[0], 'catch_up');
  assert.ok(s.rows.some((r) => r.kind === 'collections'));
  assert.ok(s.rows.some((r) => r.kind === 'pot'));
  assert.ok(!s.rows.some((r) => r.kind === 'minimum' || r.kind === 'emi'));
});
