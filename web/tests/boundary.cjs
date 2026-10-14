// Audit 80 E19 (W9): the boundary parsers accept what the API really sends,
// and reject the drifts that turn into silent wrong numbers.
// Samples: api/tests/fixtures/api_response_samples.json, written by
// scripts/export_api_samples.py and kept current by
// api/tests/test_property_schema_roundtrip.py::test_api_samples_are_current.
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
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    module._compile(output, file);
  };
const b = require(path.join(root, 'lib', 'boundary.ts'));
const samples = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../api/tests/fixtures/api_response_samples.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

test('every real API sample passes its parser (strict)', () => {
  const keys = Object.keys(samples);
  assert.ok(keys.length >= 6, 'samples for IN and US on three endpoints');
  for (const k of keys) {
    const contract = k.endsWith('/api/sensitivity/compare') ? 'compare' : 'simulate';
    assert.deepEqual(b.problemsIn(contract, samples[k]), [], k);
  }
});

test('a parser returns the very same value (it never reshapes data)', () => {
  const v = samples['IN /api/simulate'];
  assert.equal(b.parseSimulateResponse('/api/simulate', v, { strict: true }), v);
  const c = samples['US /api/sensitivity/compare'];
  assert.equal(b.parseCompareResponse(c, { strict: true }), c);
});

test('drifts that become silent wrong numbers are caught', () => {
  const base = samples['IN /api/simulate'];
  const drifts = {
    'Decimal sent as a JSON number': (r) => { r.total_interest_paid = 1234.5; },
    'renamed field': (r) => { r.total_interest = r.total_interest_paid; delete r.total_interest_paid; },
    'trajectory row lost its balance': (r) => { delete r.trajectory[0].balance; },
    'month index as text': (r) => { r.trajectory[1].month = '2'; },
    'debt-free month as text': (r) => { r.debt_free_month = '8'; },
    'NaN-ish decimal': (r) => { r.total_invested = 'NaN'; },
    'per-loan payment as number': (r) => { r.trajectory[0].payments_by_loan_index = { 0: 100 }; },
  };
  for (const [name, mutate] of Object.entries(drifts)) {
    const r = clone(base);
    mutate(r);
    assert.ok(b.problemsIn('simulate', r).length > 0, name);
    assert.throws(() => b.parseSimulateResponse('/api/simulate', r, { strict: true }), b.BoundaryError, name);
  }
});

test('optional fields may be absent or null where the API allows it', () => {
  const r = clone(samples['US /api/simulate']);
  for (const k of ['never_clears', 'surplus_allocation', 'goal_finals', 'gap_closed', 'gap_rate', 'trajectory_cut_month']) delete r[k];
  r.debt_free_month = null;
  assert.deepEqual(b.problemsIn('simulate', r), []);
});

test('soft mode reports once per endpoint and still returns the value', () => {
  const seen = [];
  const orig = console.error;
  console.error = (m) => seen.push(String(m));
  try {
    const r = clone(samples['US /api/baseline']);
    r.total_interest_paid = 5;
    assert.equal(b.parseSimulateResponse('/api/test-soft', r), r);
    b.parseSimulateResponse('/api/test-soft', r);
  } finally {
    console.error = orig;
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /test-soft.*total_interest_paid should be a decimal string/);
});

test('auth user contract', () => {
  assert.deepEqual(b.problemsIn('auth_user', { id: 'u1', email: 'a@b.c', display_name: null }), []);
  assert.ok(b.problemsIn('auth_user', { id: 1, email: 'a@b.c' }).length);
});
