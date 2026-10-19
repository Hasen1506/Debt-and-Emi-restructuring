// Audit 80+ W3 (product findings): A1, A2, A4/D1, A5, A6, "Don't sign that",
// programmable goal diversion. Pure helpers plus server renders of the cards
// from REAL engine responses (tests/fixtures/a80-w03-insights.json, made by
// api/tests/test_a80_w03_insights_api.py's body()). The 390 px journeys are in
// e2e/a80-w03-product.spec.ts (needs the local stack).
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
  return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    }).outputText;
    module._compile(output, file);
  };
const lib = (name) => require(path.join(root, 'lib', name));
const comp = (name) => require(path.join(root, 'components', name));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/a80-w03-insights.json'), 'utf8'));
const money = (v) => `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;
const h = React.createElement;

// ---------------------------------------------------------------- A2 ------
test('A2: the order is asked only when the engine says it matters', () => {
  const { orderChoice } = lib('insights.ts');
  assert.deepEqual(orderChoice(undefined), { ask: true, preselect: null, line: null });   // no answer yet: ask as before
  assert.equal(orderChoice(null).ask, false);                                            // one loan
  const same = orderChoice(FX.plan_ok.order);
  assert.equal(FX.plan_ok.order.material, false);
  assert.deepEqual(same, { ask: false, preselect: 'avalanche', line: 'All orders give the same result for your loans.' });
  // Class: whenever material is true the user is asked and nothing is pre-picked.
  for (const cheapest of ['avalanche', 'snowball'])
    for (const material of [true, false]) {
      const o = orderChoice({ ...FX.plan_ok.order, cheapest, material, line: 'x' });
      assert.equal(o.ask, material);
      assert.equal(o.preselect, material ? null : cheapest);
    }
});

test('A2: Setup shows "order-same" instead of the chips when nothing changes', () => {
  const { SetupChoices } = comp('setup/SetupChoices.tsx');
  const base = { value: { efMonths: 3, efSplit: '0.2', strategy: 'avalanche' }, onChange() {}, showErrors: false, hasLoans: true, monthlySpend: 40000, money };
  const same = renderToStaticMarkup(h(SetupChoices, { ...base, orderInfo: { ask: false, preselect: 'avalanche', line: 'All orders give the same result for your loans.' } }));
  assert.match(same, /data-testid="order-same"/);
  assert.doesNotMatch(same, /data-testid="order-ask"/);
  assert.match(same, /All orders give the same result for your loans\./);
  const ask = renderToStaticMarkup(h(SetupChoices, { ...base, orderInfo: null }));
  assert.match(ask, /data-testid="order-ask"/);
});

// ---------------------------------------------------------------- A1 ------
test('A1: "where we disagree" is worth ₹X, from the engine, and says so in rupees', () => {
  const { DisagreementCard } = comp('insights/InsightCards.tsx');
  const { disagreementTotal } = lib('insights.ts');
  const d = FX.plan_ok.disagreements;
  assert.ok(d.items.length > 0);
  const total = disagreementTotal(d);
  assert.ok(total > 0);
  const html = renderToStaticMarkup(h(DisagreementCard, { data: d, money }));
  assert.match(html, /data-testid="disagree-card"/);
  assert.match(html, new RegExp(`data-testid="disagree-total"[^>]*>${money(total).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  // Nothing to claim: the honest zero line, never a ₹0 headline.
  const zero = renderToStaticMarkup(h(DisagreementCard, { data: { ...d, items: [], total_over_plan: '0', zero_line: 'On your loans a plain calculator and RightDue agree.' }, money }));
  assert.match(zero, /data-testid="disagree-zero"/);
  assert.doesNotMatch(zero, /disagree-total/);
  assert.equal(disagreementTotal({ ...d, items: [] }), null);
});

// ---------------------------------------------------------------- A5 ------
test('A5: short this month, the gap is the headline and the date is demoted', () => {
  const { GapHeadline } = comp('insights/InsightCards.tsx');
  const g = FX.plan_short.gap;
  assert.equal(Number(g.gap), 5500);
  assert.equal(g.ways.length, 3);
  const html = renderToStaticMarkup(h(GapHeadline, { data: g, money, closedLabel: 'May 2037' }));
  assert.match(html, /data-testid="gap-headline"/);
  assert.match(html, /data-testid="gap-amount"[^>]*>₹5,500</);
  assert.match(html, /a month short: 3 ways to close it/);
  for (const w of g.ways) assert.match(html, new RegExp(`data-testid="gap-way-${w.kind}"`));
  // The conditional date sits after the ways, in the small print.
  assert.ok(html.indexOf('gap-conditional-date') > html.indexOf('gap-way-'));
  assert.match(html, /If you close the gap, you&#x27;d be debt-free by May 2037/);
  // No way claims to close more than the gap.
  for (const w of g.ways) assert.ok(Number(w.closes) <= Number(g.gap));
});

test('A5: Plan, Setup and Home put the gap in the big figure, the date in the line', () => {
  const g = lib('plan-gap.ts');
  const label = (m) => `M${m}`;
  for (const [shortfall, asIs, closed] of [[5500, null, 120], [5500, 200, 120], [1, 3, 2], [99999, null, null]]) {
    const hd = g.shortHeadline({ shortfall, asIsMonth: asIs, closedMonth: closed, label, money });
    assert.equal(hd.value, `${money(shortfall)}/MO SHORT`);
    assert.doesNotMatch(hd.value, /M\d/);                          // never a date in the big figure
    if (closed) assert.match(hd.sub, new RegExp(`gap closes: M${closed} · as things stand`));
  }
  assert.match(src('components/home/HomeDebtFree.tsx'), /shortValue\(plan\.shortfall/);
  assert.match(src('components/setup/QuickSetup.tsx'), /\$\{money\(shortfall\)\}\/mo short/);
});

// ---------------------------------------------------------------- A6 ------
test('A6: the cheaper-way card: published rates with sources, fee + GST, never the floor, neutral', () => {
  const { CheaperWay } = comp('insights/CheaperWay.tsx');
  const c = FX.plan_ok.consolidation;
  assert.deepEqual(c.scenarios.map((s) => s.rate_basis), ['typical', 'high']);
  for (const s of c.scenarios) {
    assert.equal(Number(s.fee_gst).toFixed(2), (Number(s.fee) * 0.18).toFixed(2));
    assert.ok(Number(s.rate) >= Number(c.published.typical) - 1e-9);   // never below the typical (no floor rates)
  }
  const html = renderToStaticMarkup(h(CheaperWay, { data: c, money, runArgs: null, cardNames: { 0: 'HDFC Bank credit card' }, dateLabel: (m) => `M${m}` }));
  assert.match(html, /data-testid="cheaper-way"/);
  assert.match(html, /data-testid="cheaper-scenario-typical"/);
  assert.match(html, /data-testid="cheaper-explainer"/);
  assert.match(html, /data-testid="cheaper-neutral"[^>]*>We don&#x27;t arrange loans and no lender pays us\.</);
  for (const [, url] of c.published.sources) assert.match(url, /^https:\/\//);
});

// ------------------------------------------------------------- A4 / D1 ----
test('A4/D1: prepay/keep/split is a statement about the user’s own return, never advice', () => {
  const p = FX.prepay_invest;
  assert.equal(p.available, true);
  assert.deepEqual(p.options.map((o) => Number(o.share_kept)), [0, 0.25, 0.5, 0.75, 1]);
  // Keeping more never clears sooner.
  const dates = p.options.map((o) => o.debt_free_month ?? Infinity);
  assert.deepEqual([...dates].sort((a, b) => a - b), dates);
  const { PREPAY_KEEP_NOTE } = comp('insights/PrepayKeepSplit.tsx');
  const banned = /(^|\. )Invest\b|\bfund|equity|stock|\bbond|Nifty|S&P|mutual|SIP\b|\bETF/i;
  for (const text of [p.statement, PREPAY_KEEP_NOTE]) assert.doesNotMatch(text, banned, text);
  assert.match(PREPAY_KEEP_NOTE, /isn’t advice/);
  // The whole component source names no product either.
  assert.doesNotMatch(src('components/insights/PrepayKeepSplit.tsx').replace(/\/\*[\s\S]*?\*\//g, ''), /mutual fund|equity|Nifty|S&P|\bSIP\b|\bETF\b/);
});

test('A4: the saved share is one of five, else nothing (no default)', () => {
  const l = lib('low-rate-choice.ts');
  for (const ok of ['0', '0.25', '0.5', '0.75', '1']) assert.equal(l.normalizeLowRateShare(ok), ok);
  for (const bad of ['', null, undefined, '0.3', '2', '-1', 'abc', ' 0.5x']) assert.equal(l.normalizeLowRateShare(bad), '');
  assert.equal(l.shareWords('0'), 'Prepay all of it');
  assert.equal(l.shareWords('1'), 'Keep all of it');
  assert.equal(l.shareWords('0.25'), 'Keep 25%, prepay 75%');
  // load-plan sends it only when chosen.
  assert.match(src('components/plan/load-plan.ts'), /low_rate_invest_share: lowRateShare \|\| undefined/);
});

// ------------------------------------------------------ Don't sign that ---
test('"Don’t sign that": the offer check answer carries APR, verdict and the neutrality line', () => {
  const o = FX.offer_check;
  assert.ok(['checks_out', 'costs_more', 'doesnt_fit'].includes(o.verdict));
  assert.ok(Number(o.apr) > 0);
  assert.match(o.neutrality, /^We don't arrange loans/);
  const { OfferCheck } = comp('insights/OfferCheck.tsx');
  const html = renderToStaticMarkup(h(OfferCheck, { runArgs: { user: { country: 'IN', loans: [] } }, money, loanNames: [{ index: 0, name: 'HDFC Bank credit card' }], dateLabel: (m) => `M${m}` }));
  assert.match(html, /data-testid="offer-check"/);
});

// ------------------------------------------- A1 via Loan Check memory -----
test('A1: Loan Check findings are kept on this device for 120 days, only the two kinds', () => {
  const store = {};
  global.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] };
  try {
    const m = lib('loan-check-memory.ts');
    const res = {
      lender_name: 'SBI',
      findings: [
        { kind: 'old_benchmark', amount_this_year: '18400.4', overcharged_so_far: '9000' },
        { kind: 'missed_rate_cut', amount_this_year: '0' },
        { kind: 'fee_overcharge', amount_this_year: '500' },
      ],
    };
    assert.deepEqual(m.findingsFrom(res), [{ kind: 'old_benchmark', amount_this_year: '18400', overcharged_so_far: '9000', lender: 'SBI' }]);
    m.rememberLoanCheck(res, new Date('2026-10-01'));
    assert.equal(m.readLoanCheckFindings(new Date('2026-10-14')).length, 1);
    assert.equal(m.readLoanCheckFindings(new Date('2027-03-01')).length, 0);   // older than 120 days
    assert.equal(m.readLoanCheckFindings(new Date('2026-09-01')).length, 0);   // from the future: ignored
  } finally {
    delete global.localStorage;
  }
});

// ------------------------------------------ programmable goal diversion ---
test('Goals: limits reach the engine only when set; "until" becomes a plan month', () => {
  const g = lib('goals.ts');
  // Unchanged without limits (the roadmap F goldens hold).
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'fixed', amount: '5000' }), { funding_rule: 'fixed', funding_amount: '5000.00' });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'surplus_pct', pct: '0.5', cap: '8000', pauseBelow: '2000' }),
    { funding_rule: 'surplus_pct', funding_pct: '0.5', funding_cap: '8000.00', pause_below: '2000.00' });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'after_debt', afterLoanIndex: null, amount: '3000' }),
    { funding_rule: 'after_debt', after_loan_index: null, funding_amount: '3000.00' });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'after_debt', afterLoanIndex: 1, pct: '0.25' }),
    { funding_rule: 'after_debt', after_loan_index: 1, funding_pct: '0.25' });
  // Empty or nonsense limits are dropped, never sent as 0.
  for (const bad of ['', '0', '-5', 'abc']) assert.deepEqual(g.fundingLimitsForEngine({ kind: 'schedule', cap: bad, pauseBelow: bad }), {});
  const today = new Date(2026, 9, 14);
  const rows = [{ id: 'trip', targetMonth: '2028-10', amount: '200000', fundingRule: { kind: 'surplus_pct', pct: '0.5', until: '2027-10', cap: '5000' } }];
  const [out] = g.goalsForSimulate(rows, today);
  assert.equal(out.funding_end_month_index, 12);
  assert.equal(out.funding_cap, '5000.00');
  // An "until" at or before a deferred start drops the start (the API rejects end <= start).
  const [sched] = g.goalsForSimulate([{ id: 's', targetMonth: '2028-10', amount: '1000', fundingStartMonth: '2027-12', fundingRule: { kind: 'schedule', until: '2027-10' } }], today);
  assert.equal(sched.funding_start_month_index, null);
  assert.equal(sched.funding_end_month_index, 12);
  const [kept] = g.goalsForSimulate([{ id: 's', targetMonth: '2028-10', amount: '1000', fundingStartMonth: '2027-06', fundingRule: { kind: 'schedule', until: '2027-10' } }], today);
  assert.equal(kept.funding_start_month_index, 8);
});

test('Goals: the TS run-rate mirrors the engine for cap and floor', () => {
  const { ruleRunRate } = lib('goal-line.ts');
  const r = { kind: 'surplus_pct', pct: '0.5', cap: '4000', pauseBelow: '3000' };
  assert.equal(ruleRunRate(r, 100000, 10, 20000), 4000);     // 50% of 20,000 = 10,000, capped
  assert.equal(ruleRunRate(r, 100000, 10, 2999), 0);         // lean month: paused
  assert.equal(ruleRunRate(r, 100000, 10, 3000), 1500);      // at the floor it runs (engine: < floor pauses)
  assert.equal(ruleRunRate({ kind: 'fixed', amount: '6000', cap: '4000' }, 2500, 10, 50000), 2500);  // never above what's left
  assert.equal(ruleRunRate({ kind: 'fixed', amount: '6000' }, 100000, 10, 50000), 6000);             // no limits: unchanged
  assert.match(fs.readFileSync(path.resolve(__dirname, '../../engine/goals.py'), 'utf8'), /month_surplus < g\.pause_below/);
});

test('Goals: the rule reads back in words; bad limits block saving', () => {
  const f = lib('goal-funding.ts');
  const loans = [];
  assert.equal(f.fundingRuleLabel({ kind: 'surplus_pct', pct: '0.25', cap: '5000', pauseBelow: '2000', until: '2027-10' }, loans, 'IN', 'INR'),
    '25% of spare cash; at most ₹5,000 a month, paused in any month with under ₹2,000 spare, stops in Oct 2027');
  assert.match(f.fundingRuleLabel({ kind: 'after_debt', afterLoanIndex: null, amount: '3000' }, loans, 'IN', 'INR'), /, then ₹3,000 a month$/);
  assert.equal(f.fundingRuleError({ kind: 'surplus_pct', pct: '0.25', cap: '0' }), 'Enter the most it can take in a month, above zero.');
  assert.equal(f.fundingRuleError({ kind: 'fixed', amount: '6000', cap: '4000' }), 'The monthly limit is below the fixed amount; lower the amount or raise the limit.');
  assert.equal(f.fundingRuleError({ kind: 'after_debt', afterLoanIndex: null, amount: '' }), 'Enter the amount a month once the debt is paid off.');
  assert.equal(f.fundingRuleError({ kind: 'after_debt', afterLoanIndex: null, pct: '' }), 'Enter a share between 1% and 100%.');
  assert.equal(f.fundingRuleError({ kind: 'schedule', until: '2027-13' }), 'Pick the month it stops.');
  assert.equal(f.fundingRuleError({ kind: 'after_debt', afterLoanIndex: null }), null);
  assert.equal(f.fundingRuleError({ kind: 'surplus_pct', pct: '0.25', cap: '', pauseBelow: '', until: '' }), null);
});

test('Goals: the form shows the limits and the "once it’s paid off" choice', () => {
  const { FundingLimits, AfterDebtThen } = comp('goals/GoalForm.tsx');
  const limits = renderToStaticMarkup(h(FundingLimits, { rule: { kind: 'schedule' }, patch() {}, currency: 'INR' }));
  assert.match(limits, /data-testid="goal-limits"/);
  assert.match(limits, /At most a month/);
  assert.match(limits, /Pause when spare cash is under/);
  assert.match(limits, /Stop saving in/);
  assert.doesNotMatch(limits, /<details[^>]*open/);                 // closed until something is set
  assert.match(renderToStaticMarkup(h(FundingLimits, { rule: { kind: 'schedule', cap: '5000' }, patch() {}, currency: 'INR' })), /<details[^>]*open/);
  const then = renderToStaticMarkup(h(AfterDebtThen, { rule: { kind: 'after_debt', afterLoanIndex: null, amount: '3000' }, set() {}, currency: 'INR' }));
  assert.match(then, /data-testid="goal-after-debt-then"/);
  assert.match(then, /Then, a month/);
});

// ------------------------------------------------------------- 390 px -----
test('390 px: the new cards have no fixed widths wider than a phone and wrap long words', () => {
  for (const f of ['InsightCards.tsx', 'CheaperWay.tsx', 'OfferCheck.tsx', 'PrepayKeepSplit.tsx', 'InsightsPanel.tsx']) {
    const s = src(`components/insights/${f}`);
    for (const m of s.matchAll(/(?<![a-zA-Z])(?:width|minWidth)\s*:\s*(\d+)/g)) assert.ok(Number(m[1]) <= 358, `${f}: ${m[0]}`);
    assert.doesNotMatch(s, /whiteSpace:\s*'nowrap'[^}]*\}\s*>\s*\{[^}]*headline/, f);
  }
  // Tables scroll inside their own box rather than widening the page.
  const pks = src('components/insights/PrepayKeepSplit.tsx');
  if (/<table/.test(pks)) assert.match(pks, /overflowX:\s*'auto'/);
});
