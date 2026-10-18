// Owed-fix + debt-budget prompt + full minimums line (18 Oct 2026, work/reports/owed-fix.md).
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
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const comp = (n) => require(path.join(root, 'components', n));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const inr = (v) => `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;
const usd = (v) => `$${Math.round(Number(v)).toLocaleString('en-US')}`;

// Owed-fix (18 Oct 2026): one "owed now". Vijay's case: one card, statement
// ₹2,00,000 at 36% a year, minimum ₹10,000; ₹79,919 logged paid on 9 Oct
// from Home (EMI PAID: the minimum plus ₹69,919 of the plan's ₹88,646 extra).
const card = {
  id: 'card1', loan_type: 'credit_card', outstanding: '200000', nominal_rate: '0.36', scheduled_emi: '10000',
  tenure_months_remaining: 0, balance_as_of: '2026-10-01', balance_recorded_at: '2026-10-01T05:00:00.000Z',
};
const paid = {
  id: 'e1', loanIndex: 0, loanId: 'card1', kind: 'paid_extra', date: '2026-10-09', amount: '79919', scheduledEmi: '10000',
  plannedExtra: '69919', via: 'home', loggedAt: '2026-10-09T06:00:00.000Z',
};

test('owed-fix: card ₹2,00,000 less ₹79,919 logged this month is ₹1,20,081 everywhere', () => {
  const core = lib('owed-now-core.ts');
  const ac = lib('activity-cookie.ts');
  // The plan's opening balance stays the statement: the plan's October pays the whole month.
  const current = ac.applyActivityDeltas([card], ac.activityDeltas([paid], [card], 'IN', new Date('2026-10-18T08:00:00Z')), '2026-10').loans;
  assert.equal(Number(current[0].outstanding), 200000);
  const p = core.paidThisMonth(current, [paid], '2026-10');
  assert.deepEqual(p.emis, []);
  assert.deepEqual(p.off, [{ index: 0, amount: 79919, paid: 79919, date: '2026-10-09' }]);
  // Home's rows.
  const home = lib('owed-now.ts').owedNow(current, [paid], '2026-10');
  assert.equal(home[0].owed.toNumber(), 120081);
  assert.equal(home[0].cardBefore.toNumber(), 200000);
  // The tools / What If / Profile (owedNowLoans), the same figure.
  assert.equal(Number(core.owedNowLoans(current, p)[0].outstanding), 120081);
  // The cookie carries it to the server by loan id.
  const { compressToEncodedURIComponent } = require('lz-string');
  const raw = 'z3.' + compressToEncodedURIComponent(JSON.stringify({ v: 5, deltas: [], paidNow: { month: '2026-10', loans: [], off: [{ k: 'card1', a: '79919', p: '79919', d: '2026-10-09' }] } }));
  assert.deepEqual(ac.parsePaidOff(raw, current, '2026-10'), [{ index: 0, amount: 79919, paid: 79919, date: '2026-10-09' }]);
  assert.deepEqual(ac.parsePaidOff(raw, current, '2026-11'), [], 'last month’s payments are not this month’s');
  // A v4 cookie (before the fix) still applies its deltas.
  const v4 = 'z3.' + compressToEncodedURIComponent(JSON.stringify({ v: 4, deltas: [{ loanIndex: 0, overdue: '0', penalty: '0' }] }));
  assert.equal(ac.parseActivityDeltas(v4).length, 1);
  // Plan: the footer line and the start row say the same owed-now figure.
  const o = lib('owed-today.ts');
  const f = o.owedTodayOf({ owed_today: '120081', owed_start_of_month: '200000', owed_today_interest_in_paid: '0', owed_today_paid_off: '79919' });
  const line = o.owedTodayLine(f, 'October', inr);
  assert.match(line, /₹2,00,000 at the start of October; less ₹79,919 paid this month, you owe ₹1,20,081 now/);
  assert.equal(o.shortDay('2026-10-09'), '9 Oct');
  // October's row: the plan's ₹98,646 is ₹79,919 paid and ₹18,727 to go.
  assert.equal(98646 - p.off[0].paid, 18727);
});

test('owed-fix: an extra beyond the plan’s own is not taken off twice', () => {
  const core = lib('owed-now-core.ts');
  const ac = lib('activity-cookie.ts');
  // ₹1,50,000 paid where the plan's extra was ₹88,646: ₹51,354 is off the balance at once.
  const big = { ...paid, amount: '150000', plannedExtra: '88646' };
  const current = ac.applyActivityDeltas([card], ac.activityDeltas([big], [card], 'IN', new Date('2026-10-18T08:00:00Z')), '2026-10').loans;
  assert.equal(Number(current[0].outstanding), 148646);
  assert.equal(Number(core.owedNowLoans(current, core.paidThisMonth(current, [big], '2026-10'))[0].outstanding), 50000);
  assert.equal(lib('owed-now.ts').owedNow(current, [big], '2026-10')[0].owed.toNumber(), 50000);
});

test('owed-fix: every screen reads the one helper', () => {
  assert.match(src('components/WhatIfPanel.tsx'), /owedNowLoans\(user\.loans, \{/);
  assert.match(src('components/plan/load-plan.ts'), /loadPaidOffServer\(adjustedUser\.loans/);
  assert.match(src('components/plan/load-plan.ts'), /paid_off_this_month:/);
  assert.match(src('components/plan/PlanTrajectory.tsx'), /owedNowAtStart\(plan\)/);
  assert.match(src('components/plan/PlanSchedule.tsx'), /owedNowAtStart\(plan\)/);
  assert.match(src('lib/use-profile.tsx'), /owedNowLoans\(current\.user\.loans/);
  assert.match(src('app/tools/loan-check/tool.tsx'), /useOwedTodayProfile as useStoredProfile/);
  assert.match(src('app/tools/liquidate/tool.tsx'), /useOwedTodayProfile\(\)/);
  assert.match(src('app/tools/windfall/tool.tsx'), /useOwedTodayProfile\(\)/);
  assert.match(src('components/distress/CantPay.tsx'), /Still to pay this month/);
  assert.match(src('app/profile/ProfileClient.tsx'), /<OwedNowHint /);
});

test('full minimums line: a 3-month card plan beside minimums clearing in month 72 keeps its label', () => {
  const { layoutTrajectoryLabels } = comp('ledger/LTrajectory.tsx');
  const N = 72;
  const pts = Array.from({ length: N + 1 }, (_, m) => ({ t: m / N, av: m <= 3 ? 1 - m / 3 : 0, min: Math.max(0, 1 - m / N) }));
  const ms = [{ t: 3 / N, v: 0, label: "DEBT-FREE · JAN '27" }];
  const note = "MINIMUMS ONLY: CLEAR OCT '32";
  for (const w of [340, 390, 768, 1232]) {
    const narrow = w < 480;
    const h = narrow ? 220 : 260, left = narrow ? 58 : 76, right = 14, top = 34, bottom = 26;
    const toX = (t) => left + t * (w - left - right);
    const toY = (v) => h - bottom - v * (h - top - bottom);
    const { labels, note: n } = layoutTrajectoryLabels({ points: pts, milestones: ms, minimumsNote: note, w, left, right, top, toX, toY });
    assert.equal(labels.length, 1, `w=${w}: the plan's milestone label is kept`);
    assert.ok(labels[0].x0 >= 0 && labels[0].x1 <= w, `w=${w}: label inside the chart`);
    assert.ok(n && n.y > 0, `w=${w}: the minimums note is placed`);
  }
});
