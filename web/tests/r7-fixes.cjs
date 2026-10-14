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

// Live re-test 7 fix round (R7-1..R7-7, O-4).

test('R7-1: text inputs, selects and textareas are 44px tall on a touch screen', () => {
  const css = src('styles/globals.css');
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
  const block = coarse.slice(0, coarse.indexOf('\n}\n') + 3);
  assert.match(block, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\)[^{]*,\s*textarea,\s*select\s*\{\s*min-height: 44px !important;/);
});

test('R7-2: one phrase for the short-month date, used by Setup, Plan and Home', () => {
  const g = lib('plan-gap.ts');
  const label = (m) => `Mar ${2026 + m}`;
  const money = (v) => `₹${v.toLocaleString('en-IN')}`;
  // Founder rule (answers L2 #16): "<date> if the ₹X/mo gap closes · as things stand <date>".
  // Audit 80+ A5 (golden updated on purpose): the gap-closed date is named in the line, not the headline.
  assert.equal(g.shortGapLine({ shortfall: 24000, asIsMonth: 4, closedMonth: 3, label, money }), 'if the ₹24,000/mo gap closes: Mar 2029 · as things stand: Mar 2030');
  assert.equal(g.shortGapLine({ shortfall: 24000, asIsMonth: null, closedMonth: 3, label, money }), 'if the ₹24,000/mo gap closes: Mar 2029 · as things stand: not in 30 years');
  assert.equal(g.shortGapLine({ shortfall: 24000, asIsMonth: null, closedMonth: null, label, money }), 'short ₹24,000/mo · as things stand: not in 30 years · no date even if this month’s gap closes');
  assert.equal(g.shortGapLine({ shortfall: 0, asIsMonth: 4, closedMonth: 3, label, money }), null);
  assert.equal(g.AS_IS_NEVER, 'not in 30 years');
  // Plan's headline is the same line in capitals.
  const h = g.shortHeadline({ shortfall: 24000, asIsMonth: null, closedMonth: 3, label, money });
  assert.equal(h.sub, 'IF THE ₹24,000/MO GAP CLOSES: MAR 2029 · AS THINGS STAND: NOT IN 30 YEARS');
  assert.equal(h.value, '₹24,000/MO SHORT');
  // Each surface calls the helper; nobody keeps its own wording.
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /shortGapLine\(\{/);
  assert.doesNotMatch(qs, /not in sight'/);
  assert.match(src('components/home/HomeDebtFree.tsx'), /shortGapLine\(\{/);
  assert.match(src('components/plan/LedgerPlan.tsx'), /shortHeadline\(\{/);
  assert.match(src('lib/plan-gap.ts'), /const line = shortGapLine\(args\)/);
});

test('R7-3: the disabled what-if row keeps its explanation at full contrast', () => {
  const w = src('components/WhatIfPanel.tsx');
  assert.doesNotMatch(w, /gap: 8,\s*opacity: disabled \? 0\.6 : 1/);
  assert.match(w, /accentColor: L_T\.accent, opacity: disabled \? 0\.6 : 1/);
});

test('R7-4: a print stylesheet hides the app chrome and keeps the figures', () => {
  const css = src('styles/globals.css');
  const p = css.slice(css.indexOf('@media print'));
  for (const sel of ['header', 'nav', 'button', "[role='menu']", "[data-print='hide']"]) assert.ok(p.includes(sel), sel);
  assert.match(p, /display: none !important/);
  assert.doesNotMatch(p.slice(0, p.indexOf('display: none')), /\btable\b|\bsvg\b/);
  const plan = src('components/plan/LedgerPlan.tsx');
  assert.match(plan, /id="what-if" data-print="hide"/);
  assert.match(plan, /aria-label="On this page" data-print="hide"/);
  assert.match(plan, /<div data-print="hide">\s*<DebtFreeRedirectPrompt/);
});

test('R7-5: a rate bound from the API is said in percent, and Sell to repay checks the rate as typed', () => {
  const fe = lib('form-errors.ts');
  assert.equal(fe.plainMessage('debt_effective_rate', 'debt_effective_rate: Input should be less than or equal to 10'), 'Must be 1000% or less.');
  assert.equal(fe.plainMessage('debt_effective_rate', 'Input should be greater than or equal to 0'), 'Must be 0% or more.');
  assert.equal(fe.plainMessage('user.loans.0.nominal_rate', 'Input should be less than or equal to 1'), 'Must be 100% or less.');
  // Non-rate fields keep their own units.
  assert.equal(fe.plainMessage('debt_balance', 'Input should be less than or equal to 10'), 'Must be 10 or less.');
  assert.equal(fe.plainMessage('exchange_rate', 'Input should be less than or equal to 10'), 'Must be 10 or less.');
  const r = lib('r7-inputs.ts');
  assert.equal(r.fractionAsPercent('0.125'), '12.5%');
  const tool = src('app/tools/liquidate/tool.tsx');
  assert.match(tool, /error=\{rateOutOfRange\(debtRate\) \?\? at\('debtRate'\)\}/);
  assert.match(tool, /const rateErr = rateOutOfRange\(debtRate\);/);
  const { rateOutOfRange } = lib('loan-gaps.ts');
  assert.ok(rateOutOfRange(String(99999999999999 / 100)));
  assert.ok(rateOutOfRange(String(-5000 / 100)));
  assert.equal(rateOutOfRange('0.12'), null);
});

test('R7-6: the New debt credit score is a whole number in the country’s range', () => {
  const r = lib('r7-inputs.ts');
  for (const bad of ['abc', '-5000', '1e9', '99999999999999', '5L', '299', '901', '750.5'])
    assert.equal(r.creditScoreError(bad, 'IN'), 'Enter a score from 300 to 900 (CIBIL/Experian/CRIF), a whole number.', bad);
  for (const ok of ['', '300', '750', '900']) assert.equal(r.creditScoreError(ok, 'IN'), null, ok);
  assert.equal(r.creditScoreError('851', 'US'), 'Enter a score from 300 to 850 (FICO), a whole number.');
  assert.equal(r.creditScoreError('850', 'US'), null);
  assert.equal(r.usableCreditScore('1e9', 'IN'), '');
  assert.equal(r.usableCreditScore(' 760 ', 'IN'), '760');
  const tool = src('app/tools/new-debt/tool.tsx');
  assert.match(tool, /error=\{at\('score'\) \?\? creditScoreError\(score, country\)\}/);
  assert.doesNotMatch(tool, /Number\(score\)/);
});

test('R7-7: US Setup says monthly payment, not EMI, and offers no gold loan', () => {
  const r = lib('r7-inputs.ts');
  assert.equal(r.paymentWords('US').field, 'Monthly payment');
  assert.equal(r.paymentWords('IN').field, 'EMI a month');
  const chips = [['credit_card', 'Card'], ['gold_loan', 'Gold'], ['bnpl', 'Pay later']];
  assert.deepEqual(r.loanKindsFor(chips, 'US').map(([t]) => t), ['credit_card', 'bnpl']);
  assert.deepEqual(r.loanKindsFor(chips, 'IN').map(([t]) => t), ['credit_card', 'gold_loan', 'bnpl']);
  // A saved gold loan keeps its chip.
  assert.deepEqual(r.loanKindsFor(chips, 'US', 'gold_loan').map(([t]) => t), ['credit_card', 'gold_loan', 'bnpl']);
  const qs = src('components/setup/QuickSetup.tsx');
  // No hard-coded EMI in a visible Setup label or line any more.
  for (const s of ['"Spending a month, without EMIs"', '"EMI a month"', '"Left each month, before EMIs"', '"Left each month, after EMIs"', 'Pay every EMI and card minimum', "'I KNOW THE EMI INSTEAD'", '"First EMI (year-month)"'])
    assert.ok(!qs.includes(s), s);
  assert.match(qs, /loanKindsFor\(TYPE_CHIPS, ccy === 'INR' \? 'IN' : country, loan\.loan_type\)/);
  assert.match(qs, /word=\{paymentWords\(country\)\.one\}/);
});
