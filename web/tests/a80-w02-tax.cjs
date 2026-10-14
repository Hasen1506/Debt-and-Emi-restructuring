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
const Decimal = require('decimal.js');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Audit 80 · W2 (tax UI truth): C9 bracket after life events, B14/E9 labels, C21 regime note.
const { deriveMarginalRateForUser, deriveMarginalRate } = lib('deductions.ts');
const { marginalRateFromTakeHome } = lib('quick-setup.ts');
const { taxRateLabel, taxSlabShort } = lib('tax-profile.ts');

const baseUser = (over = {}) => ({
  country: 'IN', income_type: 'salaried', tax_regime: 'old', annual_income: '960000', monthly_income: '80000',
  fixed_expenses: '30000', savings_balance: '0', primary_bank: 'HDFC Bank', loans: [], ...over,
});

test('C9: with no gross on file the bracket is solved from take-home, not take-home x 12 read as gross', () => {
  for (const [regime, th, expect] of [['old', '80000', '0.312'], ['new', '130000', '0.208']]) {
    const u = baseUser({ tax_regime: regime, monthly_income: th, annual_income: String(Number(th) * 12) });
    const qs = marginalRateFromTakeHome(th, 'IN', 'salaried', regime, undefined);
    assert.equal(new Decimal(deriveMarginalRateForUser(u)).toFixed(3), new Decimal(qs.rate).toFixed(3));
    assert.equal(new Decimal(deriveMarginalRateForUser(u)).toFixed(3), expect);
  }
  // Gross typed in Profile wins.
  const typed = baseUser({ annual_gross_salary: '600000' });
  assert.equal(new Decimal(deriveMarginalRateForUser(typed)).toFixed(3), '0.208');
});

test('B14/E9: the rate is shown as the slab people know, never "26.0%" or "0.0%"', () => {
  assert.match(taxRateLabel('0.26', 'IN'), /^25% slab \+ 4% cess = 26\.0%/);
  assert.match(taxRateLabel('0.312', 'IN', { estimated: true }), /^30% slab \+ 4% cess = 31\.2% on your next rupee \(estimated\)$/);
  assert.match(taxRateLabel('0.3432', 'IN'), /^30% slab \+ 10% surcharge \+ 4% cess/);
  assert.equal(taxRateLabel('0', 'IN', { regime: 'new', estimated: true }), 'No income tax on your pay (new regime, estimated)');
  assert.equal(taxRateLabel('0.24', 'US'), '24% federal bracket');
  assert.equal(taxRateLabel('0.29', 'US', { stateRate: '0.05' }), '24% federal bracket + 5.0% state');
  assert.equal(taxSlabShort('0.26', 'IN'), '25% slab');
  // Invariant: every Indian marginal rate the app can derive maps to a real slab.
  for (const regime of ['new', 'old']) {
    for (let g = 100000; g <= 60000000; g = Math.round(g * 1.07)) {
      const r = deriveMarginalRate({ grossAnnual: g, country: 'IN', taxRegime: regime, incomeType: 'salaried' });
      const label = taxRateLabel(r ? r.toString() : '0', 'IN');
      assert.match(label, /^(No income tax on your pay|(5|10|15|20|25|30)% slab)/, `${regime} ${g}: ${label}`);
    }
  }
  for (const f of ['components/home/LedgerHome.tsx', 'components/plan/PlanAssumptions.tsx']) {
    assert.ok(!src(f).includes('TAX BRACKET ${formatTaxRate'), `${f} still prints the bare rate`);
    assert.ok(src(f).includes('taxRateLabel('), f);
  }
});

test('C21: Plan says when the old regime would cost less, and never switches it', () => {
  const { oldRegimeWouldSave } = require(path.join(root, 'components/plan/PlanNotes.tsx'));
  const home = { loan_type: 'home_loan', bank: 'SBI', outstanding: '4000000', nominal_rate: '0.085', rate_type: 'floating',
    tenure_months_remaining: 240, scheduled_emi: '34713', property_use: 'self_occupied' };
  const u = baseUser({ tax_regime: 'new', annual_gross_salary: '2400000', loans: [home],
    deductions: { hra_claim_annual: '600000', sec_80c_annual: '150000' } });
  const note = oldRegimeWouldSave(u);
  assert.ok(note, 'old regime wins here, so the note shows');
  assert.match(note.title, /old regime would cost you about/);
  assert.equal(note.link.href, '/tax');
  assert.equal(u.tax_regime, 'new');                          // not switched
  assert.equal(oldRegimeWouldSave({ ...u, tax_regime: 'old' }), null);
  assert.equal(oldRegimeWouldSave({ ...u, loans: [] }), null);   // no tax-relevant loan: no note
  assert.equal(oldRegimeWouldSave({ ...u, deductions: {} , annual_gross_salary: '1300000'}), null); // new wins
});
