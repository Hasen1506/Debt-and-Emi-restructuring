const { profileSource } = require('./lib/profile-source.cjs'); // Audit 80 E15: Profile is split into parts/
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
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// PR K (founder decision 2026-10-08): prepayment fees in the payoff order,
// with no friction. A blank fee is 0% "assumed" on an Indian floating-rate
// loan (RBI Pre-payment Charges on Loans Directions, 2 July 2025, para 5(i))
// and "unknown, none assumed" otherwise; never a lender-specific number.

const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/prepayment_fee_defaults.json'), 'utf8'));

test('differential: the fee default equals the engine on every loan type, rate type and market', () => {
  const { prepaymentFeeDefault } = lib('prepayment-fee.ts');
  assert.equal(table.cases.length, 28);
  for (const c of table.cases) {
    const d = prepaymentFeeDefault(c.loan_type, c.rate_type, c.market);
    assert.deepEqual([d.pct, d.status, d.reason], [c.pct, c.status, c.reason], JSON.stringify(c));
  }
});

test('the form shows the default as "assumed" or "Not known", with its one-line reason, and never blocks', () => {
  const { feeShown, RBI_PREPAYMENT_URL } = lib('prepayment-fee.ts');
  const home = { loan_type: 'home_loan', rate_type: 'floating', prepayment_penalty_pct: '' };
  const a = feeShown(home, 'IN');
  assert.equal(a.status, 'assumed');
  assert.equal(a.placeholder, '0 (assumed)');
  assert.match(a.hint, /RBI/);
  assert.match(a.hint, /2 July 2025/);
  const fixed = feeShown({ loan_type: 'personal_loan', rate_type: 'fixed' }, 'IN');
  assert.equal(fixed.status, 'unknown');
  assert.equal(fixed.placeholder, 'Not known');
  assert.match(fixed.hint, /loan agreement/);
  // A ₹ loan held by a US resident follows the Indian rule; a $ loan doesn't.
  assert.equal(feeShown({ ...home, currency: 'INR' }, 'US').status, 'assumed');
  assert.equal(feeShown({ ...home, currency: 'USD' }, 'IN').status, 'unknown');
  assert.equal(feeShown({ ...home, prepayment_penalty_pct: '0.02' }, 'IN').status, 'entered');
  assert.match(RBI_PREPAYMENT_URL, /rbi\.org\.in\/Scripts\/NotificationUser\.aspx\?Id=12878/);
  // Setup and Profile use it; a blank fee is not an error and the label says optional.
  const qs = src('components/setup/QuickSetup.tsx');
  assert.match(qs, /label="Prepayment fee, % \(optional\)"/);
  assert.match(qs, /placeholder=\{feeShown\(loan, country\)\.placeholder\}/);
  assert.match(qs, /if \(fee && !/);
  const pc = profileSource();
  assert.match(pc, /hint=\{feeShown\(l, country\)\.hint\}/);
  assert.ok(!/frequently 2-4%/.test(pc), 'no made-up fee ranges in the help');
  // The bank chip is never offered where RBI fixes the fee.
  assert.match(pc, /feeShown\(l, country\)\.status === 'unknown' &&/);
});

test('"why this loan first": the engine\'s fee note reaches Home', () => {
  assert.match(src('lib/api.ts'), /payoff_order_note\?: string \| null;/);
  assert.match(src('components/plan/load-plan.ts'), /payoffOrderNote: scenario\.payoff_order_note \?\? null/);
  assert.match(src('components/home/HomeDebtFree.tsx'), /plan\.payoffOrderNote \? `\$\{plan\.payoffOrderNote\} `/);
});
