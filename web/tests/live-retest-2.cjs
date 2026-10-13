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

test('R2-1: an unreadable rate is not 0% and gets an inline error', () => {
  const { deriveTenureMonths } = lib('derived.ts');
  assert.equal(deriveTenureMonths('2500000', '', '22000'), null);
  assert.equal(deriveTenureMonths('2500000', '8.5x', '22000'), null);
  const at85 = deriveTenureMonths('2500000', '0.085', '22000');
  assert.ok(at85 > 200, `8.5% should be ~236 months, got ${at85}`);
  // An explicit 0 (interest-free) is still pure division.
  assert.equal(deriveTenureMonths('2500000', '0', '22000'), 114);
  const { percentTextToFraction } = require(path.join(root, 'components', 'ToolPrimitives.tsx'));
  assert.equal(percentTextToFraction('8.5x'), null);
  assert.match(src('components/ToolPrimitives.tsx'), /isn’t a valid rate\. Type it like 8\.5/);
});

test('R2-3: the tenure what-if only talks about a gap when the plan is short', () => {
  const { tenureWhatIfCopy } = lib('tenure-whatif-copy.ts');
  const money = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const noGap = tenureWhatIfCopy({ baselineShortfall: 0, scenarioShortfall: 0, freed: 1622, extraInterest: -25507, neverClears: false, scenarioNeverClears: false, money });
  assert.equal(noGap.gap, null);
  assert.doesNotMatch(noGap.interest, /gap/i);
  assert.match(noGap.interest, /₹1,622 a month the lower EMI frees/);
  const short = tenureWhatIfCopy({ baselineShortfall: 12500, scenarioShortfall: 0, freed: 1622, extraInterest: -25507, neverClears: false, scenarioNeverClears: false, money });
  assert.equal(short.gap, 'This month’s gap closes.');
  assert.match(short.interest, /gap borrowing/);
  const still = tenureWhatIfCopy({ baselineShortfall: 12500, scenarioShortfall: 10000, freed: 2500, extraInterest: 5000, neverClears: false, scenarioNeverClears: false, money });
  assert.match(still.gap, /still be short ₹10,000/);
  assert.doesNotMatch(src('components/plan/TenureWhatIf.tsx'), /gapAfter <= 0\.5 \?/);
});
