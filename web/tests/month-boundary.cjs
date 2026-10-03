// This month's EMI, paid or not when the balance was entered (AUDIT §10 M1).
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
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
  module._compile(output, file);
};
const lib = (name) => require(path.join(root, 'lib', name));
const { rollBalancesForward, stampBalanceDates, asksEmiPaid, afterOneEmi } = lib('roll-forward.ts');
const { owedNow } = lib('owed-now.ts');

// ₹2,40,000 at 12% with a ₹21,000 EMI: one EMI takes it to 2,21,400.
const loan = (extra = {}) => ({ id: 'a', loan_type: 'personal_loan', bank: 'X', outstanding: '240000', nominal_rate: '0.12', rate_type: 'fixed', scheduled_emi: '21000', tenure_months_remaining: 12, ...extra });
const roll = (l, month) => rollBalancesForward([l], month).loans[0];

test('a balance entered after this month\'s EMI starts the plan one EMI back, so its first month lands on the balance typed', () => {
  const l = loan({ balance_as_of: '2026-10-10', balance_after_emi: true });
  const start = roll(l, '2026-10');
  assert.equal(start.tenure_months_remaining, 13);
  // The plan's first month pays October's EMI from the start balance and ends on the balance as typed.
  assert.equal(afterOneEmi(start).toFixed(0), '240000');
  // November: October's EMI is already off, so nothing more is taken.
  assert.equal(roll(l, '2026-11').outstanding, '240000');
  // December: November's EMI comes off.
  assert.equal(roll(l, '2026-12').outstanding, '221400.00');
});

test('a balance entered before this month\'s EMI keeps it to pay, and takes it off once the month is over', () => {
  const l = loan({ balance_as_of: '2026-10-10', balance_after_emi: false });
  assert.equal(roll(l, '2026-10').outstanding, '240000');
  // It used to stay at 2,40,000 in November: October's EMI was never taken off.
  assert.equal(roll(l, '2026-11').outstanding, '221400.00');
  assert.equal(roll(l, '2026-11').tenure_months_remaining, 11);
});

test('balances saved before the question keep the old reading', () => {
  const l = loan({ balance_as_of: '2026-08-20' });
  assert.equal(roll(l, '2026-08').outstanding, '240000');
  assert.equal(roll(l, '2026-09').outstanding, '240000');
  assert.equal(roll(l, '2026-10').outstanding, '221400.00');
});

test('the answer travels with the balance it was asked about', () => {
  const saved = [loan({ balance_as_of: '2026-09-01', balance_after_emi: false })];
  // Balance unchanged: the saved date and answer stay, whatever the form holds.
  const same = stampBalanceDates([loan({ balance_after_emi: true })], saved, '2026-10-03')[0];
  assert.equal(same.balance_as_of, '2026-09-01');
  assert.equal(same.balance_after_emi, false);
  // Balance changed: today's date and the new answer.
  const changed = stampBalanceDates([loan({ outstanding: '230000', balance_after_emi: true })], saved, '2026-10-03')[0];
  assert.equal(changed.balance_as_of, '2026-10-03');
  assert.equal(changed.balance_after_emi, true);
  // Asked only for a new or changed balance on an EMI loan.
  assert.equal(asksEmiPaid(loan(), undefined), true);
  assert.equal(asksEmiPaid(loan(), saved[0]), false);
  assert.equal(asksEmiPaid(loan({ outstanding: '1' }), saved[0]), true);
  assert.equal(asksEmiPaid(loan({ loan_type: 'credit_card' }), undefined), false);
});

test('Home shows a loan after its EMI once it is marked paid, and which EMIs are still to go', () => {
  const loans = [loan(), loan({ id: 'b', outstanding: '100000', scheduled_emi: '9000' }), loan({ id: 'c', loan_type: 'credit_card', scheduled_emi: '0' })];
  const entry = (loanIndex, kind, amount, extra = {}) => ({ id: String(loanIndex) + kind, loanIndex, loanId: loans[loanIndex].id, kind, date: '2026-10-05', amount, scheduledEmi: loans[loanIndex].scheduled_emi, loggedAt: '2026-10-05T00:00:00Z', ...extra });
  const rows = owedNow(loans, [entry(0, 'paid_full', '21000'), entry(1, 'paid_partial', '4000')], '2026-10');
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].owed.toFixed(0), '221400');
  assert.equal(rows[1].status, 'part');
  assert.equal(rows[1].owed.toFixed(0), '100000');
  assert.equal(rows[2].status, null);
  // Last month's payment doesn't count for this month.
  assert.equal(owedNow(loans, [entry(0, 'paid_full', '21000', { date: '2026-09-05' })], '2026-10')[0].status, 'due');
  // The plan's own extra comes off too: it's in what's owed now.
  const extra = owedNow(loans, [entry(0, 'paid_extra', '31000', { plannedExtra: '10000' })], '2026-10')[0];
  assert.equal(extra.owed.toFixed(0), '211400');
});

test('a loan taken this month pays nothing until its first EMI next month, then rolls from there', () => {
  const { emiAnswer, emiAnswerPatch } = lib('roll-forward.ts');
  const l = loan({ balance_as_of: '2026-10-03', ...emiAnswerPatch('first', '2026-10') });
  assert.equal(l.first_emi_month, '2026-11');
  assert.equal(emiAnswer(l, '2026-10'), 'first');
  // October and November: the balance as borrowed (November's EMI is the plan's first month then).
  assert.equal(roll(l, '2026-10').outstanding, '240000');
  assert.equal(roll(l, '2026-11').outstanding, '240000');
  // December: November's EMI is off.
  assert.equal(roll(l, '2026-12').outstanding, '221400.00');
  // Home says the first EMI is next month, not that October's is due.
  assert.equal(owedNow([l], [], '2026-10')[0].status, 'first');
  // Answering "not yet" instead clears the first EMI month.
  assert.equal(emiAnswer({ ...l, ...emiAnswerPatch('due', '2026-10') }, '2026-10'), 'due');
});
