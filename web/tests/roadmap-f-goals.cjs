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
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const py = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

// PR D (roadmap 2026-10-07): user-programmable values, defaults shown and editable.

// PR F (roadmap 2026-10-07): goals with a funding rule; debt first by default; the trade-off line.

test('a new goal is debt first; a goal saved before PR F keeps its run-rate (schedule)', () => {
  const g = lib('goals.ts');
  assert.deepEqual(g.blankGoal('wedding').fundingRule, { kind: 'after_debt', afterLoanIndex: null });
  assert.deepEqual(g.fundingRuleForEngine(undefined), { funding_rule: 'schedule' });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'after_debt', afterLoanIndex: null }), { funding_rule: 'after_debt', after_loan_index: null });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'after_debt', afterLoanIndex: 2 }), { funding_rule: 'after_debt', after_loan_index: 2 });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'fixed', amount: '5000' }), { funding_rule: 'fixed', funding_amount: '5000.00' });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'surplus_pct', pct: '0.25' }), { funding_rule: 'surplus_pct', funding_pct: '0.25' });
  // Half-filled rules fall back to the run-rate rather than 422 the plan.
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'fixed', amount: '' }), { funding_rule: 'schedule' });
  assert.deepEqual(g.fundingRuleForEngine({ kind: 'surplus_pct', pct: '2' }), { funding_rule: 'schedule' });
});

test('the engine payload carries the rule, and a deferred start only for the run-rate rule', () => {
  const g = lib('goals.ts');
  const today = new Date(2026, 9, 7);
  const rows = [
    { id: 'a', targetMonth: '2028-10', amount: '100000', bufferPct: '0.1', fundingStartMonth: '2027-04' },
    { id: 'b', targetMonth: '2028-10', amount: '100000', bufferPct: '0', fundingStartMonth: '2027-04', fundingRule: { kind: 'after_debt', afterLoanIndex: null } },
    { id: 'c', targetMonth: '2026-10', amount: '100000' },
  ];
  const out = g.goalsForSimulate(rows, today);
  assert.deepEqual(out.map((x) => x.id), ['a', 'b']);
  assert.equal(out[0].funding_rule, 'schedule');
  assert.equal(out[0].funding_start_month_index, 6);
  assert.equal(out[0].required_amount, '110000.00');
  assert.equal(out[1].funding_rule, 'after_debt');
  assert.equal(out[1].funding_start_month_index, null);
  // The cookie digest keeps the rule, so /plan's server render sends it.
  const w = g.goalSliceWrite([{ ...g.blankGoal('travel'), id: 'x', amount: '5000', targetMonth: '2027-06' }]);
  assert.deepEqual(JSON.parse(Buffer.from(w.digest, 'base64').toString('utf8'))[0].fundingRule, { kind: 'after_debt', afterLoanIndex: null });
  assert.match(src('lib/goals.ts'), /return goalsForSimulate\(rows, today, currentlySaved\)/);
});

test('labels, validation and the trade-off line', () => {
  const f = lib('goal-funding.ts');
  const loans = [{ loan_type: 'credit_card', bank: 'HDFC', outstanding: '80000', nominal_rate: '0.42' }, { loan_type: 'home_loan', bank: 'SBI', outstanding: '3000000', nominal_rate: '0.085' }];
  assert.match(f.fundingRuleLabel({ kind: 'after_debt', afterLoanIndex: null }, loans, 'IN', 'INR'), /^Debt first: after every loan at 12% or more is paid off$/);
  assert.match(f.fundingRuleLabel({ kind: 'after_debt', afterLoanIndex: 1 }, loans, 'IN', 'INR'), /SBI home loan is paid off/);
  assert.match(f.fundingRuleLabel({ kind: 'surplus_pct', pct: '0.25' }, loans, 'IN', 'INR'), /25% of spare cash/);
  assert.equal(f.fundingRuleLabel(undefined, loans, 'IN', 'INR'), 'On schedule from now');
  assert.deepEqual(f.highInterestLoans(loans, 'IN').map((l) => l.bank), ['HDFC']);
  assert.equal(f.fundingRuleError({ kind: 'fixed', amount: '' }), 'Enter the amount a month.');
  assert.equal(f.fundingRuleError({ kind: 'after_debt', afterLoanIndex: null }), null);
  const line = f.tradeoffLine({ goal_id: 'g', has_high_apr_debt: true, extra_interest: '24575.39', debt_free_later_months: 6, debt_first_reaches_target: true, debt_first_fill_rate: '1', funded_now_fill_rate: '1' }, 'INR', 'Apr 2029');
  assert.match(line, /^Saving for it now, before your high-interest debt, costs about ₹24,575 more interest and leaves you in debt 6 months longer\. Debt first still reaches it by Apr 2029\.$/);
  assert.match(f.tradeoffLine({ goal_id: 'g', has_high_apr_debt: true, extra_interest: '100', debt_free_later_months: 0, debt_first_reaches_target: false, debt_first_fill_rate: '0.71', funded_now_fill_rate: '1' }, 'INR', 'Apr 2029'), /Debt first reaches 71% of it by Apr 2029\./);
  assert.match(f.tradeoffLine({ has_high_apr_debt: false }, 'INR', 'x'), /No high-interest debt/);
  // Same threshold as the engine.
  const py = fs.readFileSync(path.resolve(__dirname, '../../engine/goals.py'), 'utf8');
  assert.match(py, /HIGH_APR_THRESHOLD = \{"IN": D\("0\.12"\), "US": D\("0\.10"\)\}/);
  assert.deepEqual(f.HIGH_APR_THRESHOLD, { IN: 0.12, US: 0.1 });
});

test('wired: the form asks how to fund it (debt first first), the goal shows the rule and the trade-off', () => {
  const form = src('components/goals/GoalForm.tsx');
  assert.match(form, /5 · How to fund it/);
  assert.ok(form.indexOf('Debt first') < form.indexOf('On schedule from now'));
  assert.match(form, /A fixed amount a month/);
  assert.match(form, /A share of spare cash/);
  assert.match(form, /After a loan is paid off/);
  const detail = src('components/goals/GoalDetail.tsx');
  assert.match(detail, /api\.goalsTradeoff\(\{ user, goals, goal_ids: \[goal\.id\] \}\)/);
  assert.match(detail, /tradeoffLine\(t, currency/);
  assert.match(detail, /DEBT FIRST/);
  assert.match(src('lib/api.ts'), /'\/api\/goals\/tradeoff'/);
});
