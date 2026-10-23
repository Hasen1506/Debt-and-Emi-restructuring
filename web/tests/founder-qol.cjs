// Founder quality-of-life: advance-tax link, any-amount mark paid, spend
// average, a change log for every mutation, people loans, calendar files,
// the month's "What changed" card, and credit-report dedup.
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
  if (request === 'next/headers') return { cookies: async () => ({ get: () => undefined }) };
  if (request === 'server-only') return {};
  return load.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx'])
  require.extensions[ext] = (m, f) =>
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function stores(user) {
  const jar = new Map([['rightdue_user', encodeURIComponent(JSON.stringify(user))], ['rightdue_marginal', '.3']]);
  const data = new Map();
  global.document = {
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(value) {
      const [pair, ...attrs] = value.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      if (attrs.some((a) => a.trim() === 'max-age=0')) jar.delete(k);
      else jar.set(k, pair.slice(i + 1));
    },
  };
  global.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  global.window = { localStorage: global.localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
  return { jar, data };
}
const cleanup = () => { delete global.document; delete global.localStorage; delete global.window; };

const loan = (extra = {}) => ({ id: 'hl', bank: 'HDFC', loan_type: 'home_loan', outstanding: '500000', nominal_rate: '0.09', scheduled_emi: '6000', tenure_months_remaining: 100, rate_type: 'floating', ...extra });
const user = (extra = {}) => ({ country: 'IN', income_type: 'salaried', monthly_income: '80000', annual_income: '960000', fixed_expenses: '20000', variable_expenses: '10000', savings_balance: '0', primary_bank: 'HDFC', tax_regime: 'new', loans: [loan()], ...extra });

test('advance tax opens its own page, and every nav href is a page', () => {
  const nav = lib('app-nav.ts');
  assert.equal(nav.moreGroups({ country: 'IN' }).flatMap((g) => g.links).find((l) => l.label === 'Advance tax').href, '/tax/advance');
  assert.equal(nav.sectionFromPath('/tax/advance'), 'more');
  const hrefs = [
    ...nav.CORE_TABS.map((t) => t.href),
    ...nav.ASSETS_TAX_TABS.map((t) => t.href),
    ...nav.moreGroups({ country: 'IN' }).flatMap((g) => g.links).map((l) => l.href),
    ...nav.moreGroups({ country: 'US', is_nri_us: true }).flatMap((g) => g.links).map((l) => l.href),
  ];
  for (const href of hrefs) {
    const clean = href.split(/[?#]/)[0];
    const file = clean === '/' ? path.join(root, 'app/page.tsx') : path.join(root, 'app', clean, 'page.tsx');
    assert.ok(fs.existsSync(file), href);
  }
  const page = src('app/tax/advance/page.tsx');
  for (const line of ['15 June', '15 September', '15 December', '15 March', '44AD', '₹10,000', '234B', '234C']) assert.ok(page.includes(line), line);
  assert.ok(src('app/tax/page.tsx') === '' || src('components/tax/TaxPage.tsx').includes('/tax/advance'));
});

test('the plan uses a labelled recent average of logged spending', () => {
  const { recentSpendAverage } = lib('monthly-spend.ts');
  const entries = [
    { id: 'a', monthIso: '2026-10', spent: '40000', loggedAt: '2026-10-02T00:00:00Z' },
    { id: 'b', monthIso: '2026-09', spent: '30000', loggedAt: '2026-09-02T00:00:00Z' },
    { id: 'c', monthIso: '2026-08', spent: '20000', loggedAt: '2026-08-02T00:00:00Z' },
    { id: 'd', monthIso: '2026-07', spent: '90000', loggedAt: '2026-07-02T00:00:00Z' },
  ];
  const avg = recentSpendAverage(entries, '2026-10', 3);
  assert.equal(avg.count, 3);
  assert.equal(avg.average, 30000);
  assert.equal(recentSpendAverage([], '2026-10'), null);
  assert.match(src('components/home/LedgerHome.tsx'), /average of the last/);
  assert.match(src('components/plan/load-plan.ts'), /readSpendAverageServer/);
});

test('every mutation is written to the change log, with before and after', async () => {
  const u = user();
  stores(u);
  try {
    const { addActivityEntry } = lib('activity.ts');
    const { activityChanges, profileChanges, recordChanges, readChangeLog } = lib('change-log.ts');
    const { writeMonthlySpendClient } = lib('monthly-spend.ts');
    const { writeGoalsClient } = lib('goals.ts');
    const { writeStrategyClient } = lib('strategy.ts');
    const { saveIndia } = lib('cant-pay-draft.ts');
    const { saveProfileClient } = lib('user-store.ts');

    const entries = addActivityEntry([], { loanIndex: 0, loanId: 'hl', kind: 'paid_partial', date: '2026-10-05', amount: '1000', scheduledEmi: '6000' }, u.loans);
    recordChanges(activityChanges([], entries));
    assert.match(src('lib/commit-activity.ts'), /recordChanges\(activityChanges/);
    writeMonthlySpendClient([{ id: 's1', monthIso: '2026-10', spent: '27500.50', loggedAt: '2026-10-05T00:00:00Z' }]);
    writeGoalsClient([{ id: 'g1', kind: 'custom', label: 'Trip', amount: '50000', targetMonth: '2027-06', createdAt: '2026-10-01', fundingSources: [], priorityBump: false, bufferPct: '0' }]);
    writeStrategyClient('snowball');
    saveIndia({ letter: { body: 'Please pause the EMI.' } });
    const edited = user({ loans: [{ ...loan(), outstanding: '480000', nominal_rate: '0.085' }], monthly_income: '90000', tax_regime: 'old' });
    recordChanges(profileChanges(u, edited));
    assert.equal(saveProfileClient({ user: edited, marginalRate: '0.3' }), true);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const rows = readChangeLog();
    const kinds = new Set(rows.map((e) => e.kind));
    for (const kind of ['payment', 'spend', 'goal', 'letter', 'loan', 'income', 'tax', 'settings']) {
      assert.ok(kinds.has(kind), kind);
    }
    const payment = rows.find((e) => e.kind === 'payment');
    assert.ok(payment.before != null || payment.after != null);
    assert.equal(payment.after, '1000');
    const spend = rows.find((e) => e.what === 'Logged spending');
    assert.equal(spend.after, '27500.50');
    assert.ok(spend.at);
    const loanEdit = rows.find((e) => e.what.startsWith('Edited'));
    assert.match(loanEdit.before, /₹5,00,000/);
    assert.match(loanEdit.after, /balance ₹5,00,000 → ₹4,80,000/);
    assert.match(src('components/activity/ChangeLogPanel.tsx'), /change-filter-\$\{f\.id\}/);
    assert.match(src('components/home/PayThisMonth.tsx'), /openAmount\(row\)/);
    assert.match(src('components/activity/LogDialog.tsx'), /amt\.gt\(planned\) \? 'extra'/);
  } finally { cleanup(); }
});

test('what changed is only the log, and a calendar file repeats with a stable id', () => {
  const { whatChanged } = lib('what-changed.ts');
  const month = '2026-10';
  const entries = [
    { id: '1', at: '2026-10-05T10:00:00Z', kind: 'payment', what: 'Payment recorded', after: '6000', month },
    { id: '2', at: '2026-10-06T10:00:00Z', kind: 'spend', what: 'Logged spending', after: '30000', month },
    { id: '3', at: '2026-10-07T10:00:00Z', kind: 'settings', what: 'Debt-free date', before: 'Mar 2031', after: 'Jan 2031', month },
    { id: '4', at: '2026-10-07T10:00:00Z', kind: 'settings', what: 'Interest on the plan', before: '100', after: '90', month },
  ];
  const card = whatChanged(entries, month, 30000);
  assert.match(card.lines.join('\n'), /One payment recorded, ₹6,000/);
  assert.match(card.lines.join('\n'), /Spending logged at ₹30,000/);
  assert.match(card.lines.join('\n'), /The recent average is ₹30,000/);
  assert.match(card.lines.join('\n'), /Debt-free date moved from Mar 2031 to Jan 2031/);
  assert.match(card.lines.join('\n'), /Interest on the plan: 100 → 90/);
  assert.equal(whatChanged([], month, null).lines[0], 'Nothing recorded this month yet.');

  const { eventsForLoans, icsFor } = lib('calendar-ics.ts');
  const loans = [
    { id: 'h1', bank: 'HDFC', loan_type: 'home_loan', outstanding: '500000', scheduled_emi: '6000', tenure_months_remaining: 12, due_day: 5 },
    { id: 'p1', bank: 'Asha', loan_type: 'people_loan', outstanding: '10000', scheduled_emi: '0', tenure_months_remaining: 0, people_repay: 'whenever' },
    { id: 'p2', bank: 'Chit', loan_type: 'people_loan', outstanding: '8000', scheduled_emi: '0', tenure_months_remaining: 5, people_repay: 'lump', people_due: '2027-03', due_day: 15 },
  ];
  const events = eventsForLoans(loans, '2026-10');
  assert.equal(events.length, 2);
  assert.equal(events[0].uid, 'rightdue-h1-emi@rightdue.app');
  assert.equal(events[0].count, 12);
  const ics = icsFor(events);
  assert.match(ics, /RRULE:FREQ=MONTHLY;COUNT=12/);
  assert.match(ics, /UID:rightdue-p2-lump@rightdue.app/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270315/);
});

test('a loan from a person keeps its interest model and is not wiped on save', () => {
  const { peopleRate, peoplePatch, monthsUntil } = lib('people-loan.ts');
  const { finishShape, shapeError } = lib('repayment-shape.ts');
  assert.equal(peopleRate('none', '8', '100000'), '0');
  assert.equal(peopleRate('annual', '8.5', '100000'), String(8.5 / 100));
  assert.equal(peopleRate('monthly', '2', '100000'), String(24 / 100));
  assert.equal(peopleRate('fixed', '1000', '100000'), String(12000 / 100000));
  assert.equal(monthsUntil('2026-10', '2027-03'), 5);
  const base = { loan_type: 'people_loan', bank: 'Asha', outstanding: '100000', nominal_rate: '0', scheduled_emi: '0', tenure_months_remaining: 0 };
  const lump = peoplePatch(base, { interest: 'none', repay: 'lump', due: '2027-03', thisMonth: '2026-10' });
  assert.equal(lump.repayment, 'bullet');
  assert.equal(lump.tenure_months_remaining, 5);
  assert.equal(lump.lender_type, 'other');
  const saved = { ...base, ...lump };
  assert.deepEqual(finishShape(saved, '', '2026-10', 'INR'), {});
  assert.equal(shapeError(saved, '', '2026-10'), null);
  assert.equal(finishShape(saved, '', '2026-10', 'INR').tenure_months_remaining, undefined);
  const whenever = peoplePatch(base, { repay: 'whenever', thisMonth: '2026-10' });
  assert.equal(whenever.scheduled_emi, '0');
  assert.equal(whenever.tenure_months_remaining, 0);
  assert.equal(lib('loan-types.ts').LOAN_TYPE_NAME.people_loan, 'loan from a person');
});

test('two bureau reports of the same loan become one account', () => {
  const { mergeCreditReports, PASSWORD_HINTS, BUREAU_LINKS } = lib('credit-report.ts');
  const account = (extra) => ({
    fields: { lender: { value: 'HDFC Bank', source: 'Lender: HDFC Bank', note: '' } },
    loan_type: 'home_loan', is_open: true, is_guarantor: false, flags: [],
    loan: { loan_type: 'home_loan', lender: 'HDFC Bank', outstanding: '100', emi: '10', nominal_rate: null, tenure_months: null, sanctioned_amount: null, credit_limit: null, opened: '2020-01-01', account_last4: '4321', missing: [], ...extra },
  });
  const report = (name, balance) => ({
    bureau: name, bureau_name: name, score: null, report_date: null, warnings: name === 'cibil' ? [] : ["This doesn't look like a CIBIL, Experian, CRIF High Mark or Equifax report. Check every figure."],
    open_loans: 1, source: '', source_url: '', accounts: [account({ outstanding: balance })],
  });
  const merged = mergeCreditReports([report('CIBIL', '100000'), report('Experian', '90000')]);
  assert.equal(merged.accounts.length, 1);
  assert.equal(merged.accounts[0].loan.outstanding, '90000');
  assert.match(merged.bureau_name, /CIBIL/);
  assert.match(merged.bureau_name, /Experian/);
  assert.equal(PASSWORD_HINTS.length, 4);
  assert.equal(BUREAU_LINKS.length, 4);
  assert.match(src('components/profile/CreditReportImport.tsx'), /setFile\(null\)/);
  assert.match(src('components/profile/CreditReportImport.tsx'), /cr-edit/);
  assert.match(src('components/profile/CreditReportImport.tsx'), /Credit report imported/);
});
