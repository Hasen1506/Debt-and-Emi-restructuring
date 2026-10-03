// What the next RBI or Fed decision does to each loan (AUDIT §10 M5).
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
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
  module._compile(output, file);
};
const lib = (name) => require(path.join(root, 'lib', name));
const { emiFor, monthsFor, rateMove, firstResetAfter, whenItApplies, followsCentralBank } = lib('rate-decision.ts');

const home = (extra = {}) => ({ id: 'h', loan_type: 'home_loan', bank: 'SBI', outstanding: '4000000', nominal_rate: '0.085', rate_type: 'floating', scheduled_emi: '39390', tenure_months_remaining: 180, ...extra });

test('EMI and months agree with each other at today\'s rate', () => {
  const emi = emiFor(4000000, 0.085, 180);
  assert.ok(Math.abs(emi - 39390) < 5, String(emi));
  assert.equal(monthsFor(4000000, 0.085, Math.ceil(emi)), 180);
  // An EMI that doesn't cover the interest never clears.
  assert.equal(monthsFor(4000000, 0.085, 28000), null);
});

test('a quarter point on a ₹40 lakh, 15-year floating home loan: about ₹590 a month, or about half a year', () => {
  const m = rateMove(home(), 'IN');
  assert.equal(m.follows, 'floating');
  const up = m.emi.up - m.emi.now;
  assert.ok(up > 570 && up < 610, String(up));
  assert.ok(m.months.up - m.months.now >= 5 && m.months.up - m.months.now <= 8, String(m.months.up - m.months.now));
  assert.ok(m.months.now - m.months.down >= 4, String(m.months.now - m.months.down));
});

test('fixed loans and Indian cards don\'t follow the central bank; US cards do', () => {
  assert.equal(followsCentralBank(home({ rate_type: 'fixed' }), 'IN'), null);
  const card = { loan_type: 'credit_card', outstanding: '8000', nominal_rate: '0.24', rate_type: 'fixed', scheduled_emi: '0' };
  assert.equal(followsCentralBank(card, 'IN'), null);
  const m = rateMove(card, 'US');
  assert.equal(m.follows, 'card');
  assert.ok(Math.abs(m.interestUp - 1.67) < 0.01);
});

test('the change applies from the first reset on or after the decision', () => {
  const quarterly = home({ next_reset_date: '2026-08-01', rate_reset_frequency_months: 3 });
  assert.equal(firstResetAfter(quarterly, '2026-10-07'), '2026-11-01');
  assert.equal(firstResetAfter(home({ next_reset_date: '2026-12-15' }), '2026-10-07'), '2026-12-15');
  assert.equal(firstResetAfter(home(), '2026-10-07'), null);
  assert.match(whenItApplies(rateMove(quarterly, 'IN'), 'IN', '2026-10-07'), /1 Nov 2026/);
  assert.match(whenItApplies(rateMove(home(), 'IN'), 'IN', '2026-10-07'), /within three months/);
});

test('a reset saved as a month alone reads as its first day', () => {
  const { resetDate } = lib('rate-decision.ts');
  assert.equal(resetDate({ next_reset_date: '2026-11' }), '2026-11-01');
  assert.equal(firstResetAfter(home({ next_reset_date: '2026-11' }), '2026-10-07'), '2026-11-01');
  assert.equal(resetDate({ next_reset_date: 'soon' }), null);
});
