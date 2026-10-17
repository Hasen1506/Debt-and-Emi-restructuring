// Round 3 part B (17 Oct 2026, work/reports/ux-walkthrough-2.md #10, #13, #21, US letters).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── #10 new loan kinds ───────────────────────────────────────────────────────
test('#10: own labels; a two-wheeler is not a car loan, medical is not personal', () => {
  const { LOAN_TYPE_NAME, loanLabel } = lib('loan-types.ts');
  assert.equal(LOAN_TYPE_NAME.two_wheeler_loan, 'two-wheeler loan');
  assert.equal(LOAN_TYPE_NAME.medical_loan, 'medical loan');
  assert.equal(LOAN_TYPE_NAME.loan_against_property, 'loan against property');
  assert.equal(LOAN_TYPE_NAME.home_topup, 'home loan top-up');
  assert.equal(loanLabel({ bank: 'Bajaj Auto Finance', loan_type: 'two_wheeler_loan' }), 'Bajaj Auto Finance two-wheeler loan');
});

test('#10: LAP / top-up are home loans for tax only when used for a house', () => {
  const { taxType, fullCap24, principal80c } = lib('loan-types.ts');
  assert.equal(taxType({ loan_type: 'loan_against_property' }), 'loan_against_property');
  assert.equal(taxType({ loan_type: 'loan_against_property', house_use: 'other' }), 'loan_against_property');
  assert.equal(taxType({ loan_type: 'loan_against_property', house_use: 'buy_build' }), 'home_loan');
  assert.equal(taxType({ loan_type: 'home_topup', house_use: 'repair' }), 'home_loan');
  assert.equal(taxType({ loan_type: 'personal_loan', house_use: 'buy_build' }), 'personal_loan');
  // top-up: never 80C; repair: ₹30k cap, no 80C; LAP buy/build keeps both
  assert.equal(principal80c({ loan_type: 'home_topup', house_use: 'buy_build' }), false);
  assert.equal(principal80c({ loan_type: 'loan_against_property', house_use: 'buy_build' }), true);
  assert.equal(principal80c({ loan_type: 'loan_against_property', house_use: 'repair' }), false);
  assert.equal(fullCap24({ loan_type: 'home_topup', house_use: 'repair' }), false);
  assert.equal(fullCap24({ loan_type: 'home_loan', house_use: 'repair' }), true);
});

test('#10: Tax page lines: LAP with no house use says no tax break; top-up for a house says no 80C', () => {
  const { loanTaxLine } = lib('india-tax-loans.ts');
  assert.match(loanTaxLine({ loan_type: 'loan_against_property', outstanding: '3000000' }, 'old', '2026-10'), /No tax break unless the money bought, built or repaired a house/);
  const up = loanTaxLine({ loan_type: 'home_topup', house_use: 'buy_build', outstanding: '500000' }, 'old', '2026-10');
  assert.match(up, /up to ₹2L/);
  assert.match(up, /doesn’t count in/);
  assert.match(loanTaxLine({ loan_type: 'home_topup', house_use: 'repair' }, 'old', '2026-10'), /₹30,000 \(repair or renovation\)/);
  assert.equal(loanTaxLine({ loan_type: 'two_wheeler_loan' }, 'old', '2026-10'), null);
});

test('#10: the regime comparison counts a LAP only when it bought a house', () => {
  const { homeLoanYears } = lib('tax-profile.ts');
  const base = { outstanding: '3000000', nominal_rate: '0.095', scheduled_emi: '32000', tenure_months_remaining: 180, rate_type: 'floating', bank: '' };
  assert.equal(homeLoanYears([{ ...base, loan_type: 'loan_against_property' }], '2026-10').length, 0);
  const [h] = homeLoanYears([{ ...base, loan_type: 'home_topup', house_use: 'buy_build' }], '2026-10');
  assert.equal(h.principal80cEligible, false);
});

test('#10: Setup offers the new kinds; LAP, top-up and two-wheeler are India-only', () => {
  const { loanKindsFor } = lib('r7-inputs.ts');
  const chips = [['home_topup', 'Home top-up'], ['loan_against_property', 'Against property'], ['two_wheeler_loan', 'Two-wheeler'], ['medical_loan', 'Medical']];
  assert.deepEqual(loanKindsFor(chips, 'IN').map(([t]) => t), chips.map(([t]) => t));
  assert.deepEqual(loanKindsFor(chips, 'US').map(([t]) => t), ['medical_loan']);
  const qs = src('components/setup/QuickSetup.tsx');
  for (const t of ['home_topup', 'loan_against_property', 'two_wheeler_loan', 'medical_loan']) assert.ok(qs.includes(`['${t}',`), t);
  assert.match(src('components/setup/LoanExtras.tsx'), /Was the money used for a house\?/);
});

test('#10: US medical debt has its own guidance, the credit-report line marked verify', () => {
  const { US_MEDICAL_NOTES } = lib('loan-status.ts');
  assert.ok(US_MEDICAL_NOTES.some((t) => /itemized bill/.test(t) && /financial assistance/.test(t)));
  assert.ok(US_MEDICAL_NOTES.some((t) => /no interest/.test(t)));
  assert.ok(US_MEDICAL_NOTES.some((t) => /credit report/i.test(t) && /verify/.test(t)));
});

// ── #13 debt status ──────────────────────────────────────────────────────────
test('#13: four statuses, one plain line each', () => {
  const { DEBT_STATUS_CHOICES } = lib('loan-status.ts');
  assert.deepEqual(DEBT_STATUS_CHOICES.map(([k]) => k), ['normal', 'behind', 'collections', 'settled']);
  for (const [, label, line] of DEBT_STATUS_CHOICES) {
    assert.ok(label.length < 30, label);
    assert.ok(line.length < 90 && !line.includes('\n'), line);
  }
});

test('#13: behind / collections get steps, not "pay the minimum"; rights per country', () => {
  const { helpLines, needsHelp, rightsNote, isSettled } = lib('loan-status.ts');
  assert.equal(needsHelp({}), false);
  assert.equal(needsHelp({ debt_status: 'collections' }), true);
  assert.equal(isSettled({ debt_status: 'settled' }), true);
  const behind = helpLines({ debt_status: 'behind', loan_type: 'personal_loan' }, 'IN').join(' ');
  assert.match(behind, /hardship plan/);
  assert.doesNotMatch(behind, /minimum/i);
  const coll = helpLines({ debt_status: 'collections', loan_type: 'medical_loan' }, 'US').join(' ');
  assert.match(coll, /in writing/);
  assert.match(coll, /itemized bill/);
  assert.match(rightsNote('IN'), /RBI/);
  assert.match(rightsNote('IN'), /8 am and 7 pm/);
  assert.match(rightsNote('US'), /FDCPA/);
  assert.match(rightsNote('US'), /30 days/);
  assert.deepEqual(helpLines({ debt_status: 'normal', loan_type: 'personal_loan' }, 'IN'), []);
});

test('#13: Home shows the steps with the draft marker and links /cant-pay; the one step drops the minimums line', () => {
  const card = src('components/home/HomeDebtHelp.tsx');
  assert.match(card, /<DraftLegalMarker id="debt-rights"/);
  assert.match(card, /href="\/cant-pay"/);
  assert.match(card, /kind=debt_validation/);
  assert.match(card, /kind=cease_contact/);
  assert.match(card, /SETTLED_NOTE/);
  assert.match(src('app/page.tsx'), /<HomeDebtHelp loans=\{profile\.user\.loans\}/);
  const home = src('components/home/HomeDebtFree.tsx');
  assert.ok(home.indexOf('some(needsHelp)') > 0 && home.indexOf('some(needsHelp)') < home.indexOf('PAY AT LEAST THE MINIMUMS'));
  const { LEGAL_REVIEW } = lib('legal-review.ts');
  assert.equal(LEGAL_REVIEW['debt-rights'], 'pending');
});

test('#13: settled leaves the plan (nothing owed) and says what it does to the credit report', () => {
  const ex = src('components/setup/LoanExtras.tsx');
  assert.match(ex, /debt_status: k, outstanding: '0', scheduled_emi: '0'/);
  const { SETTLED_NOTE } = lib('loan-status.ts');
  assert.match(SETTLED_NOTE.IN, /CIBIL/);
  assert.match(SETTLED_NOTE.US, /7 years/);
  // conservative: no settlement-offer calculator
  assert.doesNotMatch(src('lib/loan-status.ts'), /settlementOffer|offerPct|settle_pct/);
});

// ── #21 salary-deducted EMI ──────────────────────────────────────────────────
test('#21: an EMI taken from salary is not taken off take-home again; the loan is still tracked', () => {
  const { deriveMetrics } = lib('derived.ts');
  const loan = { loan_type: 'personal_loan', bank: 'SBI', outstanding: '500000', nominal_rate: '0.11', rate_type: 'fixed',
    tenure_months_remaining: 60, scheduled_emi: '10871' };
  const user = (l) => ({ country: 'IN', income_type: 'salaried', annual_income: '1800000', monthly_income: '60000',
    fixed_expenses: '30000', variable_expenses: '0', savings_balance: '0', primary_bank: 'SBI', location_tier: 'urban', loans: [l] });
  const plain = deriveMetrics({ user: user(loan), marginalRate: '0', creditScore: null, isLive: true });
  const ticked = deriveMetrics({ user: user({ ...loan, salary_deducted: true }), marginalRate: '0', creditScore: null, isLive: true });
  assert.equal(plain.surplus.toNumber(), 60000 - 30000 - 10871);
  assert.equal(ticked.surplus.toNumber(), 30000);
  assert.equal(ticked.loans.length, 1);
  assert.equal(ticked.totalOutstanding.toNumber(), 500000);
});

test('#21: the tick sits on EMI loans only, with its one hint line', () => {
  const { canBeSalaryDeducted, SALARY_DEDUCTED_LABEL, SALARY_DEDUCTED_HINT } = lib('loan-status.ts');
  assert.equal(canBeSalaryDeducted('credit_card'), false);
  assert.equal(canBeSalaryDeducted('bnpl'), false);
  assert.equal(canBeSalaryDeducted('personal_loan'), true);
  assert.match(SALARY_DEDUCTED_LABEL, /salary before it reaches the bank/);
  assert.match(SALARY_DEDUCTED_HINT, /won’t take it off again/);
  assert.match(src('components/setup/LoanExtras.tsx'), /data-testid="setup-salary-deducted"/);
});
