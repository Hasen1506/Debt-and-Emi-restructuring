// Round 3 integration follow-ups (17 Oct 2026): Home's pay list and Can't-pay
// after r3b (debt status, salary-deducted EMI) met r3c/r3d's PayThisMonth.
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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Take-home ₹1,00,000 is already after the ₹10,000 salary EMI (loan 0); the
// API added it back, so the plan's month pays it alongside the car loan.
const plan = (loans, perLoan, mins, extra = {}) => ({
  live: true,
  user: { country: 'IN', income_type: 'business_owner', monthly_income: '100000', fixed_expenses: '50000', variable_expenses: '0', loans },
  monthlyPayments: [{ month: 1, perLoan }],
  trajectory: [{ month: 1, balancesByLoanIndex: Object.fromEntries(Object.keys(perLoan).map((k) => [k, '100000'])) }],
  firstMonthMinimums: mins,
  surplusAllocation: { efSlice: 0, goalSlice: 0, surplus: 30000 },
  surplus: 30000, shortfall: 0, fxRatesUsed: {}, debtBudget: '', advanceTaxSchedule: null, ...extra,
});
const govt = { loan_type: 'personal_loan', bank: 'GPF', outstanding: '300000', nominal_rate: '0.08', scheduled_emi: '10000', salary_deducted: true };
const car = { loan_type: 'auto_loan', bank: 'HDFC', outstanding: '600000', nominal_rate: '0.09', scheduled_emi: '10000' };

test('#21: a salary-deducted EMI is not a row to tick and not in the dues', () => {
  const d = payThisMonth(plan([govt, car], { 0: '10000', 1: '40000' }, { 0: '10000', 1: '10000' }), '2026-10-17');
  assert.equal(d.rows.some((r) => r.loanIndex === 0), false);
  assert.deepEqual(d.fromSalary, ['GPF personal loan']);
  assert.equal(d.duesUser, 10000, 'only the car EMI');
  assert.equal(d.extraUser, 30000);
  assert.equal(d.total, 40000);
  assert.ok(d.total <= 100000 - 50000, 'never more than take-home less spending');
});

test('#21: an extra on a salary-deducted loan is listed, without its EMI', () => {
  const d = payThisMonth(plan([govt, car], { 0: '40000', 1: '10000' }, { 0: '10000', 1: '10000' }), '2026-10-17');
  const r = d.rows.find((x) => x.loanIndex === 0);
  assert.equal(r.fromSalary, true);
  assert.equal(r.minimum, 0);
  assert.equal(r.amount, 30000);
  assert.equal(r.kind, 'extra');
  assert.equal(d.duesUser, 10000);
  assert.deepEqual(d.fromSalary, []);
});

test('#13: collections rows are held (shown, not ticked); behind rows are paid (founder, 17 Oct 2026: r3e)', () => {
  const behind = { ...car, debt_status: 'behind' };
  const coll = { loan_type: 'credit_card', bank: 'SBI', outstanding: '50000', nominal_rate: '0.42', debt_status: 'collections' };
  const d = payThisMonth(plan([behind, coll], { 0: '10000', 1: '2500' }, { 0: '10000', 1: '2500' }), '2026-10-17');
  assert.equal(d.rows.find((r) => r.loanIndex === 0).held, undefined);
  assert.equal(d.rows.find((r) => r.loanIndex === 0).behind, true);
  assert.equal(d.rows.find((r) => r.loanIndex === 1).held, 'collections');
  const ui = src('components/home/PayThisMonth.tsx');
  assert.match(ui, /row\.held && !st \?/);
  assert.match(ui, /row\.loanIndex === null \|\| row\.held \|\| statusOf\(row\)/, 'All paid from email skips held rows');
  assert.match(ui, /!data\.rows\[i\]\.held/, 'held rows are not counted as "to go"');
});

test("#21: Can't-pay shares spare cash without salary-deducted EMIs", () => {
  const cp = src('components/distress/CantPay.tsx');
  assert.match(cp, /emiOffTakeHome\(l\.loan\)/);
});

test('E2E_FROZEN_NOW defaults parse as a date', () => {
  for (const f of ['../playwright.config.ts', '../e2e/fixtures.ts', '../e2e/freeze-time.cjs', '../../scripts/verify-all.sh']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    const m = s.match(/E2E_FROZEN_NOW\s*(?:\?\?|\|\||:-)\s*['"]?([^'"}]+)/);
    assert.ok(m, f);
    assert.ok(!Number.isNaN(Date.parse(m[1])), `${f}: ${m[1]}`);
  }
});

test('#20 x country switch: a loan converted ₹ -> $ is not asked "prepayment or entered wrong?"', () => {
  const { balanceDropOf } = require(path.join(root, 'lib', 'prepay-choice.ts'));
  const saved = [{ id: 'a', loan_type: 'personal_loan', outstanding: '150000', currency: 'INR' }];
  assert.equal(balanceDropOf({ id: 'a', loan_type: 'personal_loan', outstanding: '1801.80', currency: 'USD' }, saved), 0);
  assert.equal(balanceDropOf({ id: 'a', loan_type: 'personal_loan', outstanding: '100000', currency: 'INR' }, saved), 50000);
  assert.match(src('app/profile/ProfileClient.tsx'), /balanceDropOf\(\{ \.\.\.l, currency: loanCurrency\(l, country\) \}, savedLoans\)/);
});
