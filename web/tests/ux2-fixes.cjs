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
