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

// Sprint L4 (critique #3, add #2): "I can't pay this month" triage.
const t = lib('distress-triage.ts');

const loans = [
  { key: 'pl', label: 'Personal loan', loan_type: 'personal_loan', required: 12000, ratePct: 14 },
  { key: 'cc', label: 'Card', loan_type: 'credit_card', required: 4250, ratePct: 42 },
  { key: 'car', label: 'Car loan', loan_type: 'auto_loan', required: 15000, ratePct: 9 },
  { key: 'home', label: 'Home loan', loan_type: 'home_loan', required: 35000, ratePct: 8.5 },
  { key: 'bnpl', label: 'BNPL', loan_type: 'bnpl', required: 2000, ratePct: 30 },
];

test('protect order: home, car, card minimum, then the dearer unsecured loan first', () => {
  const o = t.protectOrder(loans, 1e9);
  assert.deepEqual(o.map((l) => l.key), ['home', 'car', 'cc', 'bnpl', 'pl']);
  assert.ok(o.every((l) => l.covered === 'full' && l.short === 0));
  assert.deepEqual([...new Set(o.map((l) => l.tier))], ['secured', 'card_minimum', 'unsecured']);
});

test('protect order fills the money available in that order, and names what is short', () => {
  // ₹55,000: home 35,000 + car 15,000 = 50,000; card minimum gets 4,250; BNPL 750 of 2,000; PL nothing.
  const o = t.protectOrder(loans, 55000);
  const by = Object.fromEntries(o.map((l) => [l.key, l]));
  assert.equal(by.home.covered, 'full');
  assert.equal(by.car.covered, 'full');
  assert.equal(by.cc.covered, 'full');
  assert.deepEqual([by.bnpl.covered, by.bnpl.pay, by.bnpl.short], ['part', 750, 1250]);
  assert.deepEqual([by.pl.covered, by.pl.pay, by.pl.short], ['none', 0, 12000]);
  assert.equal(o.reduce((s, l) => s + l.pay, 0), 55000);
});

test('protect order: negative or zero money covers nothing; zero-due loans are left out', () => {
  const o = t.protectOrder([...loans, { key: 'z', label: 'Paid', loan_type: 'gold_loan', required: 0, ratePct: 10 }], -5000);
  assert.equal(o.length, 5);
  assert.ok(o.every((l) => l.covered === 'none' && l.pay === 0));
});

test('missed payment: interest at the loan rate, flat penal charge, bounce only on auto-debit', () => {
  // UX50 O-3: 2 months unpaid = 2 overdue EMIs (the first overdue 2 months,
  // the second 1). 35000 × 0.085 / 12 × (2 + 1) = 743.75; penal and bounce
  // once per missed instalment. (Was 495.83 / 500 / 590: one EMI only.)
  const c = t.missedPaymentCost({ unpaid: 35000, ratePct: 8.5, months: 2, penalCharge: 500, bounceCharge: 590, autoDebit: true });
  assert.deepEqual([c.arrears, c.interest, c.penal, c.bounce, c.total], [70000, 743.75, 1000, 1180, 2923.75]);
  assert.deepEqual(c.unknown, []);
  const noAuto = t.missedPaymentCost({ unpaid: 35000, ratePct: 8.5, months: 2, penalCharge: 500, bounceCharge: 590, autoDebit: false });
  assert.equal(noAuto.bounce, 0);
});

test('UX50 O-3: N months unpaid charges interest on every overdue EMI, N(N+1)/2 EMI-months', () => {
  const one = t.missedPaymentCost({ unpaid: 13000, ratePct: 14, months: 1, penalCharge: 0, bounceCharge: 0, autoDebit: false });
  const three = t.missedPaymentCost({ unpaid: 13000, ratePct: 14, months: 3, penalCharge: 0, bounceCharge: 0, autoDebit: false });
  // 13000 × 0.14/12 = 151.67 a month; 3 months → 6 EMI-months = 910.
  assert.equal(one.interest, 151.67);
  assert.equal(three.interest, 910);
  assert.equal(three.arrears, 39000);
  // Grows faster than linearly: a 3rd unpaid month costs more than the 1st.
  assert.ok(three.interest > 3 * one.interest);
});

test('UX50 R5-1: months unpaid is bounded 0–24 in the reader and in the cost itself', () => {
  assert.equal(t.MAX_MONTHS_UNPAID, 24);
  assert.deepEqual(t.readMonthsUnpaid('3'), { months: 3, error: null });
  assert.deepEqual(t.readMonthsUnpaid('0'), { months: 0, error: null });
  for (const bad of ['', '25', '9999999999999', '-1', '1.5', 'abc', '1e9']) {
    const r = t.readMonthsUnpaid(bad);
    assert.equal(r.months, null, bad);
    assert.ok(r.error, bad);
  }
  const huge = t.missedPaymentCost({ unpaid: 13000, ratePct: 14, months: 1e15, penalCharge: 500, bounceCharge: 500, autoDebit: true });
  const cap = t.missedPaymentCost({ unpaid: 13000, ratePct: 14, months: 24, penalCharge: 500, bounceCharge: 500, autoDebit: true });
  assert.deepEqual(huge, cap);
  assert.ok(String(Math.round(cap.total)).length < 8);
  const nan = t.missedPaymentCost({ unpaid: NaN, ratePct: NaN, months: NaN, penalCharge: null, bounceCharge: null, autoDebit: true });
  assert.equal(nan.total, 0);
  assert.deepEqual(t.readCharge(''), { value: null, error: null });
  assert.deepEqual(t.readCharge('₹590'), { value: 590, error: null });
  assert.ok(t.readCharge('-5').error);
  assert.ok(t.readCharge('99999999').error);
});

test('missed payment: never invents a lender fee; unknowns count 0 and are named', () => {
  const c = t.missedPaymentCost({ unpaid: 12000, ratePct: 14, months: 1, penalCharge: null, bounceCharge: null, autoDebit: true });
  assert.equal(c.penal, 0);
  assert.equal(c.bounce, 0);
  assert.deepEqual(c.unknown, ['penal', 'bounce']);
  assert.equal(c.total, 140);
  const zero = t.missedPaymentCost({ unpaid: 12000, ratePct: 14, months: 0, penalCharge: 500, bounceCharge: 500, autoDebit: true });
  assert.equal(zero.total, 0);
});

test('SMA stages follow the RBI Prudential Framework (1–30, 31–60, 61–90 days)', () => {
  assert.deepEqual([0, 1, 30, 31, 60, 61, 90, 91].map(t.smaStage), ['current', 'SMA-0', 'SMA-0', 'SMA-1', 'SMA-1', 'SMA-2', 'SMA-2', 'over 90 days']);
});

test('every cited rule is an rbi.org.in link with a source and date; card rule says three days', () => {
  for (const r of Object.values(t.TRIAGE_RULES)) {
    assert.match(r.url, /^https:\/\/www\.rbi\.org\.in\//, r.id);
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/, r.id);
    assert.ok(r.source.length > 20 && r.plain.length > 40, r.id);
  }
  assert.match(t.TRIAGE_RULES.card_past_due.plain, /more than three days/);
  assert.match(t.TRIAGE_RULES.recovery.plain, /before 8:00 a\.m\. or after 7:00 p\.m\./);
  assert.match(t.TRIAGE_RULES.penal.plain, /does not cover credit cards/);
  assert.match(t.TRIAGE_RULES.settlement.plain, /at least 12 months/);
  assert.match(t.TRIAGE_RULES.restructuring.plain, /non-performing asset/);
  assert.equal(t.TRIAGE_RULES.recovery_2027.from, '2027-01-01');
});

test('hardship letter: marked draft, names the loan, asks, floating-rate reset choice only when floating', () => {
  const base = { name: 'Asha', lender: 'HDFC Bank', loanLabel: 'HDFC home loan', accountRef: 'HL123', reason: 'I lost my job on 1 Oct', canPay: '₹20,000', asks: ['longer_tenure', 'waive_penal'], dateText: '12 October 2026' };
  const fl = t.hardshipLetter({ ...base, floating: true });
  // UX fix 12: the caution is shown beside the letter, never inside it.
  assert.ok(!fl.includes(t.DRAFT_MARK) && !/DRAFT/.test(fl) && fl.startsWith('12 October 2026'));
  assert.match(fl, /HDFC home loan, account HL123/);
  assert.match(fl, /1\. a longer tenure/);
  assert.match(fl, /2\. a waiver of any penal charges/);
  assert.match(fl, /higher EMI, a longer tenure or both/);
  assert.match(fl, /8 a\.m\. and 7 p\.m\./);
  assert.doesNotMatch(t.hardshipLetter({ ...base, floating: false }), /higher EMI, a longer tenure or both/);
  // No asks ticked: a pause and a longer tenure by default, never an empty request.
  assert.match(t.hardshipLetter({ ...base, asks: [], floating: false }), /1\. a short pause/);
});

test('copy: no "reviewed by professionals" claims, no guarantee, no settlement upsell', () => {
  const all = [src('lib/distress-triage.ts'), src('components/distress/CantPay.tsx')].join('\n');
  assert.doesNotMatch(all, /reviewed by|vetted by|qualified professional|guarantee/i);
  assert.match(all, /RightDue earns nothing from lenders or settlement firms/);
});

test('wiring: Home soft view links to /cant-pay; the page links Plan for the L2 tenure what-if', () => {
  assert.match(src('components/home/LedgerHome.tsx'), /href="\/cant-pay"/);
  assert.match(src('components/distress/CantPay.tsx'), /LONGER TENURE WHAT-IF/);
  assert.match(src('app/cant-pay/page.tsx'), /CantPay/);
});
