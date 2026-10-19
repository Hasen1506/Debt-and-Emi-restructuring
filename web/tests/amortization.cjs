// Shared reducing-balance math (lib/amortization.ts). Worked examples,
// including the edges the inlined copies used to get wrong: a last payment
// that is smaller than the EMI, a zero rate, a one-month loan, a 30-year
// loan, a prepayment, and two loans in one currency.
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
const { emi, emiNumber, roundEmi, monthsToClear, remainingBalance, walkSchedule, interestFromPayments } = lib('amortization.ts');
const { rateMove } = lib('rate-decision.ts');
const { derivePerCurrencyMetrics } = lib('currency.ts');

const near = (a, b, eps = 0.02) => assert.ok(Math.abs(Number(a) - b) <= eps, `${a} ≉ ${b}`);

test('EMI: 12% for a year, zero interest, one month, and no tenure', () => {
  // ₹1,00,000 at 12% for 12 months = ₹8,884.88.
  near(emi(100000, 0.12, 12), 8884.878868, 0.001);
  assert.equal(Number(emi(120000, 0, 10)), 12000);
  assert.equal(Number(emi(100000, 0.12, 1)), 101000);
  assert.equal(Number(emi(5000, 0.1, 0)), 5000);
  assert.equal(emiNumber(100000, 0.12, 0), 0);
});

test('the EMI and the months to clear are inverses, including a 30-year loan', () => {
  const payment = emi(5000000, 0.08, 360);
  assert.equal(monthsToClear(5000000, 0.08, payment), 360);
  assert.equal(monthsToClear(100000, 0, 10000), 10);
  // ₹28,000 does not cover the interest on ₹40 lakh at 8.5%.
  assert.equal(monthsToClear(4000000, 0.085, 28000), null);
  // Still owed halfway, clear at the end.
  assert.ok(Number(remainingBalance(5000000, 0.08, 360, 180)) > 1000000);
  assert.equal(Number(remainingBalance(5000000, 0.08, 360, 360)), 0);
});

test('a payment larger than the balance charges one month of interest and stops', () => {
  // ₹5,000 at 12%, EMI ₹10,000. Interest is ₹50, then the loan is gone.
  const walked = walkSchedule(5000, 0.12, 10000, 12);
  near(walked.interest, 50, 0.001);
  assert.equal(Number(walked.endBalance), 0);
  near(walked.principal, 5000, 0.001);
});

test('prepaying part of a loan saves some interest and a zero-rate loan saves none', () => {
  const payment = Number(emi(100000, 0.12, 24));
  const full = Number(walkSchedule(100000, 0.12, payment, 24).interest);
  const after = Number(walkSchedule(80000, 0.12, payment, 24).interest);
  assert.ok(full - after > 1000 && full - after < full);
  assert.equal(Number(walkSchedule(100000, 0, 10000, 10).interest), 0);
});

test('an INR EMI quote rounds up to the rupee and a USD quote up to the cent', () => {
  // 8884.878… rupees is quoted as ₹8,885.
  assert.equal(roundEmi(100000, 0.12, 12, 'INR'), '8885');
  const usd = roundEmi(10000, 0.06, 36, 'USD');
  assert.match(usd, /^\d+\.\d{2}$/);
  assert.ok(Number(usd) >= Number(emi(10000, 0.06, 36)));
});

test('two loans in one currency do not cancel each other\'s interest', () => {
  // Loan A is paid past its principal (₹50,000 of that is interest).
  // Loan B is not. Bucket-level min(paid, principal) used to say ₹0.
  const loans = [
    { outstanding: '500000', currency: 'INR', scheduled_emi: '0', nominal_rate: '0.1', loan_type: 'personal_loan' },
    { outstanding: '300000', currency: 'INR', scheduled_emi: '0', nominal_rate: '0.1', loan_type: 'personal_loan' },
  ];
  assert.equal(interestFromPayments(loans, { 0: 550000, 1: 250000 }), 50000);
  const metrics = derivePerCurrencyMetrics(loans, [
    { month: 1, perLoan: { 0: '550000', 1: '250000' }, totalPaid: 800000, extraPaid: 0 },
  ], 'IN');
  assert.equal(metrics.INR.totalInterestScenario, 50000);
  assert.equal(metrics.INR.totalPaidScenario, 800000);
});

test('a rate step is measured from the EMI being paid, not a recomputed one', () => {
  const loan = {
    id: 'h', loan_type: 'home_loan', bank: 'SBI', outstanding: '1000000',
    nominal_rate: '0.0825', rate_type: 'floating', scheduled_emi: '12500', tenure_months_remaining: 120,
  };
  const move = rateMove(loan, 'IN');
  assert.equal(move.emi.now, 12500);
  const formulaNow = Number(emi(1000000, 0.0825, 120));
  assert.ok(Math.abs(formulaNow - 12500) > 50, `formula ${formulaNow} should differ from the scheduled EMI`);
  // The rise is the new formula EMI minus ₹12,500, not minus the old formula.
  const fromScheduled = move.emi.up - 12500;
  const fromFormula = move.emi.up - formulaNow;
  assert.ok(Math.abs(fromScheduled - fromFormula) > 50);
});
