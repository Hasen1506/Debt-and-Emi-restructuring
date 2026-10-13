// G6: SMS parser for pasted / shared bank and card SMS (founder note on grill #3).
// Every message below is SYNTHETIC: made-up accounts, amounts and references,
// written in the usual shape of Indian bank alerts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '../src');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  module._compile(output, file);
};
const s = require(path.join(root, 'lib', 'sms-parser.ts'));

test('UPI debit: amount, account, payee, date, reference', () => {
  const p = s.parseSms('Rs.1,250.00 debited from A/c XX1234 on 05-10-26 to VPA shop@okaxis (UPI Ref No 627812345678). Not you? Call 1800-000-0000 -Sample Bank');
  assert.equal(p.kind, 'debit');
  assert.equal(p.amount, '1250');
  assert.equal(p.account_last4, '1234');
  assert.equal(p.date, '2026-10-05');
  assert.equal(p.ref, '627812345678');
  assert.match(p.merchant, /shop@okaxis/);
});

test('salary credit', () => {
  const p = s.parseSms('INR 1,20,000.00 credited to HDFC Bank A/c XX9876 on 01-OCT-26 from ACME PVT LTD. Avl bal INR 1,45,210.50');
  assert.equal(p.kind, 'credit');
  assert.equal(p.amount, '120000');
  assert.equal(p.bank, 'HDFC Bank');
  assert.equal(p.balance, '145210.5');
  assert.equal(p.date, '2026-10-01');
  assert.equal(p.merchant, 'ACME PVT LTD');
});

test('credit-card spend gives the card digits and the merchant', () => {
  const p = s.parseSms('Rs 3,499.00 spent on ICICI Bank Credit Card XX4321 on 06-Oct-26 at AMAZON PAY. Avl Lmt: Rs 1,12,345.00');
  assert.equal(p.kind, 'card_spend');
  assert.equal(p.card_last4, '4321');
  assert.equal(p.amount, '3499');
  assert.equal(p.merchant, 'AMAZON PAY');
  assert.equal(p.balance, '112345');
});

test('EMI / NACH auto-debit is told apart from a plain debit', () => {
  const p = s.parseSms('Your A/c XX1234 is debited with Rs.39,500.00 on 05/10/2026 towards NACH-DR SAMPLE HOUSING FIN loan EMI. -Sample Bank');
  assert.equal(p.kind, 'emi_debit');
  assert.equal(p.amount, '39500');
  assert.equal(p.date, '2026-10-05');
});

test('a bounced EMI is flagged', () => {
  const p = s.parseSms('ECS/NACH mandate for Rs 13,350 towards loan a/c XX0099 returned unpaid due to insufficient funds. Charges may apply.');
  assert.equal(p.kind, 'emi_bounce');
  assert.equal(p.amount, '13350');
  assert.equal(p.account_last4, '0099');
});

test('card statement SMS: total due, minimum due, due date', () => {
  const p = s.parseSms('Statement for Axis Bank Credit Card XX5555: Total Amt Due Rs 64,210.00, Min Amt Due Rs 3,210.00, due by 25-Oct-26.');
  assert.equal(p.kind, 'card_statement');
  assert.equal(p.total_due, '64210');
  assert.equal(p.min_due, '3210');
  assert.equal(p.due_date, '2026-10-25');
  assert.equal(p.card_last4, '5555');
});

test('OTPs and offers are skipped, not read as money', () => {
  assert.equal(s.parseSms('123456 is your OTP for a transaction of Rs 2,000 at FLIPKART. Do not share.').kind, 'otp');
  assert.equal(s.parseSms('Congrats! You are eligible for a pre-approved personal loan of up to Rs 5,00,000. Apply now: http://x.y').kind, 'promo');
});

test('a pasted block splits into messages', () => {
  const block = 'Rs.100 debited from A/c XX1 on 01-10-26 to A\nRs.200 credited to A/c XX1 on 02-10-26 from B\n482910 is your OTP';
  const list = s.parseSmsBatch(block);
  assert.deepEqual(list.map((x) => x.kind), ['debit', 'credit', 'otp']);
  const two = s.parseSmsBatch('Rs.100 debited from A/c XX1\non 01-10-26 to A\n\nRs.200 credited to A/c XX1 on 02-10-26');
  assert.equal(two.length, 2);
});

test('an EMI debit is matched to exactly one loan, never guessed', () => {
  const emi = s.parseSms('Rs 39,500 debited from A/c XX1234 on 05-10-26 for NACH EMI Sample Housing');
  const loans = [{ id: 'home', bank: 'Sample Housing', scheduled_emi: '39500' }, { id: 'pl', bank: 'Sample Bank', scheduled_emi: '13350' }];
  assert.equal(s.matchEmiToLoan(emi, loans), 'home');
  assert.equal(s.matchEmiToLoan(emi, [...loans, { id: 'car', scheduled_emi: '39501' }]), null); // two fit → ask the user
  assert.equal(s.matchEmiToLoan(s.parseSms('Rs 500 debited from A/c XX1 to SHOP'), loans), null);
});

test('card spends add up per card', () => {
  const list = s.parseSmsBatch(['Rs 1,000 spent on Credit Card XX4321 at A', 'Rs 250.50 spent on Credit Card XX4321 at B', 'Rs 99 spent on Credit Card XX9999 at C'].join('\n\n'));
  assert.deepEqual(s.cardSpendByCard(list), { 4321: 1250.5, 9999: 99 });
});

test('dates: invalid days are refused, not rolled over', () => {
  assert.equal(s.findDate('on 31-02-26'), null);
  assert.equal(s.findDate('on 5 Oct 2026'), '2026-10-05');
});

test('the parser module never calls the network', () => {
  const src = fs.readFileSync(path.join(root, 'lib', 'sms-parser.ts'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|from '\.\/api'/);
});

// UX50 C-13 / C-14: top Indian bank card-statement wordings and the EMI merchant.
// SYNTHETIC messages in each bank's usual shape.
test('UX50 C-13: card statement SMS in HDFC, SBI, ICICI, Axis, Kotak wording', () => {
  const cases = [
    ['Statement for HDFC Bank Credit Card XX9876: Total due Rs.42,310.00, Minimum due Rs.2,120.00. Due date 22-Oct-2026.', '42310', '2120', '2026-10-22', '9876'],
    ['Dear Customer, Total Amt Due on your SBI Card ending 4321 is Rs.1,50,000.00, Min Amt Due Rs 7,500.00, due by 20-Oct-26.', '150000', '7500', '2026-10-20', '4321'],
    ['ICICI Bank Credit Card XX1111 statement: Total Amt Due Rs.15,234; Min Amt Due Rs.762; Payable by 25/10/2026.', '15234', '762', '2026-10-25', '1111'],
    ['Axis Bank Credit Card no. XX2222: Total Amount Due INR 8,450.00, Minimum Amount Due INR 423.00, Payment due date 18-10-2026.', '8450', '423', '2026-10-18', '2222'],
    ['Kotak Credit Card xx3333 statement generated. Total Amount Due: Rs. 23,999.50 Min. Amount Due: Rs. 1,200.00 Pay by 21-Oct-26', '23999.5', '1200', '2026-10-21', '3333'],
  ];
  for (const [text, total, min, due, last4] of cases) {
    const p = s.parseSms(text);
    assert.equal(p.kind, 'card_statement', text);
    assert.equal(p.total_due, total, text);
    assert.equal(p.min_due, min, text);
    assert.equal(p.due_date, due, text);
    assert.equal(p.card_last4, last4, text);
  }
});

test('UX50 C-14: an EMI debit "towards EMI" has no merchant "wards EMI", and keeps the bank', () => {
  const p = s.parseSms('Your a/c XX1234 is debited for Rs.13,000.00 on 05-10-26 towards EMI. -HDFC Bank');
  assert.equal(p.kind, 'emi_debit');
  assert.equal(p.amount, '13000');
  assert.equal(p.merchant, null);
  assert.equal(p.bank, 'HDFC Bank');
  const q = s.parseSms('Rs 500.00 debited from A/c XX1234 on 05-10-26 towards SWIGGY ORDER. -Sample Bank');
  assert.equal(q.merchant, 'SWIGGY ORDER');
});
