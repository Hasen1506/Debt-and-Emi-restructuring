const { profileSource } = require('./lib/profile-source.cjs'); // Audit 80 E15: Profile is split into parts/
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
const repo = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

// Live re-test 8 fix round (R8-1..R8-9, O-1).
const { INDIA_ONLY_WORDS, localTerms } = lib('terms.ts');
const noIndiaWords = (s, where) => assert.doesNotMatch(s, INDIA_ONLY_WORDS, `${where}: ${s}`);

test('R8-1: the payment-below-interest message says "monthly payment" and dollars for a US user', () => {
  const { emiBelowInterest, loanDraftErrors } = lib('loan-gaps.ts');
  const car = { loan_type: 'auto_loan', nominal_rate: '0.07', scheduled_emi: '50', outstanding: '18000', currency: 'USD' };
  const us = emiBelowInterest(car, 'US');
  assert.match(us, /\$18,000 earns \$105 interest a month, more than the \$50 monthly payment/);
  assert.match(us, /did you mean \$1,800\?/);
  assert.match(us, /the rate and the monthly payment\.$/);
  assert.doesNotMatch(us, /thousand/);
  noIndiaWords(us, 'US emiBelowInterest');
  // Without a country, a USD loan still reads as US.
  noIndiaWords(emiBelowInterest(car), 'USD loan, no country');
  // Setup's draft check passes the country through.
  const d = loanDraftErrors(car, 'US');
  assert.ok(d.emi && !/EMI/.test(d.emi), d.emi);
  const blank = loanDraftErrors({ ...car, scheduled_emi: '' }, 'US');
  assert.equal(blank.emi, 'Enter the monthly payment the lender takes (on your statement or banking app).');
  // India keeps EMI and lakh words.
  const inr = emiBelowInterest({ loan_type: 'home_loan', nominal_rate: '0.09', scheduled_emi: '10000', outstanding: '2500000', currency: 'INR' }, 'IN');
  assert.match(inr, /₹25 lakh/);
  assert.match(inr, /EMI/);
  // A million-dollar balance may use words.
  assert.match(emiBelowInterest({ ...car, outstanding: '2000000', scheduled_emi: '100' }, 'US'), /\$2 million/);
});

test('R8-2: one term helper; US strings never say EMI, lakh, crore, RBI or CIBIL', () => {
  assert.equal(localTerms('Every EMI and card minimum', 'US'), 'Every monthly payment and card minimum');
  assert.equal(localTerms('EMIS + MINIMUMS + EXTRA', 'US'), 'MONTHLY PAYMENTS + MINIMUMS + EXTRA');
  assert.equal(localTerms('A new loan, an EMI offer, or a big purchase?', 'US'), 'A new loan, a pay-over-time offer, or a big purchase?');
  assert.equal(localTerms('EMI is due. Then an EMI.', 'US'), 'Monthly payment is due. Then a monthly payment.');
  assert.equal(localTerms('Every EMI and card minimum', 'IN'), 'Every EMI and card minimum');

  const rendered = [];
  // Home's this-month line.
  const { homeThisMonthLine } = lib('home-this-month.ts');
  const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
  const data = {
    total: 2700, extraUser: 2010,
    rows: [
      { loanIndex: 0, minimum: 270, name: 'Credit card', kind: 'extra', amountUser: 2280 },
      { loanIndex: 1, minimum: 420, name: 'Car loan', kind: 'emi', amountUser: 420 },
    ],
  };
  for (const short of [0, 500]) rendered.push(homeThisMonthLine(data, short, money, 'US').text);
  rendered.push(homeThisMonthLine({ ...data, extraUser: 0, rows: [{ ...data.rows[1], kind: 'emi' }] }, 0, money, 'US').text);
  assert.match(rendered[0], /Every monthly payment and card minimum/);
  assert.match(homeThisMonthLine(data, 0, money, 'IN').text, /Every EMI and card minimum/);
  // Tools and their questions.
  const { toolsFor } = lib('tools.ts');
  for (const t of toolsFor({ country: 'US' })) rendered.push(t.question, t.sub, t.name);
  // Home position status lines with the US tag.
  const { emiStatusLine } = lib('position-status.ts');
  for (const s of ['first', 'paid', 'due', 'part', 'missed']) rendered.push(emiStatusLine(s, 'OCT', 'NOV', 'PAYMENT', '$420'));
  // Portfolio hint, Setup words.
  const r8 = lib('r8-inputs.ts');
  rendered.push(r8.portfolioHint('US'));
  const { paymentWords } = lib('r7-inputs.ts');
  rendered.push(...Object.values(paymentWords('US')));
  // Fixed India sentences used on Plan/Home/New debt, put through the helper.
  for (const s of [
    'Due this month (EMIs and minimums)',
    'There’s no payoff date: at these figures the EMI doesn’t cover the interest, so the balance never goes down.',
    'KEEP CURRENT EMIS RUNNING.',
    'Every loan on file is paid off. Put the old EMIs to work:',
    'EMIs + fee − price in cash',
    'Take the EMI offer.',
    'The first EMI is not due yet. Choose “Paid extra” for an early prepayment.',
  ]) rendered.push(localTerms(s, 'US'));
  for (const s of rendered) noIndiaWords(s, 'US string');

  // The pages that show these strings use the helper (no bare "EMI" left).
  assert.match(src('components/plan/LedgerPlan.tsx'), /localTerms\('EMIS \+ MINIMUMS \+ EXTRA', plan\.user\.country\)/);
  assert.match(src('components/plan/PlanSchedule.tsx'), /column is its \{paymentWords\(plan\.user\.country\)\.one\}/);
  assert.match(src('components/home/LedgerHome.tsx'), /localTerms\(`Spending \$\{fc\(spend\)\} \+ EMIs and card minimums/);
  assert.match(src('components/home/OpenPositions.tsx'), /const emiTag = country === 'US' \? 'PAYMENT' : 'EMI'/);
  assert.match(src('components/home/PayThisMonth.tsx'), /kindLine\(row, fmt, owedNowFor\(row\), country\)/);
  assert.match(src('components/profile/ProfileSummary.tsx'), /user\.country === 'US' \? 'PAYMENT' : 'EMI'/);
  assert.match(src('components/activity/history.ts'), /user\.country === 'US' \? usRow\(r0\) : r0/);
  assert.match(src('components/ledger/LToolPageHeader.tsx'), /toolInCountry\(meta, user\?\.country\)\.question/);
});

test('R8-3: the tenure what-if cites RBI only for a loan from an Indian lender', () => {
  const s = src('components/plan/TenureWhatIf.tsx');
  assert.match(s, /const inIndia = loan \? loanMarket\(loan, user\.country\) === 'IN'/);
  const usBranch = s.slice(s.indexOf('{!inIndia ? ('), s.indexOf(') : (', s.indexOf('{!inIndia ? (')));
  assert.ok(usBranch.length > 0);
  assert.doesNotMatch(usBranch, /RBI/);
  assert.match(usBranch, /Ask your lender; they decide\./);
});

test('R8-4: US Sell to repay has no gold chips; US Portfolio hint has no FD/PF', () => {
  const { assetKindsFor, portfolioHint } = lib('r8-inputs.ts');
  const { SALE_ASSET_TYPES } = lib('sale-calculator.ts');
  const us = assetKindsFor(SALE_ASSET_TYPES.US, 'US').map(([t, l]) => `${t}:${l}`).join(' ');
  assert.doesNotMatch(us, /gold/i);
  assert.match(us, /fixed_deposit:CD/);
  // An asset already picked keeps its chip.
  assert.ok(assetKindsFor(SALE_ASSET_TYPES.US, 'US', 'gold_physical').some(([t]) => t === 'gold_physical'));
  assert.equal(assetKindsFor(SALE_ASSET_TYPES.IN, 'IN').length, SALE_ASSET_TYPES.IN.length);
  assert.doesNotMatch(portfolioHint('US'), /\bFDs?\b|\bPF\b|gold/);
  assert.match(portfolioHint('IN'), /FDs, funds, gold, property, PF/);
  assert.match(src('app/tools/liquidate/tool.tsx'), /assetKindsFor\(SALE_ASSET_TYPES\[country\], country, assetType\)/);
  assert.match(src('components/portfolio/LedgerPortfolio.tsx'), /portfolioHint\(country\)/);
});

test('R8-5: Sell to repay: a fixed rate clears the error from WORK IT OUT', () => {
  const s = src('app/tools/liquidate/tool.tsx');
  assert.match(s, /error=\{rateOutOfRange\(debtRate\) \?\? at\('debtRate'\)\}/);
  assert.match(s, /onChange=\{\(v\) => \{ setDebtRate\(v\); clearField\('debtRate'\); \}\}/);
  assert.match(src('lib/form-errors.ts'), /const clearField = useCallback/);
});

test('R8-6: assumptions are bounded on the form, on save, in the API, and clamped for old profiles', () => {
  const { assumptionError, clampAssumptions, clampTaxRate } = lib('r8-inputs.ts');
  assert.match(assumptionError('payRise', '999999999999.99'), /above 50% isn’t accepted/);
  assert.equal(assumptionError('payRise', '0.08'), null);
  assert.equal(assumptionError('payRise', ''), null);
  assert.match(assumptionError('payRise', '-0.6'), /below -50%/);
  assert.match(assumptionError('tax', '0.61'), /above 60%/);
  assert.match(assumptionError('tax', '-50'), /can’t be negative/);
  assert.equal(assumptionError('tax', '0.6'), null);
  assert.match(assumptionError('fee', '0.11'), /above 10%/);
  assert.match(assumptionError('fee', '-50'), /can’t be negative/);
  const old = clampAssumptions({
    annual_hike_rate: '999999999999.99', inflation_rate: '5', state_marginal_rate: '0.9',
    hike_schedule: [[1, 3, '7']], credit_score: 5000,
    loans: [{ processing_fee_amortised: '0.5', insurance_premium_pct: '0.001', nominal_rate: '0.13' }],
  });
  assert.equal(old.annual_hike_rate, '0.5');
  assert.equal(old.inflation_rate, '0.5');
  assert.equal(old.state_marginal_rate, '0.6');
  assert.deepEqual(old.hike_schedule, [[1, 3, '0.5']]);
  assert.equal(old.credit_score, undefined);
  assert.equal(old.loans[0].processing_fee_amortised, '0.1');
  assert.equal(old.loans[0].insurance_premium_pct, '0.001');
  assert.equal(old.loans[0].nominal_rate, '0.13');
  assert.equal(clampAssumptions({ annual_hike_rate: '0.08' }).annual_hike_rate, '0.08');
  assert.equal(clampTaxRate('0.95'), '0.6');
  assert.equal(clampTaxRate('0.3'), '0.3');
  // Profile wires the checks and blocks SAVE.
  const p = profileSource();
  for (const w of [
    "error={assumptionError('payRise', annualHikeRate)}",
    "error={assumptionError('tax', marginalRate)}",
    "error={assumptionError('tax', stateMarginalRate)}",
    "error={assumptionError('fee', l.prepayment_penalty_pct)}",
    "error={assumptionError('fee', l.processing_fee_amortised)}",
    "error={assumptionError('fee', l.insurance_premium_pct)}",
  ]) assert.ok(p.includes(w), w);
  assert.match(p, /const badAssumption = assumptionBlock\(\);\n\s+if \(badAssumption\) \{\n\s+onOpen\(badAssumption\.step\);/);
  // Every loaded profile is clamped before a page plans with it.
  const store = src('lib/user-store.ts');
  assert.equal((store.match(/clampAssumptions\(JSON\.parse\(raw\)/g) || []).length, 2);
  // The API refuses the same values.
  const schemas = repo('api/schemas.py');
  assert.match(schemas, /annual_hike_rate: Decimal = Field\(D\("0"\), ge=D\("-0\.5"\), le=D\("0\.5"\)\)/);
  assert.match(schemas, /TaxRate = Annotated\[Decimal, Field\(ge=0, le=D\("0\.6"\)\)\]/);
  assert.match(schemas, /processing_fee_amortised: FeeRate/);
  assert.match(schemas, /credit_score: Optional\[int\] = Field\(None, ge=300, le=900\)/);
});

test('R8-7: lock-in and part-payment gap keep the typed text and take whole months only', () => {
  const { wholeMonthsError, wholeMonthsValue, LOCK_IN_RANGE, PART_PAY_FREQ_RANGE } = lib('r8-inputs.ts');
  for (const bad of ['abc', '5L', '-5000', '1e9', '99999999999999', '2.5', '361'])
    assert.match(wholeMonthsError(bad, LOCK_IN_RANGE), /whole number of months from 0 to 360/, bad);
  assert.equal(wholeMonthsError('12', LOCK_IN_RANGE), null);
  assert.equal(wholeMonthsError('', LOCK_IN_RANGE), null);
  assert.match(wholeMonthsError('0', PART_PAY_FREQ_RANGE), /from 1 to 120/);
  assert.equal(wholeMonthsValue('abc', LOCK_IN_RANGE), undefined);
  assert.equal(wholeMonthsValue('6', LOCK_IN_RANGE), 6);
  const p = profileSource();
  assert.doesNotMatch(p, /prepay_lock_in_months: v === '' \? undefined : Number\(v\)/);
  assert.doesNotMatch(p, /part_payment_freq_months: v === '' \? undefined : Number\(v\)/);
  assert.match(p, /wholeMonthsValue\(v, LOCK_IN_RANGE\)/);
  assert.match(p, /wholeMonthsValue\(v, PART_PAY_FREQ_RANGE\)/);
});

test('R8-8: Profile credit score uses the R7-6 check', () => {
  const p = profileSource();
  assert.match(p, /error=\{creditScoreError\(creditScore, country\)\}/);
  assert.match(p, /credit_score: usableCreditScore\(creditScore, country\) \|\| undefined/);
});

test('R8-9: asset amounts are readable and not negative; a started row is never dropped silently', () => {
  const { assetAmountError, marketValueError } = lib('r8-inputs.ts');
  for (const bad of ['abc', '-5000']) assert.ok(assetAmountError(bad, 'INR'), bad);
  assert.equal(assetAmountError('5L', 'INR'), null);
  assert.equal(assetAmountError('', 'INR'), null);
  assert.ok(assetAmountError('99999999999999', 'INR'), 'impossible size');
  const row = { label: 'Flat', current_market_value: '', purchase_price: '', purchase_date: '' };
  assert.equal(marketValueError(row, 'INR', false), null);
  assert.match(marketValueError(row, 'INR', true), /Enter what it’s worth today/);
  assert.match(marketValueError({ ...row, current_market_value: '-5000' }, 'INR', false), /negative/);
  assert.equal(marketValueError({ label: '', current_market_value: '', purchase_price: '', purchase_date: '' }, 'INR', true), null);
  assert.equal(marketValueError({ ...row, current_market_value: '5L' }, 'INR', true), null);
  const page = src('app/profile/assets/page.tsx');
  assert.match(page, /setSaveError\('Not saved yet: fix the highlighted field\.'\)/);
  assert.match(page, /error=\{marketValueError\(a, country === 'US' \? 'USD' : 'INR', tried\)\}/);
});

test('O-1: Can’t pay’s citation links are 44px tall on a touch screen', () => {
  const css = src('styles/globals.css');
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
  assert.match(coarse, /a\.rd-cite \{\s*display: inline-flex !important;\s*align-items: center;\s*min-height: 44px !important;/);
  assert.match(src('components/distress/CantPay.tsx'), /className="rd-cite"/);
});

test('R8: sign-out clears Home’s debt-free marks and the decision-log flag', () => {
  const s = src('lib/server-sync.ts');
  const list = s.slice(s.indexOf('export const LOCAL_PER_USER_KEYS'), s.indexOf('] as const;', s.indexOf('export const LOCAL_PER_USER_KEYS')));
  assert.match(list, /'rightdue_debt_free_marks'/);
  assert.match(list, /'rightdue_decision_log_migrated_v1'/);
  assert.match(src('lib/months-shaved.ts'), /MONTHS_SHAVED_KEY = 'rightdue_debt_free_marks'/);
});
