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
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    module._compile(output, file);
  };
const lib = (name) => require(path.join(root, 'lib', name));

function withSession(fn) {
  const store = new Map();
  global.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
  try { fn(); } finally { delete global.window; }
}

test('Profile offers a way back to the page it was opened from', () => {
  const { recordPage, previousPage, pageName } = lib('nav-trail.ts');
  withSession(() => {
    recordPage('/plan');
    recordPage('/profile?step=income&focus=hike');
    assert.deepEqual(previousPage('/profile'), { href: '/plan', name: 'Plan' });
    // Moving between parts of Profile is not a new page.
    recordPage('/profile');
    assert.deepEqual(previousPage('/profile'), { href: '/plan', name: 'Plan' });
  });
  withSession(() => {
    recordPage('/tools/windfall');
    recordPage('/profile');
    assert.equal(previousPage('/profile').name, 'Spare cash');
  });
  // Opened straight from a bookmark: no back link.
  withSession(() => {
    recordPage('/profile');
    assert.equal(previousPage('/profile'), null);
  });
  // Storage blocked: no crash, no link.
  global.window = { sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } };
  try {
    recordPage('/plan');
    assert.equal(previousPage('/profile'), null);
  } finally { delete global.window; }
  assert.equal(pageName('/'), 'Home');
  assert.equal(pageName('/goals'), 'Goals and tools');
});

test("Activity asks for the plan's payment, as Home does, and records it", () => {
  const { buildHistory } = require(path.join(root, 'components/activity/history.ts'));
  const card = { id: 'c', loan_type: 'credit_card', bank: '', outstanding: '80000', nominal_rate: '0.42', scheduled_emi: '0' };
  const user = { country: 'IN', loans: [card], fixed_expenses: '0' };
  const due = (planPay) => buildHistory({ user, entries: [], spend: [], life: [], today: '2026-10-02', planPay })[0].rows[0];
  const withPlan = due({ 0: { amount: 80500, minimum: 4000, extra: 76500 } });
  assert.equal(withPlan.planned, '₹80,500');
  assert.match(withPlan.note, /₹4,000 minimum \+ ₹76,500 extra/);
  assert.deepEqual(
    { amount: withPlan.ref.amount, minimum: withPlan.ref.minimum, extra: withPlan.ref.extra },
    { amount: '80500', minimum: '4000.00', extra: '76500' },
  );
  // No plan run: the minimum, and no claim about the plan's extra.
  const without = due(undefined);
  assert.equal(without.planned, '₹4,000');
  assert.equal(without.ref.extra, undefined);
});

test('Rising costs: the forecast unless the user sets a rate from 0 to 25%', () => {
  const { normalizeInflationRate, inflationRateFor, INFLATION_FORECAST } = lib('inflation-modeling.ts');
  const market = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'market-data.json'), 'utf8'));
  assert.equal(INFLATION_FORECAST.IN.rate, market.inflation.IN.rate);
  assert.equal(inflationRateFor('IN', ''), market.inflation.IN.rate);
  assert.equal(inflationRateFor('US', ''), INFLATION_FORECAST.US.rate);
  assert.equal(normalizeInflationRate('0.07'), '0.07');
  assert.equal(inflationRateFor('IN', normalizeInflationRate('0.07')), '0.07');
  // 0% is a choice, not "unset".
  assert.equal(normalizeInflationRate('0'), '0');
  assert.equal(inflationRateFor('IN', '0'), '0');
  for (const bad of ['0.3', '-0.01', 'abc', '']) assert.equal(normalizeInflationRate(bad), '');
});

test('Setup estimates the same tax rate Profile works out (slab, surcharge, cess, 87A)', () => {
  const { marginalRateFromTakeHome } = lib('quick-setup.ts');
  const { deriveMarginalRate } = lib('deductions.ts');
  for (const takeHome of ['60000', '150000', '400000']) {
    const est = marginalRateFromTakeHome(takeHome, 'IN', 'salaried', 'new', undefined);
    const profile = deriveMarginalRate({ grossAnnual: est.gross, country: 'IN', taxRegime: 'new', incomeType: 'salaried' });
    assert.equal(est.rate, profile.toNumber(), `take-home ${takeHome}`);
  }
  // ₹1.5 lakh a month: the 20% slab plus 4% cess, not a bare 20%.
  assert.equal(marginalRateFromTakeHome('150000', 'IN', 'salaried', 'new', undefined).rate, 0.208);
  // ₹60,000 a month is within the 87A rebate: no tax on the next rupee.
  assert.equal(marginalRateFromTakeHome('60000', 'IN', 'salaried', 'new', undefined).rate, 0);
});

test('Safe rates are the dated quotes in market-data.json', () => {
  const { SAFE_RATES } = lib('invest-vs-prepay.ts');
  const market = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'market-data.json'), 'utf8'));
  for (const [key, r] of Object.entries(SAFE_RATES)) {
    assert.equal(r.rate, market.safe[key].rate, key);
    assert.equal(r.asOf, market.safe[key].as_of, key);
    assert.match(r.asOf, /^20\d\d-\d\d(-\d\d)?$/, key);
    assert.ok(Number(r.rate) > 0 && Number(r.rate) < 0.15, key);
  }
  // FDs compound quarterly; Treasury interest is free of state tax.
  assert.equal(SAFE_RATES.fd_in.compounding, 'quarterly');
  assert.equal(SAFE_RATES.treasury_us.tax.share, 0.8);
});
