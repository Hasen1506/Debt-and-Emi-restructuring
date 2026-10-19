// Property tests for the shared amortization module (fast-check).
// Invariants, not examples: the EMI and the months to clear are inverses,
// a walked schedule never owes a negative balance, interest plus principal
// equals what was paid (to the paisa), and an INR quote is the rupee ceiling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const fc = require('fast-check');
const Decimal = require('decimal.js');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  module._compile(output, file);
};
const { emi, monthsToClear, remainingBalance, walkSchedule, roundEmi, interestFromPayments } = require(path.join(root, 'lib/amortization.ts'));

const RUNS = 80;
const loan = {
  principal: fc.integer({ min: 10_000, max: 5_000_000 }),
  // 0.00% to 24.00%, in basis points, so the rate is a clean decimal.
  bps: fc.integer({ min: 0, max: 2400 }),
  months: fc.integer({ min: 1, max: 360 }),
};

test('property: the EMI and the months to clear are inverses', () => {
  fc.assert(
    fc.property(loan.principal, loan.bps, loan.months, (principal, bps, months) => {
      const rate = bps / 10_000;
      const payment = emi(principal, rate, months);
      const back = monthsToClear(principal, rate, payment);
      assert.equal(back, months, `${principal} at ${rate} for ${months}`);
    }),
    { numRuns: RUNS },
  );
});

test('property: a schedule never ends negative, and interest plus principal is what was paid', () => {
  fc.assert(
    fc.property(loan.principal, loan.bps, loan.months, (principal, bps, months) => {
      const rate = bps / 10_000;
      const payment = emi(principal, rate, months);
      const walked = walkSchedule(principal, rate, payment, months);
      assert.ok(walked.endBalance.gte(0), 'balance went negative');
      assert.ok(walked.endBalance.lt('0.01'), `left ${walked.endBalance}`);
      // To the paisa: the principal repaid is the opening balance.
      assert.ok(walked.principal.minus(principal).abs().lt('0.01'), `principal ${walked.principal}`);
      // One month, worked outside the walk: interest is balance × r,
      // principal is the payment less that interest, and they sum to the payment.
      const r = new Decimal(rate).div(12);
      const monthInterest = new Decimal(principal).mul(r);
      const one = walkSchedule(principal, rate, payment, 1);
      const payThis = Decimal.min(payment, new Decimal(principal).plus(monthInterest));
      assert.ok(one.interest.minus(monthInterest).abs().lt('0.0000001'));
      assert.ok(one.principal.minus(payThis.minus(monthInterest)).abs().lt('0.0000001'));
      assert.ok(one.interest.plus(one.principal).minus(payThis).abs().lt('0.0000001'));
      assert.ok(one.endBalance.gte(0));
      assert.equal(Number(remainingBalance(principal, rate, months, months)), 0);
    }),
    { numRuns: RUNS },
  );
});

test('property: an INR quote is the next rupee, and one loan cannot hide another’s interest', () => {
  fc.assert(
    fc.property(loan.principal, loan.bps, loan.months, fc.integer({ min: 1_000, max: 2_000_000 }), (principal, bps, months, other) => {
      const rate = bps / 10_000;
      const raw = emi(principal, rate, months);
      const quoted = roundEmi(principal, rate, months, 'INR');
      assert.equal(quoted, raw.toDecimalPlaces(0, Decimal.ROUND_CEIL).toFixed(0));
      const loans = [
        { outstanding: String(principal) },
        { outstanding: String(other) },
      ];
      const interest = interestFromPayments(loans, { 0: principal + 500, 1: Math.floor(other / 2) });
      assert.equal(interest, 500);
    }),
    { numRuns: RUNS },
  );
});
