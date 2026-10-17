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
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Round 3, part C (tax): UX walkthrough 2 #11 (r01uae, u07couple, u08gig,
// n13pension), #25 (itemizing), walkthrough 1 fix 10 (salaried advance tax).
const TS = lib('tax-setup.ts');
const { setupMarginalRate, marginalRateFromTakeHome } = lib('quick-setup.ts');
const { computeAnnualTax, US_STANDARD_DEDUCTION } = lib('tax-brackets.ts');
const { usSelfEmploymentTax, SE_TAX_NOTE } = lib('us-self-employment.ts');
const { deriveMarginalRateForUser, usMortgageShieldShare } = lib('deductions.ts');
const { profileMarginalRate } = lib('marginal-rate.ts');
const { earnLabel, oldRegimeAge } = lib('tax-profile.ts');
const { homeTaxReserve } = lib('salaried-advance-tax.ts');
const { payThisMonth } = lib('pay-this-month.ts');
const TAX = require(path.join(root, 'lib', 'tax-tables.json'));
const { TaxBasicsRows } = require(path.join(root, 'components/setup/TaxBasics.tsx'));

const rows = (props) => renderToStaticMarkup(React.createElement(TaxBasicsRows, {
  country: 'IN', pickCountry() {}, isNriUs: false, setIsNriUs() {}, countryNote: null,
  incomeType: 'salaried', setIncomeType() {}, tb: {}, setTb() {}, showErrors: false, ...props,
}));
const pressed = (html, label) => new RegExp(`aria-pressed="true"[^>]*>${label}<`).test(html);

// ── 1. NRI in a Gulf state or elsewhere ──────────────────────────────────────

test('1: Setup offers Gulf and another country; each Gulf state picks its currency', () => {
  const html = rows({});
  for (const l of ['India · ₹', 'USA · \\$', 'Gulf · no income tax', 'Another country']) assert.match(html, new RegExp(`>${l}<`));
  const gulf = rows({ tb: { residence: 'GULF' }, showErrors: true });
  for (const g of ['UAE', 'Saudi Arabia', 'Qatar', 'Oman', 'Kuwait', 'Bahrain']) assert.match(gulf, new RegExp(`>${g}<`));
  assert.match(gulf, /Pick the country you live in/);
  assert.match(gulf, /isn’t taxed in India.*Verify with a tax adviser/);
  assert.deepEqual(TS.GULF.map((g) => [g.code, TS.residenceCurrency(g.code)]),
    [['AE', 'AED'], ['SA', 'SAR'], ['QA', 'QAR'], ['OM', 'OMR'], ['KW', 'KWD'], ['BH', 'BHD']]);
  assert.equal(TS.residenceCurrency('OTHER'), null);
  // Pension is for residents of India only; the US gets no Gulf follow-up.
  assert.doesNotMatch(rows({ tb: { residence: 'AE' } }), /Retired · pension/);
  assert.equal(TS.taxBasicsGap('IN', { residence: 'AE' }), null);
});

test('1 property: abroad, pay earned there never gets an Indian slab rate, whatever the take-home', () => {
  for (const r of ['AE', 'SA', 'QA', 'OM', 'KW', 'BH', 'OTHER'])
    for (const th of ['20000', '150000', '900000', '5000000']) {
      assert.equal(setupMarginalRate(th, 'IN', 'salaried', { residence: r }, {}), 0, `${r} ${th}`);
      const u = TS.applyTaxBasics({ country: 'IN', income_type: 'salaried', monthly_income: th, loans: [] }, { residence: r });
      assert.equal(u.nri_residence, r);
      assert.equal(deriveMarginalRateForUser(u, '0.3'), '0.0000');
    }
  // The same take-home as a resident is taxed: the rule is what changes it.
  assert.ok(setupMarginalRate('900000', 'IN', 'salaried', {}, {}) > 0.3);
});

test('1: an NRI pays Indian tax on Indian income only, at slab rates with no 87A rebate', () => {
  const streams = (gross, kind = 'rental') => [{ id: 'x', kind, label: 'Pune flat', gross_annual: String(gross), start_date: '2020-01' }];
  // Rent ₹6L: 70% = ₹4.2L, in the 5% slab: 5.2% with cess. A resident at
  // ₹4.2L pays nothing (87A); a non-resident doesn't get the rebate.
  assert.equal(TS.abroadIndiaRate({ income_streams: streams(600000) }), 0.052);
  assert.equal(TS.abroadIndiaRate({ income_streams: streams(300000, 'interest') }), 0);
  assert.equal(TS.abroadIndiaRate({ income_streams: streams(3000000, 'interest') }), 0.312);
  assert.equal(TS.abroadIndiaRate({ income_streams: streams(3000000, 'salaried') }), 0, 'salary is taken as earned abroad');
  const u = { country: 'IN', nri_residence: 'AE', income_type: 'salaried', income_streams: streams(600000), loans: [] };
  assert.equal(earnLabel(u), 'Pay earned abroad, not taxed in India, and income from India');
  assert.equal(TS.abroadLabel('AE'), 'NRI, lives in UAE');
  assert.equal(TS.abroadLabel('OTHER'), 'NRI, lives outside India');
  // Profile's save keeps it (lib/marginal-rate): gross pay can't bring the slab back.
  assert.equal(profileMarginalRate({ abroadRate: 0, bracketRate: 0.3, stateRate: 0, manualRate: '', loadedRate: '', country: 'IN', incomeType: 'salaried', monthlyIncome: '900000' }).rate, 0);
  // Moving back to India clears it.
  assert.equal(TS.applyTaxBasics({ ...u }, {}).nri_residence, undefined);
  // The NRI prepay tool opens in their currency.
  assert.match(src('app/tools/nri-prepay/tool.tsx'), /residenceCurrency\(profile\.user\.nri_residence\)/);
});

// ── 2. US filing status, asked ───────────────────────────────────────────────

test('2: a US filing status is asked, never assumed Single', () => {
  assert.equal(TS.taxBasicsGap('US', {}), 'Pick how you file your tax return.');
  assert.equal(TS.taxBasicsGap('US', { filing: 'mfj' }), null);
  const html = rows({ country: 'US' });
  for (const f of ['Single', 'Married, filing jointly', 'Married, filing separately', 'Head of household']) {
    assert.match(html, new RegExp(`>${f}<`));
    assert.ok(!pressed(html, f), `${f} pre-selected`);
  }
  const qs = src('components/setup/QuickSetup.tsx');
  assert.doesNotMatch(qs, /filing_status:[^\n]*\?\? 'single'/);
  assert.match(qs, /step1Ok = [^\n]*taxBasicsGap\(country, tb\)/);
  assert.equal(TS.applyTaxBasics({ country: 'US', income_type: 'salaried', loans: [] }, { filing: 'mfs' }).filing_status, 'mfs');
  // /tax names all four, and says when Single is only assumed (old profiles).
  const page = src('components/tax/TaxPage.tsx');
  assert.match(page, /Not chosen: Single assumed/);
  assert.equal(TS.FILING_LABEL.mfs, 'Married, filing separately');
});

test('2: TY2026 brackets and standard deductions are the IRS figures (Rev. Proc. 2025-32 / IR-2025-103)', () => {
  assert.deepEqual(US_STANDARD_DEDUCTION, { single: 16100, mfj: 32200, hoh: 24150, mfs: 16100 });
  const tops = (s) => TAX.us[s].slabs.map(([to]) => to);
  assert.deepEqual(tops('single'), [12400, 50400, 105700, 201775, 256225, 640600, null]);
  assert.deepEqual(tops('mfj'), [24800, 100800, 211400, 403550, 512450, 768700, null]);
  // MFJ at $150k: a lower bracket than single at the same pay.
  const r = (f) => marginalRateFromTakeHome('10000', 'US', 'salaried', undefined, f).rate;
  assert.ok(r('mfj') < r('single'), `${r('mfj')} vs ${r('single')}`);
});

// ── 3. US self-employed / gig ────────────────────────────────────────────────

test('3: SE tax is 15.3% on 92.35% of net earnings, Social Security capped, half deductible (hand-checked)', () => {
  // $60,000: 55,410 × 15.3% = 8,477.73; half = 4,238.865.
  const [se, half] = usSelfEmploymentTax(60000);
  assert.ok(Math.abs(se - 8477.73) < 0.005 && Math.abs(half - 4238.865) < 0.005, `${se} ${half}`);
  // $300,000 single: 12.4% × 184,500 + 2.9% × 277,050 + 0.9% × 77,050 = 31,605.90; half = 15,456.225.
  const [se2, half2] = usSelfEmploymentTax(300000);
  assert.ok(Math.abs(se2 - 31605.9) < 0.005 && Math.abs(half2 - 15456.225) < 0.005, `${se2} ${half2}`);
  assert.deepEqual(usSelfEmploymentTax(399), [0, 0]);
  // Property: past the wage base only Medicare grows: 2.9% (+0.9%) of 92.35%.
  for (const n of [210000, 230000, 260000]) {
    const d = usSelfEmploymentTax(n + 1000)[0] - usSelfEmploymentTax(n)[0];
    const se = n * 0.9235;
    const expect = 1000 * 0.9235 * (0.029 + (se > 200000 ? 0.009 : 0));
    assert.ok(Math.abs(d - expect) < 0.01, `${n}: ${d} vs ${expect}`);
  }
  assert.equal(usSelfEmploymentTax(300000, 'mfj')[0] < se2, true, 'MFJ Additional Medicare starts at $250k');
});

test('3: a US gig worker\'s yearly tax includes SE tax, and the copy says so (no W-2)', () => {
  const gross = 80000;
  const [se, half] = usSelfEmploymentTax(gross);
  const t = Number(computeAnnualTax('US', null, 'business_owner', gross, 'single').toString());
  const fedOnly = Number(computeAnnualTax('US', null, 'salaried', gross - half, 'single').toString());
  assert.ok(Math.abs(t - (fedOnly + se)) < 0.01, `${t} vs ${fedOnly + se}`);
  // Monotonic: more profit is never less tax.
  let prev = -1;
  for (let g = 0; g <= 400000; g += 5000) {
    const v = Number(computeAnnualTax('US', null, 'business_owner', g, 'single').toString());
    assert.ok(v >= prev, `${g}`);
    prev = v;
  }
  for (const s of ['15.3%', '92.35%', '$184,500', '15 April', '15 June', '15 September', '15 January', '1040-ES']) assert.ok(SE_TAX_NOTE.includes(s), s);
  const html = rows({ country: 'US', incomeType: 'business_owner' });
  assert.match(html, />Self-employed \/ gig</);
  assert.match(html, /self-employment tax/);
  assert.doesNotMatch(html, /W-2/);
  assert.equal(earnLabel({ country: 'US', income_type: 'business_owner', annual_business_income: '80000', loans: [] }), 'Self-employed / gig');
  // /tax no longer gives a US gig worker India's regime copy (u08gig).
  assert.match(src('components/tax/TaxPage.tsx'), /user\.country === 'IN' && income\.mix === 'business' && 'With business income only/);
});

// ── 4. India senior / super senior, pension ──────────────────────────────────

test('4: old-regime senior tables (incometax.gov.in AY 2026-27), new regime the same at every age', () => {
  assert.deepEqual(TAX.in.old_60_79.slabs, [[300000, 0], [500000, 0.05], [1000000, 0.2], [null, 0.3]]);
  assert.deepEqual(TAX.in.old_80_plus.slabs, [[500000, 0], [1000000, 0.2], [null, 0.3]]);
  assert.equal(TAX.in.new.standard_deduction, 75000);
  assert.equal(TAX.in.old.standard_deduction, 50000);
  // ₹9L pension, old regime: taxable ₹8.5L after the ₹50,000 standard deduction.
  // Under 60: 12,500 + 70,000 = 82,500 × 1.04 = 85,800. 60-79: 10,000 + 70,000
  // = 80,000 → 83,200. 80+: 70,000 → 72,800.
  const old = (age) => Number(computeAnnualTax('IN', 'old', 'salaried', 900000, undefined, age).toFixed(2));
  assert.deepEqual([old(undefined), old('60_plus'), old('80_plus')], [85800, 83200, 72800]);
  const nw = (age) => computeAnnualTax('IN', 'new', 'salaried', 1800000, undefined, age).toString();
  assert.equal(nw('80_plus'), nw(undefined));
  // Property: an older taxpayer never pays more under the old regime.
  for (let g = 100000; g <= 3000000; g += 50000) {
    const [a, b, c] = [undefined, '60_plus', '80_plus'].map((x) => Number(computeAnnualTax('IN', 'old', 'salaried', g, undefined, x).toString()));
    assert.ok(a >= b && b >= c, `${g}: ${a} ${b} ${c}`);
  }
});

test('4: "Retired · pension" in Setup, with its age, and /tax says Pension', () => {
  const html = rows({ tb: { earns: 'pension' } });
  assert.ok(pressed(html, 'Retired · pension'));
  for (const a of ['Under 60', '60 to 79', '80 or over']) assert.match(html, new RegExp(`>${a}<`));
  assert.equal(TS.takeHomeWords('salaried', { earns: 'pension' }).label, 'Pension a month, after TDS');
  const u = TS.applyTaxBasics({ country: 'IN', income_type: 'salaried', loans: [] }, { earns: 'pension', age: '80_plus' });
  assert.equal(u.income_kind, 'pension');
  assert.equal(u.age_bracket, '80_plus');
  assert.equal(oldRegimeAge(u), '80_plus');
  assert.equal(earnLabel(u), 'Pension');
  assert.deepEqual(TS.taxBasicsOf(u), { earns: 'pension', age: '80_plus' });
  // The old regime at 80+ takes less tax, so the same pension needs less gross
  // (the marginal slabs above ₹5L are the same at every age).
  const g = (age) => marginalRateFromTakeHome('70000', 'IN', 'salaried', 'old', undefined, age).gross;
  assert.ok(g('80_plus') < g('60_plus') && g('60_plus') < g(undefined), `${g('80_plus')} ${g('60_plus')} ${g(undefined)}`);
});

// ── 5. US mortgage tax break only when itemizing ─────────────────────────────

test('5 property: no "after the tax break" mortgage rate unless the user itemizes', () => {
  const home = (o) => ({ loan_type: 'home_loan', outstanding: String(o), nominal_rate: '0.065' });
  for (const o of [100000, 400000, 750000, 2000000])
    for (const f of ['single', 'mfj', 'hoh', 'mfs']) {
      const u = { country: 'US', filing_status: f, loans: [home(o)] };
      assert.equal(usMortgageShieldShare(u).toNumber(), 0, `${o} ${f} not asked`);
      assert.equal(usMortgageShieldShare({ ...u, itemises: false }).toNumber(), 0);
      assert.ok(usMortgageShieldShare({ ...u, itemises: true }).gt(0), `${o} ${f} itemizes`);
    }
  const html = rows({ country: 'US', tb: { filing: 'single' } });
  assert.ok(pressed(html, 'No, standard deduction'), 'No is the default');
  assert.equal(TS.applyTaxBasics({ country: 'US', income_type: 'salaried', loans: [] }, { filing: 'single' }).itemises, false);
});

// ── 6. Salaried advance tax on Home ──────────────────────────────────────────

const schedule = {
  country: 'IN', fiscalYearLabel: 'FY 2026-27', annualLiability: '45000',
  instalments: [
    { dueDate: '2026-09-15', ordinal: 2, cumulativePct: 45, amountDue: '13500', status: 'paid' },
    { dueDate: '2026-12-15', ordinal: 3, cumulativePct: 75, amountDue: '13500', status: 'pending' },
    { dueDate: '2027-03-15', ordinal: 4, cumulativePct: 100, amountDue: '11250', status: 'pending' },
  ],
};

test('6: Home sets aside the next instalment, spread over the months to its due date', () => {
  assert.deepEqual(homeTaxReserve(schedule, '2026-10-17'), { amount: 4500, due: '15 Dec' });
  assert.deepEqual(homeTaxReserve(schedule, '2026-12-01'), { amount: 13500, due: '15 Dec' });
  assert.deepEqual(homeTaxReserve(schedule, '2026-12-16'), { amount: 2813, due: '15 Mar' });
  assert.equal(homeTaxReserve(null, '2026-10-17'), null);
  const plan = (income_type, extra = {}) => ({
    live: true,
    user: { country: 'IN', income_type, monthly_income: '160000', fixed_expenses: '60000', variable_expenses: '0',
      loans: [{ loan_type: 'auto_loan', outstanding: '600000', nominal_rate: '0.09', scheduled_emi: '12000' }] },
    monthlyPayments: [{ month: 1, perLoan: { 0: '100000' } }],
    trajectory: [{ month: 1, balancesByLoanIndex: { 0: '504500' } }],
    firstMonthMinimums: { 0: '12000' },
    surplusAllocation: { efSlice: 0, goalSlice: 0, surplus: 88000 },
    surplus: 88000, shortfall: 0, fxRatesUsed: {}, debtBudget: '',
    advanceTaxSchedule: schedule, ...extra,
  });
  const d = payThisMonth(plan('salaried'), '2026-10-17');
  const tax = d.rows.find((r) => r.kind === 'tax');
  assert.equal(tax.name, 'Advance tax due 15 Dec');
  assert.equal(tax.amountUser, 4500);
  assert.equal(d.extraUser, 88000 - 4500, 'the extra on the car loan shrinks by the reserve');
  assert.equal(d.total, d.duesUser + d.extraUser + 4500);
  assert.ok(d.total <= 160000 - 60000);
  assert.equal(d.rows.filter((r) => r.loanIndex === null).length, 1, 'one line, no extra card');
  // Not salaried (business owners have Plan's panel), or short: nothing reserved.
  assert.equal(payThisMonth(plan('business_owner'), '2026-10-17').rows.some((r) => r.kind === 'tax'), false);
  assert.equal(payThisMonth(plan('salaried', { shortfall: 5000 }), '2026-10-17').rows.some((r) => r.kind === 'tax'), false);
});

test('6: /tax stops saying "Salary only", the sleeve names Profile → Income, the tax field reaches Plan', () => {
  const u = { country: 'IN', income_type: 'salaried', annual_gross_salary: '2600000', extra_income_annual_tax: '45000', loans: [] };
  assert.equal(earnLabel(u), 'Salary and other income (interest, rent or gains)');
  assert.equal(earnLabel({ ...u, extra_income_annual_tax: undefined }), 'Salary only');
  const sleeve = src('components/debts/TaxSleeveCard.tsx');
  assert.doesNotMatch(sleeve, /Setup → Income|step=2/);
  assert.equal((sleeve.match(/href="\/profile\?step=income"/g) || []).length, 3);
  assert.match(src('components/plan/load-plan.ts'), /extraTax >= 10_000/);
  assert.match(src('components/tax/TaxPage.tsx'), /earnLabel\(user, income\)/);
});
