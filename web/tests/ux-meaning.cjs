// Sentences on Home must match the number under them (UX meaning audit).
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
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));

const inr = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;

test('this month does not say nothing is left when spare cash is sitting unused', () => {
  const { homeThisMonthLine } = lib('home-this-month.ts');
  const data = {
    rows: [{ key: 'h', loanIndex: 0, name: 'Home loan', kind: 'emi', card: false, amount: 21696, amountUser: 21696, minimum: 21696, extra: 0 }],
    total: 21696, leftOver: 28304, extraUser: 0, duesUser: 21696, budget: 0, budgetChoice: 'unset',
  };
  const line = homeThisMonthLine(data, 0, inr, 'IN');
  assert.match(line.text, /pay every EMI and card minimum, ₹21,696/);
  assert.match(line.text, /₹28,304 is spare after the amount due and is not added on top/);
  assert.doesNotMatch(line.text, /Nothing is left over/);
});

test('this month names a safe return only when all spare cash was chosen', () => {
  const { homeThisMonthLine } = lib('home-this-month.ts');
  const base = {
    rows: [{ key: 'h', loanIndex: 0, name: 'Home loan', kind: 'emi', card: false, amount: 21696, amountUser: 21696, minimum: 21696, extra: 0 }],
    total: 21696, leftOver: 28304, extraUser: 0, duesUser: 21696, budget: 0,
  };
  const all = homeThisMonthLine({ ...base, budgetChoice: 'all' }, 0, inr, 'IN');
  assert.match(all.text, /no open loan costs more than a safe return/);
  const min = homeThisMonthLine({ ...base, budgetChoice: 'min' }, 0, inr, 'IN');
  assert.match(min.text, /is not added on top/);
  assert.doesNotMatch(min.text, /safe return/);
});

test('when nothing is spare, the line says so without inventing a leftover', () => {
  const { homeThisMonthLine } = lib('home-this-month.ts');
  const data = {
    rows: [{ key: 'h', loanIndex: 0, name: 'Home loan', kind: 'emi', card: false, amount: 50000, amountUser: 50000, minimum: 50000, extra: 0 }],
    total: 50000, leftOver: 0, extraUser: 0, duesUser: 50000, budget: 0, budgetChoice: 'unset',
  };
  const line = homeThisMonthLine(data, 0, inr, 'IN');
  assert.match(line.text, /Nothing is spare above the EMIs and minimums/);
});

test('cash flow LEFT does not claim Pay this month adds spare it is not adding', () => {
  const { cashFlowLeftNote } = lib('home-this-month.ts');
  const held = cashFlowLeftNote({ income: 80000, spend: 30000, due: 21696, left: 28304, addsSpare: false, money: inr });
  assert.match(held, /Take-home ₹80,000 − spending ₹30,000 − due ₹21,696/);
  assert.match(held, /does not add it on top/);
  assert.doesNotMatch(held, /adds this ₹28,304/);
  const added = cashFlowLeftNote({ income: 120000, spend: 45000, due: 46295, left: 28705, addsSpare: true, money: inr });
  assert.match(added, /adds this ₹28,705/);
  assert.match(added, /It is not cash left after that payment/);
});

test('the line under Pay this month gives the reason that matches the choice', () => {
  const { leftOverLine } = lib('pay-this-month.ts');
  assert.match(leftOverLine({ leftOver: 28304, budget: 0, budgetChoice: 'unset' }, inr), /not added on top until the monthly total/);
  assert.doesNotMatch(leftOverLine({ leftOver: 28304, budget: 0, budgetChoice: 'unset' }, inr), /safe return/);
  assert.match(leftOverLine({ leftOver: 5000, budget: 0, budgetChoice: 'all' }, inr), /safe return/);
  assert.match(leftOverLine({ leftOver: 4000, budget: 40000, budgetChoice: 'set' }, inr), /outside your total for debts/);
  assert.equal(leftOverLine({ leftOver: 0, budget: 0, budgetChoice: 'unset' }, inr), null);
});
