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
const yaml = fs.readFileSync(path.resolve(__dirname, '../../render.yaml'), 'utf8');

// Live re-test 3, 13 Oct 2026 (LIVE-RETEST-3-2026-10-13.md).

test('R3-1: the what-if keeps "minimums never clear" when the plan never clears', () => {
  const { planWithWhatIf, minimumsClearMonth } = lib('trajectory.ts');
  // The plan's own trajectory is cut at month 180; the minimums never clear.
  const trajectory = Array.from({ length: 180 }, (_, i) => ({
    month: i + 1, avalanche: 3_000_000 + i * 1000, minimums: 3_000_000 + i * 1000, gapDebt: 10_000 * (i + 1), minimumsGapDebt: 10_000 * (i + 1),
  }));
  const plan = {
    trajectory, debtFreeMonth: null, baselineNeverClears: true, gap: null, monthlyPayments: [],
    user: { country: 'IN', loans: [{ loan_type: 'home_loan', scheduled_emi: '22000' }] },
  };
  assert.equal(minimumsClearMonth(plan.trajectory, plan.baselineNeverClears), null);
  // The what-if runs longer than the plan's cut trajectory (240 months).
  const r = {
    scenario_trajectory: Array.from({ length: 240 }, (_, i) => ({ month: i + 1, balance: String(3_000_000 - i * 100), interest_paid: '0' })),
    scenario_debt_free_month: null, scenario_trajectory_cut_month: 240, scenario_grows_without_limit: false, tenure_new_emi: '20378',
  };
  const w = planWithWhatIf(plan, r, 0);
  assert.ok(w && w.trajectory.length === 240);
  // Months past the plan's cut carry its last minimums, never 0.
  assert.ok(w.trajectory.slice(180).every((p) => p.minimums === trajectory[179].minimums));
  assert.equal(minimumsClearMonth(w.trajectory, w.baselineNeverClears), null);
  // Even without the engine's flag, a minimums line still owing at its end never clears.
  assert.equal(minimumsClearMonth(w.trajectory, false), null);
  // A minimums line that does reach 0 gives its month.
  const clears = [{ month: 1, minimums: 100 }, { month: 2, minimums: 50 }, { month: 3, minimums: 0 }, { month: 4, minimums: 0 }];
  assert.equal(minimumsClearMonth(clears, false), 3);
  // The chart's line, note and screen-reader summary all use it.
  const chart = src('components/plan/PlanTrajectory.tsx');
  assert.match(chart, /minimumsClearMonth\(traj, plan\.baselineNeverClears\)/);
  assert.match(chart, /Paying only the minimums never clears it\./);
});

test('R3-2: New Debt Check shows no bank figures for an invalid tenure, and never negative interest', () => {
  const { bankEstimate } = lib('new-debt-estimate.ts');
  for (const months of [0, -1, 481, 600, 6016, 2.5, NaN]) {
    const e = bankEstimate(300_000, 0.12, months);
    assert.equal(e.valid, false, String(months));
    assert.equal(e.emi, 0);
    assert.equal(e.interest, 0);
  }
  assert.equal(bankEstimate(0, 0.12, 60).valid, false);
  for (const months of [1, 3, 60, 480]) {
    for (const rate of [0, 0.0001, 0.12, 0.42]) {
      const e = bankEstimate(300_000, rate, months);
      assert.ok(e.valid && e.emi > 0 && e.interest >= 0, `${months} ${rate}`);
      assert.ok(e.interest <= e.emi * months);
    }
  }
  const { tenureError } = lib('tenure-rules.ts');
  assert.ok(tenureError('personal_loan', '0'));
  assert.ok(tenureError('personal_loan', '6016'));
  assert.equal(tenureError('personal_loan', '60'), null);
  const tool = src('app/tools/new-debt/tool.tsx');
  assert.match(tool, /showMoney=\{Number\(loanAmount\) > 0 && tenureOk\}/);
  assert.match(tool, /error=\{tenureLive \?\? at\('tenure'\)\}/);
});

test('R3-3: Invest or prepay rate fields say "isn’t a valid rate" and refuse out-of-range rates', () => {
  const { percentTextError, unreadableRateError } = require(path.join(root, 'components', 'ToolPrimitives.tsx'));
  assert.match(percentTextError('abc'), /“abc” isn’t a valid rate\. Type it like 8\.5/);
  assert.match(percentTextError('8.5x'), /isn’t a valid rate/);
  assert.equal(unreadableRateError('8.5x'), percentTextError('8.5x'));
  assert.match(percentTextError('500', { what: 'A loan rate' }), /above 100%/);
  assert.match(percentTextError('-3', { what: 'A tax rate' }), /can’t be negative/);
  for (const ok of ['', '8.', '8.5', '15.6', '100', '0']) assert.equal(percentTextError(ok), null, ok);
  assert.equal(percentTextError('-20', { min: -99 }), null);
  assert.match(percentTextError('600', { max: 500 }), /above 500%/);
  const tool = src('app/tools/invest-vs-prepay/tool.tsx');
  // R6B-3 (live re-test 6B): years held gained its own field error, so six
  // fields now carry one (stricter than the five before).
  assert.equal((tool.match(/error=\{rateErrors\./g) || []).length, 6);
});

test('NEW-18: Invest or prepay pre-fills the tax rate as formatTaxRate does and computes with the exact rate', () => {
  const { formatTaxRate } = lib('tax-profile.ts');
  assert.equal(formatTaxRate('0.156').replace(/%$/, ''), '15.6');
  const tool = src('app/tools/invest-vs-prepay/tool.tsx');
  assert.doesNotMatch(tool, /marginalRate \?\? 0\.3\) \* 100\)\.toFixed\(0\)/);
  assert.match(tool, /formatTaxRate\(profile\.marginalRate/);
  assert.match(tool, /marginalPct\.trim\(\) === profileMarginal \? D\(exactMarginalPct\)/);
  assert.match(tool, /v: formatTaxRate\(result\.taxRate\)/);
});

test('R3-4: Setup says a rate is not valid, not "missing a number"', () => {
  const { setupSummaryLine } = lib('loan-gaps.ts');
  const f = (o) => setupSummaryLine({ emiTooSmall: false, missing: false, fx: false, invalid: false, ...o });
  assert.match(f({ invalid: true }), /rate isn’t a valid number/);
  assert.doesNotMatch(f({ invalid: true }), /missing/);
  assert.match(f({ missing: true }), /missing a number/);
  assert.match(f({ emiTooSmall: true }), /EMI is too small/);
  assert.match(f({ invalid: true, missing: true }), /one rate isn’t a valid number, and some are missing a number/);
  assert.match(f({ emiTooSmall: true, missing: true }), /one EMI is too small to pay it off, and some are missing a number/);
  assert.match(f({ emiTooSmall: true, invalid: true, missing: true }), /EMI.*, one rate.*, and some are missing/);
  assert.match(f({ fx: true }), /exchange rate/);
  const setup = src('components/setup/QuickSetup.tsx');
  assert.match(setup, /onUnreadable=/);
  assert.match(setup, /invalid: summaryFlags\.some/);
});

test('R3-5: the open mobile menu keeps every item left-aligned', () => {
  const mh = src('components/ledger/LMasthead.tsx');
  assert.match(mh, /\[data-open="true"\]\{display:flex !important;flex-direction:column !important;align-items:flex-start !important/);
});

test('NEW-19: Render checks health on a Next.js route that never proxies to FastAPI', () => {
  assert.match(yaml, /^\s+healthCheckPath: \/api\/healthz\s*$/m);
  const route = src('app/api/healthz/route.ts');
  assert.match(route, /export const dynamic = 'force-static'/);
  assert.doesNotMatch(route, /fetch\(|API_INTERNAL_URL|127\.0\.0\.1/);
});
