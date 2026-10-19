const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));

test('a windfall slider gives the difference to the cushion and takes it back', () => {
  const { rebalanceCushion } = lib('windfall-split.ts');
  const up = rebalanceCushion({ ef: 20000, home: 80000 }, 'home', 90000, 200000, 100000, 'ef', 30000);
  assert.equal(up.home, 90000);
  assert.equal(up.ef, 10000);
  const down = rebalanceCushion(up, 'home', 50000, 200000, 100000, 'ef', 30000);
  assert.equal(down.home, 50000);
  assert.equal(down.ef, 30000);
  const capped = rebalanceCushion({ ef: 0, home: 100000 }, 'home', 150000, 200000, 100000, 'ef', 30000);
  assert.equal(capped.home, 100000);
  assert.equal(capped.ef, 0);
});

test('an empty EMI is worked out from the balance, rate and months', () => {
  const { computedEmi } = lib('derived.ts');
  const emi = computedEmi({ loan_type: 'home_loan', outstanding: '2500000', nominal_rate: '0.085', tenure_months_remaining: 240, scheduled_emi: '' });
  assert.match(emi, /^\d+$/);
  assert.ok(Number(emi) > 20000 && Number(emi) < 25000);
  assert.equal(computedEmi({ loan_type: 'home_loan', outstanding: '2500000', nominal_rate: '0.085', tenure_months_remaining: 240, scheduled_emi: '21696' }), '');
  assert.equal(computedEmi({ loan_type: 'credit_card', outstanding: '80000', nominal_rate: '0.36', tenure_months_remaining: 12, scheduled_emi: '' }), '');
});

test('the schedule and the closed line say what the founder asked for', () => {
  const schedule = fs.readFileSync(path.join(root, 'components/plan/PlanSchedule.tsx'), 'utf8');
  assert.match(schedule, /Showing \{expanded \? totalCount : eventRows\.length\} of \{totalCount\} months/);
  assert.match(schedule, /SHOW ALL/);
  const report = fs.readFileSync(path.join(root, 'components/profile/CreditReportImport.tsx'), 'utf8');
  assert.match(report, /Closed, nothing to add/);
  assert.match(report, /data-testid="cr-closed"/);
});
