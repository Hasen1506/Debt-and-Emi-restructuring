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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const Decimal = require('decimal.js');

// Sprint G2 (india-tax): old vs new with the loans, 80E window, co-borrower
// share, let-out rent, pre-construction instalments, 80C room, the Tax page.
// Law: Income-tax Act 2025 as amended by the Finance Act 2026 (docs/TAX_INDIA.md).
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/regime_compare_cases.json'), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(new Decimal(a).minus(new Decimal(b)).abs().lte(tol), `${msg}: ${a} vs ${b}`);
const toTs = (i) => ({
  salary: i.salary, businessIncome: i.business_income, otherIncome: i.other_income, age: i.age,
  hraExemption: i.hra_exemption, sec80cOther: i.sec80c_other, sec80d: i.sec80d, sec80ccd1b: i.sec80ccd1b,
  eduInterest: i.edu_interest,
  homeLoans: (i.home_loans || []).map((h) => ({
    interest: h.interest, principal: h.principal, share: h.share, letOut: h.let_out, annualRent: h.annual_rent,
    municipalTax: h.municipal_tax, preConstructionInstalment: h.pre_construction_instalment, fullCap: h.full_cap,
    principal80cEligible: h.principal_80c_eligible,
  })),
});

test('differential: compareRegimes equals the engine on every fixture case', () => {
  const { compareRegimes } = lib('regime-compare.ts');
  assert.ok(fixture.cases.length >= 300);
  for (const c of fixture.cases) {
    const r = compareRegimes(toTs(c.in));
    const o = c.out;
    const msg = JSON.stringify(c.in);
    near(r.old.tax, o.old_tax, '0.01', `old tax ${msg}`);
    near(r.new.tax, o.new_tax, '0.01', `new tax ${msg}`);
    near(r.old.taxable, o.old_taxable, '0.01', `old taxable ${msg}`);
    near(r.new.taxable, o.new_taxable, '0.01', `new taxable ${msg}`);
    near(r.old.houseProperty, o.old_hp, '0.01', `old hp ${msg}`);
    near(r.new.houseProperty, o.new_hp, '0.01', `new hp ${msg}`);
    near(r.old.loanDeductions, o.old_loan_deductions, '0.01', `loan deductions ${msg}`);
    near(r.loansWorthInOld, o.loans_worth_in_old, '0.01', `loans worth ${msg}`);
    assert.equal(r.better, o.better, msg);
    assert.equal(r.switchRule, o.switch_rule, msg);
    if (o.extra_for_old == null) assert.equal(r.extraDeductionsForOldToWin, null, msg);
    else near(r.extraDeductionsForOldToWin, o.extra_for_old, '1', `extra ${msg}`);
  }
});

test('#32 by hand: ₹18L salary with a home loan, the new regime is cheaper by ₹91,000', () => {
  const { compareRegimes, switchRuleText } = lib('regime-compare.ts');
  const r = compareRegimes({ salary: 1800000, sec80cOther: 100000, homeLoans: [{ interest: 350000, principal: 120000 }] });
  assert.equal(r.old.tax.toNumber(), 241800);
  assert.equal(r.new.tax.toNumber(), 150800);
  assert.equal(r.better, 'new');
  assert.equal(r.oldSaves.toNumber(), -91000);
  assert.match(switchRuleText('yearly'), /every year/);
  assert.match(switchRuleText('business_once'), /only once/);
});

test('#31 80E window: the initial tax year and seven more, as the engine', () => {
  const { sec80eMonthsLeft, taxYearOf } = lib('india-tax-loans.ts');
  assert.equal(taxYearOf('2020-07'), 2020);
  assert.equal(taxYearOf('2020-02'), 2019);
  assert.equal(sec80eMonthsLeft('2020-07', '2026-10'), 18);
  assert.equal(sec80eMonthsLeft('2020-02', '2026-10'), 6);
  assert.equal(sec80eMonthsLeft('2015-05', '2026-10'), 0);
  assert.equal(sec80eMonthsLeft(undefined, '2026-10'), null);
});

test('#31 pre-construction interest: one fifth a year for five tax years from completion', () => {
  const { preConstructionInstalment } = lib('india-tax-loans.ts');
  const loan = { pre_construction_interest_total: '500000', construction_completed: '2024-06' };
  assert.equal(preConstructionInstalment(loan, '2024-08').toNumber(), 100000); // tax year 2024-25: 1st
  assert.equal(preConstructionInstalment(loan, '2029-02').toNumber(), 100000); // 2028-29: 5th
  assert.equal(preConstructionInstalment(loan, '2029-04').toNumber(), 0); // 2029-30: done
  assert.equal(preConstructionInstalment(loan, '2024-03').toNumber(), 0); // before completion
});

test('plan runs get the engine tax fields from the calendar ones', () => {
  const { prepareLoanPaymentTiming } = lib('roll-forward.ts');
  const [edu, home] = prepareLoanPaymentTiming([
    { loan_type: 'education_loan', bank: 'SBI', outstanding: '800000', nominal_rate: '0.1', rate_type: 'fixed', tenure_months_remaining: 84, scheduled_emi: '13000', edu_interest_start: '2020-07' },
    { loan_type: 'home_loan', bank: 'HDFC', outstanding: '3000000', nominal_rate: '0.09', rate_type: 'floating', tenure_months_remaining: 240, scheduled_emi: '27000', pre_construction_interest_total: '250000', construction_completed: '2025-05' },
  ], '2026-10');
  assert.equal(edu.tax_deduction_months_left, 18);
  assert.equal(home.pre_construction_interest_annual, '50000');
});

test('#7 / #31 marginal shield mirrors the engine: share, let-out room, ₹30k, 80E window', () => {
  const { marginalShield, userMarginalCosts, letOutRoom } = lib('marginal-cost.ts');
  const m = '0.312';
  assert.equal(marginalShield('home_loan', 'IN', m, 'old', true, 1, 135000, 0, 1, { share: '0.5' }).toString(), '0.156');
  assert.equal(marginalShield('home_loan', 'IN', m, 'old', true, 1, 210000, 0, 1, { share: '0.5' }).toString(), '0');
  assert.equal(marginalShield('home_loan', 'IN', m, 'old', true, 1, 90000, 0, 1, { cap: 30000 }).toString(), '0');
  assert.equal(marginalShield('education_loan', 'IN', m, 'old', true, 1, 0, 0, 1, { deductionOpen: false }).toString(), '0');
  // Let-out in the new regime: room = 70% of the rent.
  assert.equal(letOutRoom('new', '300000', 1).toNumber(), 210000);
  assert.equal(letOutRoom('old', null, 1).toNumber(), 200000);
  assert.equal(marginalShield('home_loan', 'IN', '0.208', 'new', true, 1, 270000, 0, 1, { letOut: true, cap: 210000 }).toString(), '0');
  assert.equal(marginalShield('home_loan', 'IN', '0.208', 'new', true, 1, 150000, 0, 1, { letOut: true, cap: 210000 }).toString(), '0.208');
  // A whole portfolio: two co-owned homes share the user's ₹2L.
  const user = {
    country: 'IN', income_type: 'salaried', tax_regime: 'old', loans: [
      { loan_type: 'home_loan', bank: 'A', outstanding: '2000000', nominal_rate: '0.09', rate_type: 'floating', tenure_months_remaining: 240, scheduled_emi: '18000', tax_share: '0.5' },
      { loan_type: 'home_loan', bank: 'B', outstanding: '2000000', nominal_rate: '0.09', rate_type: 'floating', tenure_months_remaining: 240, scheduled_emi: '18000', tax_share: '0.5' },
    ],
  };
  const mcs = userMarginalCosts(user, m);
  // ₹1.8L of the user's share-interest < ₹2L: each gets marginal × 0.5.
  near(mcs.get(0).taxBenefit, mcs.get(0).interest.times('0.156'), '1e-15', 'share benefit');
});

test('#31 yearly tax savings pool the ₹2L across homes and stop 80E after its window', () => {
  const { indiaDeductibleForYear } = lib('tax-projection.ts');
  const D = (v) => new Decimal(v);
  const homes = [
    { loan_type: 'home_loan', bank: 'A', outstanding: '0', nominal_rate: '0', rate_type: 'fixed', tenure_months_remaining: 1, scheduled_emi: '0' },
    { loan_type: 'home_loan', bank: 'B', outstanding: '0', nominal_rate: '0', rate_type: 'fixed', tenure_months_remaining: 1, scheduled_emi: '0' },
  ];
  // Two homes at ₹1.5L each used to get ₹2L each (₹3L); the cap is one ₹2L.
  assert.equal(indiaDeductibleForYear('old', homes, [D(150000), D(150000)], 1).toNumber(), 200000);
  assert.equal(indiaDeductibleForYear('new', homes, [D(150000), D(150000)], 1).toNumber(), 0);
  const edu = [{ loan_type: 'education_loan', bank: 'S', outstanding: '0', nominal_rate: '0', rate_type: 'fixed', tenure_months_remaining: 1, scheduled_emi: '0', edu_interest_start: '2020-07' }];
  assert.equal(indiaDeductibleForYear('old', edu, [D(50000)], 1, '2026-10').toNumber(), 50000);
  assert.equal(indiaDeductibleForYear('old', edu, [D(50000)], 2, '2026-10').toNumber(), 50000); // 6 of 12 months open
  assert.equal(indiaDeductibleForYear('old', edu, [D(50000)], 3, '2026-10').toNumber(), 0);
});

test('#20 income mix and the estimated-rate label', () => {
  const { readIncome, taxRateStatus } = lib('tax-profile.ts');
  const base = { country: 'IN', income_type: 'salaried', loans: [] };
  assert.equal(readIncome({ ...base, annual_gross_salary: '1800000' }).mix, 'salary');
  assert.equal(readIncome({ ...base, annual_gross_salary: '1800000', annual_business_income: '400000' }).mix, 'salary_plus_business');
  assert.equal(readIncome({ ...base, income_type: 'business_owner', annual_business_income: '900000' }).mix, 'business');
  const streams = [
    { id: 'a', kind: 'salaried', label: 'Job', gross_annual: '1200000', start_date: '2020-01', tds_pct: '0.2' },
    { id: 'b', kind: 'freelance', label: 'Side', gross_annual: '600000', start_date: '2021-01', tds_pct: '0.1', tax_treatment: 'business_44ada' },
  ];
  const r = readIncome({ ...base, income_streams: streams });
  assert.equal(r.mix, 'salary_plus_business');
  assert.equal(r.business.toNumber(), 300000); // presumptive: half of ₹6L
  assert.equal(taxRateStatus({ ...base }), 'estimated');
  assert.equal(taxRateStatus({ ...base, tax_rate_confirmed: true }), 'confirmed');
  assert.equal(taxRateStatus({ ...base, annual_gross_salary: '1800000' }), 'from_income');
});

test('#7 the Tax page holds co-borrower share, let-out rent, pre-construction and 80E start', () => {
  const page = src('components/tax/TaxPage.tsx');
  for (const s of ['Your share for tax (%)', 'Rent a year, whole house', 'Interest paid before you got the house', 'First paid interest (YYYY-MM)', 'BEFORE A BIG DECISION', 'WHY FIVE INSTALMENTS?', 'switchRuleText', 'YES, ']) {
    assert.ok(page.includes(s), s);
  }
  // #77: /tax is a page again, not a redirect.
  const cfg = fs.readFileSync(path.resolve(__dirname, '../next.config.mjs'), 'utf8');
  assert.ok(!/source: '\/tax'/.test(cfg));
  assert.ok(fs.existsSync(path.join(root, 'app/tax/page.tsx')));
  assert.ok(src('components/profile/ProfileSummary.tsx').includes('href="/tax"'));
});

test('tax tables carry the 2025-Act section map, caps and sources', () => {
  const TAX = require(path.join(root, 'lib/tax-tables.json'));
  assert.equal(TAX.in.section_map['80E'], '129');
  assert.equal(TAX.in.section_map['115BAC'], '202');
  assert.equal(TAX.in.deductions.sec24b_self_occupied_cap, 200000);
  assert.equal(TAX.in.deductions.sec24b_other_cap, 30000);
  assert.equal(TAX.in.deductions.sec80c_cap, 150000);
  assert.equal(TAX.in.deductions.sec80e_tax_years, 8);
  assert.match(TAX.in.law_source, /^https:\/\/www\.incometaxindia\.gov\.in\//);
  assert.match(TAX.in.law_as_of, /Income-tax Act, 2025/);
  const { sectionLabel } = lib('india-tax-loans.ts');
  assert.equal(sectionLabel('80C'), 's.80C (now s.123 + Schedule XV)');
});

test('#77 the Tax page renders for an Indian borrower with home and education loans', () => {
  const { TaxPage } = require(path.join(root, 'components/tax/TaxPage.tsx'));
  const { ProfileProvider } = lib('use-profile.tsx');
  const user = {
    country: 'IN', income_type: 'salaried', tax_regime: 'old', annual_income: '1800000', monthly_income: '110000',
    annual_gross_salary: '1800000', fixed_expenses: '40000', savings_balance: '0', primary_bank: 'HDFC',
    deductions: { sec_80c_annual: '60000' },
    loans: [
      { id: 'h', loan_type: 'home_loan', bank: 'HDFC', outstanding: '3000000', nominal_rate: '0.09', rate_type: 'floating', tenure_months_remaining: 240, scheduled_emi: '27000', tax_share: '0.5' },
      { id: 'e', loan_type: 'education_loan', bank: 'SBI', outstanding: '800000', nominal_rate: '0.1', rate_type: 'fixed', tenure_months_remaining: 84, scheduled_emi: '13000', edu_interest_start: '2020-07' },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(ProfileProvider, { profile: { user, marginalRate: '0.312', creditScore: null, isLive: true } }, React.createElement(TaxPage)));
  for (const s of ['Tax and your loans', 'OLD OR NEW REGIME, THIS TAX YEAR', 'EACH LOAN AND TAX', '80C ROOM A PREPAYMENT CAN USE', 'on your 50% share', 's.80E (now s.129)', 'Salary only']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(!html.includes('NaN'));
  // A US profile gets the rate section only.
  const us = renderToStaticMarkup(React.createElement(ProfileProvider, { profile: { user: { ...user, country: 'US', filing_status: 'single', loans: [] }, marginalRate: '0.22', creditScore: null, isLive: true } }, React.createElement(TaxPage)));
  assert.ok(us.includes('Filing as') && !us.includes('OLD OR NEW REGIME'));
});
