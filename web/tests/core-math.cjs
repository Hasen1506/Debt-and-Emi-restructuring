// Money math that had no test of its own: tax slabs, card minimums, the
// loan-detail checks, the plan chart's data, and where Plan's schedule and
// chart start (the owner read a payoff month's small last payment as what
// was owed on the card).
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
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
  module._compile(output, file);
};
const lib = (name) => require(path.join(root, 'lib', name));
const tax = lib('tax-brackets.ts');
const { requiredMonthly } = lib('min-payment.ts');
const { loanGaps, rateOutOfRange } = lib('loan-gaps.ts');
const { mergeTrajectories } = lib('trajectory.ts');
const { loanClears, owedAtStart } = require(path.join(root, 'components/plan/plan-milestones.ts'));

const near = (a, b, eps = 0.5) => assert.ok(Math.abs(Number(a) - b) <= eps, `${a} ≉ ${b}`);

test('India new regime: no tax up to ₹12L taxable, slab tax plus 4% cess above it', () => {
  near(tax.incomeTaxIN(1200000, 'new'), 0);
  // 4–8L at 5%, 8–12L at 10%, 12–16L at 15%, 16–18L at 20%: ₹1,60,000 + cess.
  near(tax.incomeTaxIN(1800000, 'new'), 166400);
  // Marginal relief just above ₹12L: the tax is no more than the income above it.
  near(tax.incomeTaxIN(1210000, 'new'), 10400);
  // The ₹75,000 standard deduction for salaried income.
  near(tax.computeAnnualTax('IN', 'new', 'salaried', 1275000, undefined), 0);
});

test('India marginal rate: 0 under the rebate line, slab × cess above it', () => {
  assert.equal(tax.marginalRateIN(1100000, 'new'), 0);
  near(tax.marginalRateIN(1800000, 'new'), 0.208, 1e-9);
  near(tax.marginalRateIN(3000000, 'new'), 0.312, 1e-9);
});

test('US federal tax rises with income and its marginal rate never falls', () => {
  let lastTax = -1;
  let lastRate = 0;
  for (const income of [0, 10000, 40000, 90000, 200000, 400000, 800000]) {
    const t = Number(tax.federalTaxUS(income, 'single'));
    const r = tax.marginalRateUS(income, 'single');
    assert.ok(t >= lastTax, `tax at ${income}`);
    assert.ok(r >= lastRate, `rate at ${income}`);
    lastTax = t;
    lastRate = r;
  }
  assert.equal(Number(tax.federalTaxUS(0, 'single')), 0);
  // Married filing jointly pays less than single on the same income.
  assert.ok(Number(tax.federalTaxUS(150000, 'mfj')) < Number(tax.federalTaxUS(150000, 'single')));
});

test('what a loan needs each month: its EMI, a card’s minimum, or the minimum the user set', () => {
  const emiLoan = { loan_type: 'personal_loan', outstanding: '200000', nominal_rate: '0.14', scheduled_emi: '9500' };
  assert.equal(Number(requiredMonthly(emiLoan, 'IN')), 9500);
  const card = { loan_type: 'credit_card', bank: 'HDFC Bank', outstanding: '80000', nominal_rate: '0.42', scheduled_emi: '0' };
  const min = Number(requiredMonthly(card, 'IN'));
  assert.ok(min > 0 && min < 80000, `card minimum ${min}`);
  assert.equal(Number(requiredMonthly({ ...card, min_payment_override: '4000' }, 'IN')), 4000);
});

test('loan checks: a missing rate or EMI is a gap; a card needs no EMI; a 0% personal loan is allowed', () => {
  assert.deepEqual(loanGaps({ loan_type: 'home_loan', nominal_rate: '0', scheduled_emi: '0', outstanding: '1' }), ['rate', 'emi']);
  // "No-cost EMI" offers are real: 0% on a personal loan stands.
  assert.deepEqual(loanGaps({ loan_type: 'personal_loan', nominal_rate: '0', scheduled_emi: '5000', outstanding: '1' }), []);
  assert.deepEqual(loanGaps({ loan_type: 'credit_card', nominal_rate: '0.42', scheduled_emi: '0', outstanding: '1' }), []);
  assert.equal(rateOutOfRange('0.14'), null);
  assert.ok(rateOutOfRange('14'), 'a rate typed as 14 (not 0.14) is out of range');
});

test('chart data: both lines run to the longer one, the shorter padded with 0', () => {
  const plan = { trajectory: [{ month: 1, balance: '100', interest_paid: '2' }, { month: 2, balance: '0', interest_paid: '1' }] };
  const mins = { trajectory: [{ month: 1, balance: '100' }, { month: 2, balance: '80' }, { month: 3, balance: '60' }] };
  const pts = mergeTrajectories(plan, mins);
  assert.deepEqual(pts.map((p) => [p.month, p.avalanche, p.minimums]), [[1, 100, 100], [2, 0, 80], [3, 0, 60]]);
  assert.equal(pts[0].interest, 2);
});

// A plan as Plan's components get it: a card and a loan, the card cleared in
// month 3 with a small last payment.
const planFixture = () => ({
  user: {
    country: 'IN',
    loans: [
      { id: 'c', loan_type: 'credit_card', bank: 'HDFC Bank', outstanding: '80000', nominal_rate: '0.42', scheduled_emi: '0', min_payment_override: '4000' },
      { id: 'p', loan_type: 'personal_loan', bank: '', outstanding: '200000', nominal_rate: '0.14', scheduled_emi: '9500', tenure_months_remaining: 25 },
      // Taken out later (a planned purchase): not owed at the start.
      { id: 'n', loan_type: 'auto_loan', bank: '', outstanding: '500000', nominal_rate: '0.09', scheduled_emi: '12000', tenure_months_remaining: 48, planned_effective_month: 6 },
    ],
    fx_to_user_currency: {},
  },
  marginalRate: 0.312,
  trajectory: [
    { month: 1, avalanche: 250000, minimums: 270000, balancesByLoanIndex: { 0: 57000, 1: 193000, 2: 0 } },
    { month: 2, avalanche: 220000, minimums: 268000, balancesByLoanIndex: { 0: 33000, 1: 187000, 2: 0 } },
    { month: 3, avalanche: 180000, minimums: 266000, balancesByLoanIndex: { 0: 0, 1: 180000, 2: 0 } },
  ],
  monthlyPayments: [
    { month: 1, perLoan: { 0: '26000', 1: '9500' }, totalPaid: 35500, extraPaid: 22000 },
    { month: 2, perLoan: { 0: '26000', 1: '9500' }, totalPaid: 35500, extraPaid: 22000 },
    { month: 3, perLoan: { 0: '9435', 1: '26065' }, totalPaid: 35500, extraPaid: 22000 },
  ],
});

test('the schedule and chart start from what’s owed now, before this month’s payments', () => {
  const plan = planFixture();
  // ₹80,000 + ₹2,00,000; the car loan that starts in month 6 isn't owed yet.
  assert.equal(owedAtStart(plan), 280000);
  // The start is above month 1's balance (that's after October's payments).
  assert.ok(owedAtStart(plan) > plan.trajectory[0].avalanche);
});

test('a loan’s last payment month is the month its balance reaches 0', () => {
  const clears = loanClears(planFixture());
  assert.deepEqual(clears.map((c) => [c.index, c.month]), [[0, 3]]);
});
