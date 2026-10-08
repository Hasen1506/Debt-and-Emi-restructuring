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
for (const ext of ['.ts', '.tsx'])
    require.extensions[ext] = (module, file) => {
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true } }).outputText;
        module._compile(output, file);
    };
const lib = name => require(path.join(root, 'lib', name));
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Roadmap PR G (founder approval 2026-10-08): two sources of rates, neither a
// seeded number. (1) The user's own loan, read from its RBI Key Facts
// Statement (RBI/2024-25/18, 15 Apr 2024) and confirmed field by field.
// (2) What banks lent at last quarter, from their own disclosures (RBI
// 22 Jan 2015, para 2(a)), with a refinance hint only when it pays.

const fixtures = path.resolve(__dirname, '../../engine/tests/fixtures/rate_disclosures');
const file = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'rate-disclosures.json'), 'utf8'));

// A small disclosures file in the committed shape, so the logic tests don't
// move when the weekly job commits a new quarter.
const sample = {
  rule: 'RBI/2014-15/422', rule_url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=9508&Mode=0', as_of: '2026-10-08',
  lenders: [
    { lender_id: 'IN_SBI', name: 'SBI', source_url: 'https://sbi.example/pl', fetched_at: '2026-10-08T04:00:00Z',
      rows: [{ label: 'SBI Personal Loan scheme', category: 'personal_loan', min: null, max: null, mean: '0.1154', mean_kind: 'mean', apr_min: null, apr_max: null, apr_mean: null, period_start: '2026-04-01', period_end: '2026-06-30', period_label: 'Apr-Jun 2026 (Q1 FY 2026-27)' }] },
    { lender_id: 'IN_HDFC', name: 'HDFC Bank', source_url: 'https://hdfc.example/pl', fetched_at: '2026-10-08T04:00:00Z',
      rows: [{ label: 'Personal Loan', category: 'personal_loan', min: '0.0997', max: '0.2406', mean: '0.1089', mean_kind: 'average', apr_min: '0.0999', apr_max: '0.3394', apr_mean: '0.1118', period_start: '2026-04-01', period_end: '2026-06-30', period_label: 'Apr-Jun 2026 (Q1 FY 2026-27)' }] },
    { lender_id: 'IN_AXIS', name: 'Axis Bank', source_url: 'https://axis.example/pl', fetched_at: '2026-10-08T04:00:00Z',
      rows: [{ label: 'Personal Loan', category: 'personal_loan', min: '0.0875', max: '0.2155', mean: '0.1307', mean_kind: 'mean', apr_min: null, apr_max: null, apr_mean: null, period_start: '2026-04-01', period_end: '2026-06-30', period_label: 'Apr-Jun 2026 (Q1 FY 2026-27)' },
             { label: 'Old', category: 'personal_loan', min: '0.09', max: '0.20', mean: '0.12', mean_kind: 'mean', apr_min: null, apr_max: null, apr_mean: null, period_start: '2026-01-01', period_end: '2026-03-31', period_label: 'Jan-Mar 2026 (Q4 FY 2025-26)' }] },
  ],
};
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

test('the market view: latest quarter only, one line per bank, sources kept, nothing invented', () => {
  const { marketFor, headline, bankLine } = lib('market-rates.ts');
  const v = marketFor('personal_loan', sample);
  assert.equal(v.periodLabel, 'Apr-Jun 2026 (Q1 FY 2026-27)');
  assert.deepEqual(v.banks.map((b) => b.name), ['HDFC Bank', 'SBI', 'Axis Bank']);
  assert.equal(v.low, 0.0875);
  assert.equal(v.high, 0.2406);
  assert.equal(v.typicalMean, 0.1154);
  assert.equal(headline(v), "3 banks lent personal loans at 8.75%–24.06% in Apr-Jun 2026 (Q1 FY 2026-27); the middle bank's mean was 11.54%.");
  // SBI publishes only its mean, so only its mean is shown.
  assert.equal(bankLine(v.banks.find((b) => b.name === 'SBI')), 'SBI: mean 11.54%');
  assert.equal(bankLine(v.banks.find((b) => b.name === 'HDFC Bank')), 'HDFC Bank: 9.97%–24.06% (average 10.89%)');
  assert.ok(v.banks.every((b) => b.sourceUrl.startsWith('https://')));
  // A kind of loan no bank's page covers shows nothing; so does a card.
  assert.equal(marketFor('home_loan', sample), null);
  assert.equal(marketFor('credit_card', sample), null);
});

test('the committed disclosures file is what the web reads, and every row has a source and quarter', () => {
  const { marketFor } = lib('market-rates.ts');
  const dated = fs.readdirSync(path.resolve(__dirname, '../../api/data/rate_disclosures')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const newest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../api/data/rate_disclosures', dated[dated.length - 1]), 'utf8'));
  assert.deepEqual(file, newest);
  for (const l of file.lenders) {
    assert.match(l.source_url, /^https:\/\//);
    for (const r of l.rows) assert.ok(r.period_label && r.mean);
  }
  const pl = marketFor('personal_loan');
  assert.ok(pl && pl.banks.length >= 3, 'personal-loan disclosures from at least three banks');
  assert.ok(fs.existsSync(path.join(fixtures, 'pages.json')));
});

test('refinance: only when the saving clears the foreclosure charge (with GST) by 1% of the balance', () => {
  const { marketFor, refinanceHint } = lib('market-rates.ts');
  const v = marketFor('personal_loan', sample);
  const base = { outstanding: 500000, monthsLeft: 48, prepaymentFee: 0, feeKnown: true, gstOnFee: true };
  // 18% against a typical 11.54%: worth a look.
  const h = refinanceHint({ ...base, rate: 0.18 }, v, inr);
  assert.ok(h);
  assert.equal(h.targetRate, 0.1154);
  assert.ok(h.interestSaved > 60000 && h.interestSaved < 80000, String(h.interestSaved));
  assert.match(h.text, /^You may be able to refinance\./);
  assert.match(h.text, /processing fee and charges would have to come to less than/);
  // A 4% fee plus GST comes off the saving, and the text says so.
  const withFee = refinanceHint({ ...base, rate: 0.18, prepaymentFee: 0.04 }, v, inr);
  assert.equal(Math.round(withFee.switchCost), Math.round(500000 * 0.04 * 1.18));
  assert.ok(withFee.net < h.net);
  assert.match(withFee.text, /prepayment fee takes about ₹23,600 with GST/);
  // Not warranted: close to the typical rate, too few months, or a fee that eats the saving.
  assert.equal(refinanceHint({ ...base, rate: 0.12 }, v, inr), null);
  assert.equal(refinanceHint({ ...base, rate: 0.18, monthsLeft: 4 }, v, inr), null);
  assert.equal(refinanceHint({ ...base, rate: 0.135, monthsLeft: 12, prepaymentFee: 0.05 }, v, inr), null);
  // A fixed-rate loan whose fee nobody knows: the hint says to check it.
  assert.match(refinanceHint({ ...base, rate: 0.18, feeKnown: false }, v, inr).text, /prepayment fee isn't known/);
});

test('KFS review: every field marked from your KFS / worked out / you entered, editing makes it yours', () => {
  const { reviewRows, editRow, loanFromReview, provenanceLabel, kfsNote, dropKfsFields } = lib('kfs.ts');
  const res = {
    is_kfs: true,
    fields: {
      lender: { value: 'Demo Finance Limited', source: 'Demo Finance Limited', note: '' },
      interest_rate: { value: '0.0925', source: 'Rate of Interest: 9.25% p.a. (Fixed)', note: '' },
      sanctioned_amount: { value: '800000', source: 'Loan Amount: Rs. 8,00,000/-', note: '' },
      emi: { value: '16704', source: 'EMI: Rs. 16,704/-', note: '' },
      prepayment_charge: { value: '0.05', source: 'Foreclosure / Prepayment charges: 5% of principal outstanding', note: '5% of the amount prepaid' },
    },
    checks: [{ kind: 'emi', ok: true, stated: '16704', computed: '16703.6', message: 'The EMI checks out' }],
    loan: { bank: 'Demo Finance Limited', loan_type: 'auto_loan', rate_type: 'fixed', nominal_rate: '0.0925', scheduled_emi: '16704',
      outstanding: '265192.28', tenure_months_remaining: '17', prepayment_penalty_pct: '0.05', processing_fee_amortised: null, first_emi_month: null },
    derived: { outstanding: '43 EMIs due since 05 Apr 2023 taken off the ₹8,00,000 sanctioned' },
    warnings: [], circular: '', circular_url: '',
  };
  let rows = reviewRows(res);
  const by = (k) => rows.find((r) => r.key === k);
  assert.equal(rows.length, 10, 'every field the KFS can fill is shown, read or not');
  assert.equal(by('nominal_rate').provenance, 'kfs');
  assert.equal(by('nominal_rate').source, 'Rate of Interest: 9.25% p.a. (Fixed)');
  assert.equal(by('outstanding').provenance, 'derived');
  assert.equal(by('processing_fee_amortised').provenance, 'user');
  assert.equal(by('prepayment_penalty_pct').source, 'Foreclosure / Prepayment charges: 5% of principal outstanding (5% of the amount prepaid)');
  assert.equal(provenanceLabel('kfs'), 'from your KFS');
  assert.equal(provenanceLabel('derived'), 'worked out from your KFS');
  assert.equal(provenanceLabel('user'), 'you entered');
  rows = editRow(rows, 'nominal_rate', '0.095');
  assert.equal(by('nominal_rate').provenance, 'user');
  const loan = loanFromReview(rows, { id: 'x', loan_type: 'credit_card', bank: '', outstanding: '', nominal_rate: '', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '' }, '2026-10-08');
  assert.equal(loan.loan_type, 'auto_loan');
  assert.equal(loan.nominal_rate, '0.095');
  assert.equal(loan.prepayment_penalty_pct, '0.05');
  assert.equal(loan.tenure_months_remaining, 17);
  assert.equal(loan.rate_type_assumed, false);
  assert.ok(!loan.kfs_fields.includes('nominal_rate'), 'the edited rate is the user\'s own');
  assert.ok(loan.kfs_fields.includes('prepayment_penalty_pct') && loan.kfs_fields.includes('outstanding'));
  assert.match(kfsNote(loan), /prepayment fee/);
  assert.match(kfsNote(loan), /from your Key Facts Statement/);
  // Changing the fee in the Profile form makes it the user's.
  assert.ok(!dropKfsFields(loan, { prepayment_penalty_pct: '0.02' }).includes('prepayment_penalty_pct'));
  assert.ok(dropKfsFields(loan, { prepayment_penalty_pct: '0.05' }).includes('prepayment_penalty_pct'));
});

test('a KFS prepayment charge replaces the RBI default, and says where it came from', () => {
  const { feeShown } = lib('prepayment-fee.ts');
  const home = { loan_type: 'home_loan', rate_type: 'floating', prepayment_penalty_pct: '' };
  assert.equal(feeShown(home, 'IN').status, 'assumed');
  const fromKfs = feeShown({ ...home, prepayment_penalty_pct: '0.02', kfs_fields: ['prepayment_penalty_pct'] }, 'IN');
  assert.equal(fromKfs.status, 'kfs');
  assert.match(fromKfs.hint, /Key Facts Statement/);
  assert.equal(feeShown({ ...home, prepayment_penalty_pct: '0.02', kfs_fields: [] }, 'IN').status, 'entered');
});

test('wiring: the import never saves by itself; the market line sits beside the rate', () => {
  const imp = src('components/profile/KfsImport.tsx');
  assert.match(imp, /api\.kfsRead/);
  assert.doesNotMatch(imp, /saveProfile|persist|localStorage|api\.save|syncUser/);
  assert.match(imp, /Add this loan/);
  assert.match(imp, /not kept/);
  const prof = src('app/profile/ProfileClient.tsx');
  assert.match(prof, /<KfsImport/);
  assert.match(prof, /<MarketRateLine loan=\{l\} country=\{country\} \/>/);
  assert.match(prof, /dropKfsFields\(l, patch\)/);
  assert.match(src('lib/api.ts'), /kfsRead: \(req/);
  assert.match(src('components/profile/MarketRateLine.tsx'), /not an offer to you/);
});
