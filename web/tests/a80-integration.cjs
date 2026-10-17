// Audit 80+ integration (phase 1): glue between workstreams.
// - W1b/C11: a plan the gap credit limit can't carry (engine
//   infeasible_from_month) never shows a debt-free date in the Plan/Home/Setup
//   headline words; it leads with the monthly gap.
// - W3 A1 x W4: Loan Check results are remembered on the device for the
//   "where we disagree" card.
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
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    module._compile(output, file);
  };
const gap = require(path.join(root, 'lib', 'plan-gap.ts'));
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const label = (m) => `${MONTHS[(9 + m) % 12]} ${2026 + Math.floor((9 + m) / 12)}`;
const money = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;

// Class guard: over every combination of (this month short / a later month
// short) x (as-is date present / absent) x (closed date present / absent),
// a capped plan's words never contain the as-is debt-free date and always
// name the month it stops being fundable.
test('C11: capped plans never headline a debt-free date', () => {
  const asIs = 100; // label(100) is a month that must never appear
  for (const shortfall of [0, 5500])
    for (const asIsMonth of [asIs, null])
      for (const closedMonth of [null, undefined])
        for (const infeasibleFrom of [3, 30]) {
          const laterGap = shortfall > 0 ? undefined : { month: 7, amount: 4200 };
          const args = { shortfall, asIsMonth, closedMonth, label, money, infeasibleFrom, laterGap };
          const h = gap.shortHeadline(args);
          const all = `${h.value} ${h.sub}`;
          assert.ok(!all.includes(label(asIs)), all);
          assert.match(h.value, /\/MO SHORT$/, all);
          // "not fundable as it stands from <m>" on its own; after "as things
          // stand:" just "not fundable from <m>" (the phrase said once).
          assert.ok(all.includes(`NOT FUNDABLE AS IT STANDS FROM ${label(infeasibleFrom)}`) || all.includes(`AS THINGS STAND: NOT FUNDABLE FROM ${label(infeasibleFrom)}`), all);
          assert.ok(!/AS THINGS STAND: NOT FUNDABLE AS IT STANDS/.test(all), all);
          const line = gap.shortGapLine(args);
          if (shortfall > 0) {
            assert.ok(!line.includes(label(asIs)), line);
            assert.ok(line.includes(`as things stand: not fundable from ${label(infeasibleFrom)}`), line);
            assert.ok(!/as it stands/.test(line), line); // said once, not twice
          } else assert.equal(line, null);
        }
});

test('C11: fundable plans keep their words (no regression)', () => {
  const h = gap.shortHeadline({ shortfall: 0, asIsMonth: 40, closedMonth: null, label, money, laterGap: { month: 7, amount: 4200 } });
  assert.equal(h.value, label(40));
  assert.equal(h.sub, 'A LATER MONTH IS SHORT · GAP BORROWED');
  const line = gap.shortGapLine({ shortfall: 5500, asIsMonth: 40, closedMonth: 30, label, money });
  assert.equal(line, `if the ₹5,500/mo gap closes: ${label(30)} · as things stand: ${label(40)}`);
});

test('C11: Plan, Home and Setup pass infeasible_from_month to the gap words', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  assert.match(read('components/plan/load-plan.ts'), /\.\.\.planEnd\(scenario\)/); // infeasibleFrom via lib/plan-gap planEnd (phase 5)
  assert.match(read('lib/plan-gap.ts'), /infeasibleFrom: r\.infeasible_from_month \?\? null/);
  assert.match(read('components/plan/LedgerPlan.tsx'), /infeasibleFrom: plan\.infeasibleFrom/);
  assert.match(read('components/home/HomeDebtFree.tsx'), /infeasibleFrom: plan\.infeasibleFrom/);
  assert.match(read('components/setup/QuickSetup.tsx'), /infeasibleFrom: plan\.infeasible_from_month/);
  assert.match(read('lib/api.ts'), /infeasible_from_month\?: number \| null/);
});

test('A1 x W4: Loan Check remembers its findings for the disagree card', () => {
  const src = fs.readFileSync(path.join(root, 'app/tools/loan-check/tool.tsx'), 'utf8');
  assert.match(src, /import \{ rememberLoanCheck \} from '@\/lib\/loan-check-memory'/);
  assert.match(src, /setResult\(res\);\s*(\/\/[^\n]*\n\s*)*rememberLoanCheck\(res\);/);
});

// Integration phase 3: the golden journey's "sign out clears this browser"
// failed on W6's rd_intro_seen_plan. Class guard: every key a module writes to
// localStorage is cleared on sign-out by lib/server-sync.ts (a slice target,
// LOCAL_PER_USER_KEYS, a cleared prefix) or kept there on purpose
// (LOCAL_DEVICE_KEYS / account + device id).
test('every localStorage key written anywhere is cleared on sign-out or declared device-level', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const sync = fs.readFileSync(path.join(root, 'lib', 'server-sync.ts'), 'utf8');
  const listOf = (name) => {
    const at = sync.indexOf(`export const ${name}`);
    assert.ok(at >= 0, name);
    return [...sync.slice(at, sync.indexOf('] as const;', at)).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  };
  const perUser = listOf('LOCAL_PER_USER_KEYS');
  const prefixes = [...listOf('LOCAL_PER_USER_PREFIXES'), 'rightdue_pending_sync_', 'rightdue_state_version_', 'rightdue_sync_conflict_'];
  const device = [...listOf('LOCAL_DEVICE_KEYS'), 'rightdue_account_id', 'rightdue_device_id'];
  const slices = [...sync.matchAll(/kind: 'localStorage',\s*name: '([a-z0-9_]+)'/g)].map((m) => m[1]);
  const bad = [];
  for (const f of walk(root)) {
    const text = fs.readFileSync(f, 'utf8');
    if (!/localStorage\.setItem\(/.test(text) || f.endsWith(path.join('lib', 'server-sync.ts'))) continue;
    for (const [, key] of text.matchAll(/'((?:rightdue|rd)_[a-z0-9_]+)'/g)) {
      // Cookie names live in the same modules; only keys that this file never
      // writes to document.cookie under that name are localStorage keys.
      if (new RegExp(`cookie[^\\n]*${key}|${key}[^\\n]*cookie`, 'i').test(text) && !slices.includes(key)) continue;
      const ok = perUser.includes(key) || device.includes(key) || slices.includes(key) || prefixes.some((p) => key.startsWith(p));
      if (!ok) bad.push(`${path.relative(root, f)}: ${key}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(perUser.includes('rightdue_upi_checks') && perUser.includes('rightdue_loan_check_findings'));
});

// Integration phase 4 (E10 × B22 × A1): Home CLS at 390 px was 0.81 (budget
// 0.1) — W6's intro appeared after mount at the top and W3's insight cards
// (~1,500 px) streamed in above "This month". Class guard: the intro is
// always server-rendered and hidden before paint by the <head> script, and
// nothing that streams in with no reserved space sits above Home's first
// screen (This month, context, cash flow, Where you stand).
test('E10: page intros never render late, and Home streams insights below the first screen', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const intro = read('components/FirstVisitIntro.tsx');
  assert.ok(!/return null/.test(intro), 'FirstVisitIntro must render on the server (hidden by CSS when seen)');
  assert.ok(!/useState/.test(intro), 'no mount-time show/hide state');
  assert.match(intro, /data-intro=\{id\}/);
  assert.match(read('app/layout.tsx'), /__html: INTRO_HIDE_SCRIPT/);
  const seen = read('lib/intro-seen.ts');
  assert.match(seen, /INTRO_SEEN_PREFIX = 'rd_intro_seen_'/);
  const home = read('components/home/LedgerHome.tsx');
  const at = (s) => { const i = home.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('{insights}') > at('id="home-status"'), 'insights after "Where you stand"');
  assert.ok(at('{thisMonth}') < at('<CashFlow'), 'This month stays first');
  // The hide script itself: run it against a fake storage + document.
  const style = { id: '', textContent: '' };
  const store = { rd_intro_seen_home: '1', rd_intro_seen_plan: '1', other: 'x' };
  const keys = Object.keys(store);
  const ctx = {
    localStorage: { length: keys.length, key: (i) => keys[i] },
    document: { createElement: () => style, head: { appendChild: () => {} } },
  };
  const m = { exports: require(path.join(root, 'lib/intro-seen.ts')) };
  new Function('localStorage', 'document', m.exports.INTRO_HIDE_SCRIPT)(ctx.localStorage, ctx.document);
  assert.equal(style.id, 'rd-intro-seen');
  assert.equal(style.textContent, '[data-intro="home"]{display:none}[data-intro="plan"]{display:none}');
  assert.equal(m.exports.introHideRule('a"b'), '[data-intro="ab"]{display:none}');
});

// Integration phase 5 (C11 capped plans): the headline said "not fundable
// from <month>" but the chart and schedule still drew "DEBT-FREE AS THINGS
// STAND · <paper date>" and lost the never-clears stop. Class guard: any
// capped /simulate response (infeasible_from_month set, never_clears true,
// debt_free_month a date on paper), mapped the way load-plan maps it
// (planEnd), renders no debt-free date in the chart, the schedule, the CSV
// events or the headline, and stops the schedule at "NOT FUNDABLE FROM".
test('C11: a capped plan renders no debt-free date on Plan (chart, schedule, headline)', () => {
  const prevLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/plan', useSearchParams: () => new URLSearchParams() };
    if (request === 'server-only') return {};
    return prevLoad.call(this, request, ...rest);
  };
  try {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { mergeTrajectories, extractMonthlyPayments, planWithWhatIf } = require(path.join(root, 'lib/trajectory.ts'));
    const { PlanTrajectory } = require(path.join(root, 'components/plan/PlanTrajectory.tsx'));
    const { PlanSchedule } = require(path.join(root, 'components/plan/PlanSchedule.tsx'));
    const { planHeadline } = require(path.join(root, 'lib/plan-headline.ts'));
    const today = require(path.join(root, 'lib/today.ts'));
    const now = today.getCountryToday('IN');
    const longLabel = (m) => today.monthIndexToCountryLabel(m, 'IN');
    const shortCap = (m) => { const d = today.monthIndexToDate(m, now); return `${today.MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getFullYear()}`; };
    const chartCap = (m) => { const d = today.monthIndexToDate(m, now); return `${today.MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase()} ’${String(d.getFullYear()).slice(-2)}`; };
    const loans = [
      { id: 'p', bank: 'SBI', loan_type: 'personal_loan', outstanding: '200000', nominal_rate: '0.14', scheduled_emi: '10000', tenure_months_remaining: 24 },
      { id: 'c', bank: 'HDFC', loan_type: 'credit_card', outstanding: '100000', nominal_rate: '0.42', scheduled_emi: '0' },
    ];
    // A run that "clears" in month `dfm` only by paying with money that can't
    // be found from `infeasible` on (C11).
    const response = ({ dfm, infeasible, shortNow }) => {
      const trajectory = [];
      for (let m = 1; m <= dfm; m++) {
        const p = Math.max(0, 200000 * (1 - m / 20));
        const c = Math.max(0, 100000 * (1 - m / dfm));
        const short = (shortNow && m === 1) || m >= 3 ? 4200 : 0;
        trajectory.push({
          month: m, balance: String(p + c), interest_paid: '900', invested: '0',
          balances_by_loan_index: { 0: String(p), 1: String(c) },
          payments_by_loan_index: { 0: p > 0 || m === 20 ? '10000' : '0', 1: c > 0 || m === dfm ? '3000' : '0' },
          total_paid: '13000', extra_paid: '0', shortfall: String(short),
          gap_borrowed: String(short), gap_debt: String(Math.min(150000, 4200 * Math.max(0, m - 2))), gap_interest: '50',
        });
      }
      return {
        debt_free_month: dfm, total_interest_paid: '90000', total_invested: '0', trajectory, months_in_horizon: dfm,
        never_clears: true, trajectory_cut_month: null, grows_without_limit: false, shortfall: shortNow ? '4200' : '0',
        gap_rate: '0.45', total_gap_interest: '5000', infeasible_from_month: infeasible,
        gap_closed: shortNow ? { cut: '4200', debt_free_month: dfm - 2, total_interest_paid: '80000' } : null,
      };
    };
    let combos = 0;
    for (const dfm of [40, 70])
      for (const infeasible of [1, 6, 30])
        for (const shortNow of [false, true]) {
          const r = response({ dfm, infeasible, shortNow });
          const end = gap.planEnd(r);
          assert.equal(end.debtFreeMonth, null, 'a capped run has no debt-free month');
          assert.deepEqual(end.scheduleCut, { month: infeasible, growsWithoutLimit: false, notFundableFrom: infeasible });
          const futureRow = r.trajectory.find((p) => p.month > 1 && Number(p.shortfall) > 0);
          const plan = {
            live: true, user: { country: 'IN', loans, monthly_income: '50000', efund_balance: '0' }, displayCurrency: 'INR',
            strategy: 'avalanche', trajectory: mergeTrajectories(r, r), monthlyPayments: extractMonthlyPayments(r),
            ...end, baselineNeverClears: true, shortfall: Number(r.shortfall), gap: gap.planGap(r), gaps: [],
            futureShortfall: futureRow ? { month: futureRow.month, amount: Number(futureRow.shortfall) } : undefined,
            totalInterest: r.total_interest_paid, baselineInterest: '0', runArgs: null, strategyCompare: null,
          };
          const short = true;
          const html = [
            renderToStaticMarkup(React.createElement(PlanTrajectory, { plan, short })),
            renderToStaticMarkup(React.createElement(PlanSchedule, { plan })),
          ].join('\n');
          const words = (s) => s.replace(/<[^>]+>/g, ' ');
          const text = words(html);
          for (const bad of [shortCap(dfm), chartCap(dfm), longLabel(dfm)]) assert.ok(!text.includes(bad), `paper date ${bad} shown (dfm ${dfm}, infeasible ${infeasible})`);
          assert.ok(!/DEBT-FREE AS THINGS STAND|★ DEBT-FREE|debt-free in /.test(text), 'debt-free milestone/row shown');
          assert.ok(text.includes(`NOT FUNDABLE FROM ${shortCap(infeasible)}`), 'schedule heading/stop says not fundable');
          assert.ok(!text.includes('NEVER CLEARS ·') && !/DOESN’T CLEAR IN 30 YEARS/.test(text), 'the capped stop, not the 30-year one');
          assert.match(html, /data-testid="schedule-stop"/);
          assert.ok(text.includes(`NOT FUNDABLE FROM ${chartCap(infeasible)}`), 'chart note says not fundable');
          // Headline: the words Plan, Home and Setup use.
          const label = (m) => longLabel(m).toUpperCase();
          const h = gap.shortHeadline({ shortfall: plan.shortfall, asIsMonth: plan.debtFreeMonth, closedMonth: plan.gap?.closed?.debtFreeMonth, label, money: (v) => `₹${v}`, infeasibleFrom: plan.infeasibleFrom, laterGap: plan.futureShortfall });
          assert.ok(!`${h.value} ${h.sub}`.includes(label(dfm)));
          assert.doesNotMatch(planHeadline({ debtFreeMonth: plan.debtFreeMonth, short, country: 'IN' }), /^Debt-free:/);
          // The tenure what-if (compare) maps through the same planEnd.
          const wi = planWithWhatIf(plan, { scenario_trajectory: r.trajectory, scenario_debt_free_month: dfm, scenario_never_clears: true, scenario_infeasible_from_month: infeasible }, 0);
          assert.equal(wi.debtFreeMonth, null);
          assert.equal(wi.scheduleCut.notFundableFrom, infeasible);
          // Setup's Debt-free row for a capped plan: the later gap, never the paper date.
          const row = gap.cappedRow(r, longLabel, (v) => `₹${v}`);
          if (!shortNow) assert.ok(row && !row.join(' ').includes(longLabel(dfm)) && row[1].includes(`not fundable as it stands from ${longLabel(infeasible)}`), String(row));
          else assert.equal(row, null); // month-1 short: Setup's short row (shortGapLine, guarded above)
          combos++;
        }
    assert.equal(combos, 12);
    // Fundable plans keep their date and their stop rules (no regression).
    assert.deepEqual(gap.planEnd({ debt_free_month: 40 }), { debtFreeMonth: 40, infeasibleFrom: null, scheduleCut: null });
    assert.deepEqual(gap.planEnd({ debt_free_month: null, never_clears: true, trajectory_cut_month: 360 }), { debtFreeMonth: null, infeasibleFrom: null, scheduleCut: { month: 360, growsWithoutLimit: false } });
    // Every page reads the run's end through planEnd / shownDebtFreeMonth.
    const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
    assert.match(read('components/plan/load-plan.ts'), /\.\.\.planEnd\(scenario\)/);
    assert.doesNotMatch(read('components/plan/load-plan.ts'), /debtFreeMonth: (scenario|altSims\[\d\]|sims\[i\]|paceSim)\.debt_free_month/);
    assert.match(read('lib/trajectory.ts'), /\.\.\.planEnd\(\{/);
    assert.match(read('components/setup/QuickSetup.tsx'), /shownDebtFreeMonth\(plan\)/);
  } finally {
    Module._load = prevLoad;
  }
});
