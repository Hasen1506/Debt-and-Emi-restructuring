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
const loan = (id = 'a', extra = {}) => ({ id, bank: id, loan_type: 'home_loan', outstanding: '500000', nominal_rate: '.09', scheduled_emi: '6000', rate_type: 'floating', ...extra });
const user = (extra = {}) => ({ country: 'US', income_type: 'salaried', monthly_income: '10000', annual_income: '120000', annual_gross_salary: '120000', fixed_expenses: '3000', savings_balance: '50000', primary_bank: 'a', loans: [loan()], ...extra });
test('goal cash stays reserved and conserves wealth for external and account funding', () => {
    const { allocateCash } = lib('cash-allocation.ts');
    const u = user({ cash_accounts: [{ name: 'Cash', kind: 'checking', balance: '50000', apy: '0' }] });
    const input = { total: '10000.25', ef: '0', debt: '0', investment: '0', goals: '10000.25', source: 'external', date: '2026-10-02' };
    const external = allocateCash(u, input);
    assert.equal(external.savings_balance, '50000.00');
    assert.equal(external.assets[0].current_market_value, '10000.25');
    assert.equal(external.assets[0].user_marks_liquid, false);
    const own = allocateCash(u, { ...input, source: 'account', accountName: 'Cash' });
    assert.equal(own.savings_balance, '39999.75');
    assert.equal(Number(own.savings_balance) + Number(own.assets[0].current_market_value), 50000);
    assert.throws(() => allocateCash(u, { ...input, total: '9999' }));
});
test('goal affordability uses card minimums, open loans and native FX conversions', () => {
    const { monthlySpare } = lib('goal-line.ts');
    assert.equal(monthlySpare(user({ loans: [loan('in', { currency: 'INR', scheduled_emi: '8000' }), loan('closed', { currency: 'USD', outstanding: '0', scheduled_emi: '99999' })], fx_to_user_currency: { INR: '.0125' } })), 6900);
    assert.equal(monthlySpare(user({ loans: [loan('card', { currency: 'USD', loan_type: 'credit_card', bank: 'Chase', outstanding: '1000', nominal_rate: '.24', scheduled_emi: '0' })] })), 6960);
    assert.equal(monthlySpare(user({ loans: [loan('in', { currency: 'INR' })] })), 0);
});
test('a windfall extra does not mark the regular EMI paid in Activity', () => {
    const { buildHistory } = require(path.join(root, 'components/activity/history.ts'));
    const u = user({ loans: [loan('a', { loan_type: 'personal_loan', currency: 'USD' })] });
    const entry = { id: 'extra', loanIndex: 0, loanId: 'a', kind: 'paid_extra', amount: '500', scheduledEmi: '0', date: '2026-10-02', loggedAt: '2026-10-02T00:00:00Z' };
    const groups = buildHistory({ user: u, entries: [entry], spend: [], life: [], today: '2026-10-02' });
    assert.ok(groups[0].rows.some(r => r.pending));
    assert.equal(buildHistory({ user: u, entries: [{ ...entry, scheduledEmi: '6000', amount: '6500' }], spend: [], life: [], today: '2026-10-02' })[0].rows.some(r => r.pending), false);
});
test('balance aging preserves unchanged anchors and skips non-amortizing loans', () => {
    const { rollBalancesForward, stampBalanceDates } = lib('roll-forward.ts');
    const loans = [loan('a', { outstanding: '100000', scheduled_emi: '10000', nominal_rate: '0', tenure_months_remaining: 10, balance_as_of: '2026-06-01' }), loan('b', { loan_type: 'credit_card', balance_as_of: '2026-06-01' })];
    const r = rollBalancesForward(loans, '2026-10');
    assert.equal(r.loans[0].outstanding, '70000.00');
    assert.equal(r.loans[0].tenure_months_remaining, 7);
    assert.equal(r.loans[1].outstanding, loans[1].outstanding);
    assert.equal(stampBalanceDates(loans, loans, '2026-10-02')[0].balance_as_of, '2026-06-01');
    assert.equal(stampBalanceDates([{ ...loans[0], outstanding: '50000' }], loans, '2026-10-02')[0].balance_as_of, '2026-10-02');
});
test('mortgage note converts native shield amount and applies threshold in display currency', () => {
    const { loanToUserDecimal } = lib('currency.ts');
    const { PlanNotes } = require(path.join(root, 'components/plan/PlanNotes.tsx'));
    const u = user({ deductions: { mortgage_interest_annual: '30000', itemized_deductions_other: '30000' }, fx_to_user_currency: { INR: '.0125' }, loans: [loan('in', { currency: 'INR' })] });
    assert.equal(loanToUserDecimal('10800', u.loans[0], 'US', u.fx_to_user_currency).toString(), '135');
    const plan = { user: u, displayCurrency: 'USD', marginalRate: '.24', bracketTransitions: [] };
    const html = renderToStaticMarkup(React.createElement(PlanNotes, { plan }));
    assert.doesNotMatch(html, /\$10,800/);
    assert.doesNotMatch(html, /saves about/); // $135 is below the $1000 note threshold.
    const native = renderToStaticMarkup(React.createElement(PlanNotes, { plan: { ...plan, user: { ...u, loans: [loan('us', { currency: 'USD' })] } } }));
    assert.match(native, /\$10,800/);
    const largerFx = renderToStaticMarkup(React.createElement(PlanNotes, { plan: { ...plan, user: { ...u, fx_to_user_currency: { INR: '.2' } } } }));
    assert.match(largerFx, /\$2,160/);
    for (const fx of [undefined, {}, { INR: '0' }, { INR: '-1' }, { INR: 'Infinity' }, { INR: 'NaN' }, { INR: 'bad' }]) {
        assert.equal(loanToUserDecimal('10800', u.loans[0], 'US', fx), null);
    }
    assert.equal(loanToUserDecimal('123456.789012345', u.loans[0], 'US', { INR: '.0125' }).toString(), '1543.2098626543125');
});
test('rate forms choose visible eligible loans and reject closed or planned targets', () => {
    const { isOpenCurrentLoan, rateChangeLoanIndex } = lib('plan-controls.ts');
    const loans = [loan('closed', { outstanding: '0' }), loan('draft', { planned_effective_month: 1 }), loan('fixed', { rate_type: 'fixed' }), loan('floating')];
    assert.equal(rateChangeLoanIndex(loans, 0), 3);
    assert.equal(rateChangeLoanIndex(loans, 1), 3);
    assert.equal(rateChangeLoanIndex(loans, 2), 2);
    assert.equal(rateChangeLoanIndex(loans, 99), 3);
    assert.equal(rateChangeLoanIndex(loans.slice(0, 2)), -1);
    for (const balance of ['0', '-1', 'NaN', 'Infinity', 'bad'])
        assert.equal(isOpenCurrentLoan(loan('x', { outstanding: balance })), false);
    assert.equal(isOpenCurrentLoan(loan('x', { outstanding: '.01' })), true);
});
test('ignored scalar and phase-only hikes remain configured and can be included again', () => {
    const { PlanAssumptions } = require(path.join(root, 'components/plan/PlanAssumptions.tsx'));
    const { HikeToggle } = require(path.join(root, 'components/HikeToggle.tsx'));
    const u = user({ country: 'IN', annual_hike_rate: '.08' });
    const compare = Object.fromEntries(['avalanche', 'hybrid', 'snowball'].map(s => [s, { debtFreeMonth: 12, totalInterest: '100' }]));
    const plan = { user: { ...u, annual_hike_rate: '0', hike_schedule: [] }, configuredUser: u, displayCurrency: 'INR', strategy: 'avalanche', strategyCompare: compare, hikeModeling: 'off', inflationModeling: 'off', taxReinvestProjection: [], currenciesInPlay: ['INR'], efSplit: '.3', profileIsLive: true, live: true, marginalRate: '.24' };
    const html = renderToStaticMarkup(React.createElement(PlanAssumptions, { plan }));
    assert.match(html, /IGNORED/);
    assert.doesNotMatch(html, /PAY RISES · <strong[^>]*>NONE SET/);
    const toggle = renderToStaticMarkup(React.createElement(HikeToggle, { active: 'off', hikeRatePct: '0%', hikeMonthLabel: 'April', hikePhases: [[1, 3, '.08']], variant: 'ledger' }));
    assert.match(toggle, /INCLUDE/);
    assert.doesNotMatch(toggle, /disabled/);
    const scalar = renderToStaticMarkup(React.createElement(PlanAssumptions, { plan: { ...plan, hikeModeling: 'on', configuredUser: { ...u, annual_hike_rate: '.004' } } }));
    assert.match(scalar, /0.40%/);
});
test('payoff milestones include instant arrivals, and never infer clearance from missing data', () => {
    const { loanClears } = require(path.join(root, 'components/plan/plan-milestones.ts'));
    const plan = { user: { loans: [loan('now'), loan('future', { planned_effective_month: 3 })] }, trajectory: [{ month: 1, balancesByLoanIndex: { 0: '0', 1: '0' } }, { month: 2, balancesByLoanIndex: { 0: '0', 1: '0' } }, { month: 3, balancesByLoanIndex: { 0: '0', 1: '0' } }], monthlyPayments: [{ month: 1, perLoan: { 0: '500000' } }, { month: 3, perLoan: { 1: '500000' } }] };
    assert.deepEqual(loanClears(plan).map(c => [c.index, c.month]), [[0, 1], [1, 3]]);
    assert.deepEqual(loanClears({ ...plan, monthlyPayments: [] }), []);
    assert.deepEqual(loanClears({ ...plan, trajectory: [{ month: 1, balancesByLoanIndex: { 0: '10', 1: '0' } }] }), []);
    assert.deepEqual(loanClears({ ...plan, trajectory: [{ month: 1 }] }), []);
    assert.deepEqual(loanClears({ ...plan, user: { loans: [loan('not-yet', { planned_effective_month: 10 })] } }), []);
});
function stores(u, block = false) {
    const jar = new Map([['rightdue_user', encodeURIComponent(JSON.stringify(u))], ['rightdue_marginal', '.24'], ['rightdue_score', '780']]);
    const data = new Map();
    global.document = { get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); }, set cookie(value) { const [pair, ...attrs] = value.split(';'); const split = pair.indexOf('='); const key = pair.slice(0, split); if (block && key.startsWith('rightdue_user'))
            return; if (attrs.some(a => a.trim() === 'max-age=0'))
            jar.delete(key);
        else
            jar.set(key, pair.slice(split + 1)); } };
    global.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
    global.window = { localStorage: global.localStorage, dispatchEvent() { }, addEventListener() { }, removeEventListener() { } };
    return { jar, data };
}
test('spending commits preserve metadata, reject future and stale cuts, and roll back failed saves', async () => {
    process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    const { commitSpendingCut } = lib('commit-spending-cut.ts');
    const { loadProfileClient } = lib('user-store.ts');
    const u = user({ fixed_expenses: '45000', variable_expenses: '5000' });
    try {
        const store = stores(u);
        const next = commitSpendingCut(u, 1234.56, 1);
        assert.equal(loadProfileClient().user.variable_expenses, '3765.44');
        assert.equal(loadProfileClient().user.fixed_expenses, '45000');
        assert.equal(loadProfileClient().creditScore, 780);
        assert.equal(loadProfileClient().marginalRate, '.24');
        assert.equal(next.length, 1);
        assert.throws(() => commitSpendingCut(u, 100, 1), /spending changed/);
        stores(u);
        assert.throws(() => commitSpendingCut(u, 100, 13), /Future cuts are previews/);
        assert.equal(loadProfileClient().user.variable_expenses, '5000');
        for (const invalid of [-1, 0, 5001, Infinity, NaN])
            assert.throws(() => commitSpendingCut(u, invalid, 1));
        const blocked = stores(u, true);
        blocked.data.set('rightdue_commitments', '[]');
        assert.throws(() => commitSpendingCut(u, 100, 1), /could not be saved/);
        assert.equal(blocked.data.get('rightdue_commitments'), '[]');
        assert.equal(loadProfileClient().user.variable_expenses, '5000');
        const quota = stores(u);
        global.localStorage.setItem = () => { throw new Error('quota'); };
        assert.throws(() => commitSpendingCut(u, 100, 1), /quota/);
        assert.equal(loadProfileClient().user.variable_expenses, '5000');
        assert.equal(quota.data.size, 0);
        assert.equal(store.jar.get('rightdue_score'), '780');
        const cents = user({ fixed_expenses: '5000.11' });
        stores(cents);
        commitSpendingCut(cents, 1234.56, 1);
        assert.equal(loadProfileClient().user.fixed_expenses, '3765.55');
        await new Promise(resolve => setImmediate(resolve));
    }
    finally {
        delete global.window;
        delete global.document;
        delete global.localStorage;
    }
});
test('legacy forms survive unique ID migration and reject changed or duplicate targets', () => {
    const { currentLoanIndex } = lib('plan-controls.ts');
    const legacy = loan();
    delete legacy.id;
    assert.equal(currentLoanIndex({ loanIndex: 0 }, legacy, [loan('other', { outstanding: '10' }), { ...legacy, id: 'migrated' }]), 1);
    assert.equal(currentLoanIndex({ loanIndex: 0 }, legacy, [{ ...legacy, id: 'one' }, { ...legacy, id: 'two' }]), -1);
    assert.equal(currentLoanIndex({ loanIndex: 0 }, legacy, [{ ...legacy, id: 'one', outstanding: '100' }]), -1);
    assert.equal(currentLoanIndex({ loanIndex: 0, loanId: 'a' }, legacy, [loan('b'), loan('a')]), 1);
});
test('goal and contribution transaction restores existing slices after blocked writes', () => {
    process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    const { persistGoalSlices } = lib('persist-goal-slices.ts');
    for (const failure of ['storage', 'cookie']) {
        const { jar, data } = stores(user());
        data.set('goals', 'old goals');
        data.set('contributions', 'old money');
        jar.set('goal_digest', 'old');
        jar.set('money_digest', 'old');
        const put = localStorage.setItem;
        localStorage.setItem = (k, v) => { if (failure === 'storage' && k === 'contributions')
            throw Error('quota'); put(k, v); };
        const descriptor = Object.getOwnPropertyDescriptor(document, 'cookie');
        Object.defineProperty(document, 'cookie', { ...descriptor, set(value) { if (failure === 'cookie' && value.startsWith('money_digest='))
                return; descriptor.set(value); } });
        assert.throws(() => persistGoalSlices([{ key: 'goals', cookie: 'goal_digest', digest: 'new', value: [], slice: 'goals' }, { key: 'contributions', cookie: 'money_digest', digest: 'new', value: [], slice: 'goal_contributions' }]));
        assert.equal(data.get('goals'), 'old goals');
        assert.equal(data.get('contributions'), 'old money');
        assert.equal(jar.get('goal_digest'), 'old');
        assert.equal(jar.get('money_digest'), 'old');
    }
    delete global.document;
    delete global.window;
    delete global.localStorage;
});
test('goal spending cut returns failure after quota even with an existing decision log', () => {
    process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    const { commitExpenseReduction } = lib('expense-commit.ts');
    const u = user();
    const { jar, data } = stores(u);
    data.set('rightdue_decision_log', '[]');
    localStorage.setItem = () => { throw Error('quota'); };
    assert.equal(commitExpenseReduction({ monthlyDelta: 1000 }), null);
    assert.deepEqual(JSON.parse(decodeURIComponent(jar.get('rightdue_user'))), u);
    assert.equal(data.get('rightdue_decision_log'), '[]');
    delete global.document;
    delete global.window;
    delete global.localStorage;
});
