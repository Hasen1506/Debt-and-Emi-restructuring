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
  assert.match(read('components/plan/load-plan.ts'), /infeasibleFrom: scenario\.infeasible_from_month/);
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
