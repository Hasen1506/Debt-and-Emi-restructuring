const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith('@/'))
        request = path.join(root, request.slice(2));
    // lib/rate-cards.ts sits beside its data, rate-cards.json: take the module.
    if (request.endsWith(path.join('lib', 'rate-cards')))
        request += '.ts';
    return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'next/navigation')
        return { useRouter: () => ({ refresh() { } }) };
    return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
    require.extensions[ext] = (module, file) => {
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
        module._compile(output, file);
    };
const lib = name => require(path.join(root, 'lib', name));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src_ = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// PR C (roadmap 2026-10-07): the true annual cost, the TypeScript twin of engine/true_apr.py.
test('differential: the TypeScript true annual cost matches the engine on every fixture case', () => {
  const { trueApr } = lib('true-apr.ts');
  const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/true_apr_cases.json'), 'utf8'));
  assert.ok(cases.length >= 40);
  for (const c of cases) {
    const got = trueApr(c.in);
    for (const k of Object.keys(c.out)) assert.ok(Math.abs(got[k] - c.out[k]) < 1e-9, `${JSON.stringify(c.in)} ${k}: ${got[k]} vs ${c.out[k]}`);
  }
});

test('one rate for a loan: a 42% Indian card costs 62.52% a year on its row, in its breakdown and by its cash flows', () => {
  const { computeBreakdown } = lib('effective-apr.ts');
  const { loanMarginalCost } = lib('marginal-cost.ts');
  const { trueApr, trueAprInputsFromBreakdown } = lib('true-apr.ts');
  const loan = { id: 'c', bank: 'HDFC', loan_type: 'credit_card', outstanding: '50000', nominal_rate: '0.42', currency: 'INR' };
  // GST is billed monthly and compounds with the interest: (1 + 3.5% × 1.18)^12 − 1.
  const mc = loanMarginalCost(loan, 'IN', '0.3', 'new');
  assert.equal(mc.annualCost.toFixed(4), '0.6252');
  // The cash-flow figure (engine/true_apr.py's twin) agrees when nothing was paid upfront.
  const b = computeBreakdown(loan, '0.3', 'IN', undefined);
  assert.ok(Math.abs(trueApr(trueAprInputsFromBreakdown(loan, b.lines)).apr - 0.6252) < 0.0001);
  // The breakdown a row opens shows that one figure, not the old simple sum (49.56%).
  const { EffectiveAprBreakdown } = require(path.join(root, 'components/EffectiveAprBreakdown.tsx'));
  const html = renderToStaticMarkup(React.createElement(EffectiveAprBreakdown, { loan, marginalTaxRate: '0.3', country: 'IN', taxRegime: 'new' }));
  assert.match(html, /What it costs you a year/);
  assert.match(html, /= 62\.52%/);
  assert.doesNotMatch(html, /49\.56%/);
  // A loan with an upfront fee: the yearly cost leaves it out (already paid) and the note gives the all-in figure.
  const pl = { id: 'p', bank: 'SBI', loan_type: 'personal_loan', outstanding: '300000', nominal_rate: '0.14', currency: 'INR', tenure_months_remaining: 36, processing_fee_amortised: '0.01' };
  const html2 = renderToStaticMarkup(React.createElement(EffectiveAprBreakdown, { loan: pl, marginalTaxRate: '0.3', country: 'IN', taxRegime: 'new' }));
  assert.match(html2, /= 14\.93%/);
  assert.match(html2, /paid upfront, it costs \d+\.\d\d% a year over its life/);
});

test('Home and Plan rank and show loans by that cost: the dearest flag is the avalanche top', () => {
  const { deriveMetrics } = lib('derived.ts');
  const { payoffOrders } = lib('payoff-order.ts');
  const base = { outstanding: '300000', tenure_months_remaining: 36, scheduled_emi: '10000', rate_type: 'fixed', currency: 'INR' };
  // 14% with a 4% fee spread (old simple sum: 18%+) against a plain 16% loan: the 16% one costs more from here.
  const user = { country: 'IN', tax_regime: 'new', monthly_income: '200000', fixed_expenses: '50000', loans: [
    { ...base, id: 'a', bank: 'A', loan_type: 'personal_loan', nominal_rate: '0.14', processing_fee_amortised: '0.03', insurance_premium_pct: '0.01' },
    { ...base, id: 'b', bank: 'B', loan_type: 'personal_loan', nominal_rate: '0.16' },
  ] };
  const m = deriveMetrics({ user, marginalRate: '0.3' });
  assert.equal(m.loudest.index, payoffOrders(user, '0.3').avalanche[0]);
  assert.equal(m.loudest.index, 1);
  assert.equal(m.loans[1].effective.toFixed(4), m.loans[1].cost.annualCost.toFixed(4));
  for (const f of ['components/home/OpenPositions.tsx', 'components/plan/PlanNotes.tsx', 'components/WhatIfPanel.tsx']) {
    assert.doesNotMatch(src_(f), /computeBreakdown\([^)]*\)\.effective|b\.effective|\{ effective \} = computeBreakdown/, f);
  }
});
