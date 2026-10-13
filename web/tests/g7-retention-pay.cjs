// G7 (retention + pay): months-shaved counter, share card with no amounts,
// UPI "did it go through?", monthly prompts, calendar file, payday snapshot,
// plan summary for an assistant.
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
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── months shaved ───────────────────────────────────────────────────────────

test('months shaved compares calendar debt-free months, so time passing alone shaves nothing', () => {
  const { recordMark, shaved, shavedLine, debtFreeYm, monthsBetween } = lib('months-shaved.ts');
  assert.equal(debtFreeYm(1, new Date(2026, 9, 12)), '2026-10');
  assert.equal(debtFreeYm(84, new Date(2026, 9, 12)), '2033-09');
  assert.equal(monthsBetween('2026-10', '2029-08'), 34);
  let marks = recordMark([], '2029-08', '2026-10-01');
  // Same date a month later: no change recorded, nothing "shaved".
  marks = recordMark(marks, '2029-08', '2026-11-01');
  assert.equal(marks.length, 1);
  assert.equal(shaved(marks, '2026-11'), null);
  // An extra payment pulls the date 3 months in.
  marks = recordMark(marks, '2029-05', '2026-11-02');
  const s = shaved(marks, '2026-11');
  assert.equal(s.vsPrevious, 3);
  assert.equal(s.leftBefore, 33);
  assert.equal(s.leftNow, 30);
  assert.match(shavedLine(s), /^33 → 30 months to debt-free: 3 months shaved off/);
  // A later date is said plainly, not dressed up.
  marks = recordMark(marks, '2029-07', '2026-12-02');
  assert.match(shavedLine(shaved(marks, '2026-12')), /2 months later than before/);
});

test('months-shaved history is capped and keeps the first date as the baseline', () => {
  const { recordMark } = lib('months-shaved.ts');
  let marks = [];
  for (let i = 0; i < 40; i++) marks = recordMark(marks, `20${30 + (i % 2)}-0${1 + (i % 9)}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`);
  assert.ok(marks.length <= 24);
  assert.equal(marks[0].ym, '2030-01');
  assert.deepEqual(recordMark(marks, 'bad', '2026-10-01'), marks);
});

// ── share card ──────────────────────────────────────────────────────────────

test('share card shows the date, months shaved and loans cleared, and never an amount', () => {
  const { shareCardSvg, shareText, assertNoAmounts } = lib('share-card.ts');
  const input = { debtFreeLabel: 'May 2033', monthsShaved: 7, loansCleared: 1, loansTotal: 3 };
  const svg = shareCardSvg(input);
  assert.match(svg, /^<svg[^>]+width="1080"/);
  assert.match(svg, /Debt-free by May 2033/);
  assert.match(svg, /7 months sooner/);
  assert.match(svg, /1 of 3 loans cleared/);
  assert.match(svg, /No amounts shown/);
  assert.doesNotMatch(svg, /[₹$]/);
  assert.equal(shareText(input), 'Debt-free by May 2033. 7 months sooner than when I started. 1 of 3 loans cleared. Planned with RightDue.');
  for (const bad of ['₹4,50,000 left', '$12,000 paid', 'EMI 18500', 'Rs. 500', '3.5 lakh', '42.5% card'])
    assert.throws(() => assertNoAmounts(bad), /currency|amount/, bad);
  for (const ok of ['Debt-free by Aug 2033', '3 of 4 loans cleared', '12 months sooner']) assertNoAmounts(ok);
});

test('share card escapes text so a label cannot inject markup', () => {
  const { shareCardSvg } = lib('share-card.ts');
  const svg = shareCardSvg({ debtFreeLabel: '<script>', monthsShaved: 0, loansCleared: 0, loansTotal: 0 });
  assert.doesNotMatch(svg, /<script>/);
});

// ── UPI: did it go through? ─────────────────────────────────────────────────

test('UPI checks: one per row and month, a 12-digit reference, raised again after a while', () => {
  const { upsertPending, removePending, utrError, dueChecks, UPI_FAILED_NOTE } = lib('upi-confirm.ts');
  const p = { key: 'l1', name: 'SBI home loan', amount: 25000, vpa: 'x@sbi', openedAt: '2026-10-12T10:00:00Z', month: '2026-10' };
  let list = upsertPending([], p);
  list = upsertPending(list, { ...p, utr: '123456789012' });
  assert.equal(list.length, 1);
  assert.equal(list[0].utr, '123456789012');
  assert.equal(removePending(list, 'l1', '2026-10').length, 0);
  assert.equal(utrError(''), null);
  assert.equal(utrError('1234 5678 9012'), null);
  assert.match(utrError('12345'), /12 digits/);
  assert.equal(dueChecks(list, new Date('2026-10-12T11:00:00Z')).length, 0);
  assert.equal(dueChecks(list, new Date('2026-10-12T13:00:00Z')).length, 1);
  // RBI TAT rule for a failed payment to a business: T+5, ₹100 a day.
  assert.match(UPI_FAILED_NOTE, /within 5 days/);
  assert.match(UPI_FAILED_NOTE, /₹100 a day/);
});

test('PAY VIA UPI asks before recording; only YES marks it paid', () => {
  const { UpiPay } = require(path.join(root, 'components/home/UpiPay.tsx'));
  const loan = { loan_type: 'home_loan', outstanding: '2500000', nominal_rate: '0.085', bank: 'SBI', upi_vpa: 'sbihl.998877@sbi' };
  const html = renderToStaticMarkup(React.createElement(UpiPay, { name: 'SBI home loan', amount: 25000, currency: 'INR', monthLabel: 'Oct 2026', onSaveVpa: () => true, loan }));
  assert.match(html, /PAY VIA UPI/);
  assert.doesNotMatch(html, /went through/);    // nothing asked before the app opens
  const comp = src('components/home/UpiPay.tsx');
  // onConfirmed is called from the YES button only.
  assert.equal((comp.match(/onConfirmed\?\.\(\)/g) || []).length, 1);
  assert.match(comp, /YES, IT WENT THROUGH[\s\S]*?<\/button>/);
  const pay = src('components/home/PayThisMonth.tsx');
  assert.match(pay, /onConfirmed=\{\(\) => attempt\(\(\) => markPaid\(row\)\)\}/);
});

// ── monthly prompts ─────────────────────────────────────────────────────────

test('monthly prompts: last month unlogged, regime check before 31 March (India), at most three, snoozable', () => {
  const { monthlyPrompts, snooze } = lib('monthly-prompts.ts');
  const base = { country: 'IN', loansWithPayments: 2, activityDates: [], pendingUpi: [], snoozed: [] };
  const feb = monthlyPrompts({ ...base, today: new Date(2027, 1, 5) });
  assert.deepEqual(feb.map((p) => p.key), ['log_last_month', 'regime_check', 'ask_assistant']);
  // Logged last month: no nag. US: no Indian regime check.
  const logged = monthlyPrompts({ ...base, today: new Date(2027, 1, 5), activityDates: ['2027-01-03'], country: 'US' });
  assert.deepEqual(logged.map((p) => p.key), ['ask_assistant']);
  // Late in the month the logging prompt waits for next month.
  assert.ok(!monthlyPrompts({ ...base, today: new Date(2026, 9, 20) }).some((p) => p.key === 'log_last_month'));
  // Snoozed this month only.
  const sn = snooze([], 'ask_assistant', new Date(2026, 9, 20));
  assert.ok(!monthlyPrompts({ ...base, today: new Date(2026, 9, 21), snoozed: sn }).some((p) => p.key === 'ask_assistant'));
  assert.ok(monthlyPrompts({ ...base, today: new Date(2026, 10, 21), snoozed: sn }).some((p) => p.key === 'ask_assistant'));
  // A UPI check left open comes first.
  const pend = [{ key: 'l1', name: 'SBI home loan', amount: 1, vpa: 'x@y', openedAt: '2026-10-01T00:00:00Z', month: '2026-10' }];
  assert.equal(monthlyPrompts({ ...base, today: new Date(2026, 9, 20), pendingUpi: pend })[0].key, 'upi_check');
});

// ── calendar file ───────────────────────────────────────────────────────────

test('calendar file: all-day events, escaped text, folded lines, alert the evening before, CRLF', () => {
  const { buildIcs, foldLine, upcomingOnly } = lib('ics.ts');
  const ics = buildIcs(
    [{ uid: 'complaint-reply-2026-11-10', day: '2026-11-10', title: "Complaint to HDFC Bank: Bank's reply due", description: 'Day 30; then, escalate, to the Ombudsman' }],
    new Date('2026-10-12T05:00:00Z'),
  );
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261110\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261111\r\n/);
  assert.match(ics, /DESCRIPTION:Day 30\\; then\\, escalate\\, to the Ombudsman/);
  assert.match(ics, /TRIGGER:-PT15H/);
  assert.match(ics, /DTSTAMP:20261012T050000Z/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(foldLine('x'.repeat(80)).split('\r\n ').join(''), 'x'.repeat(80));
  assert.throws(() => buildIcs([{ uid: 'a', day: '10/11/2026', title: 't' }]), /bad date/);
  const items = [{ day: '2026-10-01', state: 'done' }, { day: '2026-11-10', state: 'upcoming' }, { day: '2026-10-11', state: 'upcoming' }];
  assert.deepEqual(upcomingOnly(items, '2026-10-12').map((i) => i.day), ['2026-11-10']);
});

// ── payday snapshot / plan summary ──────────────────────────────────────────

const PAY = {
  rows: [
    { key: 'a', loanIndex: 0, name: 'HDFC credit card', kind: 'extra', card: true, amount: 18500.4, currency: 'INR', amountUser: 18500, minimum: 4000, extra: 14500, dueDay: 5 },
    { key: 'b', loanIndex: 1, name: 'SBI home loan', kind: 'emi', card: false, amount: 32000, currency: 'INR', amountUser: 32000, minimum: 32000, extra: 0 },
    { key: 'ef', loanIndex: null, name: 'Emergency fund', kind: 'ef', card: false, amount: 4000, currency: 'INR', amountUser: 4000, minimum: 0, extra: 4000 },
  ],
  total: 54500, leftOver: 0, extraUser: 18500, budget: 0,
};

test('payday snapshot carries names, amounts and kinds only', () => {
  const { paydaySnapshot, rowsFingerprint, snapshotNeedsSend } = lib('payday-snapshot.ts');
  const s = paydaySnapshot(PAY, 'IN', '2026-10-30');
  assert.deepEqual(Object.keys(s).sort(), ['country', 'currency', 'made_on', 'month', 'rows']);
  assert.deepEqual(s.rows[0], { name: 'HDFC credit card', amount: '18500', currency: 'INR', kind: 'extra', due_day: 5 });
  for (const r of s.rows) assert.deepEqual(Object.keys(r).filter((k) => !['name', 'amount', 'currency', 'kind', 'due_day'].includes(k)), []);
  const fp = rowsFingerprint(s);
  assert.equal(snapshotNeedsSend(`2026-10-30|${fp}`, '2026-10-30', fp), false);
  assert.equal(snapshotNeedsSend(`2026-10-29|${fp}`, '2026-10-30', fp), true);
});

test('plan summary for an assistant has the numbers and no lender names', () => {
  const { planContext } = lib('plan-context.ts');
  const t = planContext({
    country: 'IN', monthLabel: 'October 2026', debtFreeLabel: 'May 2033', pay: PAY, strategy: 'avalanche',
    loans: [{ type: 'credit card', outstanding: 90000, ratePct: 42, emi: null, currency: 'INR' }, { type: 'home loan', outstanding: 3500000, ratePct: 8.5, emi: 32000, currency: 'INR' }],
    fmt: (v) => `₹${v}`,
  });
  assert.match(t, /Debt-free: May 2033/);
  assert.match(t, /1\. credit card: ₹90000 owed, 42% a year/);
  assert.match(t, /loan 1 \(credit card\): ₹18500\.4 \(extra\)/);
  assert.doesNotMatch(t, /HDFC|SBI/);
});

// ── wiring ──────────────────────────────────────────────────────────────────

test('Home renders the progress, payday email and email answers; complaints get reminders', () => {
  assert.match(src('components/home/HomeDebtFree.tsx'), /<HomeProgress/);
  const pay = src('components/home/PayThisMonth.tsx');
  assert.match(pay, /<EmailAnswers month=\{month\} onMarkAllPaid=\{markAllPaid\}/);
  assert.match(pay, /<PaydayEmail /);
  assert.match(pay, /if \(row\.kind === 'clears'\) setCleared\(row\)/);
  assert.match(src('app/tools/loan-check/complaint.tsx'), /<DeadlineReminders/);
  // The payday email UI shows only when the server says it's on.
  assert.match(src('components/home/PaydayEmail.tsx'), /if \(!f\.payday_email/);
  // The loan-cleared letter is labelled a draft and not legal advice.
  assert.match(src('components/home/LoanCleared.tsx'), /DRAFT\. Read it[\s\S]*not legal advice/);
});
