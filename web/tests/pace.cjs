// What reached the debts, month by month, against the plan (AUDIT §10 M4).
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
const { paceMonths, paceSummary, paceDiffers, monthsBefore } = lib('pace.ts');

const loan = (id, extra = {}) => ({ id, loan_type: 'personal_loan', bank: 'X', outstanding: '240000', nominal_rate: '0.12', rate_type: 'fixed', scheduled_emi: '21000', tenure_months_remaining: 12, balance_as_of: '2026-06-05', ...extra });
let n = 0;
const entry = (loanId, loanIndex, date, amount, extra = {}) => ({ id: `e${++n}`, loanId, loanIndex, kind: 'paid_full', date, amount: String(amount), scheduledEmi: '21000', loggedAt: `${date}T10:00:00Z`, ...extra });

test('the three months before this one, oldest first, across a year end', () => {
  assert.deepEqual(monthsBefore('2027-01', 3), ['2026-10', '2026-11', '2026-12']);
});

test('a month counts only when every running EMI loan is logged; one-offs are kept apart', () => {
  const loans = [loan('a'), loan('b', { scheduled_emi: '9000' })];
  const entries = [
    entry('a', 0, '2026-07-05', 21000), entry('b', 1, '2026-07-07', 9000),
    entry('a', 0, '2026-08-05', 21000), entry('b', 1, '2026-08-07', 4000, { kind: 'paid_partial', scheduledEmi: '9000' }),
    entry('a', 0, '2026-08-20', 100000, { kind: 'paid_extra', source: 'bonus' }),
    entry('a', 0, '2026-09-05', 21000),
  ];
  const months = paceMonths(entries, loans, '2026-10');
  assert.deepEqual(months.map((m) => [m.month, m.complete]), [['2026-07', true], ['2026-08', true], ['2026-09', false]]);
  const s = paceSummary(months, loans, 'IN', {});
  assert.deepEqual(s.months.map((m) => [m.paid, m.oneOff]), [[30000, 0], [25000, 100000], [21000, 0]]);
  // Over July and August only: September is missing loan b.
  assert.equal(s.counted, 2);
  assert.equal(s.average, 27500);
});

test('a loan added in September isn\'t expected in July or August, and a closed one isn\'t after it closed', () => {
  const loans = [loan('a'), loan('c', { balance_as_of: '2026-09-02' }), loan('d', { outstanding: '0' })];
  const entries = [
    entry('d', 2, '2026-07-05', 50000, { kind: 'closed' }),
    entry('a', 0, '2026-07-05', 21000), entry('a', 0, '2026-08-05', 21000),
    entry('a', 0, '2026-09-05', 21000), entry('c', 1, '2026-09-09', 8000),
  ];
  const s = paceSummary(paceMonths(entries, loans, '2026-10'), loans, 'IN', {});
  assert.deepEqual(s.months.map((m) => [m.paid, m.oneOff, m.complete]), [[21000, 50000, true], [21000, 0, true], [29000, 0, true]]);
  assert.equal(s.average, 23667);
});

test('one month logged gives no average yet; nothing logged gives nothing', () => {
  const loans = [loan('a')];
  const one = paceSummary(paceMonths([entry('a', 0, '2026-09-05', 21000)], loans, '2026-10'), loans, 'IN', {});
  assert.equal(one.average, null);
  assert.equal(one.counted, 1);
  assert.equal(paceSummary(paceMonths([], loans, '2026-10'), loans, 'IN', {}), null);
});

test('payments on a dollar loan count in rupees at the plan\'s rate, and an unknown rate gives no pace', () => {
  const loans = [loan('a'), loan('u', { currency: 'USD', scheduled_emi: '300' })];
  const entries = ['2026-08', '2026-09'].flatMap((m) => [entry('a', 0, `${m}-05`, 21000), entry('u', 1, `${m}-06`, 300)]);
  const months = paceMonths(entries, loans, '2026-10');
  assert.equal(paceSummary(months, loans, 'IN', { USD: '88' }).average, 47400);
  assert.equal(paceSummary(months, loans, 'IN', {}), null);
});

test('the pace is said only when it is more than 5% off the plan', () => {
  assert.equal(paceDiffers(57500, 60000), false);
  assert.equal(paceDiffers(45250, 60000), true);
  assert.equal(paceDiffers(64000, 60000), true);
  assert.equal(paceDiffers(100, 0), false);
});

test('a loan already paid off with nothing logged doesn\'t hold a month open', () => {
  const loans = [loan('a'), loan('z', { outstanding: '0' })];
  const entries = [entry('a', 0, '2026-08-05', 21000), entry('a', 0, '2026-09-05', 21000)];
  const s = paceSummary(paceMonths(entries, loans, '2026-10'), loans, 'IN', {});
  assert.equal(s.counted, 2);
});
