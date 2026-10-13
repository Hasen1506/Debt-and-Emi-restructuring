// UX50 F4: credit-report import merge/dedupe (D-03), balance date (D-06), card copy (D-07),
// bureau guide (D-13), and the SMS "add a loan from an EMI" proposal (D-10). SYNTHETIC data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  for (const ext of ['', '.ts', '.tsx']) {
    try { return origResolve.call(this, request + ext, parent, ...rest); } catch { /* next */ }
  }
  return origResolve.call(this, request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  module._compile(output, file);
};
const cr = require(path.join(root, 'lib', 'credit-report.ts'));

const blank = () => ({ loan_type: 'credit_card', bank: '', outstanding: '', nominal_rate: '', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '' });
const card = { loan_type: 'credit_card', lender: 'DEMO BANK', outstanding: '64210', emi: null, nominal_rate: null, tenure_months: null, sanctioned_amount: null, credit_limit: null, opened: '2019-07-02', account_last4: '4321', reported: '2026-09-30', missing: ['nominal_rate'] };

test('D-03: an account already typed in is matched, by digits or by lender and type', () => {
  const loans = [{ ...blank(), bank: 'Demo Bank Ltd.', outstanding: '60000', nominal_rate: '0.42' }, { ...blank(), loan_type: 'home_loan', bank: 'SAMPLE HFC' }];
  assert.equal(cr.matchExistingLoan(card, loans), 0);
  assert.equal(cr.matchExistingLoan({ ...card, lender: 'Other Bank', account_last4: null }, loans), -1);
  assert.equal(cr.matchExistingLoan({ ...card, account_last4: '9999' }, [{ ...loans[0], account_last4: '4321' }]), -1);
  assert.equal(cr.matchExistingLoan(card, [{ ...blank(), bank: 'Someone', account_last4: '4321' }]), 0);
  assert.equal(cr.lenderKey('HDFC Bank Ltd.'), cr.lenderKey('hdfc'));
});

test('D-03: the merge preview lists only figures that change', () => {
  const existing = { ...blank(), bank: 'Demo Bank', outstanding: '60000', nominal_rate: '0.42' };
  const incoming = cr.loanFromAccount(card, blank(), '2026-10-07');
  const diff = cr.mergePatch(existing, incoming).map((d) => d.field);
  assert.ok(diff.includes('outstanding'));
  assert.ok(!diff.includes('nominal_rate'));
});

test('D-06: the balance is dated the day the lender reported it', () => {
  assert.equal(cr.loanFromAccount(card, blank(), '2026-10-07').balance_as_of, '2026-09-30');
  assert.equal(cr.loanFromAccount({ ...card, reported: null }, blank(), '2026-10-07').balance_as_of, '2026-10-07');
  assert.equal(cr.loanFromAccount({ ...card, reported: '2027-01-01' }, blank(), '2026-10-07').balance_as_of, '2026-10-07');
  assert.equal(cr.loanFromAccount(card, blank(), '2026-10-07').imported_from, 'credit_report');
});

test('D-07: a card is asked only for its APR and minimum, from its statement', () => {
  const s = cr.missingSentence(card);
  assert.match(s, /APR or minimum due/);
  assert.doesNotMatch(s, /EMI|months left|prepayment/);
});

test('D-13: Experian is first and links to the consumer portal', () => {
  assert.equal(cr.BUREAU_LINKS[0].name, 'Experian');
  assert.match(cr.BUREAU_LINKS[0].url, /consumer\.experian\.in/);
  assert.equal(cr.EXPERIAN_STEPS.length, 3);
});

test('D-10: an EMI SMS for an unknown loan proposes one with its EMI, digits and bank', () => {
  const sms = require(path.join(root, 'lib', 'sms-parser.ts'));
  const { loanFromEmiSms } = require(path.join(root, 'components', 'profile', 'SmsImport.tsx'));
  const p = sms.parseSms('EMI of Rs 13,350 for Loan A/c XX0099 debited from HDFC Bank a/c XX1234 on 05-10-26.');
  assert.equal(p.kind, 'emi_debit');
  const loan = loanFromEmiSms(p);
  assert.equal(loan.scheduled_emi, '13350');
  assert.equal(loan.bank, 'HDFC Bank');
  assert.equal(loan.imported_from, 'sms');
});
