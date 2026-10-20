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

// UX50 round, fix agent F2 (Setup, Home, Plan): ux50/B.md.


// Live re-test 6B fix round (R6B-1..9).

test('R6B-1: Setup step 3 shows no crore-scale interest when the gap borrowing runs away', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /gapRunsAway = short && (plan\.debt_free_month|shownDebtFreeMonth\(plan\)) == null/);
  assert.match(qs, /\['Interest you’ll pay', '—', 'the gap borrowing keeps growing'\]/);
  assert.match(qs, /'doesn’t clear at these figures'/);
  assert.match(qs, /saneCap\(owedToday\)/);
  // Plan says the same.
  assert.match(src('components/plan/LedgerPlan.tsx'), /THE GAP BORROWING KEEPS GROWING/);
  // The cap Setup uses: 100x what's owed today (₹3.5 crore on ₹2 lakh is above it).
  const g = lib('plan-gap.ts');
  assert.ok(35552632 > g.saneCap(200000));
});

test('Setup step 1 warns when spending exceeds take-home', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /data-testid="spend-over-income"/);
  assert.match(qs, /leftBeforeEmis && leftBeforeEmis\.lt\(0\) && \(/);
  assert.match(qs, /a month more than you take home/);
});

test('R6B-2: what-if boxes use the shared amount parser with inline errors', () => {
  const r = lib('r6b-inputs.ts');
  assert.deepEqual(r.parseWhatIfBox('5L', 'integer', 'INR', 0, 1e7), { value: 500000, error: null, note: null });
  assert.equal(r.parseWhatIfBox('₹2,00,000', 'integer', 'INR', 0, 1e7).value, 200000);
  assert.equal(r.parseWhatIfBox('1.5 cr', 'integer', 'INR', 0, 1e8).value, 15000000);
  const bad = r.parseWhatIfBox('abc', 'integer', 'INR', 0, 1e7);
  assert.equal(bad.value, null);
  assert.match(bad.error, /Type a number/);
  assert.match(r.parseWhatIfBox('-5000', 'integer', 'INR', 0, 1e7).error, /negative/);
  assert.match(r.parseWhatIfBox('1e9', 'integer', 'INR', 0, 1e7).error, /Type a number/);
  const capped = r.parseWhatIfBox('5 cr', 'integer', 'INR', 0, 1e7);
  assert.equal(capped.value, 1e7);
  assert.match(capped.note, /Kept within/);
  assert.equal(r.parseWhatIfBox('', 'integer', 'INR', 0, 1e7).value, 0);
  assert.equal(r.parseWhatIfBox('-25', 'bps', 'INR', -200, 200, 25).value, -25);
  // A typed rate change stays exact. The slider step must not rewrite it.
  assert.equal(r.parseWhatIfBox('30', 'bps', 'INR', -200, 300, 5).value, 30);
  assert.equal(r.parseWhatIfBox('10', 'bps', 'INR', -200, 300, 25).value, 10);
  assert.equal(r.parseWhatIfBox('30', 'bps', 'INR', -200, 300, 5).note, null);
  assert.match(r.parseWhatIfBox('5x', 'bps', 'INR', -200, 200, 25).error, /basis points/);
  const w = src('components/WhatIfPanel.tsx');
  assert.match(w, /parseWhatIfBox\(raw, mode, currency, min, max, step\)/);
  assert.match(w, /aria-invalid=\{boxError \? true : undefined\}/);
  assert.match(w, /data-testid="whatif-box-error"/);
  // The old silent path ("abc" → 0) is gone.
  assert.doesNotMatch(w, /raw\.replace\(\/\[\^\\d\.-\]\/g, ''\)/);
});

test('R6B-3: years held is whole years from 1 to 100, with a field error', () => {
  const r = lib('r6b-inputs.ts');
  for (const ok of ['1', '5', '100']) assert.equal(r.yearsHeldError(ok), null, ok);
  for (const bad of ['0', '-3', '2.5', '101', '500', '1e3', 'abc']) assert.ok(r.yearsHeldError(bad), bad);
  assert.match(src('app/tools/invest-vs-prepay/tool.tsx'), /error=\{rateErrors\.years\}/);
});

test('R6B-4: one inflation range for the field and the sim; the note names only the bad field', () => {
  const r = lib('r6b-inputs.ts');
  assert.equal(r.inflationError('0'), null);
  assert.equal(r.inflationError('6.5'), null);
  assert.ok(r.inflationError('-5'));
  assert.ok(r.inflationError('101'));
  assert.ok(r.inflationError('abc'));
  // Bad inflation only: the note doesn't blame the years.
  assert.doesNotMatch(r.mcNote('5', '-5'), /years/);
  assert.match(r.mcNote('5', '-5'), /Prices rise a year/);
  // Bad years only: the note doesn't blame inflation.
  assert.doesNotMatch(r.mcNote('0', '6'), /Prices rise/);
  assert.match(r.mcNote('0', '6'), /years held/);
  assert.equal(r.mcNote('5', '6'), '');
  const t = src('app/tools/invest-vs-prepay/tool.tsx');
  assert.match(t, /inflation: swings \? inflationError\(inflationPct\) : null/);
  assert.doesNotMatch(t, /min: -50, what: 'Inflation'/);
});

test('R6B-5: Setup shows the tax bracket to one decimal', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /Tax bracket \{formatTaxRate\(rate\)\}/);
  assert.doesNotMatch(qs, /Tax bracket \{\(Number\(rate\) \* 100\)\.toFixed\(0\)\}/);
  assert.equal(lib('tax-profile.ts').formatTaxRate('0.312'), '31.2%');
});

test('R6B-6: Home and the 404 have their own titles', () => {
  assert.match(src('app/page.tsx'), /title: 'Home · RightDue'/);
  assert.match(src('app/not-found.tsx'), /title: 'Page not found · RightDue'/);
});

test('R6B-7: an out-of-range APR is marked before Continue and summarised as out of range', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /issues=\{showErrors \? issuesOf\(l\) : rateRangeOnly\(l\)\}/);
  const g = lib('loan-gaps.ts');
  assert.ok(g.rateOutOfRange('-0.42'));
  assert.ok(g.rateOutOfRange('42'));
  assert.match(g.setupSummaryLine({ emiTooSmall: false, missing: false, fx: false, invalid: true, outOfRange: true }), /out of range/);
  assert.match(g.setupSummaryLine({ emiTooSmall: false, missing: false, fx: false, invalid: true }), /isn’t a valid number/);
  assert.match(
    g.setupSummaryLine({ emiTooSmall: true, missing: false, fx: false, invalid: true, outOfRange: true }),
    /one rate is out of range/,
  );
});

test('R6B-8: Loan Check rate fields carry their own error (aria-invalid / aria-describedby)', () => {
  const t = src('app/tools/loan-check/tool.tsx');
  for (const [k, p] of [['currentRate', 'pCurrent'], ['startRate', 'pStart'], ['startBench', 'pBench'], ['startSpread', 'pSpread']]) {
    assert.ok(t.includes(`error={at('${k}') ?? ${p}.error}`), k);
    assert.ok(t.includes(`<RateProblem parsed={${p}} onFix=`) && t.includes('fixOnly />'), k);
  }
});

test('R6B-9: choosing a strategy offline saves it, says so, and refreshes on reconnect', () => {
  const h = src('components/useStrategyRefresh.tsx');
  assert.match(h, /addEventListener\('online'/);
  // A probe of a static file decides, since navigator.onLine isn't reliable everywhere.
  assert.match(h, /fetch\(PROBE, \{ method: 'HEAD', cache: 'no-store' \}\)/);
  assert.match(h, /data-testid="strategy-offline-note"/);
  const s = src('components/StrategySwitcher.tsx');
  assert.match(s, /useStrategyRefresh\(\)/);
  assert.match(s, /<OfflineStrategyNote\s+show=\{offline\}/);
  assert.doesNotMatch(s, /router\.refresh\(\)/);
  assert.match(s, /writeStrategyClient\(s\)/);
  // The masthead and Profile show the saved order; they do not write it.
  for (const f of ['components/chrome/PayoffOrderSwitch.tsx', 'components/personas/StrategyTriptych.tsx']) {
    const summary = src(f);
    assert.doesNotMatch(summary, /writeStrategyClient/, f);
    assert.doesNotMatch(summary, /useStrategyRefresh/, f);
  }
  const m = require(path.join(root, 'components/useStrategyRefresh.tsx'));
  assert.equal(m.isOfflineNow({ onLine: false }), true);
  assert.equal(m.isOfflineNow({ onLine: true }), false);
  assert.equal(m.isOfflineNow(undefined), false);
});

test('UX50 C-16: Loan check links to the KFS import beside the starting rate', () => {
  const t = src('app/tools/loan-check/tool.tsx');
  assert.match(t, /data-testid="loan-check-import-link"/);
  assert.match(t, /href="\/profile\?step=loans"/);
  assert.ok(t.indexOf('loan-check-import-link') < t.indexOf('label="The rate it started at"'));
});
