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
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

// Live re-test 9 fix round (R9-1..R9-3, O-1, O-3).
const { INDIA_ONLY_WORDS, localTerms } = lib('terms.ts');

test('R9-1: US New debt / purchase strings go through the term helper', () => {
  assert.equal(localTerms('A LOAN OR EMI OFFER', 'US'), 'A LOAN OR PAY-OVER-TIME OFFER');
  assert.equal(localTerms('A LOAN OR EMI OFFER', 'IN'), 'A LOAN OR EMI OFFER');
  assert.equal(localTerms('Longer: lower EMI, more interest', 'US'), 'Longer: lower monthly payment, more interest');
  for (const s of ['EMI', 'after the EMI', 'saves in time, EMI under 40%', 'so the EMI fits', 'down payment + EMIs − tax saved', 'down payment + EMIs',
    "The EMI takes 30% of what's left each month; up to 40% is comfortable.", 'Shop EMI offer', 'The EMI doesn’t fit yet.'])
    assert.doesNotMatch(localTerms(s, 'US'), INDIA_ONLY_WORDS, s);
  // The New debt mode switch is rendered by a client component that knows the country.
  assert.match(src('app/tools/new-debt/page.tsx'), /current=\{mode === 'offer'\}><NewDebtOfferLabel \/><\/LBracket>/);
  assert.doesNotMatch(src('app/tools/new-debt/page.tsx'), />A LOAN OR EMI OFFER</);
  assert.match(src('app/tools/new-debt/mode-nav.tsx'), /\{newDebtOfferLabel\(profile\.user\.country\)\}/);
  assert.match(src('app/tools/purchase/tool.tsx'), /localTerms\('Longer: lower EMI, more interest', country\)/);
});

test('R9-1: no tool page a US borrower can open has a bare "EMI" string', () => {
  // India-only tools: Loan Check (countries: ['IN']) and NRI prepay (an Indian loan).
  const indiaOnly = /[\\/]tools[\\/](loan-check|nri-prepay)[\\/]/;
  // Constants that are put through localTerms where they are shown (checked below).
  const routedLater = [
    ['app/tools/new-debt/tool.tsx', "cant_afford: { text: 'The EMI doesn’t fit yet.'"],
    ['app/tools/new-debt/tool.tsx', "label: 'Shop EMI offer'"],
    ['app/tools/new-debt/mode-nav.tsx', "NEW_DEBT_OFFER_LABEL = 'A LOAN OR EMI OFFER'"],
  ];
  assert.match(src('app/tools/new-debt/tool.tsx'), /localTerms\(isCard && v\.verdict === 'take' \? 'Take the EMI offer\.' : VERDICT\[v\.verdict\]\.text, country\)/);
  assert.match(src('app/tools/new-debt/tool.tsx'), /LOAN_TYPE_OPTIONS\.map\(\(o0\) => \(\{ \.\.\.o0, label: localTerms\(o0\.label, country\) \}\)\)/);
  assert.match(src('app/tools/new-debt/mode-nav.tsx'), /return localTerms\(NEW_DEBT_OFFER_LABEL, country\)/);
  const helper = /localTerms\(|\bt\(|country === 'US'|isUS|paymentWords|currency === 'USD'/;
  const bare = [];
  const files = walk(path.join(root, 'app/tools')).filter((f) => /\.tsx?$/.test(f) && !indiaOnly.test(f));
  assert.ok(files.length >= 10, `scanned ${files.length} tool files`);
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\/?\*.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (!/\bEMIs?\b/.test(code) || !/['"`>]/.test(code)) return;
      if (helper.test(code)) return;
      if (routedLater.some(([file, text]) => file === rel && code.includes(text))) return;
      bare.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bare, []);
});

test('R9-2: a button’s spoken name starts with the words on it (WCAG 2.5.3)', () => {
  // <button aria-label=…>TEXT</button> and <LBracket label=…>TEXT</LBracket>
  // with plain visible words: the name must start with those words.
  const re = /<(button|LBracket|a|Link)\b((?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*?)>\s*([A-Za-z+][A-Za-z +’'·]*?)\s*<\/\1>/gs;
  const bad = [];
  let checked = 0;
  for (const f of walk(root).filter((x) => x.endsWith('.tsx'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(re)) {
      const lab = /(?:aria-label|\blabel)=(?:\{`([^`]*)`\}|"([^"]*)"|\{'([^']*)'\})/.exec(m[2]);
      if (!lab) continue;
      const name = (lab[1] ?? lab[2] ?? lab[3]).toLowerCase();
      const visible = m[3].replace(/\s+/g, ' ').trim().toLowerCase();
      if (!/[a-z]{2,}/.test(visible)) continue; // an icon ("i", "×") has no words to match
      checked++;
      if (!name.startsWith(visible)) bad.push(`${path.relative(root, f)}: [${m[3].trim()}] "${name}"`);
    }
  }
  assert.ok(checked >= 20, `checked ${checked}`);
  assert.deepEqual(bad, []);
  // R10-2: the regex above only sees plain-text children; it missed names
  // whose visible words sit in {cond ? 'A' : 'B'}, before a dynamic part
  // ("WHY {pct}? ↓"), next to symbols, or in nested elements (the payoff
  // medallion). The full scanner (tests/lib/label-in-name.cjs) checks those.
  const { scanApp } = require('./lib/label-in-name.cjs');
  const all = scanApp(root);
  assert.ok(all.length >= 50, `scanned ${all.length}`);
  assert.deepEqual(all.filter((r) => !r.ok).map((r) => `${r.file}:${r.line} [${r.visible}]`), []);
  // The Activity row buttons named in the re-test.
  const a = src('components/activity/ActivityPage.tsx');
  for (const l of ['label={`Edit ${what}`}', 'label={`Undo ${what}`}', 'label={`Undo spending for ${what}`}', 'label={`It held: ${r.target}`}', 'label={`It happened: ${r.target}`}'])
    assert.ok(a.includes(l), l);
  assert.doesNotMatch(a, /label=\{`(Change|Remove) /);
  // Home's MARK PAID / SET ASIDE buttons (conditional text, checked by hand).
  const p = src('components/home/PayThisMonth.tsx');
  assert.match(p, /`Set aside \$\{fmt\(row\.amount, row\.currency\)\}: \$\{row\.name\}`/);
  assert.match(p, /`Mark extra paid: \$\{row\.name\}/);
  assert.match(p, /`Mark paid: \$\{row\.name\}/);
});

// ─── R9-3 ────────────────────────────────────────────────────────────────
const { payThisMonth } = lib('pay-this-month.ts');
const { homeThisMonthLine } = lib('home-this-month.ts');

/** A seeded random number generator (mulberry32), so a failure replays. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A live plan whose first month pays exactly take-home less spending, split
 *  across loans in paise the way the engine does, less the set-aside. */
function makePlan(rand, n, { income, spend, ef = 0, goals = 0, country = 'IN', maxBal = 1.5e7 }) {
  const loans = [];
  const mins = {};
  const perLoan = {};
  const balances = {};
  let minSum = 0;
  for (let i = 0; i < n; i++) {
    const outstanding = Math.round(1 + rand() * maxBal);
    const min = Math.round(outstanding * (0.01 + rand() * 0.03) * 100 + rand() * 100) / 100 + 0.37;
    loans.push({ id: `l${i}`, loan_type: 'personal_loan', outstanding: String(outstanding), nominal_rate: '0.13', scheduled_emi: String(min), currency: country === 'US' ? 'USD' : 'INR' });
    mins[i] = String(min);
    minSum += min;
  }
  const available = income - spend;
  let extraPool = Math.max(0, available - minSum - ef - goals);
  // Split the extra over a few loans in paise.
  const takers = [...Array(n).keys()].filter(() => rand() < 0.4);
  if (takers.length === 0) takers.push(0);
  takers.forEach((i, k) => {
    const share = k === takers.length - 1 ? extraPool : Math.round(extraPool * rand() * 0.7 * 100) / 100;
    extraPool -= share;
    perLoan[i] = (perLoan[i] ?? 0) + share;
  });
  for (let i = 0; i < n; i++) {
    perLoan[i] = String(Number(mins[i]) + (perLoan[i] ?? 0));
    balances[i] = String(Math.max(1, Number(loans[i].outstanding) - Number(perLoan[i])));
  }
  return {
    live: true,
    user: { loans, country, monthly_income: String(income), fixed_expenses: String(spend), variable_expenses: '0' },
    monthlyPayments: [{ month: 1, perLoan, totalPaid: available - ef - goals }],
    trajectory: [{ month: 1, balancesByLoanIndex: balances }],
    firstMonthMinimums: mins,
    surplusAllocation: { efSlice: ef, goalSlice: goals, surplus: available - minSum, debtSlice: available - minSum - ef - goals },
    surplus: available - minSum,
    shortfall: 0,
    fxRatesUsed: {},
    debtBudget: '',
    minSum,
    available,
  };
}

test('R9-3: the 16-loan case: Home pays what is available, not ₹1 more, and the parts add up', () => {
  const rand = rng(916);
  const plan = makePlan(rand, 16, { income: 2500000, spend: 100000, maxBal: 2e6 });
  assert.ok(plan.minSum < plan.available && plan.minSum % 1 !== 0, `minimums ${plan.minSum}`);
  const d = payThisMonth(plan);
  const cashFlowDues = Math.round(plan.minSum);
  const cashFlowLeft = Math.round(plan.available - plan.minSum);
  assert.equal(d.duesUser, cashFlowDues);
  assert.ok(d.extraUser <= cashFlowLeft, `${d.extraUser} > ${cashFlowLeft}`);
  assert.equal(d.total, d.duesUser + d.extraUser);
  assert.ok(d.total <= plan.available);
  const money = (v) => `₹${Math.round(v)}`;
  const line = homeThisMonthLine(d, 0, money, 'IN').text;
  assert.match(line, new RegExp(`pay ₹${d.total}\\. Every EMI and card minimum \\(₹${d.duesUser}\\), plus ₹${d.extraUser} extra`));
  // Plan's TO DEBTS THIS MONTH reads the same parts.
  assert.match(src('components/plan/LedgerPlan.tsx'), /\(ptm \? ptm\.duesUser \+ ptm\.extraUser : undefined\)/);
});

test('R9-3 property: over random loan sets, Home’s this-month total never exceeds take-home less spending', () => {
  const rand = rng(20261014);
  let runs = 0;
  for (let k = 0; k < 400; k++) {
    const n = 1 + Math.floor(rand() * 20);
    const income = Math.round(50000 + rand() * 5e6);
    const maxBal = income * (0.5 + rand() * 2);
    const spend = Math.round(rand() * income * 0.3);
    const ef = rand() < 0.3 ? Math.round(rand() * 5000) : 0;
    const goals = rand() < 0.3 ? Math.round(rand() * 5000) : 0;
    const plan = makePlan(rand, n, { income, spend, ef, goals, maxBal, country: rand() < 0.2 ? 'US' : 'IN' });
    if (plan.available - plan.minSum - ef - goals < 0) continue; // a short month takes the shortfall path
    runs++;
    const d = payThisMonth(plan);
    if (!d) continue;
    const msg = `case ${k}: n=${n} income=${income} spend=${spend}`;
    assert.ok(Number.isInteger(d.total) && Number.isInteger(d.duesUser) && Number.isInteger(d.extraUser), msg);
    // Rounded once, like the cash flow (a .5 tie may go either way in floating point).
    assert.ok(Math.abs(d.duesUser - plan.minSum) <= 0.5 + 1e-6, `${msg}: dues ${d.duesUser} vs ${plan.minSum}`);
    const setAside = d.rows.filter((r) => r.loanIndex === null).reduce((s, r) => s + r.amountUser, 0);
    assert.equal(d.total, d.duesUser + d.extraUser + setAside, msg);
    assert.ok(d.total <= plan.available, `${msg}: total ${d.total} > available ${plan.available}`);
    // Home's cash flow LEFT (take-home − spending − rounded minimums) covers extra + set-aside.
    assert.ok(d.extraUser + setAside <= plan.available - d.duesUser, msg);
    const line = homeThisMonthLine(d, 0, (v) => `₹${v}`, 'IN');
    const paid = Number(/pay ₹(\d+)\./.exec(line.text)?.[1] ?? /, ₹(\d+)/.exec(line.text)?.[1]);
    assert.ok(paid <= plan.available, `${msg}: ${line.text}`);
  }
  assert.ok(runs >= 200, `ran ${runs}`);
});

test('O-3: once this month is logged, the Home strip says so instead of "pay ₹54,000"', () => {
  const { thisMonthProgress, progressLine } = lib('this-month-progress.ts');
  const rows = [
    { key: 'card', loanIndex: 0, minimum: 9000, amount: 48800, amountUser: 48800 },
    { key: 'pl', loanIndex: 1, minimum: 5200, amount: 5200, amountUser: 5200 },
  ];
  const money = (v) => `₹${v.toLocaleString('en-IN')}`;
  const PLAN = 'This month: pay ₹54,000. Every EMI and card minimum (₹14,200), plus ₹39,800 extra on your credit card.';
  const e = (loanIndex, kind, amount, scheduledEmi, date = '2026-10-07') => ({ id: `${loanIndex}${kind}`, loanIndex, kind, date, amount: String(amount), scheduledEmi: String(scheduledEmi) });
  // Nothing logged: the plan's own sentence stays.
  assert.equal(progressLine(thisMonthProgress(rows, [], [], '2026-10'), 54000, money, PLAN), PLAN);
  // Last month's entries don't count.
  assert.equal(progressLine(thisMonthProgress(rows, [e(1, 'paid_full', 5200, 5200, '2026-09-07')], [], '2026-10'), 54000, money, PLAN), PLAN);
  // One paid.
  const one = progressLine(thisMonthProgress(rows, [e(1, 'paid_full', 5200, 5200)], [], '2026-10'), 54000, money, PLAN);
  assert.equal(one, `${PLAN} ₹5,200 of it is logged as paid; ₹48,800 still to pay.`);
  // Both paid (the re-test's case).
  const both = thisMonthProgress(rows, [e(1, 'paid_full', 5200, 5200), e(0, 'paid_extra', 48800, 9000)], [], '2026-10');
  assert.equal(both.allPaid, true);
  assert.equal(progressLine(both, 54000, money, PLAN), 'This month: all paid, ₹54,000 logged. Nothing more is due until next month.');
  assert.doesNotMatch(progressLine(both, 54000, money, PLAN), /pay ₹54,000/);
  // A set-aside row counts once ticked.
  const withEf = [...rows, { key: 'ef', loanIndex: null, minimum: 0, amount: 1000, amountUser: 1000 }];
  assert.equal(thisMonthProgress(withEf, [e(1, 'paid_full', 5200, 5200), e(0, 'paid_extra', 48800, 9000)], [], '2026-10').allPaid, false);
  assert.equal(thisMonthProgress(withEf, [e(1, 'paid_full', 5200, 5200), e(0, 'paid_extra', 48800, 9000)], ['ef'], '2026-10').allPaid, true);
  // The strip is wired to it.
  assert.match(src('components/home/HomeDebtFree.tsx'), /<HomeThisMonth line=\{line\} progress=\{progress\} \/>/);
  assert.match(src('components/home/HomeThisMonth.tsx'), /setText\(progressLine\(p, total, money, line\.text\)\)/);
  assert.match(src('components/home/PayThisMonth.tsx'), /window\.dispatchEvent\(new Event\(SET_ASIDE_EVENT\)\)/);
});

test('O-1: an aborted /plan rates request is dropped quietly', () => {
  const { shouldReport } = lib('client-error.ts');
  assert.equal(shouldReport('AbortError', 'The operation was aborted.'), false);
  assert.equal(shouldReport('TypeError', 'Fetch API cannot load https://rightdue.app/api/rates/central due to access control checks.'), false);
  assert.equal(shouldReport('TypeError', 'Load failed'), false);
  assert.equal(shouldReport('TypeError', 'x is not a function'), true);
  const s = src('components/plan/RateDecisions.tsx');
  assert.match(s, /\.centralRates\(ctrl\.signal\)/);
  assert.match(s, /if \(ctrl\.signal\.aborted \|\| isAbortError\(e\)\) return;/);
  assert.match(s, /window\.addEventListener\('pagehide', stop\)/);
  // R10-3: the caller's signal and the page-wide one (lib/page-abort).
  assert.match(src('lib/api.ts'), /centralRates: \(signal\?: AbortSignal\) =>\n\s+pageScoped\(\(s\) => get<CentralRatesResponse>\('\/api\/rates\/central', s\), signal\)/);
});
