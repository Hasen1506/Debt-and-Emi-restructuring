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

test('Advance tax: presumptive pays once by 15 Mar (s.408(2)); s.425 [234C] fixed periods; mid-year rebase', () => {
  const { buildSchedule, accruedPenalty, rebaseSchedule } = lib('advance-tax.ts');
  const apr1 = new Date(2026, 3, 1, 12);
  const pres = buildSchedule('IN', new Decimal(100000), apr1, { presumptive: true });
  assert.equal(pres.instalments.length, 1);
  assert.deepEqual([pres.instalments[0].dueDate, pres.instalments[0].cumulativePct, pres.instalments[0].amountDue], ['2027-03-15', 100, '100000']);
  const reg = buildSchedule('IN', new Decimal(100000), apr1);
  assert.deepEqual(reg.instalments.map((i) => i.amountDue), ['15000', '30000', '30000', '25000']);
  // Nothing paid by 1 Oct: June 15,000 x 1% x 3 + Sept 45,000 x 1% x 3 = 1,800.
  assert.equal(accruedPenalty(reg, new Date(2026, 9, 1, 12)).sec234C, '1800');
  // 12,000 paid in June: no June interest (12% rule); Sept (33,000 short, < 36%) x 3% = 990.
  const paid = { ...reg, instalments: reg.instalments.map((i, k) => (k === 0 ? { ...i, status: 'paid', paidAmount: '12000' } : i)) };
  assert.equal(accruedPenalty(paid, new Date(2026, 9, 1, 12)).sec234C, '990');
  // Income rose mid-year: remaining instalments re-cut to the new estimate, paid kept.
  const q1 = { ...reg, instalments: reg.instalments.map((i, k) => (k === 0 ? { ...i, status: 'paid', paidAmount: '15000' } : i)) };
  const re = rebaseSchedule(q1, new Decimal(150000));
  assert.deepEqual(re.instalments.map((i) => i.amountDue), ['15000', '52500', '45000', '37500']);
  assert.equal(rebaseSchedule(q1, new Decimal(105000)), q1);   // within 10%: left alone
});

test('C7 (web True APR): a let-out home gets only the set-off the self-occupied home leaves', () => {
  const { computeBreakdown } = lib('effective-apr.ts');
  const so = { loan_type: 'home_loan', outstanding: '3000000', nominal_rate: '0.09', property_use: 'self_occupied', scheduled_emi: '27000', tenure_months_remaining: 240 };
  const lo = { loan_type: 'home_loan', outstanding: '5000000', nominal_rate: '0.09', property_use: 'let_out', scheduled_emi: '45000', tenure_months_remaining: 240 };
  const shield = (b) => (b.lines.find((l) => l.label === 'Tax shield') || { value: new Decimal(0) }).value;
  const all = [so, lo];
  const sSo = shield(computeBreakdown(so, '0.312', 'IN', 'old', true, all));
  const sLo = shield(computeBreakdown(lo, '0.312', 'IN', 'old', true, all));
  // ₹ of tax saved = shield × balance; together at most 31.2% of ₹2L = ₹62,400.
  const saved = sSo.mul(3000000).add(sLo.mul(5000000));
  assert.ok(saved.lte(62400.5), `saved ${saved}`);
  assert.equal(sLo.toNumber(), 0);
  // With ₹3L rent the let-out home's interest still lowers tax on that rent (both regimes).
  const rented = { ...lo, annual_rent: '300000' };
  assert.ok(shield(computeBreakdown(rented, '0.208', 'IN', 'new', true, all)).gt(0));
});
