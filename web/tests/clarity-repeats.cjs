// Each figure is said once where it belongs: Plan's heading carries the
// debt-free date, Home's Where you stand carries it on Home, the card's
// "why here" says its cost once, and the TO DEBTS chip doesn't promise all
// the spare cash while part of it goes to the emergency fund.
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
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('What changed only mentions the debt-free date when it moved', () => {
  const { whatChanged } = lib('what-changed.ts');
  const month = '2026-10';
  const at = '2026-10-05T10:00:00Z';
  const still = whatChanged([{ id: '1', at, kind: 'settings', what: 'Debt-free date', after: 'Sep 2029', month }], month, null, 'INR').lines;
  assert.deepEqual(still, ['Nothing recorded this month yet.']);
  const moved = whatChanged([{ id: '1', at, kind: 'settings', what: 'Debt-free date', before: 'Oct 2029', after: 'Sep 2029', month }], month, null, 'INR').lines;
  assert.deepEqual(moved, ['Debt-free date moved from Oct 2029 to Sep 2029.']);
});

test("the card's why-here line gives its cost once", () => {
  const { whyFirstShort } = lib('card-rate.ts');
  const w = whyFirstShort('0.6031', '0.42');
  assert.equal(w, '42.00% a year on the statement, about 60.31% all-in');
  assert.doesNotMatch(w, /saves/);
  const home = src('components/home/HomeDebtFree.tsx');
  assert.doesNotMatch(home, /because \$\{WHY\[plan\.strategy\] \?\? WHY\.avalanche\}\.` : 'The extra goes on your only loan\.'\} \$\{whyFirstShort/);
});

test('TO DEBTS says "after the fund" when part of the spare goes there first', () => {
  const { debtBudgetChoiceLabel } = lib('debt-budget.ts');
  assert.equal(debtBudgetChoiceLabel('all', '', 'INR'), 'EMIS + ALL SPARE CASH');
  assert.equal(debtBudgetChoiceLabel('all', '', 'INR', false, true), 'EMIS + SPARE CASH AFTER THE FUND');
  assert.equal(debtBudgetChoiceLabel('all', '', 'USD', false, true), 'PAYMENTS + SPARE CASH AFTER THE FUND');
  assert.equal(debtBudgetChoiceLabel('min', '', 'INR', false, true), 'EMIS AND MINIMUMS ONLY');
});

test("Plan's date is said once on screen; Home's progress line drops the date", () => {
  const plan = src('components/plan/LedgerPlan.tsx');
  // The sentence heading stays for screen readers; the DEBT-FREE box shows it.
  assert.match(plan, /<h2 data-rd-useful className="sr-only">/);
  assert.match(plan, /l: 'DEBT-FREE'/);
  assert.doesNotMatch(src('components/home/HomeProgress.tsx'), /Debt-free in \$\{ymLabel/);
});
