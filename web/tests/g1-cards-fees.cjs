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
const Decimal = require('decimal.js');

// Sprint G1 (cards-fees), 2026-10-12. Mirrors engine/tests/test_g1_cards_fees.py.

test('#27: the web GST table is the engine one: card interest yes, loan interest no, every fee yes', () => {
  const { gstApplies, GST_APPLIES } = lib('gst.ts');
  assert.equal(gstApplies('card_interest'), true);
  assert.equal(gstApplies('loan_interest'), false);
  for (const k of ['processing_fee', 'prepayment_fee', 'late_fee', 'penal_charge', 'bounce_charge']) assert.equal(gstApplies(k), true, k);
  assert.throws(() => gstApplies('something_new'));
  assert.ok(Object.keys(GST_APPLIES).length >= 10);
});

test('#27: a gold / education / BNPL processing fee shows its GST line', () => {
  const { computeBreakdown } = lib('effective-apr.ts');
  for (const loan_type of ['gold_loan', 'education_loan', 'bnpl']) {
    const loan = { id: 'g', bank: 'Muthoot', loan_type, outstanding: '100000', nominal_rate: '0.12', currency: 'INR', tenure_months_remaining: 12, processing_fee_amortised: '0.01' };
    const b = computeBreakdown(loan, '0', 'IN', undefined);
    assert.ok(b.lines.some((l) => /GST on processing fee/.test(l.label)), loan_type);
  }
});

test('L3 / #25: a 42% card costs 60.31% a year: GST is never charged interest', () => {
  const { marginalCost, compounded } = lib('marginal-cost.ts');
  const mc = marginalCost('0.42', true, '0', '0', 0);
  assert.equal(mc.gst.toFixed(10), compounded('0.42').times('0.18').toFixed(10));
  assert.equal(mc.annualCost.toFixed(4), '0.6031');
});

test('#27: an Indian prepayment fee carries 18% GST in the marginal cost; a US one does not', () => {
  const { prepaymentFeeWithGst, loanMarginalCost } = lib('marginal-cost.ts');
  assert.equal(prepaymentFeeWithGst('0.04', true).toFixed(4), '0.0472');
  assert.equal(prepaymentFeeWithGst('0.04', false).toFixed(4), '0.0400');
  const loan = { id: 'p', bank: 'HDFC', loan_type: 'personal_loan', outstanding: '300000', nominal_rate: '0.14', rate_type: 'fixed', currency: 'INR', tenure_months_remaining: 24, prepayment_penalty_pct: '0.04' };
  assert.equal(loanMarginalCost(loan, 'IN', '0').fee.toFixed(4), '0.0236');
});

test('#28: the fee default by lender type and business purpose equals the engine on every case', () => {
  const { prepaymentFeeDefault } = lib('prepayment-fee.ts');
  const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../engine/tests/fixtures/prepayment_fee_lender_cases.json'), 'utf8'));
  assert.ok(table.cases.length > 500);
  for (const c of table.cases) {
    const a = c.args;
    const d = prepaymentFeeDefault(a.loan_type, a.rate_type, a.market, {
      lenderType: a.lender_type ?? undefined,
      businessPurpose: a.business_purpose ?? undefined,
      sanctionYear: a.sanction_year ?? undefined,
      sanctionedAmount: a.sanctioned_amount ?? undefined,
    });
    assert.deepEqual([d.pct, d.status, d.reason], [c.pct, c.status, c.reason], JSON.stringify(a));
  }
});

test('#28: the form reads the business answer: an NBFC business loan is "Not known", a personal one "assumed"', () => {
  const { feeShown } = lib('prepayment-fee.ts');
  const base = { loan_type: 'personal_loan', rate_type: 'floating', prepayment_penalty_pct: '', lender_type: 'nbfc' };
  assert.equal(feeShown({ ...base, business_purpose: true, sanction_year: 2026 }, 'IN').status, 'unknown');
  assert.equal(feeShown({ ...base, business_purpose: false }, 'IN').status, 'assumed');
  assert.equal(feeShown({ ...base, lender_type: 'other' }, 'IN').status, 'unknown');
});

test('#26: a card minimum is an estimate, and an Indian one never sits below interest + GST', () => {
  const { explainMinPayment, STATEMENT_MIN_ADVICE } = lib('min-payment.ts');
  const e = explainMinPayment({ loan_type: 'credit_card', bank: 'AmEx India', outstanding: '100000', nominal_rate: '0.42' }, 'IN');
  assert.equal(e.verified, false);
  assert.equal(e.advice, STATEMENT_MIN_ADVICE);
  assert.match(e.advice, /statement/);
  // 100000 × 3.5% × 1.18 = 4,130 (2% of the balance would be 2,000).
  assert.ok(new Decimal(e.estimated).gte(4130), e.estimated);
});
