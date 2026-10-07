const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith('@/'))
        request = path.join(root, request.slice(2));
    return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'next/navigation')
        return { useRouter: () => ({ refresh() { } }) };
    return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
    require.extensions[ext] = (module, file) => {
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
        module._compile(output, file);
    };
const lib = name => require(path.join(root, 'lib', name));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// PR A (roadmap 2026-10-07): accuracy.

test('Home: a foreign balance is labelled as the balance, and the status line carries the EMI amount', () => {
  const { OpenPositions } = require(path.join(root, 'components/home/OpenPositions.tsx'));
  const { deriveMetrics } = lib('derived.ts');
  const user = { country: 'US', income_type: 'salaried', monthly_income: '50000', fixed_expenses: '5000', savings_balance: '0',
    fx_to_user_currency: { INR: '0.01037' },
    loans: [{ id: 'h', bank: 'HDFC', loan_type: 'home_loan', outstanding: '2000000', nominal_rate: '0.085', scheduled_emi: '18100', tenure_months_remaining: 180, rate_type: 'floating', currency: 'INR' }] };
  const profile = { user, marginalRate: '0.3', creditScore: null, isLive: true };
  const html = renderToStaticMarkup(React.createElement(OpenPositions, { profile, m: deriveMetrics(profile) }));
  assert.match(html, /BALANCE ≈ \$20,7\d\d/);
  const { emiStatusLine } = lib('position-status.ts');
  assert.equal(emiStatusLine('due', 'OCT', 'NOV', 'EMI', '₹18,100'), 'OCT EMI ₹18,100 TO PAY');
  assert.equal(emiStatusLine('missed', 'OCT', 'NOV', 'MINIMUM', '₹2,500'), 'OCT MINIMUM ₹2,500 NOT PAID');
  assert.equal(emiStatusLine('paid', 'OCT', 'NOV', 'EMI', '₹18,100'), 'AFTER OCT EMI');
});

test('Pay this month: a card payoff is explained as owed + interest + GST', () => {
  const { payThisMonth } = lib('pay-this-month.ts');
  const plan = { live: true, user: { country: 'IN', loans: [{ id: 'c', bank: 'HDFC', loan_type: 'credit_card', outstanding: '50000', nominal_rate: '0.42' }] },
    monthlyPayments: [{ month: 1, perLoan: { 0: '52065' }, totalPaid: 52065, extraPaid: 50000 }], firstMonthMinimums: { 0: '2500' },
    trajectory: [{ month: 1, balancesByLoanIndex: { 0: '0' } }], fxRatesUsed: {}, surplusAllocation: { surplus: 60000, efSlice: 0, goalSlice: 0 }, surplus: 60000, debtBudget: '0' };
  const row = payThisMonth(plan).rows[0];
  assert.equal(row.kind, 'clears');
  assert.deepEqual(row.payoff, { owed: 50000, interest: 1750, gst: 315 });
  const { payoffBreakdown } = lib('schedule-reconcile.ts');
  assert.equal(payoffBreakdown(50000, 1750, 315, (n) => '₹' + n.toLocaleString('en-IN')), '₹50,000 owed + ₹1,750 interest + ₹315 GST');
});

test('Plan schedule: principal + interest = cash, and principal ties out to today\'s balance', () => {
  const { reconcileSchedule, scheduleColumnHelp } = lib('schedule-reconcile.ts');
  const t = reconcileSchedule([{ principal: 29613, interest: 300 }, { principal: 16646, interest: 205 }], 46259);
  assert.equal(t.cash, 46764); assert.equal(t.interest, 505); assert.ok(t.tiesOut);
  assert.ok(!reconcileSchedule([{ principal: 1000, interest: 0 }], 5000).tiesOut);
  assert.match(scheduleColumnHelp(true, '18').INTEREST, /18% GST/);
  const s = src('components/plan/PlanSchedule.tsx');
  assert.match(s, /<ScheduleFooter /); assert.match(s, /title=\{help\[h\]\}/);
});

test('Profile: the emergency-fund time-to-fill follows the Plan slider, not a fixed 30%', () => {
  const { efMonthsToFill } = lib('ef-split.ts');
  assert.equal(efMonthsToFill(60000, 0, 10000, '0.3'), 20);
  assert.equal(efMonthsToFill(60000, 0, 10000, '0.6'), 10);
  assert.equal(efMonthsToFill(60000, 0, 10000, '0'), Infinity);
  assert.equal(efMonthsToFill(60000, 70000, 10000, '0.3'), 0);
  assert.doesNotMatch(src('app/profile/ProfileClient.tsx'), /surplus \* 0\.3\b/);
});

test('Tax bracket: a stale 0% estimate is replaced after switching India → US with the same take-home', () => {
  const { profileMarginalRate } = lib('marginal-rate.ts');
  const base = { bracketRate: null, stateRate: 0, manualRate: '0', loadedRate: '0', incomeType: 'salaried', monthlyIncome: '50000' };
  const switched = profileMarginalRate({ ...base, prev: { country: 'IN', income_type: 'salaried', monthly_income: '50000' }, country: 'US', filing: 'single' });
  assert.equal(switched.rate, 0.37); assert.equal(switched.estimated, true);
  // Unchanged inputs keep the saved rate, and the state rate isn't added twice.
  assert.equal(profileMarginalRate({ ...base, manualRate: '0.29', loadedRate: '0.29', stateRate: 0.05, prev: { country: 'US', income_type: 'salaried', monthly_income: '50000' }, country: 'US' }).rate, 0.29);
  // A rate typed now wins; gross pay wins over everything.
  assert.equal(profileMarginalRate({ ...base, manualRate: '0.22', prev: { country: 'US', income_type: 'salaried', monthly_income: '50000' }, country: 'US' }).rate, 0.22);
  assert.equal(profileMarginalRate({ ...base, bracketRate: 0.24, stateRate: 0.05, country: 'US' }).rate, 0.29);
  // Lifecycle events on a profile with no income keep the old rate instead of 0.
  const { applyConfirmedEventWithRefresh } = lib('lifecycle-events.ts');
  const user = { country: 'US', income_type: 'salaried', monthly_income: '', loans: [{ id: 'h', loan_type: 'home_loan', outstanding: '1', nominal_rate: '0.07', rate_type: 'floating' }] };
  const ev = { id: 'e', kind: 'floating_rate_reset', loanId: 'h', loanIndex: 0, newRate: '0.08', status: 'confirmed', loggedAt: '2026-10-01' };
  assert.equal(applyConfirmedEventWithRefresh(user, '0.32', ev).marginalRate, '0.32');
});

test('GST is set in one place: web reads it from the engine export', () => {
  const { GST_RATE_IN } = lib('gst.ts');
  assert.equal(GST_RATE_IN.toString(), '0.18');
  assert.equal(require(path.join(root, 'lib/tax-tables.json')).in.gst, 0.18);
  for (const f of ['lib/effective-apr.ts', 'lib/estimate-penalty.ts', 'lib/pay-this-month.ts']) assert.doesNotMatch(src(f), /0\.18/, f);
});
