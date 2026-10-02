const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith('@/'))
        request = path.join(root, request.slice(2));
    return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'next/navigation')
        return { useRouter: () => ({ refresh() { } }) };
    return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
    require.extensions[ext] = (module, file) => {
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
        module._compile(output, file);
    };
const lib = name => require(path.join(root, 'lib', name));

const card = { id: 'c', loan_type: 'credit_card', bank: '', outstanding: '80000', nominal_rate: '0.42', scheduled_emi: '0' };
const planWith = (owedAfter, extra = {}) => ({
  live: true,
  user: { country: 'IN', loans: [card] },
  monthlyPayments: [{ month: 1, perLoan: { 0: '80500' }, totalPaid: 80500, extraPaid: 76500 }],
  trajectory: [{ month: 1, balancesByLoanIndex: { 0: owedAfter } }],
  firstMonthMinimums: { 0: '4000' },
  surplusAllocation: null,
  surplus: 76500,
  fxRatesUsed: {},
  debtBudget: '',
  ...extra,
});

test('a payment above the opening balance is not a payoff while interest leaves some owing', () => {
  const { payThisMonth } = lib('pay-this-month.ts');
  const row = payThisMonth(planWith(2300)).rows[0];
  assert.equal(row.kind, 'extra');
  assert.equal(row.owedAfter, 2300);
  assert.equal(payThisMonth(planWith(0)).rows[0].kind, 'clears');
});

test('pay this month reports the extra and the user\'s own total for debts', () => {
  const { payThisMonth } = lib('pay-this-month.ts');
  const all = payThisMonth(planWith(2300));
  assert.equal(all.extraUser, 76500);
  assert.equal(all.budget, 0);
  assert.equal(payThisMonth(planWith(2300, { debtBudget: '50000' })).budget, 50000);
});

test('the debt budget keeps a whole positive amount, else means all spare cash', () => {
  const { normalizeDebtBudget } = lib('debt-budget.ts');
  assert.equal(normalizeDebtBudget('50,000'), '50000');
  assert.equal(normalizeDebtBudget('0'), '');
  assert.equal(normalizeDebtBudget(''), '');
  assert.equal(normalizeDebtBudget('abc'), '');
});

test('the switch knows when all three strategies pay the debts in the same order', () => {
  const { sharedPayoffOrder } = lib('payoff-order.ts');
  const base = { country: 'IN', tax_regime: 'new', loans: [] };
  const cardL = { loan_type: 'credit_card', bank: '', outstanding: '80000', nominal_rate: '0.42', scheduled_emi: '0' };
  const personal = { loan_type: 'personal_loan', bank: '', outstanding: '200000', nominal_rate: '0.14', scheduled_emi: '9500' };
  // The card is both the smallest and the dearest: one order for all three.
  assert.deepEqual(sharedPayoffOrder({ ...base, loans: [personal, cardL] }, '0.2'), ['Credit card', 'Personal loan']);
  // A small cheap loan ahead of a big dear one: snowball and avalanche differ.
  const small = { loan_type: 'auto_loan', bank: '', outstanding: '30000', nominal_rate: '0.09', scheduled_emi: '3000' };
  const bigCard = { ...cardL, outstanding: '300000' };
  assert.equal(sharedPayoffOrder({ ...base, loans: [small, bigCard] }, '0.2'), null);
});
