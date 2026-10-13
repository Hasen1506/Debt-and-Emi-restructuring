// G6: the credit-report and SMS imports never save by themselves, say honestly
// where the document is read (#19), keep the password out of storage (#18),
// and send SMS nowhere.
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
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  module._compile(output, file);
};
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cr = require(path.join(root, 'lib', 'credit-report.ts'));

const BLANK = { loan_type: 'personal_loan', bank: '', outstanding: '', nominal_rate: '', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '' };

test('a reviewed home loan becomes a Profile loan with the months left, not the full term', () => {
  const loan = cr.loanFromAccount({
    loan_type: 'home_loan', lender: 'SAMPLE HOUSING FINANCE', outstanding: '3812450', emi: '39500', nominal_rate: '0.0865',
    tenure_months: '240', sanctioned_amount: '4500000', credit_limit: null, opened: '2021-03-15', account_last4: '3456',
    missing: ['rate_type', 'prepayment_fee'],
  }, BLANK, '2026-10-12');
  assert.equal(loan.loan_type, 'home_loan');
  assert.equal(loan.bank, 'SAMPLE HOUSING FINANCE');
  assert.equal(loan.outstanding, '3812450');
  assert.equal(loan.scheduled_emi, '39500');
  assert.equal(loan.tenure_months_remaining, 240 - 67); // Mar 2021 → Oct 2026 = 67 months gone
  assert.equal(loan.rate_type, 'fixed'); // untouched: the report doesn't say, the user picks
});

test('a card keeps no EMI or tenure; blanks stay blank for the user to fill', () => {
  const card = cr.loanFromAccount({
    loan_type: 'credit_card', lender: 'DEMO BANK', outstanding: '64210', emi: null, nominal_rate: null, tenure_months: null,
    sanctioned_amount: null, credit_limit: '200000', opened: '2019-07-02', account_last4: '4321', missing: ['emi', 'nominal_rate', 'tenure_months', 'rate_type', 'prepayment_fee'],
  }, BLANK, '2026-10-12');
  assert.equal(card.scheduled_emi, '');
  assert.equal(card.nominal_rate, '');
  assert.match(cr.missingSentence({ missing: ['emi', 'nominal_rate'] }), /the EMI, the interest rate/);
});

test('wiring: imports never save by themselves; copy is honest about the server', () => {
  const imp = src('components/profile/CreditReportImport.tsx');
  assert.match(imp, /api\.creditReportRead/);
  assert.doesNotMatch(imp, /saveProfile|persist|localStorage|sessionStorage|api\.save|syncUser|document\.cookie/);
  assert.match(imp, /read on RightDue&apos;s server/);
  assert.match(imp, /never\s+stored/);
  // UX50 D-12: the password field has a show/hide toggle, so it is a password field unless shown.
  assert.match(imp, /type=\{showPw \? 'text' : 'password'\}/);
  assert.match(imp, /autoComplete="off"/);
  assert.doesNotMatch(imp, /on your device|stays on your phone|local only/i);
  const sms = src('components/profile/SmsImport.tsx');
  assert.doesNotMatch(sms, /\bapi\.|fetch\(|saveProfile|localStorage/);
  assert.match(sms, /on this device only/);
  const kfs = src('components/profile/KfsImport.tsx');
  assert.match(kfs, /data-testid="kfs-password"/);
  assert.doesNotMatch(kfs, /local only/i);
  const prof = src('app/profile/ProfileClient.tsx');
  assert.match(prof, /<CreditReportImport/);
  assert.match(prof, /<SmsImport loans=\{loans\}/);
  assert.match(src('lib/api.ts'), /creditReportRead: \(req/);
});
