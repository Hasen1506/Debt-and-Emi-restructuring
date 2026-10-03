// Fixed or floating when the borrower isn't sure (AUDIT §10 M2).
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
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  module._compile(output, file);
};
const rt = require(path.join(root, 'lib', 'rate-type.ts'));

test('not sure takes the usual type: Indian bank home and education loans float, the rest are fixed', () => {
  assert.equal(rt.likelyRateType('home_loan', 'IN'), 'floating');
  assert.equal(rt.likelyRateType('education_loan', 'IN'), 'floating');
  for (const t of ['personal_loan', 'auto_loan', 'gold_loan', 'bnpl']) assert.equal(rt.likelyRateType(t, 'IN'), 'fixed');
  assert.equal(rt.likelyRateType('home_loan', 'US'), 'fixed');
});

test('a new kind of loan brings its usual type unless the borrower picked one', () => {
  const card = { loan_type: 'credit_card', rate_type: 'fixed', rate_type_assumed: true };
  const home = rt.patchLoanKeepingRateType(card, { loan_type: 'home_loan' }, 'IN');
  assert.equal(home.rate_type, 'floating');
  assert.equal(home.rate_type_assumed, true);
  const picked = { ...home, ...rt.applyRateTypeChoice('fixed', 'home_loan', 'IN') };
  assert.equal(rt.rateTypeChoice(picked), 'fixed');
  const personal = rt.patchLoanKeepingRateType(picked, { loan_type: 'personal_loan' }, 'IN');
  assert.equal(personal.rate_type, 'fixed');
  assert.equal(personal.rate_type_assumed, false);
  // Back to not sure: the usual again.
  assert.deepEqual(rt.applyRateTypeChoice('unsure', 'home_loan', 'IN'), { rate_type: 'floating', rate_type_assumed: true });
});
