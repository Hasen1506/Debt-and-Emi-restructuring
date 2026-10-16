// UX walkthrough fixes (16 Oct 2026, work/reports/ux-walkthrough.md).
// Each test names the fix it guards.
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

const scenario = (o = {}) => ({
  rate: '0.1209', rate_basis: 'typical', tenure_months: 36, card_indices: [1, 2], card_total: '85000', principal: '85000',
  fee: '0', fee_gst: '0', emi: '2827', card_minimum_now: '4250', cash_freed: '1423', gap_before: '0', gap_after: '0',
  debt_free_before: 49, debt_free_after: 48, cost_before: '10000', cost_after: '8000', saving: '3291', payments_share_after: '0.3',
  verdict: 'saves', break_even_fee_pct: '0.022', cost_window_months: null, ...o,
});
const cons = (o = {}) => ({ cards: [1, 2], card_cost: { 1: '0.6031', 2: '0.5020' }, scenarios: [scenario()], published: null, neutrality: 'We don’t arrange loans and no lender pays us.', ...o });
const renderCheaper = (data, country = 'IN', dateLabel = (m) => (m == null ? 'not within the plan' : `M${m}`)) => {
  const { CheaperWay } = comp('insights/CheaperWay.tsx');
  return text(renderToStaticMarkup(React.createElement(CheaperWay, {
    data, money: country === 'US' ? usd : inr, runArgs: null, cardNames: { 1: 'Card 1', 2: 'Card 2' }, dateLabel, country,
  })));
};

// ── fix 1 ───────────────────────────────────────────────────────────────────
test('fix 1: when the plan clears the cards soon, the card-to-loan move is one quiet line, no pitch', () => {
  const t = renderCheaper(cons({ plan_clears_month: 2, not_worth_it: 'plan_clears' }));
  assert.match(t, /Moving your Card 1 and Card 2 to a personal loan isn't worth it: your plan clears them by M2/);
  assert.doesNotMatch(t, /36 MONTHS|Saves|EMI|CHECK MY QUOTE|Cheaper way to carry this/);
  const costs = renderCheaper(cons({ not_worth_it: 'costs_more', scenarios: [scenario({ saving: '-50', cash_freed: '-10' })] }));
  assert.match(costs, /wouldn't save money at these rates/);
  // Worth it: the full card, as before.
  assert.match(renderCheaper(cons()), /Cheaper way to carry this/);
});

test('fix 1/11: Setup step 3 leads with This month, then the date, and the insight cards come last', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  const preview = qs.slice(qs.indexOf('function PlanPreview('));
  const at = (s) => { const i = preview.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('<SetupThisMonth') < at('<table'), 'This month before the date table');
  assert.ok(at('<table') < at('<InsightsPanel'), 'the date before the A6 card');
  const home = src('components/home/LedgerHome.tsx');
  const h = (s) => { const i = home.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(h('{register}') < h('id="home-status"') && h('{register}') < h('<CashFlow'), 'Pay this month before the figures');
  assert.ok(h('{register}') < h('{insights}'), 'the pay list before the insight cards');
});

// ── fix 2 ───────────────────────────────────────────────────────────────────
test('fix 2: CheaperWay shows no debt-free date for a capped plan (InsightsPanel maps capped scenarios to no date)', () => {
  const capped = cons({ scenarios: [scenario({ debt_free_before: null, debt_free_after: null })] });
  assert.doesNotMatch(renderCheaper(capped), /Debt-free/);
  assert.match(renderCheaper(cons()), /Debt-free M48 instead of M49/);
  const panel = src('components/insights/InsightsPanel.tsx');
  assert.match(panel, /debt_free_before: null, debt_free_after: null/);
  assert.match(src('components/home/HomeDebtFree.tsx'), /capped=\{plan\.infeasibleFrom != null\}/);
  assert.match(src('components/setup/QuickSetup.tsx'), /capped=\{plan\.infeasible_from_month != null\}/);
});

// Class guard over every component that renders a debt-free month: each one
// reads it through planEnd/shownDebtFreeMonth, gets it from an engine answer
// that already drops a capped plan's paper date (engine/plan_end.py), or is
// given only an already-mapped PlanData date. A new file that renders one
// without being listed fails here.
test('fix 2: every component that renders a debt-free date is guarded against capped plans', () => {
  const GUARDED = {
    'app/tools/windfall/tool.tsx': 'planEnd (runFromResponse)',
    'components/activity/LogDialog.tsx': 'shownDebtFreeMonth',
    'components/plan/load-plan.ts': 'planEnd',
    'components/plan/PlanTrajectory.tsx': 'chartEndMonth/notFundableFrom',
    'components/setup/QuickSetup.tsx': 'shownDebtFreeMonth + capped prop',
    'lib/plan-gap.ts': 'defines planEnd/shownDebtFreeMonth',
    'lib/trajectory.ts': 'planEnd',
    // Engine answers read through engine/plan_end.shown_debt_free_month:
    'components/insights/CheaperWay.tsx': 'engine consolidation (_clears) + InsightsPanel capped map',
    'components/insights/InsightsPanel.tsx': 'capped prop',
    'components/insights/OfferCheck.tsx': 'engine offer_check shown_debt_free_month',
    'components/insights/PrepayKeepSplit.tsx': 'engine prepay_invest shown_debt_free_month',
    'components/WhatIfPanel.tsx': 'engine sensitivity.compare shown_debt_free_month',
    'components/plan/TenureWhatIf.tsx': 'scenario_infeasible_from_month + engine compare',
    'lib/payoff-range.ts': 'engine debt_free_range shown_debt_free_month',
    'lib/seasonal-income.ts': 'API _seasonal_out drops capped dates',
    // PlanData dates are already planEnd-mapped by load-plan:
    'components/home/HomeDebtFree.tsx': 'PlanData', 'components/home/HomeDebtFreeRange.tsx': 'PlanData',
    'components/home/HomeProgress.tsx': 'PlanData (datedPlan)', 'components/plan/LedgerPlan.tsx': 'PlanData',
    'components/plan/PlanSchedule.tsx': 'PlanData', 'components/plan/PlanPace.tsx': 'PlanData',
    'components/plan/DebtFreeRedirectPrompt.tsx': 'PlanData', 'components/plan/PlanData.ts': 'type',
    'components/StrategySwitcher.tsx': 'load-plan strategyCompare (shownDebtFreeMonth)',
    'components/personas/StrategyCompare.tsx': 'Profile outcomes (shownDebtFreeMonth)',
    'components/plan/PayoffRulesEditor.tsx': 'Profile outcomes (shownDebtFreeMonth)',
  };
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
  const renders = /debt_free_month|debt_free_before|debt_free_after|debtFreeMonth|new_debt_free_month|scenario_debt_free_month/;
  const files = [...walk('app'), ...walk('components')].filter((f) => renders.test(src(f)));
  const missing = files.filter((f) => !GUARDED[f]);
  assert.deepEqual(missing, [], `renders a debt-free month without a C11 guard: ${missing.join(', ')}`);
  for (const [f, how] of Object.entries(GUARDED)) {
    if (!fs.existsSync(path.join(root, f))) continue;
    if (/^(planEnd|shownDebtFreeMonth)/.test(how)) assert.match(src(f), /planEnd|shownDebtFreeMonth/, f);
  }
});

// ── fix 5 ───────────────────────────────────────────────────────────────────
test('fix 5: US users never see GST, RBI, KFS or "fixed-EMI" in the card or offer copy', () => {
  const us = renderCheaper(cons({ cards: [0], card_cost: { 0: '0.3448' }, scenarios: [scenario({ card_indices: [0] })] }), 'US');
  assert.doesNotMatch(us, /GST|RBI|KFS|EMI|in India|CIBIL/);
  assert.match(us, /fixed-payment personal loan/);
  const india = renderCheaper(cons());
  assert.match(india, /plus 18% GST/);
  assert.match(india, /How moving a card to a loan works in India/);
  const { monthlyPrompts } = lib('monthly-prompts.ts');
  const base = { today: new Date(2026, 9, 20), loansWithPayments: 1, activityDates: ['2026-09-02'], pendingUpi: [], snoozed: [] };
  const usAsk = monthlyPrompts({ ...base, country: 'US' }).find((p) => p.key === 'ask_assistant');
  assert.doesNotMatch(usAsk.text, /RBI|RM\b/);
  assert.match(monthlyPrompts({ ...base, country: 'IN' }).find((p) => p.key === 'ask_assistant').text, /RBI/);
  const offer = src('components/insights/OfferCheck.tsx');
  assert.match(offer, /KIND_LABEL_US/);
  assert.match(src('components/insights/InsightsPanel.tsx'), /country === 'US' \? 'GOT A LOAN OR PAY-OVER-TIME OFFER/);
});

// ── fix 7 ───────────────────────────────────────────────────────────────────
test('fix 7: two cards get two names everywhere (Card 1 / Card 2), a lender or nickname wins', () => {
  const { uniqueLoanNames } = lib('loan-types.ts');
  const loans = [
    { loan_type: 'home_loan', bank: '' },
    { loan_type: 'credit_card', bank: '' },
    { loan_type: 'credit_card', bank: '' },
    { loan_type: 'personal_loan', bank: '' },
  ];
  assert.deepEqual(uniqueLoanNames(loans), ['Home loan', 'Card 1 (credit card)', 'Card 2 (credit card)', 'Personal loan']);
  assert.deepEqual(uniqueLoanNames(loans, true), ['home loan', 'Card 1', 'Card 2', 'personal loan']);
  assert.deepEqual(uniqueLoanNames([{ loan_type: 'credit_card', bank: 'HDFC' }, { loan_type: 'credit_card', bank: 'SBI' }], true), ['HDFC credit card', 'SBI credit card']);
  // The pay list and the schedule's paid-off rows use the same names.
  for (const f of ['lib/pay-this-month.ts', 'components/plan/plan-milestones.ts', 'components/insights/InsightsPanel.tsx', 'components/home/HomeRestructure.tsx'])
    assert.match(src(f), /disambiguateLoans/, f);
  assert.match(src('components/setup/QuickSetup.tsx'), /loans: disambiguateLoans\(user\.loans\)/);
});

// ── fix 8 ───────────────────────────────────────────────────────────────────
const payRow = (o) => ({ key: o.name, card: false, currency: 'INR', extra: 0, kind: 'emi', ...o, amountUser: o.amount });
test('fix 8: short of cash, the order to pay in (secured, card minimums, then other loans) and whom to call', () => {
  const { shortPriority, shortPriorityText } = lib('short-priority.ts');
  const loans = [
    { loan_type: 'personal_loan', nominal_rate: '0.14' },
    { loan_type: 'credit_card', nominal_rate: '0.42' },
    { loan_type: 'credit_card', nominal_rate: '0.40' },
    { loan_type: 'home_loan', nominal_rate: '0.09' },
  ];
  const data = { rows: [
    payRow({ name: 'Personal loan', loanIndex: 0, amount: 12000, minimum: 12000 }),
    payRow({ name: 'Card 1', loanIndex: 1, amount: 6000, minimum: 6000, card: true, kind: 'minimum' }),
    payRow({ name: 'Card 2', loanIndex: 2, amount: 2000, minimum: 2000, card: true, kind: 'minimum' }),
    payRow({ name: 'Home loan', loanIndex: 3, amount: 20000, minimum: 20000 }),
  ], total: 40000, extraUser: 0, leftOver: 0, budget: 0 };
  const lines = shortPriority(data, loans, 3000);
  assert.deepEqual(lines.map((l) => l.name), ['Home loan', 'Card 1 minimum', 'Card 2 minimum', 'Personal loan']);
  assert.deepEqual(lines.map((l) => l.short), [0, 0, 0, 3000]);
  const t = shortPriorityText(lines, 3000, inr, 'IN');
  assert.match(t, /^You’re ₹3,000 short of this month’s payments\. Pay them in this order: 1\. Home loan ₹20,000, 2\. Card 1 minimum ₹6,000/);
  assert.match(t, /That leaves the personal loan ₹3,000 short: call that bank before the due date/);
  assert.doesNotMatch(t, /Pay every EMI and card minimum/);
  const us = shortPriorityText(lines, 3000, usd, 'US');
  assert.match(us, /call that lender/);
  // Home's one line and its pay list, and Setup, say it too.
  const { homeThisMonthLine } = lib('home-this-month.ts');
  const line = homeThisMonthLine(data, 3000, inr, 'IN', loans);
  assert.equal(line.tone, 'short');
  assert.match(line.text, /^This month you’re ₹3,000 short\. Pay Home loan, Card 1 minimum and Card 2 minimum first, then call the bank for the personal loan before the due date\./);
  assert.doesNotMatch(src('components/home/HomeDebtFree.tsx'), /Pay every EMI and card minimum', plan\.user\.country\)\} in full first/);
  assert.match(src('components/setup/SetupThisMonth.tsx'), /WHAT TO SAY TO THE/);
});

// ── fix 9 ───────────────────────────────────────────────────────────────────
test('fix 9: a shortfall never reads green and a healthy date never reads red', () => {
  const home = src('components/home/HomeDebtFree.tsx');
  assert.match(home, /const SHORT_TONE = \{ color: 'var\(--negative\)' \}/);
  assert.match(home, /const DATE_TONE = \{ color: 'var\(--positive\)' \}/);
  assert.match(home, /<span style=\{SHORT_TONE\}>\{shortValue\(plan\.shortfall/);
  assert.match(home, /className="l-hit" style=\{CAPTION_TONE\}>\s*IN \{monthsSpan/);
  assert.match(src('components/home/LedgerHome.tsx'), /l: 'DEBT-FREE', v: debtFree\.v, s: debtFree\.s, tone: L_T\.ink/);
  assert.doesNotMatch(src('components/insights/InsightCards.tsx'), /disagree-total" style=\{\{[^}]*L_T\.positive/);
});

// ── fix 13 ──────────────────────────────────────────────────────────────────
test('fix 13: no "nothing logged for last month" in the plan’s first month', () => {
  const { monthlyPrompts } = lib('monthly-prompts.ts');
  const base = { today: new Date(2026, 9, 7), country: 'IN', loansWithPayments: 3, activityDates: [], pendingUpi: [], snoozed: [] };
  assert.ok(!monthlyPrompts({ ...base, firstBalanceYm: '2026-10' }).some((p) => p.key === 'log_last_month'));
  const later = monthlyPrompts({ ...base, firstBalanceYm: '2026-08' }).find((p) => p.key === 'log_last_month');
  assert.match(later.text, /^Did September’s payments go out as planned\?/);
  assert.match(src('components/home/HomeDebtFree.tsx'), /firstBalanceYm=\{plan\.user\.loans\.map\(\(l\) => l\.balance_as_of/);
});

test('fix 4: one "owed today": the add-back and the paid EMI cancel, tools and the engine read the same set', () => {
  const rf = lib('roll-forward.ts');
  const home = { id: 'h', loan_type: 'home_loan', outstanding: '4500000', nominal_rate: '0.086', scheduled_emi: '42000', tenure_months_remaining: 200, balance_after_emi: true, balance_as_of: '2026-10-07' };
  const car = { id: 'c', loan_type: 'car_loan', outstanding: '600000', nominal_rate: '0.09', scheduled_emi: '12500', tenure_months_remaining: 60, balance_after_emi: false, balance_as_of: '2026-09-02' };
  const card = { id: 'k', loan_type: 'credit_card', outstanding: '60000', nominal_rate: '0.42', scheduled_emi: '0', tenure_months_remaining: 0 };
  const loans = [home, car, card];
  assert.deepEqual(rf.paidAtEntryThisMonth(loans, '2026-10'), [0]);
  const start = rf.rollBalancesForward(loans, '2026-10').loans;
  assert.ok(Number(start[0].outstanding) > 4500000, 'the plan opens before October’s EMI');
  // Home loan paid at entry, car marked paid in Activity: both after one EMI; the card as entered.
  const owed = rf.owedTodayLoans(start, [0, 1, 2]);
  assert.ok(Math.abs(Number(owed[0].outstanding) - 4500000) < 0.01, owed[0].outstanding);
  assert.equal(owed[1].outstanding, rf.afterOneEmi(start[1]).toFixed(2));
  assert.equal(owed[2].outstanding, '60000');
  // The cookie carries Activity's paid marks by loan id; the server maps them back to positions.
  const ac = lib('activity-cookie.ts');
  const entries = [{ id: '1', loanIndex: 1, loanId: 'c', kind: 'paid_full', date: '2026-10-05', amount: '12500', scheduledEmi: '12500', loggedAt: '2026-10-05T10:00:00Z' }];
  assert.deepEqual(ac.paidEmisMarked(entries, loans, '2026-10'), ['c']);
  assert.deepEqual(ac.paidEmisMarked(entries, loans, '2026-11'), []);
  const { compressToEncodedURIComponent } = require('lz-string');
  const raw = 'z3.' + compressToEncodedURIComponent(JSON.stringify({ v: 4, deltas: [], paidNow: { month: '2026-10', loans: ['c'] } }));
  assert.deepEqual(ac.parsePaidNow(raw, [card, car, home], '2026-10'), [1], 'by id, not position');
  assert.deepEqual(ac.parsePaidNow(raw, loans, '2026-11'), [], 'last month’s marks are not this month’s');
  // The Plan line names both figures and the reason; silent when they agree.
  const o = lib('owed-today.ts');
  const f = o.owedTodayOf({ owed_today: '4885000', owed_start_of_month: '4901430', owed_today_interest_in_paid: '25570' });
  const line = o.owedTodayLine(f, 'October', inr);
  assert.match(line, /₹49,01,430 at the start of October, before the EMIs you’ve already paid; ₹48,85,000 after them, which is what you owe today/);
  assert.match(line, /repaid ₹16,430 of principal \(the other ₹25,570 was interest\)/);
  assert.equal(o.owedTodayLine(o.owedTodayOf({ owed_today: '100', owed_start_of_month: '100' }), 'October', inr), null);
  // Tools that show a balance read what's owed today, and load-plan sends the paid set to the engine.
  assert.match(src('app/tools/nri-prepay/tool.tsx'), /useOwedTodayProfile as useStoredProfile/);
  assert.match(src('components/WhatIfPanel.tsx'), /owedTodayLoans\(user\.loans, runArgs\?\.paid_emi_this_month/);
  assert.match(src('components/plan/load-plan.ts'), /loadPaidNowServer\(profile\.user\.loans/);
});

test('fix 14: an NRI plan explains the principal gap by the rupee slide, not "a balance the plan doesn’t clear"', () => {
  const { scheduleGapReason } = comp('plan/PlanSchedule.tsx');
  assert.match(scheduleGapReason({ INR: '0.035' }), /rupee loan’?'?s balance falls as the plan assumes the rupee weakens 3\.5% a year/);
  assert.match(scheduleGapReason(undefined), /loans that start later/);
});
