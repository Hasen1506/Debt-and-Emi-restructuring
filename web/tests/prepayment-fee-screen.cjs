/**
 * Screen test: the prepayment box is hidden where RBI sets the charge to
 * zero, and shown under More options only where a charge can apply.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  return originalLoad.call(this, request, ...rest);
};
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
    }).outputText;
    module._compile(output, file);
  };
}

const { PrepaymentFeeFields } = require(path.join(root, 'components/profile/PrepaymentFeeFields.tsx'));
const { RBI_ZERO_NOTE } = require(path.join(root, 'lib/prepayment-fee.ts'));

function loan(over = {}) {
  return {
    loan_type: 'home_loan',
    rate_type: 'floating',
    bank: 'HDFC Bank',
    outstanding: '2500000',
    nominal_rate: '0.085',
    tenure_months_remaining: 180,
    scheduled_emi: '25000',
    currency: 'INR',
    ...over,
  };
}

function html(l, askOpen) {
  return renderToStaticMarkup(React.createElement(PrepaymentFeeFields, {
    loan: l, country: 'IN', askOpen, onChange() {},
  }));
}

const NOTE = 'No prepayment charge on floating-rate loans (RBI rule)';
const hasNote = (s) => s.includes(NOTE);

test('the note is the founder\'s sentence', () => {
  assert.equal(RBI_ZERO_NOTE, NOTE);
});

test('a floating-rate personal loan shows the note and no fee box', () => {
  const closed = html(loan(), false);
  assert.ok(hasNote(closed));
  assert.doesNotMatch(closed, /Prepayment fee/);
  const open = html(loan({ prepayment_penalty_pct: '0.02' }), true);
  assert.ok(hasNote(open));
  assert.doesNotMatch(open, /Prepayment fee/);
});

test('a fixed-rate loan asks for the fee only under More options', () => {
  const fixed = loan({ rate_type: 'fixed', loan_type: 'personal_loan' });
  assert.equal(html(fixed, false), '');
  const open = html(fixed, true);
  assert.match(open, /Prepayment fee/);
  assert.ok(!hasNote(open));
});

test('a business loan from a commercial bank sanctioned in 2026 is zero, and an NBFC is asked', () => {
  const bank = loan({ business_purpose: true, sanction_year: 2026, lender_type: 'bank', sanctioned_amount: '8000000' });
  assert.ok(hasNote(html(bank, true)));
  assert.doesNotMatch(html(bank, true), /Prepayment fee/);
  const nbfc = loan({ business_purpose: true, sanction_year: 2026, lender_type: 'nbfc', sanctioned_amount: '4000000', bank: 'A local lender' });
  const open = html(nbfc, true);
  assert.match(open, /Prepayment fee/);
  assert.match(open, /Kind of lender/);
  assert.match(open, /Amount sanctioned/);
  const hfc = loan({
    business_purpose: true, sanction_year: 2026, lender_type: 'hfc',
    sanctioned_amount: '4000000', bank: 'LIC Housing Finance',
  });
  assert.ok(hasNote(html(hfc, false)));
  assert.doesNotMatch(html(hfc, true), /Prepayment fee/);
});
