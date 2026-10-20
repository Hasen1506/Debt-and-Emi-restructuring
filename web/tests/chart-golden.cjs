// The trajectory chart and the schedule share one balance series. A leftover
// the plan stops paying (a 0% loan from a person) must not stretch the axis
// to year 30, and loans that do clear still get a marker.
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
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/plan', useSearchParams: () => new URLSearchParams() };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (m, f) =>
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      f,
    );
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { PlanTrajectory } = require(path.join(root, 'components/plan/PlanTrajectory.tsx'));
const { chartBalances } = require(path.join(root, 'lib/schedule-chart.ts'));
const { formatCurrencyWhole } = require(path.join(root, 'lib/api.ts'));
const today = require(path.join(root, 'lib/today.ts'));

test('chart golden: a leftover stops the axis, markers stay, balances match the schedule', () => {
  const loans = [
    { id: 'card', bank: 'HDFC Bank', loan_type: 'credit_card', outstanding: '90000', nominal_rate: '0.36', scheduled_emi: '5000', tenure_months_remaining: 0 },
    { id: 'home', bank: 'HDFC Bank', loan_type: 'home_loan', outstanding: '1800000', nominal_rate: '0.085', scheduled_emi: '22800', tenure_months_remaining: 120, rate_type: 'floating' },
    { id: 'asha', bank: 'Asha', loan_type: 'people_loan', outstanding: '60000', nominal_rate: '0', scheduled_emi: '0', tenure_months_remaining: 0, people_repay: 'whenever' },
  ];
  const trajectory = [];
  for (let m = 1; m <= 360; m++) {
    const card = m < 2 ? 40000 : 0;
    const home = m < 19 ? Math.max(0, 1800000 - (m - 1) * 100000) : 0;
    const asha = 60000;
    const avalanche = card + home + asha;
    const minimums = m < 120 ? 900000 - m * 4000 : 60000;
    trajectory.push({
      month: m,
      avalanche,
      minimums,
      balancesByLoanIndex: { 0: card, 1: home, 2: asha },
    });
  }
  const plan = {
    live: true,
    user: { country: 'IN', loans, monthly_income: '180000', fixed_expenses: '35000', efund_balance: '0' },
    displayCurrency: 'INR',
    marginalRate: '0.3',
    strategy: 'avalanche',
    trajectory,
    monthlyPayments: [],
    debtFreeMonth: null,
    infeasibleFrom: null,
    baselineNeverClears: true,
    gap: null,
    gaps: [],
    strategyCompare: null,
  };
  const html = renderToStaticMarkup(React.createElement(PlanTrajectory, { plan, short: false }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /₹60,000 STAYS/);
  assert.match(text, /CARD/);
  assert.match(text, /HOME LOAN/);
  assert.doesNotMatch(text, /DEBT-FREE/);
  // Year-30 tick is the bug: the leftover is not a 30-year line.
  const settle = today.formatMonthDate(today.monthIndexToDate(19, today.getCountryToday('IN')), 'short');
  const horizon = today.formatMonthDate(today.monthIndexToDate(360, today.getCountryToday('IN')), 'short');
  assert.match(text, new RegExp(settle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, new RegExp(horizon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const tips = [...html.matchAll(/data-month="(\d+)" data-balance="(-?\d+)"/g)].map((m) => ({ month: Number(m[1]), balance: Number(m[2]) }));
  assert.ok(tips.length > 5 && tips.length < 40, `plotted ${tips.length} months`);
  assert.equal(tips[tips.length - 1].month, 19);
  assert.equal(tips[tips.length - 1].balance, 60000);
  assert.ok(tips.every((t) => t.month <= 19));
  const byMonth = new Map(chartBalances(plan).map((p) => [p.month, Math.round(p.balance)]));
  for (const t of tips) assert.equal(t.balance, byMonth.get(t.month), `month ${t.month} matches the schedule balance`);
  assert.equal(new Set(tips.map((t) => t.month)).size, tips.length);

  // A negative rounding does not pull the line under the axis.
  plan.trajectory = [{ month: 1, avalanche: -4, minimums: 10, balancesByLoanIndex: { 0: 0, 1: 0, 2: 0 } }];
  plan.debtFreeMonth = 1;
  const dipped = renderToStaticMarkup(React.createElement(PlanTrajectory, { plan, short: false }));
  assert.match(dipped, /data-balance="-4"/);
  const ys = [...dipped.matchAll(/L?\d+\.?\d*,(\d+\.?\d*)/g)].map((m) => Number(m[1]));
  const axis = Math.max(...ys);
  assert.ok(ys.every((y) => y <= axis + 0.2), 'the line stays on or above ₹0');
});

test('chart golden: 20 Oct 2026 card — no doubled balance, partial month is a short slot', () => {
  // Vijay's tablet screenshot. Statement ₹2,00,000, ₹1,01,519 already paid,
  // so ₹98,481 is owed now. The unreduced run drew minimums at ₹1,96,962
  // and a plan that rose, then cleared in December. The series here is the
  // run that starts from today's balance (engine/tests/test_trajectory_opening.py).
  const oct20 = new Date(2026, 9, 20, 12, 0, 0, 0);
  const endOct = today.trajectoryPointDate(1, oct20);
  const endNov = today.trajectoryPointDate(2, oct20);
  assert.equal(today.localIsoDate(today.trajectoryPointDate(0, oct20)), '2026-10-20');
  assert.equal(today.localIsoDate(endOct), '2026-10-31');
  assert.equal(today.localIsoDate(endNov), '2026-11-30');
  const days = (a, b) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
  const nowToOct = days(oct20, endOct);
  const octToNov = days(endOct, endNov);
  assert.equal(nowToOct, 11);
  assert.ok(nowToOct < octToNov / 2, 'NOW and the end of October are the same month');
  const t1 = today.trajectoryTimeFraction(1, 0, 2, oct20);
  assert.ok(Math.abs(t1 - 11 / 41) < 1e-9, `month 1 sits at ${t1}, not halfway`);

  const trajectory = [
    { month: 1, avalanche: 2159.15, minimums: 91849.23, balancesByLoanIndex: { 0: 2159.15 } },
    { month: 2, avalanche: 0, minimums: 84982.69, balancesByLoanIndex: { 0: 0 } },
  ];
  const plan = {
    live: true,
    user: {
      country: 'IN',
      loans: [{
        id: 'card', bank: 'HDFC Bank', loan_type: 'credit_card', outstanding: '200000',
        nominal_rate: '0.36', scheduled_emi: '10000', tenure_months_remaining: 0,
      }],
      monthly_income: '150000', fixed_expenses: '0', efund_balance: '0',
    },
    displayCurrency: 'INR',
    marginalRate: '0.3',
    strategy: 'snowball',
    trajectory,
    monthlyPayments: [{ month: 1, perLoan: { 0: '98646' }, totalPaid: 98646, extraPaid: 88646 }],
    debtFreeMonth: 2,
    infeasibleFrom: null,
    baselineNeverClears: false,
    gap: null,
    gaps: [],
    owedToday: { today: 98481, startOfMonth: 200000, interestInPaid: 0, paidOff: 101519 },
    strategyCompare: {
      avalanche: { debtFreeMonth: 2, totalInterest: '2375.11' },
      rules: { debtFreeMonth: 2, totalInterest: '2375.11' },
      snowball: { debtFreeMonth: 2, totalInterest: '2375.11' },
    },
  };
  const html = renderToStaticMarkup(React.createElement(PlanTrajectory, { plan, short: false }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const start = formatCurrencyWhole(98481, 'INR');
  const doubled = formatCurrencyWhole(196962, 'INR');
  assert.match(text, new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, new RegExp(doubled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const free = today.monthIndexToCountryLabel(2, 'IN');
  assert.match(text, new RegExp(`DEBT-FREE · ${free.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const tips = [...html.matchAll(/data-month="(\d+)" data-balance="(-?\d+)" data-t="([0-9.]+)"/g)].map((m) => ({
    month: Number(m[1]), balance: Number(m[2]), t: Number(m[3]),
  }));
  assert.deepEqual(tips.map((p) => p.month), [0, 1, 2]);
  assert.deepEqual(tips.map((p) => p.balance), [98481, 2159, 0]);
  assert.ok(tips.every((p, i) => i === 0 || p.balance <= tips[i - 1].balance));
  const wall = today.getCountryToday('IN');
  assert.equal(tips[0].t, 0);
  assert.equal(tips[2].t, 1);
  assert.ok(Math.abs(tips[1].t - today.trajectoryTimeFraction(1, 0, 2, wall)) < 0.0001);
});
