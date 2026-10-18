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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** A back/forward-cache restore: pageshow with persisted true (R12-1 fix 2:
 *  the first load's pageshow, persisted false, no longer ends a leave). */
const bfcacheShow = () => Object.defineProperty(new Event('pageshow'), 'persisted', { value: true });
const { scanApp, scanSource } = require('./lib/label-in-name.cjs');

// Live re-test 10 fix round (R10-1..R10-4, Home interest vs Plan).

// ─── R10-1 / R10-2: label in name (WCAG 2.5.3) ───────────────────────────
test('R10-1/R10-2: the scanner catches the forms R9’s regex missed', () => {
  const bad = (s) => scanSource(s).filter((r) => !r.ok).map((r) => r.visible);
  // R10-1: visible words in nested elements, with dynamic parts after them.
  assert.deepEqual(bad("<button aria-label={`Payoff strategy: ${p.name}. Change it`}><Medal /><span><small>PAYOFF ORDER</small><b>{p.name.toUpperCase()}</b></span></button>"), ['payoff order']);
  // R10-2: words before a dynamic part, and symbols.
  assert.deepEqual(bad("<LBracket onClick={f} label={`${isOpen ? 'Hide' : 'Show'} what the ${name} costs a year`}>{isOpen ? 'HIDE' : `WHY ${fmtPct(d.effective)}? ↓`}</LBracket>"), ['why']);
  assert.deepEqual(bad('<LBracket href="/tax" label="Open the Tax page">{c === \'IN\' ? \'OLD VS NEW REGIME, LOAN BY LOAN →\' : \'TAX PAGE →\'}</LBracket>'), ['old vs new regime loan by loan', 'tax page']);
  assert.deepEqual(bad("<LBracket onClick={x} label={`${funded ? 'Archive' : 'Cancel'} ${goal.label}`}>{funded ? 'ARCHIVE' : 'CANCEL GOAL'}</LBracket>"), ['cancel goal']);
  // …and passes the fixed forms.
  assert.deepEqual(bad("<button aria-label={`Payoff order: ${p.name}, ${p.tag}. Change it`}><Medal /><span><small>PAYOFF ORDER</small><b>{p.name}</b></span></button>"), []);
  assert.deepEqual(bad("<LBracket label={isOpen ? `Hide what the ${n} costs` : `Why ${fmtPct(d.effective)}? What the ${n} costs`}>{isOpen ? 'HIDE' : `WHY ${fmtPct(d.effective)}? ↓`}</LBracket>"), []);
  assert.deepEqual(bad("<LBracket onClick={x} label={`${funded ? 'Archive' : 'Cancel goal'}: ${goal.label}`}>{funded ? 'ARCHIVE' : 'CANCEL GOAL'}</LBracket>"), []);
  // An icon has no words to match; an arrow function in props doesn't end the tag.
  assert.deepEqual(bad('<button onClick={() => a > b} aria-label="Dismiss">×</button>'), []);
});

test('R10-2: every button and link name in the app starts with its visible words', () => {
  const results = scanApp(root);
  assert.ok(results.length >= 50, `checked ${results.length}`);
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => `${r.file}:${r.line} [${r.visible}] "${r.names.join(' / ')}"`), []);
  // The ones the re-test named.
  // Audit 80+ B20: the medallion is gone; the payoff order is a labelled radio group.
  assert.match(src('components/chrome/PayoffOrderSwitch.tsx'), /role="radiogroup"\s+aria-labelledby="rd-payoff-order-label"/);
  assert.match(src('components/home/OpenPositions.tsx'), /`Why \$\{fmtPct\(d\.effective\)\}\? What the \$\{name\} costs a year, line by line`/);
  assert.match(src('components/profile/ProfileSummary.tsx'), /'Old vs new regime, loan by loan: open the Tax page' : 'Tax page'/);
  assert.match(src('components/goals/GoalsPage.tsx'), /label=\{`\$\{funded \? 'Archive' : 'Cancel goal'\}: \$\{goal\.label\}`\}/);
});

// ─── R10-3: page-wide abort, WebKit noise, chunk reload ───────────────────
test('R10-3: one page signal, aborted on beforeunload/pagehide, renewed for later requests', async () => {
  const win = new EventTarget();
  global.window = win;
  try {
    delete require.cache[path.join(root, 'lib/page-abort.ts')];
    const { pageSignal, pageScoped, anySignal } = lib('page-abort.ts');
    const a = pageSignal();
    assert.equal(pageSignal(), a, 'shared');
    // R11-1 changed this: beforeunload aborts at once (no task later), even
    // when a "leave this page?" prompt keeps the person here; the prompt
    // case recovers through pageScoped()'s re-ask (tests/r11-fixes.cjs).
    const ask = new Event('beforeunload', { cancelable: true });
    win.addEventListener('beforeunload', (e) => e.preventDefault(), { once: true });
    win.dispatchEvent(ask);
    assert.equal(ask.defaultPrevented, true);
    assert.equal(a.aborted, true);
    const a2 = pageSignal();
    assert.notEqual(a2, a);
    assert.equal(a2.aborted, false);
    win.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    assert.equal(a2.aborted, true);
    // Let the leave settle (a plain Event's returnValue isn't a string):
    // a pageshow says the page is in use again.
    win.dispatchEvent(bfcacheShow());
    const b = pageSignal();
    assert.notEqual(b, a);
    assert.equal(b.aborted, false);
    win.dispatchEvent(new Event('pagehide'));
    assert.equal(b.aborted, true);
    // pageScoped: cut off by the page, still here → asked again.
    let calls = 0;
    const got = await pageScoped(async (signal) => {
      calls++;
      if (calls === 1) {
        win.dispatchEvent(new Event('pagehide'));
        assert.equal(signal.aborted, true);
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return 'ok';
    }, undefined, 5);
    assert.equal(got, 'ok');
    assert.equal(calls, 2);
    // The caller's own cancel is not retried.
    const own = new AbortController();
    own.abort();
    await assert.rejects(pageScoped(async (signal) => {
      assert.equal(signal.aborted, true);
      throw Object.assign(new Error('x'), { name: 'AbortError' });
    }, own.signal, 5));
    // Any other error passes through.
    await assert.rejects(pageScoped(async () => { throw new Error('500'); }, undefined, 5), /500/);
    const c1 = new AbortController();
    const both = anySignal(c1.signal, new AbortController().signal);
    c1.abort();
    assert.equal(both.aborted, true);
  } finally {
    delete global.window;
  }
  // Wired: rates, auth/me and notify flags all use it.
  const api = src('lib/api.ts');
  assert.match(api, /meInFlight = pageScoped\(\(signal\) => get<AuthUser \| null>\('\/api\/auth\/me', signal\)\)/);
  assert.match(api, /pageScoped\(\(s\) => get<CentralRatesResponse>\('\/api\/rates\/central', s\), signal\)/);
  assert.match(src('lib/notify-client.ts'), /pageScoped\(\(signal\) => call<NotifyFlags>\('\/flags', signal \? \{ signal \} : undefined\)\)/);
});

test('R10-3: WebKit navigation noise is filtered in the reporter and the E2E watchers, nothing else', () => {
  const { shouldReport, isChunkLoadError, reloadOnceForChunkError } = lib('client-error.ts');
  for (const m of [
    'Fetch API cannot load https://rightdue.app/api/session/auth/me due to access control checks.',
    'Fetch API cannot load https://rightdue.app/api/notify/flags due to access control checks.',
    'https://rightdue.app/plan?_rsc=yqSatT45 due to access control checks.',
  ]) {
    assert.equal(shouldReport('TypeError', m), false, m);
    assert.equal(shouldReport('Error', m), false, m); // WebKit's page error has no TypeError name
  }
  assert.equal(shouldReport('TypeError', 'Cannot read properties of undefined'), true);
  // The E2E helper shares the rule but only for our own routes, never a bare "Load failed".
  const out = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../e2e/browser-noise.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = new Module(path.join(__dirname, '../e2e/browser-noise.ts'));
  m.filename = path.join(__dirname, '../e2e/browser-noise.ts');
  m.paths = Module._nodeModulePaths(path.dirname(m.filename));
  m._compile(out, m.filename);
  const { isWebKitNavigationNoise } = m.exports;
  assert.equal(isWebKitNavigationNoise('/rightdue.app/api/rates/central due to access control checks.'), true);
  assert.equal(isWebKitNavigationNoise('/rightdue.app/activity?_rsc=1p-R due to access control checks.'), true);
  assert.equal(isWebKitNavigationNoise('Load failed'), false);
  assert.equal(isWebKitNavigationNoise('https://evil.example/x due to access control checks.'), false);
  assert.equal(isWebKitNavigationNoise('ReferenceError: x is not defined'), false);
  assert.match(fs.readFileSync(path.join(__dirname, '../e2e/a11y.spec.ts'), 'utf8'), /if \(isWebKitNavigationNoise\(e\.message\)\) return;/);
  // ChunkLoadError: one reload, never a loop, never while leaving.
  assert.equal(isChunkLoadError('ChunkLoadError', 'Loading chunk 931 failed.'), true);
  assert.equal(isChunkLoadError('Error', 'Loading chunk app/plan/page failed.\n(error: https://rightdue.app/_next/static/chunks/app/plan/page-abc.js)'), true);
  assert.equal(isChunkLoadError('TypeError', 'x is not a function'), false);
  const store = new Map();
  let reloads = 0;
  const w = { location: { reload: () => reloads++ }, sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  assert.equal(reloadOnceForChunkError(w, true, 1e12), false);
  assert.equal(reloadOnceForChunkError(w, false, 1e12), true);
  assert.equal(reloadOnceForChunkError(w, false, 1e12 + 30_000), false);
  assert.equal(reloadOnceForChunkError(w, false, 1e12 + 61_000), true);
  assert.equal(reloads, 2);
  assert.match(src('components/site/BrowserErrorReporter.tsx'), /isChunkLoadError\(name, message\) && reloadOnceForChunkError\(window, leaving\)/);
});

// ─── R10-4: Setup's extra uses Home's whole-rupee split ──────────────────
const { setupExtraMove } = lib('setup-this-month.ts');
const { payThisMonth } = lib('pay-this-month.ts');
const { firstExtraPayment } = lib('quick-setup.ts');
const { extractMonthlyPayments } = lib('trajectory.ts');

/** Persona M from the re-test: 16 personal loans, ₹25 lakh take-home,
 *  ₹1 lakh spending. Month 1 the way the engine splits it (paise): the
 *  high-rate small loans cleared with their month's interest, the ₹1 loan
 *  with its interest, the rest on the 12% loan. */
const M = {
  income: 2500000, spend: 100000,
  loans: [
    [1, 0.1, 1], [9999999, 0.11, 300000], [15000000, 0.12, 450000], [50000, 0.13, 1500], [75000, 0.14, 2250],
    [120000, 0.15, 3600], [30000, 0.16, 900], [45000, 0.17, 1350], [60000, 0.1, 1800], [80000, 0.11, 2400],
    [90000, 0.12, 2700], [25000, 0.13, 750], [15000, 0.14, 450], [200000, 0.15, 6000], [10000, 0.16, 300], [5000, 0.17, 150],
  ],
};
function personaPlan(p, topIndex = 2, keep = [1]) {
  const user = {
    country: 'IN', monthly_income: String(p.income), fixed_expenses: String(p.spend), variable_expenses: '0',
    loans: p.loans.map(([o, r, emi], i) => ({ id: `L${i}`, loan_type: 'personal_loan', outstanding: String(o), nominal_rate: String(r), scheduled_emi: String(emi), tenure_months_remaining: 40 })),
  };
  const available = p.income - p.spend;
  const pay = {};
  const mins = {};
  const after = {};
  let used = 0;
  p.loans.forEach(([o, r, emi], i) => {
    const payoff = Math.round((o + (o * r) / 12) * 100) / 100;
    mins[i] = String(Math.min(emi, payoff) === emi && emi < payoff ? emi : payoff);
    if (i === topIndex) return;
    const v = keep.includes(i) ? emi : payoff;
    pay[i] = v;
    used += v;
    after[i] = keep.includes(i) ? String(o + (o * r) / 12 - emi) : '0';
  });
  pay[topIndex] = Math.round((available - used) * 100) / 100;
  const [o, r] = p.loans[topIndex];
  after[topIndex] = String(o + (o * r) / 12 - pay[topIndex]);
  const str = (o0) => Object.fromEntries(Object.entries(o0).map(([k, v]) => [k, String(v)]));
  const plan = {
    trajectory: [{ month: 1, payments_by_loan_index: str(pay), balances_by_loan_index: after, interest_paid: '0', total_paid: String(available) }],
    surplus_allocation: { surplus: String(available - Object.values(mins).reduce((s, v) => s + Number(v), 0)), goal_slice: '0', ef_slice: '0', debt_slice: '0' },
    shortfall: '0',
  };
  const minimums = { trajectory: [{ month: 1, payments_by_loan_index: mins }] };
  return { user, plan, minimums };
}

/** Home's own path: PlanData the way load-plan builds it. */
function homeTopExtra({ user, plan, minimums }) {
  const sa = plan.surplus_allocation;
  const d = payThisMonth({
    live: true, user, fxRatesUsed: {}, debtBudget: 0, shortfall: 0,
    monthlyPayments: extractMonthlyPayments(plan),
    trajectory: [{ month: 1, balancesByLoanIndex: plan.trajectory[0].balances_by_loan_index }],
    firstMonthMinimums: extractMonthlyPayments(minimums).find((p) => p.month === 1).perLoan,
    surplusAllocation: { surplus: Number(sa.surplus), goalSlice: 0, efSlice: 0, debtSlice: 0 },
    surplus: Number(sa.surplus),
  });
  const top = d.rows.filter((r) => r.loanIndex !== null && r.extra >= 1).sort((a, b) => b.extra - a.extra)[0];
  return { d, top };
}

test('R10-4: the 16-loan persona: Setup’s “₹X extra on your personal loan” is Home’s figure to the rupee', () => {
  const m = personaPlan(M);
  const { d, top } = homeTopExtra(m);
  // The rows' roundings add up to ₹1 over take-home less spending, so Home
  // takes ₹1 off the largest extra (R9-3).
  const old = firstExtraPayment(m.plan.trajectory[0].payments_by_loan_index, m.minimums.trajectory[0].payments_by_loan_index);
  assert.equal(Number(old.extra), top.extra + 1, 'the re-test’s ₹10,60,995 vs ₹10,60,994 shape');
  const move = setupExtraMove(m.plan, m.minimums, m.user);
  assert.deepEqual(move, { index: top.loanIndex, extra: top.extra });
  assert.equal(move.index, 2);
  assert.ok(d.total <= M.income - M.spend);
  // Setup renders it.
  // UX fix 1/11 moved Setup's This month into SetupThisMonth.tsx.
  const q = src('components/setup/SetupThisMonth.tsx');
  assert.match(q, /const move = setupExtraMove\(plan, minimums, planUser\);/);
  assert.match(q, /money\(String\(move\.extra\), loanCurrency\(moveLoan, country\)\)/);
  assert.doesNotMatch(q, /firstExtraPayment\(/);
  assert.doesNotMatch(src('components/setup/QuickSetup.tsx'), /firstExtraPayment\(/);
});

test('R10-4 property: over random splits of the 16 loans, Setup and Home name the same loan and extra', () => {
  let seed = 1014;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let runs = 0;
  for (let k = 0; k < 200; k++) {
    const loans = M.loans.map(([o, r, emi]) => [Math.max(1, Math.round(o * (0.5 + rand()))), r, Math.round(emi * (0.8 + rand() * 0.4) * 100) / 100 + 0.37]);
    const p = { income: M.income, spend: Math.round(50000 + rand() * 400000), loans };
    const topIndex = rand() < 0.5 ? 2 : 1;
    const m = personaPlan(p, topIndex, [topIndex === 2 ? 1 : 2]);
    const { top } = homeTopExtra(m);
    if (!top) continue;
    if (Number(m.plan.trajectory[0].payments_by_loan_index[topIndex]) < 0) continue;
    runs++;
    assert.deepEqual(setupExtraMove(m.plan, m.minimums, m.user), { index: top.loanIndex, extra: top.extra }, `case ${k}`);
  }
  assert.ok(runs >= 100, `ran ${runs}`);
});

// ─── Home's INTEREST tile vs Plan ─────────────────────────────────────────
test('Home interest: the tile reads the plan’s month-1 interest (as Plan and its CSV), and says what it is', () => {
  const { homeInterestLine } = lib('home-this-month.ts');
  const money = (v) => `₹${v.toLocaleString('en-IN')}`;
  // Persona G: ₹1,80,000 card at 39% and ₹60,000 at 13%. Balance × rate ÷ 12
  // is ₹6,500; the plan's October (card interest on the average daily
  // balance, 18% GST on it) is ₹6,929, the CSV's figure.
  assert.deepEqual(homeInterestLine({ planInterest: 6929.4, monthLabel: 'Oct 2026', fallback: 6500, money }), { value: '₹6,929/MO', caption: 'CHARGED IN OCT 2026 · AS ON PLAN' });
  assert.deepEqual(homeInterestLine({ planInterest: null, monthLabel: '', fallback: 6500, money }), { value: '₹6,500/MO', caption: "AT TODAY'S BALANCES AND RATES" });
  const h = src('components/home/HomeDebtFree.tsx');
  assert.match(h, /plan\.trajectory\.find\(\(p\) => p\.month === 1\)/);
  assert.match(h, /planInterest: first\.interest/);
  assert.match(src('app/page.tsx'), /<HomeInterestValue \/>/);
  const l = src('components/home/LedgerHome.tsx');
  assert.doesNotMatch(l, /'CHARGED THIS MONTH'/);
  // UI revert 18 Oct 2026: interest is red again, as before audit 80+ B19.
  assert.match(l, /\{ l: 'INTEREST', v: interest\.v, s: interest\.s, tone: L_T\.negative \}/);
  // The CSV and Plan table read the same trajectory interest.
  assert.match(src('lib/trajectory.ts'), /interest: s\?\.interest \?\? 0/);
});
