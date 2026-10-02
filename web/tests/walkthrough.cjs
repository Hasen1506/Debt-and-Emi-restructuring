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
  assert.equal(INFLATION_FORECAST.IN.rate, '0.050');
  assert.equal(inflationRateFor('IN', ''), '0.050');
  assert.equal(inflationRateFor('US', ''), INFLATION_FORECAST.US.rate);
  assert.equal(normalizeInflationRate('0.07'), '0.07');
  assert.equal(inflationRateFor('IN', normalizeInflationRate('0.07')), '0.07');
  // 0% is a choice, not "unset".
  assert.equal(normalizeInflationRate('0'), '0');
  assert.equal(inflationRateFor('IN', '0'), '0');
  for (const bad of ['0.3', '-0.01', 'abc', '']) assert.equal(normalizeInflationRate(bad), '');
});
