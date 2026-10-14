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
    return originalResolve.call(this, request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
    require.extensions[ext] = (module, file) => {
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
        module._compile(output, file);
    };
const lib = name => require(path.join(root, 'lib', name));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Audit 80 W10: E5 (NRI drift + remittance), E6 (Setup FX race), E7 (US
// student-loan hold). Differential against engine/tests/fixtures/a80_w10_cases.json
// (scripts/export_a80_w10_cases.py), plus generic guards on the FX gate.
const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/a80_w10_cases.json'), 'utf8'));

test('E6: a rate still loading is pending, never an "enter a rate" error', () => {
  const { fxGate } = lib('fx-gate.ts');
  const r = fxGate(['INR'], {}, { INR: 'loading' }, 'USD');
  assert.deepEqual(r.pending, ['INR']);
  assert.deepEqual(r.errors, {});
});

test('E6 class guard: every combination of quote state and typed rate', () => {
  const { fxGate } = lib('fx-gate.ts');
  const quotes = [undefined, 'loading', 'failed', { rate: '0.0105', as_of: '2026-10-13' }];
  const typed = [undefined, '', '0', 'abc', '0.0105', '200000'];
  for (const q of quotes)
    for (const t of typed) {
      const { pending, errors } = fxGate(['INR'], t === undefined ? {} : { INR: t }, { INR: q }, 'USD');
      const ok = Number(t) > 0;
      // Never both pending and an error.
      assert.ok(!(pending.includes('INR') && errors.INR), JSON.stringify([q, t]));
      // Pending exactly when the fetch is running and nothing usable is typed.
      assert.equal(pending.includes('INR'), q === 'loading' && !ok, JSON.stringify([q, t]));
      // A usable typed rate in range is never an error, whatever the fetch did.
      if (ok && Number(t) <= 100000) assert.equal(errors.INR, undefined, JSON.stringify([q, t]));
      // A failed fetch with nothing typed asks for the rate, naming the failure.
      if (q === 'failed' && !ok) assert.match(errors.INR, /couldn't be fetched/);
    }
});

test('E6: Setup waits for the rate instead of refusing the step', () => {
  // Rendering QuickSetup needs the browser; the wiring is checked by the
  // Playwright journey e2e/a80-w10-personas.spec.ts (delayed /api/fx-rate).
  const { FX_WAIT_LABEL } = lib('fx-gate.ts');
  assert.match(FX_WAIT_LABEL, /RATE/);
});

test('E5: the plan and the NRI tool use one rupee slide (engine twin)', () => {
  const fx = lib('fx-drift.ts');
  assert.equal(fx.DEFAULT_FX_DRIFT, 'on');
  assert.equal(fx.INR_SLIDE_VS_USD, cases.inr_slide_vs_usd);
  assert.equal(fx.defaultDriftForLoanCurrency('INR', 'US'), cases.inr_slide_vs_usd);
  assert.equal(fx.defaultDriftForLoanCurrency('USD', 'IN'), '0');
});

test('E5: the NRI line is about the dearest open rupee loan, and only abroad', () => {
  const { nriLineLoan } = require(path.join(root, 'components/plan/NriPrepayLine.tsx'));
  const loans = [
    { loan_type: 'home_loan', outstanding: '4500000', nominal_rate: '0.085', currency: 'INR' },
    { loan_type: 'personal_loan', outstanding: '300000', nominal_rate: '0.14', currency: 'INR' },
    { loan_type: 'auto_loan', outstanding: '20000', nominal_rate: '0.075', currency: 'USD' },
    { loan_type: 'credit_card', outstanding: '90000', nominal_rate: '0.42', currency: 'INR' },
  ];
  const fx = { INR: '0.0105' };
  assert.equal(nriLineLoan({ country: 'US', loans, fx_to_user_currency: fx }).nominal_rate, '0.14');
  assert.equal(nriLineLoan({ country: 'IN', loans, fx_to_user_currency: fx }), null);
  assert.equal(nriLineLoan({ country: 'US', loans, fx_to_user_currency: {} }), null);
  assert.equal(nriLineLoan({ country: 'US', loans: loans.slice(2), fx_to_user_currency: fx }), null);
});

test('E7 differential: the hold with the user\'s country equals the engine', () => {
  const u = lib('us-loans.ts');
  assert.equal(cases.student_with_country.length, 90);
  for (const c of cases.student_with_country)
    assert.equal(u.forgivenessPrepayBlock(c.loan, c.country), c.block, JSON.stringify(c));
});

test('E7: Setup asks federal/private and PSLF/IDR for a US student loan', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { UsStudentChips } = require(path.join(root, 'components/setup/UsStudentChips.tsx'));
  const html = renderToStaticMarkup(
    React.createElement(UsStudentChips, { loan: { loan_type: 'education_loan', outstanding: '38000', currency: 'USD' }, onPatch() {} }),
  );
  for (const want of ['Federal', 'Private', 'Not sure', 'PSLF', 'Income-driven', 'Extra held off this loan'])
    assert.ok(html.includes(want), want);
  const released = renderToStaticMarkup(
    React.createElement(UsStudentChips, { loan: { loan_type: 'education_loan', outstanding: '38000', currency: 'USD', forgiveness_track: 'none' }, onPatch() {} }),
  );
  assert.ok(!released.includes('Extra held off this loan'));
});
