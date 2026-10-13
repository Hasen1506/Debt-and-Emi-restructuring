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

// Live re-test 13 Oct 2026 (LIVE-RETEST-2026-10-13.md).

test('NEW-1: an amount field never hands raw text to its caller', () => {
  const { amountForCaller, isPartialScale, isImmediateAmountError, parseAmountText } = lib('amount.ts');
  assert.equal(amountForCaller('25 la'), '');
  assert.doesNotThrow(() => amountForCaller('2,50,00,00,25,0000'));
  assert.equal(amountForCaller('25 lakh'), '2500000');
  assert.equal(amountForCaller('25,00,000'), '2500000');
  assert.equal(amountForCaller(''), '');
  // Half-typed scale words are still typing, not an error yet.
  for (const t of ['25 l a', '25 la', '25 lak', '1.5 cro', '2 mil'].slice(1)) {
    assert.equal(isPartialScale(t), true, t);
    assert.equal(isImmediateAmountError(t, parseAmountText(t)), false, t);
  }
  assert.equal(isPartialScale('25 xyz'), false);
  const field = src('components/ToolPrimitives.tsx');
  assert.match(field, /onChange\(amountForCaller\(next\.text, currency\)\)/);
  assert.doesNotMatch(field, /\.value \?\? raw\)/);
  assert.match(field, /onChange\(f \?\? ''\)/);
});

test('NEW-1: derived maths never throws on half-typed or non-numeric text', () => {
  const { deriveTenureMonths } = lib('derived.ts');
  for (const bad of ['25 la', '2,50,00,00,25,0000', 'abc', NaN, Infinity, undefined, null, '']) {
    assert.doesNotThrow(() => deriveTenureMonths(bad, '0.086', '22000'));
    assert.doesNotThrow(() => deriveTenureMonths('2500000', bad, '22000'));
    assert.doesNotThrow(() => deriveTenureMonths('2500000', '0.086', bad));
  }
  assert.equal(deriveTenureMonths('25 la', '0.086', '22000'), null);
  assert.equal(deriveTenureMonths('2500000', '0.086', '22000') > 200, true);
});

test('NEW-3/NEW-4: an EMI at or below the monthly interest is blocked with the numbers and a 10x check', () => {
  const { emiBelowInterest, loanDraftErrors } = lib('loan-gaps.ts');
  const tenX = { loan_type: 'home_loan', outstanding: '25000000', nominal_rate: '0.086', scheduled_emi: '22000' };
  const msg = emiBelowInterest(tenX);
  assert.match(msg, /At 8\.6%, ₹2\.5 crore earns ₹1,79,167 interest a month, more than the ₹22,000 EMI/);
  assert.match(msg, /did you mean ₹25 lakh\?/);
  assert.equal(loanDraftErrors(tenX).emi, msg);
  assert.equal(emiBelowInterest({ ...tenX, outstanding: '2500000' }), null);
  assert.deepEqual(loanDraftErrors({ ...tenX, outstanding: '2500000' }), {});
  // No "did you mean" when a tenth wouldn't clear either.
  assert.doesNotMatch(emiBelowInterest({ ...tenX, scheduled_emi: '1000' }), /did you mean/);
  // Cards have no EMI to check.
  assert.equal(emiBelowInterest({ ...tenX, loan_type: 'credit_card' }), null);
  assert.match(src('components/setup/QuickSetup.tsx'), /emiBelowInterest\(\{ \.\.\.loan, currency: ccy \}\)/);
  assert.match(src('app/profile/ProfileClient.tsx'), /emiBelowInterest\(loan\) \?/);
});

test('NEW-2/NEW-3: Plan never prints unbounded totals', () => {
  const plan = src('components/plan/LedgerPlan.tsx');
  assert.match(plan, /MINIMUMS ALONE NEVER CLEAR IT'\n\s+: interestSaved >= 1 && sane\(interestSaved\)/);
  assert.match(plan, /return <NeverClears plan=\{plan\} fc=\{fc\} \/>/);
  assert.match(plan, /never repaid: it grows without limit/);
  const tw = src('components/plan/TenureWhatIf.tsx');
  assert.match(tw, /neverClears\n\s+\? r\.scenario_never_clears/);
});
