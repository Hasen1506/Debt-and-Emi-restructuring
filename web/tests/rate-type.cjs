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

const { planGivens } = require(path.join(root, 'lib', 'plan-givens.ts'));
test('what the plan takes as given: a stale balance and an old "fixed" home loan are to check', () => {
  const user = {
    country: 'IN', monthly_income: '150000', fixed_expenses: '60000', variable_expenses: '0',
    loans: [
      { loan_type: 'home_loan', bank: 'SBI', outstanding: '4000000', nominal_rate: '0.085', rate_type: 'fixed', tenure_months_remaining: 180, scheduled_emi: '39400', balance_as_of: '2026-05-01' },
      { loan_type: 'credit_card', bank: '', outstanding: '80000', nominal_rate: '0.42', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '0', balance_as_of: '2026-10-02' },
    ],
  };
  const g = planGivens(user, { today: '2026-10-03', inflation: { on: false, rate: 0 }, hike: { on: false, rate: 0, month: 4 } });
  const by = Object.fromEntries(g.map((x) => [x.key, x]));
  assert.equal(by.balances.source, 'CHECK');
  assert.match(by.balances.lines[0], /5 months ago/);
  assert.equal(by['rate-type'].source, 'CHECK');
  assert.match(by['rate-type'].lines[0], /usually floating/);
  assert.equal(by.cards.source, 'ASSUMED');
  assert.equal(by.rates.source, 'ASSUMED');
  // Picked as floating and dated today: nothing to check there.
  user.loans[0] = { ...user.loans[0], rate_type: 'floating', rate_type_assumed: false, balance_as_of: '2026-10-01', balance_after_emi: true };
  const g2 = Object.fromEntries(planGivens(user, { today: '2026-10-03', inflation: { on: true, rate: 0.05 }, hike: { on: false, rate: 0, month: 4 } }).map((x) => [x.key, x]));
  assert.equal(g2.balances.source, 'YOU SAID');
  assert.match(g2.balances.lines[0], /after that month's EMI/);
  assert.equal(g2['rate-type'].source, 'YOU SAID');
  assert.match(g2.rates.lines[1], /SBI home loan is floating/);
  assert.match(g2.spending.lines[0], /rising 5\.0% a year/);
});
