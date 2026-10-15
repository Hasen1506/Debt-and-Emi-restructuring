// Round 2 (engine branch) web pieces: Plan inputs (gap limit, own return,
// rate rise, DOB), salaried advance tax, the NRI FX path of the marginal
// cost, and that Profile / Setup keep what only Plan edits.
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
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
    module._compile(output, file);
  };
const lib = (name) => require(path.join(root, 'lib', name));
const src = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const Decimal = require('decimal.js');

const P = lib('plan-inputs');
const S = lib('salaried-advance-tax');
const M = lib('marginal-cost');

// ── plan-inputs ────────────────────────────────────────────────────────────

test('gap limit: own figure wins, else 3 months of take-home labelled assumed', () => {
  assert.deepEqual(P.gapLimitFor({ monthly_income: '80000' }), { value: 240000, assumed: true });
  assert.deepEqual(P.gapLimitFor({ monthly_income: '80000', gap_credit_limit: '150000' }), { value: 150000, assumed: false });
  assert.deepEqual(P.gapLimitFor({ monthly_income: '80000', gap_credit_limit: '' }), { value: 240000, assumed: true });
  assert.deepEqual(P.gapLimitFor({ monthly_income: '80000', gap_credit_limit: '0' }), { value: 0, assumed: false });
});

test('amount / % / DOB / age / tenure parsers', () => {
  assert.equal(P.parseAmount('1,50,000'), '150000');
  assert.equal(P.parseAmount('₹ 2,000.6'), '2001');
  assert.equal(P.parseAmount(''), '');
  assert.equal(P.parseAmount('-5'), null);
  assert.equal(P.parseAmount('abc'), null);
  assert.equal(P.parseReturnPct('7.5'), '0.075');
  assert.equal(P.parseReturnPct('6.5%'), '0.065');
  assert.equal(P.parseReturnPct(''), '');
  assert.equal(P.parseReturnPct('31'), null);
  assert.equal(P.parseReturnPct('-1'), null);
  assert.equal(P.parseDob('1990-06', '2026-10-15'), '1990-06');
  assert.equal(P.parseDob('1990-06-30', '2026-10-15'), '1990-06-30');
  assert.equal(P.parseDob('2027-01', '2026-10-15'), null);
  assert.equal(P.parseDob('1990-13', '2026-10-15'), null);
  assert.equal(P.parseDob('', '2026-10-15'), '');
  assert.equal(P.parseRetirementAge('65'), 65);
  assert.equal(P.parseRetirementAge('39'), null);
  assert.equal(P.parseRetirementAge('86'), null);
  assert.equal(P.parseRetirementAge('60.5'), null);
  assert.equal(P.parseMaxTenure('360'), 360);
  assert.equal(P.parseMaxTenure('0'), null);
  assert.equal(P.parseMaxTenure('481'), null);
});

test('assumed return and split threshold: 6.5% IN / 4% US + 1 point, own figure wins', () => {
  assert.deepEqual(P.assumedReturnFor({ country: 'IN' }), { value: 0.065, assumed: true });
  assert.deepEqual(P.assumedReturnFor({ country: 'US' }), { value: 0.04, assumed: true });
  assert.deepEqual(P.assumedReturnFor({ country: 'IN', assumed_post_tax_return: '0.08' }), { value: 0.08, assumed: false });
  assert.ok(Math.abs(P.splitThreshold({ country: 'IN' }) - 0.075) < 1e-12);
  assert.ok(Math.abs(P.splitThreshold({ country: 'US', assumed_post_tax_return: '0.05' }) - 0.06) < 1e-12);
  // Same defaults as the engine (engine/prepay_invest.py).
  const py = fs.readFileSync(path.resolve(__dirname, '../../engine/prepay_invest.py'), 'utf8');
  assert.match(py, /"IN":\s*D\("0\.065"\)/);
  assert.match(py, /"US":\s*D\("0\.04"\)/);
  assert.match(py, /SPLIT_MARGIN\s*=\s*D\("0\.01"\)/);
});

test('retirement age default and months to the age limit', () => {
  assert.deepEqual(P.retirementAgeFor({ income_type: 'salaried' }), { value: 60, assumed: true });
  assert.deepEqual(P.retirementAgeFor({ income_type: 'business_owner' }), { value: 70, assumed: true });
  assert.deepEqual(P.retirementAgeFor({ income_type: 'salaried', retirement_age: 58 }), { value: 58, assumed: false });
  assert.equal(P.monthsToAgeLimit({ income_type: 'salaried' }, '2026-10-15'), null);
  // Born Oct 1980, 46 in Oct 2026: 14 years (168 months) to 60.
  assert.equal(P.monthsToAgeLimit({ income_type: 'salaried', date_of_birth: '1980-10' }, '2026-10-15'), 168);
  assert.equal(P.monthsToAgeLimit({ income_type: 'salaried', date_of_birth: '1960-01-05' }, '2026-10-15'), -81);
});

test('rate-rise mode: India extends, US raises, own choice wins; floating loans only', () => {
  assert.deepEqual(P.rateRiseModeFor({}, 'IN'), { mode: 'extend', assumed: true });
  assert.deepEqual(P.rateRiseModeFor({}, 'US'), { mode: 'raise_emi', assumed: true });
  assert.deepEqual(P.rateRiseModeFor({ currency: 'INR' }, 'US'), { mode: 'extend', assumed: true });
  assert.deepEqual(P.rateRiseModeFor({ on_rate_rise: 'mix' }, 'IN'), { mode: 'mix', assumed: false });
  const loans = [
    { rate_type: 'floating', outstanding: '100' },
    { rate_type: 'fixed', outstanding: '100' },
    { rate_type: 'floating', outstanding: '0' },
    { rate_type: 'floating', outstanding: '5' },
  ];
  assert.deepEqual(P.floatingLoanIndices(loans), [0, 3]);
});

test('ceiling line names min(360, lender max, age) and the no-limit rule', () => {
  assert.match(P.ceilingLine({ loan_type: 'home_loan' }, null, 'IN'), /smallest of 360 months; past that/);
  assert.match(P.ceilingLine({ loan_type: 'home_loan', max_tenure_months: 300 }, 120, 'IN'), /360 months, your lender's 300 months, 120 months to your age limit/);
  assert.match(P.ceilingLine({ loan_type: 'personal_loan' }, 120, 'IN'), /Not stretched past its end date/);
  assert.match(P.ceilingLine({ loan_type: 'home_loan' }, -3, 'IN'), /already reached/);
});

// ── salaried advance tax ───────────────────────────────────────────────────

const streams = [
  { id: 's', kind: 'salaried', label: 'Job', gross_annual: '1800000', start_date: '2024-04-01' },
  { id: 'i', kind: 'interest', label: 'FD', gross_annual: '200000', start_date: '2024-04-01', tds_pct: '0.10' },
  { id: 'r', kind: 'rental', label: 'Flat', gross_annual: '240000', start_date: '2024-04-01' },
  { id: 'f', kind: 'freelance', label: 'Side', gross_annual: '300000', start_date: '2024-04-01' },
  { id: 'g', kind: 'capital_gains', label: 'Shares', gross_annual: '150000', start_date: '2024-04-01', cg_kind: 'equity_ltcg' },
  { id: 'old', kind: 'other', label: 'Ended', gross_annual: '50000', start_date: '2023-01-01', end_date: '2025-03-31' },
  { id: 'z', kind: 'other', label: 'Zero', gross_annual: '0', start_date: '2024-04-01' },
];

test('non-TDS streams: kinds mapped, TDS kept, ended and empty streams skipped, salary not included', () => {
  const out = S.nonTdsStreams(streams, '2026-10-15');
  assert.deepEqual(out, [
    { kind: 'interest', gross_annual: '200000', tds_pct: '0.10' },
    { kind: 'rent', gross_annual: '240000' },
    { kind: 'freelance', gross_annual: '300000', presumptive: true },
    { kind: 'capital_gains', gross_annual: '150000', cg_kind: 'equity_ltcg' },
  ]);
  const normal = S.nonTdsStreams([{ ...streams[3], tax_treatment: 'business_normal' }], '2026-10-15');
  assert.equal(normal[0].presumptive, false);
  const cg = S.nonTdsStreams([{ ...streams[4], cg_kind: undefined }], '2026-10-15');
  assert.equal(cg[0].cg_kind, 'other');
});

test('request only for a salaried Indian with gross pay and non-TDS income', () => {
  const u = { country: 'IN', income_type: 'salaried', annual_gross_salary: '1800000', tax_regime: 'old', age_bracket: '60_plus', income_streams: streams, loans: [] };
  const r = S.salariedAdvanceTaxRequest(u, '2026-10-15');
  assert.equal(r.annual_gross_salary, '1800000');
  assert.equal(r.tax_regime, 'old');
  assert.equal(r.age, 60);
  assert.equal(r.today, '2026-10-15');
  assert.equal(r.streams.length, 4);
  assert.equal(S.salariedAdvanceTaxRequest({ ...u, country: 'US' }, '2026-10-15'), null);
  assert.equal(S.salariedAdvanceTaxRequest({ ...u, income_type: 'business_owner' }, '2026-10-15'), null);
  assert.equal(S.salariedAdvanceTaxRequest({ ...u, annual_gross_salary: '' }, '2026-10-15'), null);
  assert.equal(S.salariedAdvanceTaxRequest({ ...u, income_streams: [streams[0]] }, '2026-10-15'), null);
  assert.equal(S.salariedAdvanceTaxRequest({ ...u, tax_regime: undefined }, '2026-10-15').tax_regime, 'new');
});

const response = (extra = {}) => ({
  applies: true, liability: '64000', reason: '', tax_total: '0', tax_on_salary: '0', tds_on_other: '0', presumptive: false,
  fiscal_year_label: 'FY 2026-27',
  instalments: [
    { due: '2026-06-15', cumulative_share: '0.15', amount: '9600', cumulative: '9600' },
    { due: '2026-09-15', cumulative_share: '0.45', amount: '19200', cumulative: '28800' },
    { due: '2026-12-15', cumulative_share: '0.75', amount: '19200', cumulative: '48000' },
    { due: '2027-03-15', cumulative_share: '1', amount: '16000', cumulative: '64000' },
  ],
  interest_234c_if_unpaid: '3360', interest_234b_if_unpaid: '2560', interest_if_unpaid: '5920',
  assumptions: [], sources: {}, threshold: '10000', ...extra,
});

test('schedule keeps upcoming instalments, renumbered; none under ₹10,000 or when it does not apply', () => {
  const s = S.scheduleFromResponse(response(), '2026-10-15');
  assert.equal(s.country, 'IN');
  assert.equal(s.annualLiability, '64000');
  assert.deepEqual(s.instalments.map((i) => [i.dueDate, i.ordinal, i.cumulativePct, i.amountDue, i.status]), [
    ['2026-12-15', 1, 75, '19200', 'pending'],
    ['2027-03-15', 2, 100, '16000', 'pending'],
  ]);
  assert.equal(S.scheduleFromResponse(response({ applies: false }), '2026-10-15'), null);
  assert.equal(S.scheduleFromResponse(response({ liability: '9999' }), '2026-10-15'), null);
  assert.notEqual(S.scheduleFromResponse(response({ liability: '10000' }), '2026-10-15'), null);
  assert.equal(S.scheduleFromResponse(response(), '2027-03-16'), null);
});

test('note names the extra tax, the ₹10,000 line and the 234C + 234B interest', () => {
  const fmt = (v) => `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;
  const n = S.salariedAdvanceTaxNote(response(), fmt);
  assert.match(n, /adds ₹64,000 this year/);
  assert.match(n, /₹10,000 or more/);
  assert.match(n, /about ₹5,920 in interest/);
  assert.match(n, /s\.425 \[234C\] ₹3,360 \+ s\.424 \[234B\] ₹2,560/);
});

test('India advance tax threshold is "₹10,000 or more" (gte) for business income too', () => {
  const T = lib('tax-brackets');
  assert.equal(T.isAdvanceTaxApplicable('IN', 'business_owner', new Decimal(10000)), true);
  assert.equal(T.isAdvanceTaxApplicable('IN', 'business_owner', new Decimal(9999)), false);
  assert.equal(T.isAdvanceTaxApplicable('IN', 'salaried', new Decimal(50000)), false);
});

test('Plan wires the salaried advance tax only when no business schedule exists', () => {
  const lp = src('components/plan/load-plan.ts');
  assert.match(lp, /if \(!advanceTaxSchedule\) \{[\s\S]*salariedAdvanceTaxRequest\(adjustedUser/);
  assert.match(src('components/plan/LedgerPlan.tsx'), /data-testid="advance-tax-salaried-note"/);
  assert.match(src('lib/api.ts'), /'\/api\/tax\/advance-tax\/salaried'/);
});

// ── FX drift path of the marginal cost (TS twin of engine _fx_adjust) ────

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(Number(a) - Number(b)) < eps, `${a} vs ${b}`);

test('fxAdjust matches the engine (values from engine.marginal_cost._fx_adjust)', () => {
  const us = (drift, rc) => ({ country: 'US', fx_drift_annualized: { INR: drift }, ...(rc != null ? { remittance_cost: rc } : {}) });
  const l = { currency: 'INR' };
  close(M.fxAdjust(l, us('0.03'), new Decimal('0.10'), 60), '0.02739307958540195570');
  close(M.fxAdjust(l, us('0'), new Decimal('0.10'), 6), '-0.026950');
  close(M.fxAdjust(l, us('0.03', '0'), new Decimal('0.10'), 24), '0.03300');
  close(M.fxAdjust(l, us('-0.02', '0.01'), new Decimal('0.10'), 0), '-0.032780');
});

test('fxAdjust is zero for a same-currency loan and with no drift and no cost', () => {
  assert.equal(M.fxAdjust({ currency: 'USD' }, { country: 'US', fx_drift_annualized: { INR: '0.05' } }, new Decimal('0.1'), 60).toString(), '0');
  assert.equal(M.fxAdjust({}, { country: 'IN' }, new Decimal('0.1'), 60).toString(), '0');
  // A dollar loan for an Indian earner: no default transfer cost that way.
  assert.equal(M.fxAdjust({ currency: 'USD' }, { country: 'IN' }, new Decimal('0.1'), 60).toString(), '0');
  assert.equal(M.REMITTANCE_COST_DEFAULT.USD, '0.0245');
});

test('userMarginalCosts adds the FX adjustment to an NRI rupee loan and can flip the order', () => {
  const base = { country: 'US', income_type: 'salaried', monthly_income: '9000', loans: [
    { id: 'car', bank: 'Ally', loan_type: 'car_loan', outstanding: '20000', nominal_rate: '0.085', scheduled_emi: '500', tenure_months_remaining: 48, rate_type: 'fixed' },
    { id: 'home', bank: 'SBI', loan_type: 'personal_loan', currency: 'INR', outstanding: '1500000', nominal_rate: '0.10', scheduled_emi: '30000', tenure_months_remaining: 60, rate_type: 'fixed' },
  ], fx_to_user_currency: { INR: '0.012' } };
  const flat = M.userMarginalCosts({ ...base, remittance_cost: '0' }, '0.22');
  assert.equal(flat.get(1).fxAdjust, undefined);
  assert.ok(flat.get(1).total.gt(flat.get(0).total), 'without FX the 10% rupee loan costs more');
  const slid = M.userMarginalCosts({ ...base, fx_drift_annualized: { INR: '-0.04' } }, '0.22');
  const fx = slid.get(1).fxAdjust;
  assert.ok(fx && fx.lt(0), 'a sliding rupee makes the rupee loan cheaper in dollars');
  close(slid.get(1).total, flat.get(1).total.plus(fx));
  assert.ok(slid.get(1).total.lt(slid.get(0).total), 'order flips to the car loan once the slide is counted');
  assert.equal(slid.get(0).fxAdjust, undefined);
});

// ── Profile / Setup keep what only Plan edits ──────────────────────────────

test('carryPlanInputs hands back Plan-only fields; a key the form sets wins; loans by id', () => {
  const prev = {
    country: 'IN', gap_credit_limit: '200000', date_of_birth: '1988-04', retirement_age: 62, assumed_post_tax_return: '0.07',
    loans: [{ id: 'a', on_rate_rise: 'mix', max_tenure_months: 300 }, { id: 'b', on_rate_rise: 'raise_emi' }],
  };
  const built = { country: 'IN', loans: [{ id: 'a', outstanding: '1' }, { id: 'c', outstanding: '2' }, { id: 'b', on_rate_rise: undefined }] };
  const out = P.carryPlanInputs(built, prev);
  assert.equal(out.gap_credit_limit, '200000');
  assert.equal(out.date_of_birth, '1988-04');
  assert.equal(out.retirement_age, 62);
  assert.equal(out.assumed_post_tax_return, '0.07');
  assert.equal(out.loans[0].on_rate_rise, 'mix');
  assert.equal(out.loans[0].max_tenure_months, 300);
  assert.equal(out.loans[1].on_rate_rise, undefined);
  assert.equal(out.loans[2].on_rate_rise, undefined, 'the form cleared it on purpose');
  assert.equal(P.carryPlanInputs(built, null), built);
  const own = P.carryPlanInputs({ ...built, gap_credit_limit: '5' }, prev);
  assert.equal(own.gap_credit_limit, '5');
});

function browser(initialUser) {
  const jar = new Map();
  const data = new Map();
  global.document = {
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(value) {
      const [pair, ...attrs] = value.split(';');
      const split = pair.indexOf('=');
      const key = pair.slice(0, split);
      if (attrs.some((a) => a.trim() === 'max-age=0')) jar.delete(key); else jar.set(key, pair.slice(split + 1));
    },
  };
  global.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  global.window = { localStorage: global.localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
  if (initialUser) lib('user-store').saveProfileClient({ user: initialUser, marginalRate: '0.2' });
}

const savedUser = () => ({
  country: 'IN', income_type: 'salaried', monthly_income: '90000', annual_income: '1080000', fixed_expenses: '40000', variable_expenses: '0',
  savings_balance: '0', efund_balance: '0', efund_target: '0', primary_bank: 'SBI',
  gap_credit_limit: '150000', date_of_birth: '1985-03', retirement_age: 58, assumed_post_tax_return: '0.072',
  loans: [{ id: 'L1', bank: 'SBI', loan_type: 'home_loan', outstanding: '3000000', nominal_rate: '0.085', scheduled_emi: '30000',
    tenure_months_remaining: 180, rate_type: 'floating', on_rate_rise: 'raise_emi', max_tenure_months: 300 }],
});

function keepsAll(u) {
  assert.equal(u.gap_credit_limit, '150000');
  assert.equal(u.date_of_birth, '1985-03');
  assert.equal(u.retirement_age, 58);
  assert.equal(u.assumed_post_tax_return, '0.072');
  assert.equal(u.loans[0].on_rate_rise, 'raise_emi');
  assert.equal(u.loans[0].max_tenure_months, 300);
}

test('QuickSetup save path keeps the Plan-only inputs (rebuild drops loan extras, carry restores them)', () => {
  browser(savedUser());
  const store = lib('user-store');
  const current = store.loadProfileClient();
  keepsAll(current.user);
  // What Setup's buildUser does to a loan it finished, at worst: rebuilt
  // from its own fields only.
  const L = current.user.loans[0];
  const rebuilt = { ...current.user, loans: [{ id: L.id, bank: L.bank, loan_type: L.loan_type, outstanding: '2900000', nominal_rate: L.nominal_rate, scheduled_emi: L.scheduled_emi, tenure_months_remaining: 170, rate_type: L.rate_type }] };
  delete rebuilt.gap_credit_limit; delete rebuilt.date_of_birth; delete rebuilt.retirement_age; delete rebuilt.assumed_post_tax_return;
  const choices = { efMonths: 3, efSplit: '0.30', strategy: 'avalanche' };
  const applied = lib('setup-choices').applyChoices(P.carryPlanInputs(rebuilt, current.user), choices, 40000, '2026-10-15');
  const built = lib('fx-refresh').dateProfileRates(applied, current.user, {}, Date.now());
  const user = { ...built, loans: lib('loan-types').disambiguateLoans(lib('roll-forward').stampBalanceDates(built.loans, current.user.loans, '2026-10-15')) };
  assert.equal(lib('paid-at-entry').saveProfileWithPaidEmis({ ...current, user, marginalRate: '0.2' }, '2026-10-15'), true);
  keepsAll(store.loadProfileClient().user);
});

test('Profile save path ({...stored.user, ...buildUser()}) keeps them too', () => {
  browser(savedUser());
  const store = lib('user-store');
  const stored = store.loadProfileClient();
  // Profile's buildUser names none of the Plan-only keys; its loans come
  // from the saved ones.
  const built = { country: 'IN', income_type: 'salaried', monthly_income: '95000', loans: stored.user.loans.map((l) => ({ ...l, outstanding: '2950000' })) };
  const merged = P.carryPlanInputs({ ...stored.user, ...built }, stored.user);
  const withFx = lib('fx-refresh').dateProfileRates(merged, stored.user, {}, Date.now());
  const stamped = { ...withFx, loans: lib('roll-forward').stampBalanceDates(withFx.loans, stored.user.loans, '2026-10-15') };
  assert.equal(lib('paid-at-entry').saveProfileWithPaidEmis({ user: stamped, marginalRate: '0.2', creditScore: null }, '2026-10-15'), true);
  keepsAll(store.loadProfileClient().user);
});

test('both forms route their save through carryPlanInputs; buildUser never names a Plan-only key', () => {
  const profile = src('app/profile/ProfileClient.tsx');
  const setup = src('components/setup/QuickSetup.tsx');
  assert.match(profile, /dateProfileRates\(\s*carryPlanInputs\(\{ \.\.\.\(stored\.isLive \? stored\.user : \{\}\), \.\.\.buildUser\(\) \}/);
  assert.match(setup, /dateProfileRates\(carryPlanInputs\(buildUser\(\), current\.isLive \? current\.user : null\)/);
  const body = (s) => s.slice(s.indexOf('function buildUser(): UserPayload'), s.indexOf('function buildUser(): UserPayload') + 6000);
  for (const k of ['gap_credit_limit', 'date_of_birth', 'retirement_age', 'assumed_post_tax_return']) {
    assert.doesNotMatch(body(profile), new RegExp(`\\b${k}\\b`), `Profile buildUser names ${k}`);
    assert.doesNotMatch(body(setup), new RegExp(`\\b${k}\\b`), `Setup buildUser names ${k}`);
  }
});
