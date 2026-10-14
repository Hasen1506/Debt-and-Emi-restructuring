// Audit 80+ Section C, workstream W1 (web side): C19 CSV layout, C4 lock-in stamp.
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

test('C19: a SUM down a loan column adds payments only; opening balances sit in their own columns', () => {
  const csv = lib('schedule-csv.ts');
  const loans = [{ loan_type: 'home_loan', bank: 'HDFC Bank' }, { loan_type: 'credit_card', bank: 'SBI Card' }];
  const header = csv.scheduleCsvHeader(loans, 'IN', 'inr');
  assert.deepEqual(header.slice(2, 6), [
    'HDFC Bank home loan paid (₹)', 'SBI Card credit card paid (₹)',
    'HDFC Bank home loan owed at start (₹)', 'SBI Card credit card owed at start (₹)',
  ]);
  const start = { mo: 0, date: 'OCT 2026', perLoan: { 0: '3000000', 1: '50000' }, extra: 0, interest: 0, principal: 0, balance: 3050000, event: 'OWED AT THE START' };
  const months = [1, 2, 3].map((mo) => ({ mo, date: `M${mo}`, perLoan: { 0: '26035', 1: '5000' }, extra: 0, interest: 0, principal: 0, balance: 0, event: '' }));
  const rows = [csv.scheduleCsvCells(start, true, 2), ...months.map((r) => csv.scheduleCsvCells(r, false, 2))];
  rows.forEach((r) => assert.equal(r.length, header.length));
  const col = (name) => rows.map((r) => Number(r[header.indexOf(name)] || 0)).reduce((a, b) => a + b, 0);
  // Class guard: the paid column sums to the payments, never payments + balance.
  assert.equal(col('HDFC Bank home loan paid (₹)'), 3 * 26035);
  assert.equal(col('SBI Card credit card paid (₹)'), 3 * 5000);
  assert.equal(col('HDFC Bank home loan owed at start (₹)'), 3000000);
  assert.equal(rows[0][1], csv.CSV_START_LABEL);
});

test('C4: a typed lock-in is stamped with the month it ends, and keeps that month when re-saved', () => {
  const rf = lib('roll-forward.ts');
  assert.equal(rf.addMonths('2026-10', 6), '2027-04');
  assert.equal(rf.addMonths('2026-12', 1), '2027-01');
  const typed = rf.stampBalanceDates([{ loan_type: 'personal_loan', outstanding: '500000', prepay_lock_in_months: 12 }], [], '2026-10-14');
  assert.equal(typed[0].prepay_lock_in_until, '2027-10');
  // Saved again in Feb with the same 12: the end month doesn't move, so the
  // months left run down (it used to restart at 12 on every load).
  const again = rf.stampBalanceDates([{ ...typed[0], outstanding: '450000' }], typed, '2027-02-01');
  assert.equal(again[0].prepay_lock_in_until, '2027-10');
  assert.equal(rf.lockInMonthsLeft(again[0], '2027-02'), 8);
  // A profile saved before the stamp counts from the month its balance was entered.
  const legacy = rf.stampBalanceDates([{ loan_type: 'personal_loan', outstanding: '1', prepay_lock_in_months: 12, balance_as_of: '2026-08-15' }],
    [{ loan_type: 'personal_loan', outstanding: '1', prepay_lock_in_months: 12, balance_as_of: '2026-08-15' }], '2026-10-14');
  assert.equal(legacy[0].prepay_lock_in_until, '2027-08');
  // Changing the months restarts the count; clearing them drops the stamp.
  const changed = rf.stampBalanceDates([{ ...again[0], prepay_lock_in_months: 6 }], again, '2027-02-01');
  assert.equal(changed[0].prepay_lock_in_until, '2027-08');
  const cleared = rf.stampBalanceDates([{ ...again[0], prepay_lock_in_months: 0 }], again, '2027-02-01');
  assert.equal(cleared[0].prepay_lock_in_until, undefined);
});

test('C4 class guard: months left never rise as the calendar moves', () => {
  const rf = lib('roll-forward.ts');
  for (let start = 0; start < 30; start += 7)
    for (const months of [0, 1, 6, 12, 24]) {
      const begin = rf.addMonths('2026-01', start);
      const loan = { prepay_lock_in_months: months, prepay_lock_in_until: rf.addMonths(begin, months) };
      let prev = Infinity;
      for (let k = 0; k <= months + 2; k += 1) {
        const left = rf.lockInMonthsLeft(loan, rf.addMonths(begin, k));
        assert.ok(left <= prev);
        prev = left;
      }
      assert.equal(prev, 0);
    }
});

test('C4: the payoff order reads lock-in months still to run, not the months as typed', () => {
  const mc = lib('marginal-cost.ts');
  const base = { loan_type: 'personal_loan', bank: 'HDFC Bank', outstanding: '300000', nominal_rate: '0.14', rate_type: 'fixed', tenure_months_remaining: 36, scheduled_emi: '10250' };
  // Typed 6 months of lock-in, stamped to end two years ago: it has run out.
  const ended = mc.loanMarginalCost({ ...base, prepay_lock_in_months: 6, prepay_lock_in_until: '2024-01' }, 'IN', '0');
  assert.equal(ended.locked, false);
  assert.equal(ended.lockInMonths, 0);
  // Stamped far ahead: still locked, ranked after open loans.
  const live = mc.loanMarginalCost({ ...base, prepay_lock_in_months: 6, prepay_lock_in_until: '2999-01' }, 'IN', '0');
  assert.equal(live.locked, true);
  assert.ok(live.lockInMonths > 6);
  // No stamp (an old profile): the typed months stand.
  const unstamped = mc.loanMarginalCost({ ...base, prepay_lock_in_months: 6 }, 'IN', '0');
  assert.equal(unstamped.lockInMonths, 6);
});
