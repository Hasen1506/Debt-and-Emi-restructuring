// Apply flow (founder, 18 Oct 2026, work/reports/apply-flow.md): every saved
// change gets a before → after record and an UNDO that restores exact state.
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
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const loan = (extra = {}) => ({ id: 'hl', bank: 'HDFC', loan_type: 'home_loan', outstanding: '500000', nominal_rate: '.09', scheduled_emi: '6000.40', tenure_months_remaining: 100, rate_type: 'floating', ...extra });
const user = (extra = {}) => ({ country: 'IN', income_type: 'salaried', monthly_income: '150000', annual_income: '1800000', annual_gross_salary: '1800000', fixed_expenses: '60000', savings_balance: '50000', primary_bank: 'HDFC', loans: [loan()], ...extra });
function stores(u) {
  const jar = new Map([['rightdue_user', encodeURIComponent(JSON.stringify(u))], ['rightdue_marginal', '.3']]);
  const data = new Map();
  global.document = { get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); }, set cookie(value) {
    const [pair, ...attrs] = value.split(';'); const i = pair.indexOf('='); const k = pair.slice(0, i);
    if (attrs.some((a) => a.trim() === 'max-age=0')) jar.delete(k); else jar.set(k, pair.slice(i + 1));
  } };
  global.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  global.window = { localStorage: global.localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
  return { jar, data };
}
const cleanup = () => { delete global.document; delete global.localStorage; delete global.window; };
const result = { baseline_debt_free_month: 40, scenario_debt_free_month: 31, baseline_total_interest: '410000.4', scenario_total_interest: '352000' };
const base = (undo) => ({ country: 'IN', currency: 'INR', what: 'x', from: 'this month', before: { debtFreeMonth: 40, totalInterest: '410000.4' }, after: { debtFreeMonth: 31, totalInterest: '352000' }, undo });

test('before/after figures come from the plan run (baseline) and the plan with the change (scenario)', () => {
  const { planFigures } = lib('applied-change.ts');
  assert.deepEqual(planFigures(result, 'baseline'), { debtFreeMonth: 40, totalInterest: '410000.4' });
  assert.deepEqual(planFigures(result, 'scenario'), { debtFreeMonth: 31, totalInterest: '352000' });
  // A side that never clears has no honest interest total.
  assert.deepEqual(planFigures({ ...result, scenario_debt_free_month: null, scenario_never_clears: true }, 'scenario'), { debtFreeMonth: null, totalInterest: null });
  assert.deepEqual(planFigures(null, 'baseline'), { debtFreeMonth: null, totalInterest: null });
});

test('UNDO of a spending cut restores spending and the debt budget exactly, and the card stays as undone', async () => {
  const { commitSpendingCut } = lib('commit-spending-cut.ts');
  const ac = lib('applied-change.ts');
  const { loadProfileClient } = lib('user-store.ts'); const { readDebtBudgetClient } = lib('debt-budget.ts');
  const u = user({ fixed_expenses: '60000.35' }); const s = stores(u);
  try {
    const entries = commitSpendingCut(u, 10000.1, 1, '0');
    ac.recordAppliedChange({ ...base({ kind: 'spending_cut', commitmentId: entries[0].id }), budgetHolds: 'unset' });
    assert.equal(loadProfileClient().user.fixed_expenses, '50000.25');
    const shown = ac.readAppliedChange();
    assert.equal(shown.budgetHolds, 'unset');
    assert.equal(shown.before.debtFreeMonth, 40);
    ac.undoAppliedChange(shown);
    assert.equal(loadProfileClient().user.fixed_expenses, '60000.35');
    assert.equal(readDebtBudgetClient(), '');
    assert.deepEqual(JSON.parse(s.data.get('rightdue_commitments')), []);
    assert.equal(ac.readAppliedChange().undone, true);
    ac.dismissAppliedChange();
    assert.equal(ac.readAppliedChange(), null);
    await new Promise((r) => setImmediate(r));
  } finally { cleanup(); }
});

test('UNDO of a lump sum removes only its Activity entry and puts the old EMI back', async () => {
  const { applyToolResult } = lib('apply-tool-result.ts');
  const { readActivityClient, addActivityEntry } = lib('activity.ts');
  const { commitActivity } = lib('commit-activity.ts');
  const { saveLowerEmi } = lib('prepay-choice.ts');
  const { addCommitment, readCommitmentsClient, writeCommitmentsClient } = lib('commitments.ts');
  const ac = lib('applied-change.ts');
  const { loadProfileClient } = lib('user-store.ts');
  const u = user(); stores(u);
  try {
    // An earlier, real payment stays untouched.
    commitActivity(addActivityEntry([], { loanIndex: 0, loanId: 'hl', kind: 'paid_full', date: '2026-10-05', amount: '6000.40', scheduledEmi: '6000.40' }, u.loans), u);
    const before = JSON.stringify(readActivityClient());
    applyToolResult({ loanIndex: 0, kind: 'paid_extra', amount: '56000.40', scheduledEmi: '6000.40', loans: u.loans, country: 'IN',
      prepay: { prepayMode: 'reduce_emi', emiBefore: '6000.40', emiAfter: '5400.00' } });
    const activityId = readActivityClient()[0].id;
    assert.equal(saveLowerEmi({ loanIndex: 0, loanId: 'hl' }, 5400), true);
    const commitments = addCommitment(readCommitmentsClient(), { date: '2026-10-18', kind: 'lump_sum', amount: '50000', loanIndex: 0, loanBank: 'HDFC' });
    writeCommitmentsClient(commitments);
    ac.recordAppliedChange(base({ kind: 'lump_sum', activityId, commitmentId: commitments[0].id, emi: { loanId: 'hl', loanIndex: 0, before: '6000.40', after: '5400.00' } }));
    assert.equal(loadProfileClient().user.loans[0].scheduled_emi, '5400.00');
    ac.undoAppliedChange(ac.readAppliedChange());
    assert.equal(JSON.stringify(readActivityClient()), before);
    assert.equal(loadProfileClient().user.loans[0].scheduled_emi, '6000.40');
    assert.deepEqual(readCommitmentsClient(), []);
    // Undoing again finds nothing to undo and changes nothing.
    assert.throws(() => ac.undoAppliedChange(ac.readAppliedChange()), /no longer in Activity/);
    assert.equal(JSON.stringify(readActivityClient()), before);
    await new Promise((r) => setImmediate(r));
  } finally { cleanup(); }
});

test('lump-sum UNDO refuses, changing nothing, when the EMI was edited after it', async () => {
  const { applyToolResult } = lib('apply-tool-result.ts');
  const { readActivityClient } = lib('activity.ts');
  const ac = lib('applied-change.ts');
  const { loadProfileClient, saveProfileClient } = lib('user-store.ts');
  const u = user(); stores(u);
  try {
    applyToolResult({ loanIndex: 0, kind: 'paid_extra', amount: '56000.40', scheduledEmi: '6000.40', loans: u.loans, country: 'IN' });
    const activityId = readActivityClient()[0].id;
    ac.recordAppliedChange(base({ kind: 'lump_sum', activityId, emi: { loanId: 'hl', loanIndex: 0, before: '6000.40', after: '5400.00' } }));
    const p = loadProfileClient();
    saveProfileClient({ ...p, user: { ...p.user, loans: [{ ...p.user.loans[0], scheduled_emi: '5000' }] } });
    assert.throws(() => ac.undoAppliedChange(ac.readAppliedChange()), /EMI changed after/);
    assert.equal(readActivityClient().length, 1);
    assert.equal(loadProfileClient().user.loans[0].scheduled_emi, '5000');
    await new Promise((r) => setImmediate(r));
  } finally { cleanup(); }
});

test('tenure APPLY saves the longer tenure and lower EMI; UNDO restores both exactly', async () => {
  const ac = lib('applied-change.ts');
  const { loadProfileClient, saveProfileClient } = lib('user-store.ts');
  const u = user(); stores(u);
  try {
    const undo = ac.applyTenure({ loanIndex: 0, loanId: 'hl' }, 12, '5321.678');
    assert.deepEqual(undo.before, { tenure: 100, emi: '6000.40' });
    assert.deepEqual(undo.after, { tenure: 112, emi: '5321.68' });
    let l = loadProfileClient().user.loans[0];
    assert.equal(l.tenure_months_remaining, 112); assert.equal(l.scheduled_emi, '5321.68');
    ac.recordAppliedChange({ ...base(undo), bankNote: true });
    ac.undoAppliedChange(ac.readAppliedChange());
    l = loadProfileClient().user.loans[0];
    assert.equal(l.tenure_months_remaining, 100); assert.equal(l.scheduled_emi, '6000.40');
    // A higher EMI is not a stretch; nothing is saved.
    assert.throws(() => ac.applyTenure({ loanIndex: 0, loanId: 'hl' }, 12, '7000'), /doesn’t lower/);
    // Edited after the change: UNDO refuses and keeps the edit.
    const u2 = ac.applyTenure({ loanIndex: 0, loanId: 'hl' }, 24, '5000');
    const p = loadProfileClient();
    saveProfileClient({ ...p, user: { ...p.user, loans: [{ ...p.user.loans[0], tenure_months_remaining: 130 }] } });
    assert.throws(() => ac.undoAppliedChange({ ...base(u2) }), /edited after/);
    assert.equal(loadProfileClient().user.loans[0].tenure_months_remaining, 130);
    await new Promise((r) => setImmediate(r));
  } finally { cleanup(); }
});

test('wiring: DO IT buttons record the change, tenure has APPLY TO MY PLAN, Home insights say check only', () => {
  const w = src('components/WhatIfPanel.tsx');
  assert.match(w, /<AppliedChangeCard kinds=\{\['lump_sum', 'spending_cut'\]\} \/>/);
  assert.equal((w.match(/recordAppliedChange\(\{/g) || []).length, 2);
  // "Before" is the plan's figures captured from the run before the save.
  assert.ok(w.indexOf("planFigures(r, 'baseline')") > 0);
  // Previews (the debounced scenario runs) never write Activity or commitments.
  const preview = w.slice(w.indexOf('useDebouncedScenario('), w.indexOf('const surplusStep'));
  assert.doesNotMatch(preview, /applyToolResult|commitActivity|addCommitment|recordAppliedChange|commitSpendingCut/);
  const t = src('components/plan/TenureWhatIf.tsx');
  assert.match(t, /APPLY TO MY PLAN/);
  assert.match(t, /Confirm them with your bank/);
  assert.match(src('components/plan/LedgerPlan.tsx'), /<AppliedChangeCard banner \/>/);
  assert.match(src('components/insights/CheaperWay.tsx'), /Check only; nothing changes until you update your loan/);
  assert.match(src('components/insights/InsightCards.tsx'), /Check only; nothing changes until you update your loan/);
  const card = src('components/AppliedChangeCard.tsx');
  assert.match(card, /won&apos;t reach your debts until you choose an amount/);
  assert.match(card, /fontSize: 13/);
});
