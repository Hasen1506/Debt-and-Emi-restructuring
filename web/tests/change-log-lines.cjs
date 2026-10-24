// The change log reads like the rest of the app: a loan is named once
// ("HDFC credit card", not "HDFC Bank: HDFC Bank:"), amounts carry their
// currency, rates are percentages, and a loan that only gained an id on
// load is not logged as removed and added again.
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
const { profileChanges } = lib('profile-changes.ts');
const { whatChanged } = lib('what-changed.ts');

const home = { loan_type: 'home_loan', bank: 'HDFC Bank', outstanding: '3500000', nominal_rate: '0.0850', scheduled_emi: '35200', tenure_months_remaining: 180 };
const card = { loan_type: 'credit_card', bank: 'HDFC Bank', outstanding: '80000', nominal_rate: '0.42', scheduled_emi: '4000', tenure_months_remaining: 0 };
const user = (loans, extra = {}) => ({ country: 'IN', monthly_income: '150000', fixed_expenses: '45000', tax_regime: 'new', income_type: 'salaried', loans, ...extra });

test('a new loan is named once, with its figures formatted', () => {
  const [row] = profileChanges(user([home]), user([home, card]));
  assert.equal(row.what, 'Added HDFC credit card');
  assert.equal(row.after, 'balance ₹80,000, 42.00% a year, payment ₹4,000');
  const [h] = profileChanges(user([]), user([home]));
  assert.equal(h.what, 'Added HDFC home loan');
  assert.equal(h.after, 'balance ₹35,00,000, 8.50% a year, EMI ₹35,200, 180 months left');
});

test('a loan that gains an id on load is the same loan', () => {
  const before = user([home, card]);
  const after = user([{ ...home, id: 'l_1' }, { ...card, id: 'l_2' }]);
  assert.deepEqual(profileChanges(before, after), []);
  // An id-matched edit is still an edit, and a real removal is still logged.
  const edited = profileChanges(after, user([{ ...home, id: 'l_1', outstanding: '3400000' }]));
  assert.deepEqual(edited.map((e) => e.what), ['Edited HDFC home loan', 'Removed HDFC credit card']);
  assert.equal(edited[0].after, 'balance ₹35,00,000 → ₹34,00,000');
});

test('US loans read in dollars with a payment, not an EMI', () => {
  const mortgage = { loan_type: 'home_loan', bank: 'Chase', outstanding: '320000', nominal_rate: '0.0675', scheduled_emi: '2140', tenure_months_remaining: 330 };
  const [row] = profileChanges(user([], { country: 'US' }), user([mortgage], { country: 'US' }));
  assert.equal(row.after, 'balance $320,000, 6.75% a year, payment $2,140, 330 months left');
});

test('the Home card says each loan change once, in the household currency', () => {
  const month = '2026-10';
  const at = '2026-10-05T10:00:00Z';
  const rows = [
    ...profileChanges(user([home, card]), user([{ ...home, outstanding: '3400000' }])),
    { id: 'p', at, kind: 'payment', what: 'Payment recorded', after: '35200', month },
  ].map((e, i) => ({ id: String(i), at, month, ...e }));
  const lines = whatChanged(rows, month, null, 'INR').lines;
  assert.ok(lines.includes('One payment recorded, ₹35,200 in all.'), lines.join('\n'));
  assert.ok(lines.includes('Edited HDFC home loan: balance ₹35,00,000 → ₹34,00,000.'), lines.join('\n'));
  assert.ok(lines.includes('Removed HDFC credit card (balance ₹80,000, 42.00% a year, payment ₹4,000).'), lines.join('\n'));
  assert.equal(whatChanged(rows, month, null, 'USD').lines[0], 'One payment recorded, $35,200 in all.');
});

test('payments are named in words, not as internal kinds', () => {
  const { activityChanges } = lib('change-log.ts');
  const e = { id: 'a1', loanIndex: 0, loanId: 'hl', kind: 'paid_partial', date: '2026-10-05', amount: '1000', scheduledEmi: '6000' };
  const [added] = activityChanges([], [e]);
  assert.equal(added.what, 'Part payment recorded');
  assert.equal(added.after, '1000'); // a number: the Home card adds these up
  const [edited] = activityChanges([e], [{ ...e, kind: 'paid_full', amount: '6000' }]);
  assert.equal(edited.before, 'part payment 1000');
  assert.equal(edited.after, 'payment 6000');
});
