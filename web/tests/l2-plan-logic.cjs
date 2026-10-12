// Sprint L2 (plan logic): grill #38 and live-test #15, #16, #17, #24, #26.
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
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    }).outputText;
    module._compile(output, file);
  };
const gap = require(path.join(root, 'lib/plan-gap.ts'));
const { mergeTrajectories } = require(path.join(root, 'lib/trajectory.ts'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// The live-test stress persona: 8 short months, then the personal loan's
// freed EMI repays the borrowing (numbers from engine/tests/test_gap_borrowing.py).
const point = (month, extra = {}) => ({ month, balance: '100', interest_paid: '1', invested: '0', shortfall: '0', ...extra });
const sim = {
  debt_free_month: 55,
  total_interest_paid: '641723',
  trajectory: [
    point(1, { shortfall: '9515', gap_borrowed: '9515', gap_debt: '9515' }),
    point(2, { shortfall: '9515', gap_borrowed: '9515', gap_debt: '19451', gap_interest: '421' }),
    point(9, { gap_repaid: '43146', gap_debt: '49801', gap_interest: '3939' }),
    point(10, { gap_repaid: '43146', gap_debt: '8858', gap_interest: '2203' }),
    point(11, { gap_repaid: '9250', gap_debt: '0', gap_interest: '392' }),
    point(12),
  ],
  gap_rate: '0.45',
  gap_rate_basis: 'default',
  gap_rate_source: 'SBI Card MITC',
  total_gap_interest: '19427',
  gap_closed: { cut: '9515', debt_free_month: 50, total_interest_paid: '580000' },
};

test('#38: the gap-borrowing story is read from the engine, not re-derived', () => {
  const g = gap.planGap(sim);
  assert.equal(g.rate, 0.45);
  assert.equal(g.basis, 'default');
  assert.equal(g.firstBorrowMonth, 1);
  assert.equal(g.peak, 49801);
  assert.equal(g.peakMonth, 9);
  assert.equal(g.repaidMonth, 11);
  assert.equal(g.totalInterest, 19427);
  assert.deepEqual(g.closed, { cut: 9515, debtFreeMonth: 50, totalInterest: 580000 });
  assert.equal(gap.gapRateWords(0.45), '45%');
  assert.equal(gap.gapRateWords(0.2236), '22.36%');
  // A plan that is never short has no gap story at all.
  assert.equal(gap.planGap({ trajectory: [point(1), point(2)] }), null);
});

test('#16: a short plan names both dates, so headline and table tell one story', () => {
  const label = (m) => `M${m}`;
  const money = (v) => `₹${v}`;
  const h = gap.shortHeadline({ shortfall: 11138, asIsMonth: 104, closedMonth: 92, label, money });
  assert.equal(h.value, 'M92');
  assert.match(h.sub, /IF THE ₹11138\/MO GAP CLOSES/);
  assert.match(h.sub, /AS THINGS STAND: M104/);
  const never = gap.shortHeadline({ shortfall: 11138, asIsMonth: null, closedMonth: null, label, money });
  assert.equal(never.value, 'NO DATE YET');
  assert.match(never.sub, /AS THINGS STAND: NOT IN 30 YEARS/);
});

test('#17: the chart axis ends at the plan’s payoff, not the end of the minimums line', () => {
  // Live test: plan clears Aug 2033 (~month 82) while the axis ran to Oct 2044.
  const end = gap.chartEndMonth({ planClears: 82, minClear: 216, lastMonth: 216 });
  assert.ok(end < 216 && end >= 82, String(end));
  assert.equal(gap.chartEndMonth({ planClears: 82, minClear: 120, lastMonth: 216 }), 120);
  // A gap that only grows: three years of it, not 30.
  assert.equal(gap.chartEndMonth({ planClears: null, minClear: null, lastMonth: 360, growingGapFrom: 1 }), 37);
  assert.equal(gap.chartEndMonth({ planClears: null, minClear: null, lastMonth: 360 }), 360);
});

test('#24: due beside what the month can cover (₹70,000 take-home stress case)', () => {
  const v = gap.dueVsAffordable({ income: 70000, costs: 55000, shortfall: 61138 });
  assert.deepEqual(v, { due: 76138, canCover: 15000, short: 61138 });
  const line = gap.dueVsAffordableLine(v, (x) => `₹${x}`);
  assert.match(line, /Due this month: ₹76138/);
  assert.match(line, /you have ₹15000 for them/);
  assert.match(line, /₹61138 short/);
  // Costs above income: nothing covers the dues.
  assert.deepEqual(gap.dueVsAffordable({ income: 40000, costs: 50000, shortfall: 30000 }), { due: 20000, canCover: 0, short: 20000 });
});

test('#15: the schedule says when a short month is borrowed and when it is paid back', () => {
  const ev = gap.gapEvents(gap.planGap(sim), (v) => `₹${v}`, '45%');
  assert.match(ev.get(1), /BORROWED ON A CARD AT 45%/);
  assert.equal(ev.get(11), '✓ GAP BORROWING REPAID');
});

test('#38: chart points carry gap borrowing beside the loan balances', () => {
  const pts = mergeTrajectories(sim, { ...sim, trajectory: sim.trajectory.map((p) => ({ ...p, gap_debt: '0' })) });
  assert.equal(pts.find((p) => p.month === 2).gapDebt, 19451);
  assert.equal(pts.find((p) => p.month === 2).minimumsGapDebt, 0);
  // Loans-only total is untouched.
  assert.equal(pts.find((p) => p.month === 2).avalanche, 100);
  assert.equal(pts.find((p) => p.month === 3).gapDebt, undefined);
});

test('#26: the tenure what-if offers EMI loans only and cites the RBI rule', () => {
  const { TenureWhatIf } = require(path.join(root, 'components/plan/TenureWhatIf.tsx'));
  const loan = (extra) => ({ bank: 'SBI', loan_type: 'home_loan', outstanding: '2500000', nominal_rate: '0.086', scheduled_emi: '21854', rate_type: 'floating', tenure_months_remaining: 240, ...extra });
  const plan = (loans) => ({ runArgs: null, user: { country: 'IN', loans }, displayCurrency: 'INR', marginalRate: '0', strategy: 'avalanche' });
  const html = renderToStaticMarkup(React.createElement(TenureWhatIf, { plan: plan([loan(), loan({ loan_type: 'credit_card', bank: 'HDFC', scheduled_emi: '0' })]) }));
  assert.match(html, /LONGER TENURE/);
  assert.match(html, /SBI home loan/);
  assert.doesNotMatch(html, /HDFC credit card/);
  assert.match(html, /NotificationUser\.aspx\?Id=12529/);
  assert.match(html, /they decide/);
  // Only a card: nothing to stretch, nothing shown.
  assert.equal(renderToStaticMarkup(React.createElement(TenureWhatIf, { plan: plan([loan({ loan_type: 'credit_card', scheduled_emi: '0' })]) })), '');
});
