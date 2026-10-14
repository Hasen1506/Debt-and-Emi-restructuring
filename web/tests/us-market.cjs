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

// Sprint G3 (grill #33, #34, #79, SALT): the US rules in lib/us-loans.ts equal
// engine/us_loans.py on every case in the exported fixture.
const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/us_loan_cases.json'), 'utf8'));
const s = (v) => (v == null ? null : v.toString());

test('differential: student-loan holds and explainers equal the engine', () => {
  const u = lib('us-loans.ts');
  assert.equal(cases.student.length, 45); // E7: + 'none' and 'unsure' answers
  for (const c of cases.student) {
    assert.equal(u.forgivenessPrepayBlock(c.loan), c.block, JSON.stringify(c.loan));
    assert.deepEqual(u.studentLoanExplainer(c.loan), c.explainer, JSON.stringify(c.loan));
  }
});

test('differential: PMI due and PMI analysis equal the engine', () => {
  const u = lib('us-loans.ts');
  for (const c of cases.homes) {
    assert.equal(s(u.pmiDue(c.loan)), c.due, JSON.stringify(c.loan));
    const a = u.pmiAnalysis(c.loan);
    if (c.analysis === null) { assert.equal(a, null); continue; }
    assert.deepEqual({
      kind: a.kind, monthly: s(a.monthly), annual: s(a.annual), request_balance: s(a.requestBalance),
      auto_balance: s(a.autoBalance), extra_to_request_now: s(a.extraToRequestNow),
      months_to_request: a.monthsToRequest, months_to_auto: a.monthsToAuto,
      pmi_saved_by_paying_now: s(a.pmiSavedByPayingNow), pmi_return_pct: s(a.pmiReturnPct), notes: a.notes,
    }, c.analysis, JSON.stringify(c.loan));
  }
  assert.equal(u.ESCROW_NOTE, cases.escrow_note);
});

test('differential: every state\'s mortgage-interest treatment equals the engine', () => {
  const u = lib('us-loans.ts');
  assert.equal(u.US_STATES.length, 51);
  for (const c of cases.states) {
    const t = u.stateMortgageTreatment(c.state);
    assert.deepEqual([t.kind, t.modelled, t.label, t.sourceUrl], [c.kind, c.modelled, c.label, c.source_url], String(c.state));
    assert.equal(s(u.usMortgageMarginalRate('0.2707', c.state, '0.0507')), c.rate, String(c.state));
  }
});

test('differential: the SALT cap schedule equals the engine (IRC §164(b)(7))', () => {
  const u = lib('us-loans.ts');
  for (const c of cases.salt)
    assert.equal(s(u.saltCapForYear(c.year, c.magi, c.mfs)), c.cap, JSON.stringify(c));
  assert.match(u.SALT_CAP_COPY, /\$40,400/);
});

test('no copy still says the SALT cap is $10k', () => {
  for (const f of ['lib/deductions.ts', 'components/onboarding/DeductionsPanel.tsx'])
    assert.doesNotMatch(src(f), /\$10k/, f);
});

test('only US-market loans send the US fields', () => {
  const { usLoanFieldsFor } = lib('us-loans.ts');
  const edu = { loan_type: 'education_loan', student_loan_kind: 'federal', forgiveness_track: 'pslf' };
  assert.equal(usLoanFieldsFor(edu, 'US').forgiveness_track, 'pslf');
  assert.equal(usLoanFieldsFor(edu, 'IN').forgiveness_track, undefined);
  assert.equal(usLoanFieldsFor({ ...edu, currency: 'INR' }, 'US').forgiveness_track, undefined);
  const home = { loan_type: 'home_loan', pmi_monthly: '150', original_home_value: '300000' };
  assert.equal(usLoanFieldsFor(home, 'US').pmi_monthly, '150');
  assert.equal(usLoanFieldsFor({ ...home, pmi_monthly: '' }, 'US').pmi_monthly, undefined);
});

test('a PA mortgage saves only federal tax in the on-screen payoff order too', () => {
  const { userMarginalCosts } = lib('marginal-cost.ts');
  const home = { loan_type: 'home_loan', bank: 'X', outstanding: '285000', nominal_rate: '0.065', rate_type: 'fixed', tenure_months_remaining: 348, scheduled_emi: '1896' };
  const user = (state) => ({ country: 'US', income_type: 'salaried', annual_income: '96000', monthly_income: '8000', fixed_expenses: '3000', savings_balance: '0', primary_bank: 'X', state, state_marginal_rate: '0.0307', itemises: true, loans: [home], deductions: { mortgage_interest_paid: '40000' } });
  const pa = userMarginalCosts(user('PA'), '0.2507').get(0);
  const ca = userMarginalCosts(user('CA'), '0.2507').get(0);
  assert.ok(ca.taxBenefit.gt(0));
  assert.ok(pa.taxBenefit.lt(ca.taxBenefit), `${pa.taxBenefit} vs ${ca.taxBenefit}`);
});

test('the Profile loan card shows the US fields for US-market loans', () => {
  const p = src('app/profile/ProfileClient.tsx');
  assert.match(p, /loanMarket\(l, country\) === 'US' && \(\s*<UsLoanFields/);
  assert.match(p, /<UsStateField value=\{usState\}/);
  assert.match(p, /\.\.\.usLoanFieldsFor\(l, country\)/);
  const f = src('components/profile/UsLoanFields.tsx');
  assert.match(f, /PSLF/);
  assert.match(f, /ESCROW_NOTE/);
});
