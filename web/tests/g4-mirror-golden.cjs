// Sprint G4: golden / differential tests for the TS mirrors (grill #41),
// the payoff-range copy (#24), the inflation line (#39) and the
// registry-linked constants (#35).
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
const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/mirror_cases.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/data_freshness.json'), 'utf8'));

test('differential: min-payment.ts matches engine/minimum_payments.py on every golden case', () => {
  const { explainMinPayment } = lib('min-payment.ts');
  assert.ok(cases.min_payment.length >= 100);
  const bad = [];
  for (const c of cases.min_payment) {
    const got = explainMinPayment(c.in, c.in.country);
    if (got.estimated !== c.out.estimated || got.source !== c.out.source) bad.push(`${JSON.stringify(c.in)}: TS ${got.estimated}/${got.source} vs engine ${c.out.estimated}/${c.out.source}`);
  }
  assert.deepEqual(bad, []);
});

test('differential: prepayment-fee.ts default matches engine/prepayment_fee.py for every type × rate × market', () => {
  const { prepaymentFeeDefault } = lib('prepayment-fee.ts');
  for (const c of cases.prepayment_fee_default) {
    const got = prepaymentFeeDefault(c.in.loan_type, c.in.rate_type, c.in.market);
    assert.equal(Number(got.pct), Number(c.out.pct), JSON.stringify(c.in));
    assert.equal(got.status, c.out.status, JSON.stringify(c.in));
    assert.equal(got.reason, c.out.reason, JSON.stringify(c.in));
  }
});

test('golden: seeded Monte Carlo is reproducible, and zero volatility is exact', () => {
  const { simulateMonteCarlo } = lib('monte-carlo.ts');
  const inp = { expectedReturn: 0.12, volatility: 0.18, years: 7, taxRate: 0.125, inflation: 0.04, trials: 2000, seed: 20261012 };
  const a = simulateMonteCarlo(inp);
  const b = simulateMonteCarlo(inp);
  assert.deepEqual(a.percentilesNominal, b.percentilesNominal);
  // Median after-tax return ≈ (exp(ln(1.12) − σ²/2) − 1) × (1 − tax): the analytic centre.
  const centre = (Math.exp(Math.log(1.12) - 0.5 * 0.18 * 0.18) - 1) * (1 - 0.125);
  assert.ok(Math.abs(a.percentilesNominal[50] - centre) < 0.01, `${a.percentilesNominal[50]} vs ${centre}`);
  assert.ok(a.percentilesNominal[5] < a.percentilesNominal[50] && a.percentilesNominal[50] < a.percentilesNominal[95]);
  const flat = simulateMonteCarlo({ ...inp, volatility: 0, trials: 10 });
  assert.ok(Math.abs(flat.percentilesNominal[50] - 0.12 * (1 - 0.125)) < 1e-12);
  assert.ok(Math.abs(flat.percentilesReal[50] - ((1 + 0.12 * 0.875) / 1.04 - 1)) < 1e-12);
});

test('#24: payoff range copy gives the exact month, the range and a reason per scenario', () => {
  const { rangeLabel, whyThisRange, RANGE_TERMS } = lib('payoff-range.ts');
  const r = {
    exact: 56, earliest: 53, latest: 57, has_floating: true, open_ended: false,
    scenarios: [
      { id: 'rate_down', label: 'Floating rates 1 point lower', why: 'x', debt_free_month: 54, shift_months: -2 },
      { id: 'rate_up', label: 'Floating rates 1 point higher', why: 'y', debt_free_month: 57, shift_months: 1 },
    ],
  };
  const start = new Date(Date.UTC(2026, 9, 1)); // Oct 2026 = month 1
  const l = rangeLabel(r, start);
  assert.equal(l.exact, 'May 2031');
  assert.equal(l.range, 'Feb–Jun 2031');
  const why = whyThisRange(r);
  assert.match(why[0], /2 months sooner/);
  assert.match(why[1], /1 month later/);
  assert.match(why.at(-1), /isn't a forecast/);
  assert.equal(rangeLabel({ ...r, latest: null, open_ended: true }, start).range, 'Feb 2031 or later');
  assert.equal(rangeLabel({ ...r, earliest: 56, latest: 56 }, start).range, null);
  for (const t of Object.values(RANGE_TERMS)) assert.match(t, /: /); // every term is explained
});

test('#39: the spending line says what the plan assumes, both ways', () => {
  const { spendingAssumptionLine, INFLATION_LONG_RUN } = lib('inflation-modeling.ts');
  assert.match(spendingAssumptionLine('off', '₹45,000'), /stays at ₹45,000 a month/);
  assert.match(spendingAssumptionLine('on', '₹45,000', '5.2'), /grows 5.2% a year/);
  assert.doesNotMatch(spendingAssumptionLine('on', '₹45,000'), / % /);
  assert.equal(INFLATION_LONG_RUN.IN.rate, '0.04');
  assert.equal(INFLATION_LONG_RUN.US.rate, '0.02');
});

test('#35: constants that quote a dated figure agree with the freshness registry', () => {
  const { INFLATION_LONG_RUN } = lib('inflation-modeling.ts');
  const { REMITTANCE_REFERENCE } = lib('payoff-range.ts');
  const by = Object.fromEntries(registry.entries.map((e) => [e.id, e]));
  assert.equal(Number(by.inflation_long_run_in.value), Number(INFLATION_LONG_RUN.IN.rate));
  assert.equal(Number(by.inflation_long_run_us.value), Number(INFLATION_LONG_RUN.US.rate));
  assert.equal(Number(by.remittance_cost_us_in.value), Number(REMITTANCE_REFERENCE.rate));
  assert.equal(by.remittance_cost_us_in.url, REMITTANCE_REFERENCE.url);
});

test('differential: goal-line.ts funding rules match engine/goals.py serial_fill_allocation (first month)', () => {
  const { firstMonthContribution } = lib('goal-line.ts');
  assert.ok(cases.goal_rule.length >= 60);
  const kinds = new Set(cases.goal_rule.map((c) => c.in.rule.kind));
  assert.deepEqual([...kinds].sort(), ['fixed', 'schedule', 'surplus_pct']);
  for (const c of cases.goal_rule) {
    const got = firstMonthContribution(c.in.rule, Number(c.in.remaining), c.in.months, Number(c.in.spare));
    assert.ok(Math.abs(got - Number(c.out.amount)) < 0.01, `${JSON.stringify(c.in)}: TS ${got} vs engine ${c.out.amount}`);
  }
});

test('goal-line: a fixed amount too small for the date is SHORT and shows the fixed amount', () => {
  const { goalLine, goalContext } = lib('goal-line.ts');
  const today = new Date('2026-10-07T04:30:00Z');
  const goal = { id: 'g1', name: 'Car', kind: 'custom', targetMonth: '2027-10', amount: '600000', bufferPct: '0', fundingSources: ['surplus'], status: 'active', fundingRule: { kind: 'fixed', amount: '10000' } };
  const user = { country: 'IN', currency: 'INR', monthly_income: '150000', fixed_expenses: '50000', variable_expenses: '0', loans: [], assets: [], efund_balance: '0', efund_target: '0' };
  const ctx = goalContext({ goals: [goal], saved: {}, user, today, indicativeRate: 0.1 });
  const line = goalLine(goal, 0, ctx);
  assert.equal(line.monthly, 10000);
  assert.equal(line.state, 'short');
});

test('#24: the Home range words read the engine edges, and say nothing when there is no range', () => {
  const src = fs.readFileSync(path.join(root, 'components/home/HomeDebtFreeRange.tsx'), 'utf8');
  assert.match(src, /api\.sensitivityRange\(plan\.runArgs\)/);
  assert.match(src, /WHY THIS RANGE/);
  const apiSrc = fs.readFileSync(path.join(root, 'lib/api.ts'), 'utf8');
  assert.match(apiSrc, /'\/api\/sensitivity\/range'/);
});
