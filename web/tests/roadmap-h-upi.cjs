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

// PR E (roadmap 2026-10-07): "Your rules" replaces Hybrid.

// PR H (roadmap 2026-10-07): Pay via UPI. A plain upi://pay deep link built
// from the lender's UPI ID; MARK PAID stays the user's own confirmation.

test('UPI link: upi://pay with payee, amount (2 dp), INR and a note, spaces as %20', () => {
  const { upiPayLink } = lib('upi.ts');
  const href = upiPayLink({ vpa: ' Loans.123@HDFCBank ', name: 'HDFC Bank', amount: 12345.5, note: 'HDFC card Oct 2026' });
  assert.equal(href, 'upi://pay?pa=loans.123%40hdfcbank&pn=HDFC%20Bank&am=12345.50&cu=INR&tn=HDFC%20card%20Oct%202026');
  const u = new URL(href);
  assert.equal(u.protocol, 'upi:');
  assert.equal(u.searchParams.get('pa'), 'loans.123@hdfcbank');
  assert.equal(u.searchParams.get('am'), '12345.50');
  assert.equal(u.searchParams.get('cu'), 'INR');
  // Optional fields are left out rather than sent empty.
  assert.equal(upiPayLink({ vpa: 'a.b@okicici', amount: 100 }), 'upi://pay?pa=a.b%40okicici&am=100.00&cu=INR');
});

test('UPI link refuses a bad UPI ID or amount instead of building a link that pays the wrong place', () => {
  const { upiPayLink, isValidVpa, vpaError, normalizeVpa } = lib('upi.ts');
  for (const bad of ['', 'loans', '@hdfcbank', 'loans@', 'lo ans@hdfc', 'loans@hdfc bank', 'loans@@hdfc', 'upi://pay?pa=x@y'])
    assert.equal(isValidVpa(bad), false, bad);
  for (const ok of ['loans.123@hdfcbank', 'hdfcbankcc.4111@hdfcbank', 'name-1_x@okaxis', 'x9@ybl']) assert.equal(isValidVpa(ok), true, ok);
  assert.throws(() => upiPayLink({ vpa: 'nope', amount: 10 }), /invalid UPI ID/);
  for (const amount of [0, -5, NaN, Infinity]) assert.throws(() => upiPayLink({ vpa: 'a.b@okicici', amount }), /invalid amount/);
  assert.match(vpaError(''), /Enter the UPI ID/);
  assert.match(vpaError('loans'), /isn’t a UPI ID/);
  assert.equal(vpaError('loans.1@sbi'), null);
  assert.equal(normalizeVpa('  A.B@OKSBI '), 'a.b@oksbi');
});

test('UPI limit note follows NPCI: up to ₹5L for a loan payment (Sep 2025), banks may cap lower', () => {
  const { upiLimitNote } = lib('upi.ts');
  assert.equal(upiLimitNote(25000), null);
  assert.match(upiLimitNote(150000), /up to ₹5,00,000 for a loan payment, but your bank or app may cap it lower/);
  assert.match(upiLimitNote(600000), /Over ₹5,00,000.*split it, or pay by net banking/);
});

test('Only a rupee loan with a saved UPI ID gets a link; the note is short and plain', () => {
  const { canPayByUpi, upiNote } = lib('upi.ts');
  assert.equal(canPayByUpi({ upi_vpa: 'loans.1@sbi', currency: 'INR' }, 'INR'), true);
  assert.equal(canPayByUpi({ upi_vpa: 'loans.1@sbi', currency: 'USD' }, 'USD'), false);
  assert.equal(canPayByUpi({ upi_vpa: '', currency: 'INR' }, 'INR'), false);
  assert.equal(canPayByUpi({ upi_vpa: 'bad', currency: 'INR' }, 'INR'), false);
  assert.equal(canPayByUpi(undefined, 'INR'), false);
  assert.equal(upiNote('HDFC Card & <Loan>', 'Oct 2026'), 'HDFC Card Loan Oct 2026');
  assert.ok(upiNote('x'.repeat(80), 'Oct 2026').length <= 50);
});

test('PAY VIA UPI renders a plain upi:// link with no claim of automatic payment; MARK PAID stays manual', () => {
  const { UpiPay } = require(path.join(root, 'components/home/UpiPay.tsx'));
  const base = { name: 'SBI home loan', amount: 25000, currency: 'INR', monthLabel: 'Oct 2026', onSaveVpa: () => true };
  const loan = { loan_type: 'home_loan', outstanding: '2500000', nominal_rate: '0.085', bank: 'SBI', upi_vpa: 'sbihl.998877@sbi' };
  const html = renderToStaticMarkup(React.createElement(UpiPay, { ...base, loan }));
  const href = /href="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');
  assert.equal(href, 'upi://pay?pa=sbihl.998877%40sbi&pn=SBI&am=25000.00&cu=INR&tn=SBI%20home%20loan%20Oct%202026');
  assert.match(html, /PAY VIA UPI/);
  assert.match(html, /To sbihl\.998877@sbi\./);
  // Without a UPI ID it asks for one; a dollar loan gets nothing (UPI moves rupees).
  assert.match(renderToStaticMarkup(React.createElement(UpiPay, { ...base, loan: { ...loan, upi_vpa: undefined } })), /add the lender&#x27;s UPI ID|add the lender's UPI ID/);
  assert.equal(renderToStaticMarkup(React.createElement(UpiPay, { ...base, loan, currency: 'USD' })), '');
  assert.equal(renderToStaticMarkup(React.createElement(UpiPay, { ...base, loan, amount: 0 })), '');
  // After the UPI app opens, the user is told to confirm with MARK PAID; nothing is marked for them.
  const comp = src('components/home/UpiPay.tsx');
  assert.match(comp, /Tap MARK PAID to record it/);
  const pay = src('components/home/PayThisMonth.tsx');
  assert.match(pay, /<UpiPay/);
  assert.match(pay, /MARK PAID/);
  // No bill-payment network is claimed anywhere in the app.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const claims = walk(root).filter((f) => /\.(tsx?|json)$/.test(f) && /\bBBPS\b|Bharat ?Bill ?Pay/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(claims, []);
});
