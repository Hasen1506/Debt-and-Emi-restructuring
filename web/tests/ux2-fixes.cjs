// UX walkthrough round 2 fixes, part A (16 Oct 2026, work/reports/ux-walkthrough-2.md).
// Each test names the finding it guards.
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
    m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const lib = (n) => require(path.join(root, 'lib', n));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── #1 ──────────────────────────────────────────────────────────────────────
test('#1: a payment just above the interest gets its real months left, not none', () => {
  const { deriveTenureMonths } = lib('derived.ts');
  assert.ok(Math.abs(deriveTenureMonths('300000', '0.14', '3501') - 703) <= 1);        // ₹3 L at 14%, EMI ₹3,501
  assert.ok(Math.abs(deriveTenureMonths('45000', '0.089', '334') - 974) <= 1);        // HELOC $45k at 8.9%, $334
  assert.equal(deriveTenureMonths('300000', '0.14', '3500.001'), null);     // past 100 years
  assert.equal(deriveTenureMonths('300000', '0.14', '3500'), null);       // never
});

test('#1: Setup warns when only a sliver of the payment reaches the balance, and blocks past 100 years', () => {
  const { slowPayoffNote, emiBelowInterest, loanDraftErrors } = lib('loan-gaps.ts');
  const loan = { loan_type: 'personal_loan', outstanding: '300000', nominal_rate: '0.14', scheduled_emi: '3501' };
  const note = slowPayoffNote(loan, 'INR', 'IN', 703);
  assert.match(note, /Only about ₹1 of the ₹3,501 EMI goes to the balance/);
  assert.match(note, /over 58 years/);
  const us = slowPayoffNote({ outstanding: '45000', nominal_rate: '0.089', scheduled_emi: '334' }, 'USD', 'US', 974);
  assert.match(us, /\$334 monthly payment/);
  assert.doesNotMatch(us, /EMI/);
  assert.equal(slowPayoffNote({ outstanding: '300000', nominal_rate: '0.14', scheduled_emi: '7000' }, 'INR', 'IN', 60), '');
  assert.equal(loanDraftErrors(loan, 'IN').emi, undefined);               // a warning, not a block
  assert.match(emiBelowInterest({ ...loan, scheduled_emi: '3500.001' }, 'IN'), /would take over 100 years/);
  assert.ok(loanDraftErrors({ ...loan, scheduled_emi: '3500.001' }, 'IN').emi);
  assert.match(src('components/setup/QuickSetup.tsx'), /slowPayoffNote\(loan, ccy, country, tenure\)/);
});

test('#1: rolling a loan with unknown months left forward keeps it unknown (no 1-month balloon)', () => {
  const { rollBalancesForward } = lib('roll-forward.ts');
  const loan = { id: 'p', loan_type: 'personal_loan', outstanding: '300000', nominal_rate: '0.14', scheduled_emi: '3501', tenure_months_remaining: 0, balance_after_emi: true, balance_as_of: '2026-10-05' };
  assert.equal(rollBalancesForward([loan], '2026-10').loans[0].tenure_months_remaining, 0);
  assert.equal(rollBalancesForward([{ ...loan, tenure_months_remaining: 703 }], '2026-10').loans[0].tenure_months_remaining, 704);
});

// ── #2 ──────────────────────────────────────────────────────────────────────
test('#2: Setup takes 0 take-home pay (blank is still an error) and says what the plan does', () => {
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /const incomeOk = income\.trim\(\) !== '' && isAmount\(income\);/);
  assert.doesNotMatch(qs, /Number\(income\) > 0/);
  assert.match(qs, /NO_PAY_HINT = 'No pay coming in right now\? 0 is fine/);
  // The short-of-cash preview on step 3 keeps its priority order and /cant-pay link.
  assert.match(src('components/setup/SetupThisMonth.tsx'), /shortPriorityText[\s\S]*href="\/cant-pay"/);
});

// ── #4, #18 ─────────────────────────────────────────────────────────────────
test('#4: a loan rate up to 1,000% a year is accepted with a high-cost note; other rates stay 0-100%', () => {
  const g = lib('loan-gaps.ts');
  const payday = { loan_type: 'personal_loan', outstanding: '500', nominal_rate: '3.91', scheduled_emi: '250' };
  assert.deepEqual(g.loanDraftErrors(payday, 'US'), {});
  assert.deepEqual(g.loanGaps({ ...payday, tenure_months_remaining: 3 }), []);
  assert.match(g.rateSanityNote('personal_loan', '3.91', 'US'), /391% a year is a very high-cost loan/);
  assert.equal(g.rateSanityNote('personal_loan', '0.14', 'IN'), null);
  assert.match(g.loanDraftErrors({ ...payday, nominal_rate: '10.5' }, 'US').rate, /above 1,000% a year/);
  assert.match(g.rateOutOfRange('1.2'), /above 100% a year/);                      // a rate-reset / tool rate
  assert.match(g.setupSummaryLine({ invalid: true, outOfRange: true }), /0 to 1,000% a year/);
  assert.match(src('components/setup/QuickSetup.tsx'), /hint=\{rateSanityNote\(loan\.loan_type, loan\.nominal_rate, country\)/);
});

test('#18: a card at 3.5% gets "monthly rate? enter 42"; 120% on a loan points at the rate, not the balance', () => {
  const g = lib('loan-gaps.ts');
  assert.match(g.rateSanityNote('credit_card', '0.035', 'IN'), /If 3\.5% is the monthly rate, enter 42 \(3\.5% × 12 months\)/);
  assert.match(g.rateSanityNote('credit_card', '1.2', 'IN'), /far above card rates/);
  assert.equal(g.rateSanityNote('credit_card', '0.42', 'IN'), null);
  const typo = { loan_type: 'personal_loan', outstanding: '500000', nominal_rate: '1.2', scheduled_emi: '12000' };
  const msg = g.loanDraftErrors(typo, 'IN').emi;
  assert.match(msg, /Check the rate \(did you mean 12%\?\)/);
  assert.doesNotMatch(msg, /did you mean ₹50,000/);
});

// ── #6 ──────────────────────────────────────────────────────────────────────
test('#6: the Setup draft lives in this browser (new tab, days later) and goes on finish or sign-out', () => {
  const d = lib('setup-draft.ts');
  const store = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const w = { localStorage: store(), sessionStorage: store() };
  const now = 1_760_000_000_000;
  w.localStorage.setItem(d.SETUP_DRAFT_KEY, d.serializeDraft({ takeHome: '80000' }, 1, now));
  const threeDays = now + 3 * 24 * 3600 * 1000;
  assert.equal(d.parseDraft(d.readDraftText(w), threeDays).state.takeHome, '80000');      // a first Setup, days later
  assert.equal(d.parseDraft(d.readDraftText(w), threeDays, d.SETUP_EDIT_DRAFT_MAX_AGE_MS), null); // editing a saved profile: 6 h
  assert.equal(d.parseDraft(d.readDraftText(w), now + d.SETUP_DRAFT_MAX_AGE_MS + 1), null);
  // A draft an older build left in this tab still comes back once.
  const old = { localStorage: store(), sessionStorage: store() };
  old.sessionStorage.setItem(d.SETUP_DRAFT_KEY, 'x');
  assert.equal(d.readDraftText(old), 'x');
  d.dropDraft(w); d.dropDraft(old);
  assert.equal(d.readDraftText(w), null);
  assert.equal(d.readDraftText(old), null);
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /window\.localStorage\.setItem\(SETUP_DRAFT_KEY/);
  assert.doesNotMatch(qs, /sessionStorage\.(get|set)Item\(SETUP_DRAFT_KEY/);
  assert.match(qs, /readDraft\(stored\.isLive\)/);
  assert.match(src('lib/auth.ts'), /clearPendingSync\(\);\n\s*\(await import\('\.\/setup-draft'\)\)\.dropDraft\(\)/);
  assert.ok(lib('account.ts').LOCAL_PREFIXES.some((p) => d.SETUP_DRAFT_KEY.startsWith(p)));        // "Clear this browser" too
});

// ── #7 ──────────────────────────────────────────────────────────────────────
test('#7: a pasted "123 456" code is not cut short, and too many tries says so', () => {
  const page = src('app/login/page.tsx');
  const input = page.slice(page.indexOf('autoComplete="one-time-code"'), page.indexOf('placeholder="••••••"'));
  assert.doesNotMatch(input, /maxLength=/);
  assert.match(input, /setCode\(e\.target\.value\.replace\(\/\\D\/g, ''\)\.slice\(0, 6\)\)/);
  const keep = (raw) => raw.replace(/\D/g, '').slice(0, 6);           // the onChange above
  assert.equal(keep('123 456'), '123456');
  assert.equal(keep('123-456'), '123456');
  const { authErrorMessage } = lib('auth-error.ts');
  assert.equal(authErrorMessage(429, JSON.stringify({ detail: 'Too many attempts. Request a new code.' }), null), 'Too many attempts. Request a new code.');
  assert.match(authErrorMessage(429, JSON.stringify({ detail: 'Too many wrong codes for this email today. Try again tomorrow.' }), '86400'), /Try again tomorrow/);
  assert.doesNotMatch(authErrorMessage(429, JSON.stringify({ detail: 'Too many attempts. Request a new code.' }), null), /busy/);
  assert.match(authErrorMessage(429, JSON.stringify({ detail: 'Rate limit exceeded: 5 per 1 minute' }), null), /Wait a minute/);   // not ours: as before
  assert.match(authErrorMessage(429, 'unknown', '30'), /Wait 30 seconds/);
});

test('#7: the per-connection limit keeps its "wait N seconds"', () => {
  const { authErrorMessage } = lib('auth-error.ts');
  assert.match(authErrorMessage(429, JSON.stringify({ detail: 'Too many requests from this connection. Wait a minute and try again.' }), '20'), /Wait 20 seconds/);
});

// ── #16 ─────────────────────────────────────────────────────────────────────
test('#16: a lender name keeps its capitals mid-sentence; only generic names are lowered', () => {
  const { lowerName } = lib('home-this-month.ts');
  assert.equal(lowerName('Bajaj Auto Finance car loan'), 'Bajaj Auto Finance car loan');
  assert.equal(lowerName('Kotak Mahindra personal loan'), 'Kotak Mahindra personal loan');
  assert.equal(lowerName('Car loan'), 'car loan');
  assert.equal(lowerName('Credit card 2'), 'credit card 2');
  assert.equal(lowerName('HDFC Bank credit card'), 'HDFC Bank credit card');
});

test('#16: the short-month sentence uses the same rule', () => {
  assert.match(src('lib/short-priority.ts'), /the \$\{lowerName\(l\.name\)\} \$\{money\(l\.short\)\} short/);
});

// ── #17 ─────────────────────────────────────────────────────────────────────
test('#17: the months-left hint ends a month later when this month’s EMI is already paid or the first EMI is next month', () => {
  const { lastEmiMonthIndex } = lib('roll-forward.ts');
  assert.equal(lastEmiMonthIndex({ balance_after_emi: false }, 60, '2026-10'), 60);
  assert.equal(lastEmiMonthIndex({}, 60, '2026-10'), 60);
  assert.equal(lastEmiMonthIndex({ balance_after_emi: true }, 60, '2026-10'), 61);
  assert.equal(lastEmiMonthIndex({ first_emi_month: '2026-11' }, 60, '2026-10'), 61);
  assert.equal(lastEmiMonthIndex({ first_emi_month: '2027-01' }, 60, '2026-10'), 63);
  assert.match(src('components/setup/QuickSetup.tsx'), /monthIndexToCountryLabel\(lastEmiMonthIndex\(loan, tenure, thisMonth\)( \+ moratoriumMonths\(loan, end, thisMonth\))?, country\)/);
});

// ── #3 ──────────────────────────────────────────────────────────────────────
test('#3: Setup offers how a loan is repaid; cards and pay later have no choice; US says payment', () => {
  const r = lib('repayment-shape.ts');
  assert.equal(r.shapeChoices('credit_card', 'IN'), null);
  assert.equal(r.shapeChoices('bnpl', 'IN'), null);
  assert.deepEqual(r.shapeChoices('gold_loan', 'IN').map(([s]) => s), ['emi', 'interest_only', 'bullet']);
  assert.match(r.shapeChoices('education_loan', 'IN')[1][1], /Moratorium/);
  assert.equal(r.shapeChoices('education_loan', 'US')[0][1], 'Monthly payments');
  assert.match(r.shapeChoices('personal_loan', 'IN')[1][1], /overdraft, credit line/);
});

test('#3: an education moratorium saves as a pre-EMI window, then EMIs (typed, or 10 years estimated)', () => {
  const r = lib('repayment-shape.ts');
  const edu = { id: 'e', loan_type: 'education_loan', outstanding: '1200000', nominal_rate: '0.1', scheduled_emi: '0', tenure_months_remaining: 0, repayment: 'interest_only' };
  const f = r.finishShape(edu, '2027-06', '2026-10', 'INR');
  assert.equal(f.repayment, 'emi');
  assert.equal(f.pre_emi_months_remaining, 8);
  assert.equal(f.tenure_months_remaining, 120);
  assert.ok(Number(f.scheduled_emi) > 15000 && Number(f.scheduled_emi) < 16500);   // ₹12 L, 10%, 120 months ≈ ₹15,858
  assert.ok(f.estimated_fields.includes('emi'));
  const typed = r.finishShape({ ...edu, scheduled_emi: '20000', tenure_months_remaining: 80 }, '2027-06', '2026-10', 'INR');
  assert.equal(typed.scheduled_emi, '20000');
  assert.equal(typed.tenure_months_remaining, 80);
  assert.equal(r.shapeOf({ ...edu, repayment: 'emi', pre_emi_months_remaining: 8 }), 'interest_only');
  assert.equal(r.savedEndMonth({ ...edu, repayment: 'emi', pre_emi_months_remaining: 8 }, '2026-10'), '2027-06');
  assert.ok(r.emiOptional(edu, '2027-06'));
  assert.match(r.shapeNote(edu, '2027-06', (v) => `₹${Math.round(v)}`, 'IN'), /Interest of about ₹10000 a month until 2027-06, then the EMI below/);
});

test('#3: an overdraft is interest only with no end; a gold loan is a bullet with a due month; errors are plain', () => {
  const r = lib('repayment-shape.ts');
  const od = { loan_type: 'personal_loan', outstanding: '200000', nominal_rate: '0.12', scheduled_emi: '', tenure_months_remaining: 0, repayment: 'interest_only' };
  assert.deepEqual(r.finishShape(od, '', '2026-10', 'INR'), { repayment: 'interest_only', scheduled_emi: '2000', tenure_months_remaining: 0, pre_emi_months_remaining: 0 });
  assert.equal(r.finishShape(od, '2027-10', '2026-10', 'INR').tenure_months_remaining, 12);
  assert.equal(r.shapeError(od, '', '2026-10'), null);
  const gold = { loan_type: 'gold_loan', outstanding: '100000', nominal_rate: '0.09', scheduled_emi: '', tenure_months_remaining: 0, repayment: 'bullet' };
  assert.match(r.shapeError(gold, '', '2026-10'), /month it is due/);
  assert.match(r.shapeError(gold, '2026-09', '2026-10'), /after this one/);
  assert.match(r.shapeError(gold, 'June', '2026-10'), /year-month/);
  assert.deepEqual(r.finishShape(gold, '2027-04', '2026-10', 'INR'), { repayment: 'bullet', scheduled_emi: '0', tenure_months_remaining: 6, pre_emi_months_remaining: 0 });
  assert.deepEqual(r.finishShape({ ...od, repayment: undefined }, '', '2026-10', 'INR'), { repayment: undefined, pre_emi_months_remaining: 0 });
});

test('#3: interest-only, bullet and US income-driven loans are not "never paid off"', () => {
  const g = lib('loan-gaps.ts');
  const base = { loan_type: 'education_loan', outstanding: '1200000', nominal_rate: '0.1', scheduled_emi: '10000' };
  assert.ok(g.loanDraftErrors(base, 'IN').emi);                                   // an EMI loan: still blocked
  assert.deepEqual(g.loanDraftErrors({ ...base, repayment: 'interest_only' }, 'IN'), {});
  assert.deepEqual(g.loanDraftErrors({ ...base, repayment: 'bullet', scheduled_emi: '0' }, 'IN'), {});
  const idr = { loan_type: 'education_loan', outstanding: '60000', nominal_rate: '0.065', scheduled_emi: '150', currency: 'USD', forgiveness_track: 'idr' };
  assert.equal(g.emiBelowInterest(idr, 'US'), null);
  assert.deepEqual(g.loanDraftErrors(idr, 'US'), {});
  assert.deepEqual(g.loanGaps({ ...base, repayment: 'bullet', scheduled_emi: '0', tenure_months_remaining: 6 }), []);
  const rf = lib('roll-forward.ts');
  assert.equal(rf.asksEmiPaid({ ...base, repayment: 'interest_only' }, undefined), false);
  assert.equal(rf.asksEmiPaid({ ...base, repayment: 'bullet' }, undefined), false);
  assert.equal(rf.asksEmiPaid(base, undefined), true);
});

test('#3: the chips render on Setup loans, and QuickSetup saves through finishShape', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { RepaymentChips } = require(path.join(root, 'components/setup/RepaymentChips.tsx'));
  const html = (loan, end = '') => renderToStaticMarkup(React.createElement(RepaymentChips, { loan, country: 'IN', endMonth: end, onPatch() {}, onEnd() {}, money: (v) => `₹${v}` }));
  const gold = { id: 'g', loan_type: 'gold_loan', outstanding: '100000', nominal_rate: '0.09', scheduled_emi: '', tenure_months_remaining: 0, repayment: 'bullet' };
  assert.match(html(gold), /All at the end/);
  assert.match(html(gold), /Due month \(year-month\)/);
  assert.equal(html({ ...gold, loan_type: 'credit_card' }), '');
  assert.doesNotMatch(html({ ...gold, repayment: undefined }), /year-month/);       // EMI: no end month box
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /<RepaymentChips loan=\{loan\}/);
  assert.match(qs, /Object\.assign\(out, finishShape\(out, endOf\(l\), thisMonth, loanCurrency\(l, country\)\)\)/);
  assert.match(qs, /\{!card && !ui\.byMonths && shapeNeedsEmi\(loan, end\) && \(/);
});

// ── Part B (work/reports/ux-fix-2b.md) ──────────────────────────────────────
test('B1 (#3 gaps): moratorium months move the end month on, count interest now, and a type switch drops a stale shape', () => {
  const r = lib('repayment-shape.ts');
  const edu = { loan_type: 'education_loan', outstanding: '1000000', nominal_rate: '0.12', scheduled_emi: '14347', repayment: 'interest_only', pre_emi_months_remaining: 0 };
  assert.equal(r.moratoriumMonths(edu, '2027-10', '2026-10'), 12);
  assert.equal(r.moratoriumMonths({ ...edu, repayment: undefined }, '2027-10', '2026-10'), 0);
  assert.equal(r.payingNow(edu, '2027-10', 'INR'), '10000');            // interest, not the ₹14,347 EMI after
  assert.equal(r.payingNow({ ...edu, repayment: undefined }, '', 'INR'), null);
  const gold = { loan_type: 'gold_loan', outstanding: '100000', nominal_rate: '0.1', scheduled_emi: '0', repayment: 'bullet' };
  assert.deepEqual(r.typeSwitch(gold, 'personal_loan', 'IN'), { loan_type: 'personal_loan', repayment: undefined, pre_emi_months_remaining: 0 });
  assert.deepEqual(r.typeSwitch({ ...gold, repayment: 'interest_only' }, 'personal_loan', 'IN'), { loan_type: 'personal_loan' });
  assert.equal(r.typeSwitch({ ...gold, repayment: 'interest_only' }, 'credit_card', 'IN').repayment, undefined);
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /payingNow\(l, endOf\(l\), ccy\) \?\? emiOf\(l\)/);
  assert.match(qs, /onPatch\(typeSwitch\(loan, t, country\)\)/);
  assert.match(qs, /\+ moratoriumMonths\(loan, end, thisMonth\)/);
});

test('B2 (#8): Home cash flow and the loans total use the plan’s month-1 dues, the figure “This month” uses', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { CashFlow } = require(path.join(root, 'components/home/LedgerHome.tsx'));
  const card = (bank) => ({ id: bank, loan_type: 'credit_card', bank, outstanding: '60000', nominal_rate: '0.45', scheduled_emi: '0', tenure_months_remaining: 0 });
  const profile = { user: { country: 'IN', monthly_income: '65000', fixed_expenses: '30000', variable_expenses: '0', loans: [card('Axis Bank'), card('HDFC Bank')] }, marginalRate: '0', creditScore: null, isLive: true };
  const html = renderToStaticMarkup(React.createElement(CashFlow, { profile, dues: 26590 }));
  assert.match(html, /EMIs and card minimums ₹26,590/);
  assert.match(html, /₹8,410/);                                            // 65,000 − 30,000 − 26,590
  const page = src('app/page.tsx');
  assert.match(page, /<HomeCashFlow \/>/);
  assert.match(page, /<HomeDuesTotal \/>/);
  assert.match(src('components/home/HomeDebtFree.tsx'), /payThisMonth\(plan\)\?\.duesUser/);
  assert.match(src('components/home/OpenPositions.tsx'), /MINIMUMS \{dues \?\? /);
});

test('B3 (#12): a pitch banks would likely refuse gets one quiet line; the extra’s saving runs only until the loan clears', () => {
  const { extraSaving, loanClearsMonth } = lib('this-month.ts');
  assert.deepEqual(extraSaving(1774, 0.6031, null), { amount: 1070, months: 12 });
  assert.deepEqual(extraSaving(1774, 0.6031, 2), { amount: 178, months: 2 });   // not ₹1,070 beside ₹261 of interest
  assert.equal(loanClearsMonth({ trajectory: [{ month: 1, balancesByLoanIndex: { 0: '900' } }, { month: 2, balancesByLoanIndex: { 0: '0' } }] }, 0), 2);
  assert.equal(loanClearsMonth({ trajectory: [{ month: 1, balancesByLoanIndex: { 0: '900' } }] }, 0), null);
  assert.match(src('components/home/HomeDebtFree.tsx'), /before the loan is cleared in/);
  const { notWorthLine } = require(path.join(root, 'components/insights/CheaperWay.tsx'));
  assert.match(notWorthLine({ cards: [0], not_worth_it: 'not_approvable' }, 'card', () => ''), /unlikely to be approved/);
});

test('B4 (#15): pay later keeps its name and reads as payments, not EMIs', () => {
  const t = lib('loan-types.ts');
  assert.equal(t.loanLabel({ bank: 'Simpl', loan_type: 'bnpl' }), 'Simpl pay later');
  assert.equal(t.loanLabel({ loan_type: 'bnpl' }), 'Pay later');
  assert.doesNotMatch(JSON.stringify([t.LOAN_TYPE_NAME, t.LOAN_TYPE_SHORT]), /BNPL/);
  const op = src('components/home/OpenPositions.tsx');
  assert.match(op, /const payTag = later \? 'PAYMENT' : emiTag;/);
  assert.match(op, /PAYMENT\$\{n === 1 \? '' : 'S'\} LEFT/);
  assert.match(op, /isCard \? 'MINIMUM' : payTag/);
});

test('B5 (#5): a 0% card is taken, with an optional end month and the rate after it', () => {
  const g = lib('loan-gaps.ts');
  const bt = { loan_type: 'credit_card', outstanding: '300000', nominal_rate: '0', scheduled_emi: '0' };
  assert.equal(g.loanDraftErrors(bt, 'US').rate, undefined);
  assert.deepEqual(g.loanGaps(bt), []);
  assert.ok(g.loanDraftErrors({ ...bt, nominal_rate: '' }, 'US').rate);              // blank is still missing
  assert.match(g.rateSanityNote('credit_card', '0', 'US'), /Add when it ends and the rate after/);
  const p = lib('promo-rate.ts');
  assert.equal(p.promoError({}, '2026-10'), null);
  assert.match(p.promoError({ promo_until: '2027-04' }, '2026-10'), /rate after the offer ends/);
  assert.equal(p.promoError({ promo_until: '2027-04', rate_after_promo: '0.2499' }, '2026-10'), null);
  assert.match(p.promoError({ promo_until: '2026-05', rate_after_promo: '0.2499' }, '2026-10'), /passed/);
  assert.equal(p.promoForEngine({ ...bt, promo_until: '2027-04', rate_after_promo: '0.2499' }, '2026-10').promo_months, 7);
  assert.equal(p.promoForEngine({ ...bt, promo_until: '2026-09', rate_after_promo: '0.2499' }, '2026-10').nominal_rate, '0.2499');
  assert.equal(p.promoForEngine(bt, '2026-10'), bt);
  assert.match(src('components/plan/load-plan.ts'), /promoForEngine\(l, planMonth\)/);
  assert.match(src('components/setup/QuickSetup.tsx'), /<PromoFields loan=\{loan\}/);
});
