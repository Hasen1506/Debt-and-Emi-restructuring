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

// Live re-test 2, 13 Oct 2026 (LIVE-RETEST-2-2026-10-13.md).

test('NEW-2: a never-clearing schedule stops at the horizon and never prints a runaway figure', () => {
  const { scheduleStop, boundedMoney, saneCap, scheduleStopLine, NEVER_CLEARS_HORIZON } = lib('plan-gap.ts');
  const owed = 3_050_000;
  // Persona B: loans clear at year 30 but gap borrowing compounds forever.
  const rows = Array.from({ length: 1200 }, (_, i) => ({
    mo: i + 1,
    balance: Math.max(0, owed - i * 9000),
    gapDebt: 12_500 * Math.pow(1.04, i),
  }));
  const s = scheduleStop({ rows, owedToday: owed, cut: { month: 360, growsWithoutLimit: false } });
  assert.ok(s.lastMonth !== null && s.lastMonth <= NEVER_CLEARS_HORIZON);
  const cap = saneCap(owed);
  for (const r of rows.filter((r) => r.mo <= s.lastMonth)) assert.ok(r.balance + r.gapDebt <= cap);
  // It grows past 100x before month 360 here, so it says "without limit".
  assert.equal(s.growsWithoutLimit, true);
  assert.match(scheduleStopLine(true, 'MAR 2031'), /GROWS WITHOUT LIMIT.*STOPS AT MAR 2031/);
  assert.match(scheduleStopLine(false, 'SEP 2056'), /DOESN’T CLEAR IN 30 YEARS/);
  // A plan that clears is shown whole.
  const ok = rows.slice(0, 80).map((r) => ({ ...r, gapDebt: 0 }));
  assert.deepEqual(scheduleStop({ rows: ok, owedToday: owed, cut: null }), { lastMonth: null, growsWithoutLimit: false });
  // An older API with no cut still can't print a 30-digit figure.
  assert.ok(scheduleStop({ rows, owedToday: owed, cut: null }).lastMonth < 1200);
  assert.equal(boundedMoney(1.5e25, cap, String), 'KEEPS GROWING');
  assert.equal(boundedMoney(1000, cap, (v) => `₹${v}`), '₹1000');
});

test('NEW-2: the schedule uses the stop and the bounded cells', () => {
  const s = src('components/plan/PlanSchedule.tsx');
  assert.match(s, /scheduleStop\(/);
  assert.match(s, /cell\(gapMonths\[r\.mo\]\.debt\)/);
  assert.doesNotMatch(s, /fc\(gapMonths\[r\.mo\]\.debt/);
});
