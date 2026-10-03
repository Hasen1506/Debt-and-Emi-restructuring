/** Browser regressions for the PR 21 audit. Run against an auth-bypassed
 * local web/API pair with feeds disabled; see AUDIT.md for the command. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const LZ = require('../web/node_modules/lz-string');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const output = process.env.AUDIT_OUTPUT;
const now = new Date();
const month = (offset = 0) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const loan = (id, extra = {}) => ({ id, loan_type: 'personal_loan', bank: 'HDFC Bank',
  outstanding: '500000', nominal_rate: '.16', scheduled_emi: '12160',
  tenure_months_remaining: 60, rate_type: 'fixed', balance_as_of: month(), ...extra });
const user = (extra = {}) => ({ country: 'IN', income_type: 'salaried', annual_income: '1800000',
  annual_gross_salary: '1800000', monthly_income: '150000', fixed_expenses: '60000',
  variable_expenses: '0', savings_balance: '0', primary_bank: 'HDFC Bank', tax_regime: 'new',
  credit_score: 750, efund_balance: '0', efund_target: '0', annual_hike_rate: '0',
  inflation_rate: '.05', investment_options: [], loans: [loan('pl'),
    loan('cc', { loan_type: 'credit_card', bank: 'ICICI Bank', outstanding: '100000',
      nominal_rate: '.42', scheduled_emi: '0', tenure_months_remaining: 0 })], ...extra });
const cookies = async c => Object.fromEntries((await c.cookies()).map(x => [x.name, decodeURIComponent(x.value)]));
async function profile(c) {
  const jar = await cookies(c); let raw = jar.finoptima_user;
  if (raw.startsWith('z1.')) {
    const match = /^z1\.(\d+)\./.exec(raw); let compressed = raw.slice(match[0].length);
    for (let i = 1; i < Number(match[1]); i++) compressed += jar['finoptima_user_' + i] || '';
    raw = LZ.decompressFromEncodedURIComponent(compressed);
  }
  return JSON.parse(raw);
}
const store = (p, key) => p.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), key);
const body = p => p.locator('main').innerText();
async function visit(p, path) {
  await p.goto(base + path, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => {
    const e = document.querySelector('main input,main button,main select');
    return document.querySelector('main') && (!e || Object.keys(e).some(k => k.startsWith('__reactProps$')));
  });
  assert.ok(!p.url().includes('/login'), 'Use a local auth-bypassed test instance');
}
async function previewCut(p) {
  const input = p.getByRole('textbox', { name: 'Spend less each month', exact: true });
  await input.fill('10000'); await input.press('Tab');
  await p.waitForFunction(() => document.querySelector('main').textContent.includes('52,367'));
}
const results = [];
let browser;
async function run(name, u, fn, settings = {}) {
  const c = await browser.newContext();
  await c.route('https://**/*', r => r.abort()); // external fonts are unrelated to these flows
  const jar = { finoptima_user: JSON.stringify(u), finoptima_marginal: '.208',
    finoptima_debt_budget: '50000', ...settings };
  await c.addCookies(Object.entries(jar).map(([name, value]) => ({ name, value: encodeURIComponent(value), url: base })));
  const p = await c.newPage(); p.setDefaultTimeout(15000); p.setDefaultNavigationTimeout(45000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  try {
    await fn(p, c); assert.deepEqual(errors, []);
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (e) {
    results.push({ name, passed: false, error: e.stack, page: await body(p).catch(() => '') });
    console.error('FAIL', name, e.message);
  } finally {
    await c.close(); if (output) fs.writeFileSync(output, JSON.stringify(results, null, 2));
  }
}
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  await run('Spending-cut preview, save, reload and undo agree', user(), async (p, c) => {
    await visit(p, '/plan'); await previewCut(p);
    const preview = await body(p); assert.match(preview, /52,367/);
    await p.getByRole('button', { name: /Lock in.*trim/i }).click();
    await p.getByRole('button', { name: /SHOW CHANGES MADE HERE/ }).waitFor();
    assert.equal((await profile(c)).fixed_expenses, '50000');
    assert.equal((await cookies(c)).finoptima_debt_budget, '60000');
    await visit(p, '/plan'); assert.match(await body(p), /52,367/);
    await p.getByRole('button', { name: /SHOW CHANGES MADE HERE/ }).click();
    await p.getByRole('button', { name: 'Undo this spending cut and its debt-budget change', exact: true }).click();
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('finoptima_commitments') || '[]').length === 0);
    assert.equal((await profile(c)).fixed_expenses, '60000');
    assert.equal((await cookies(c)).finoptima_debt_budget, '50000');
  });
  for (const blocked of ['finoptima_user', 'finoptima_debt_budget']) {
    await run('Blocked ' + blocked + ' rolls back the whole cut', user(), async (p, c) => {
      await visit(p, '/plan'); await previewCut(p);
      await p.evaluate(key => {
        const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        Object.defineProperty(document, 'cookie', { get() { return d.get.call(this); }, set(value) {
          if (!value.startsWith(key)) d.set.call(this, value);
        } });
      }, blocked);
      await p.getByRole('button', { name: /Lock in.*trim/i }).click();
      assert.equal((await profile(c)).fixed_expenses, '60000');
      assert.equal((await cookies(c)).finoptima_debt_budget, '50000');
      assert.equal((await store(p, 'finoptima_commitments')).length, 0);
      assert.equal(await p.getByRole('button', { name: 'Undo this spending cut and its debt-budget change', exact: true }).count(), 0);
    });
  }
  const final = user({ loans: [loan('final', { outstanding: '1000', scheduled_emi: '9500', nominal_rate: '.14' })] });
  await run('Home and Activity cap the final EMI and Mark paid logs it', final, async (p) => {
    await visit(p, '/'); assert.match(await body(p), /1,012/);
    await visit(p, '/activity');
    await p.getByRole('button', { name: /^Mark paid:.*1,012/ }).click();
    const entries = await store(p, 'finoptima_activity');
    assert.equal(Number(entries[0].amount), 1012); assert.equal(Number(entries[0].scheduledEmi), 1012);
    await visit(p, '/activity'); assert.equal(await p.getByRole('button', { name: /^Mark paid:/ }).count(), 0);
  });
  await run('Other amount uses the same capped final EMI', final, async (p) => {
    await visit(p, '/activity'); await p.getByRole('button', { name: /^Other amount:/ }).click();
    const d = p.getByRole('dialog'); await d.getByRole('button', { name: /Paid in full/i }).click();
    await d.getByLabel('Amount paid', { exact: true }).fill('1012');
    await d.getByRole('button', { name: /SAVE/ }).click(); await d.waitFor({ state: 'hidden' });
    const entries = await store(p, 'finoptima_activity');
    assert.equal(Number(entries[0].amount), 1012); assert.equal(Number(entries[0].scheduledEmi), 1012);
  });
  await run('Costlier consolidation is held back after the card clears', user({ credit_score: 720,
    loans: [loan('pl'), loan('cc', { loan_type: 'credit_card', outstanding: '80000', nominal_rate: '.42', scheduled_emi: '0', tenure_months_remaining: 0 })] }), async (p) => {
    await visit(p, '/'); assert.match(await body(p), /7,135/);
    assert.match(await body(p), /costs about[\s\S]*more in the first year/);
    assert.doesNotMatch(await body(p), /Save ~[^\n]+combining/);
  });
  await run('Beneficial consolidation quotes the nominal rate and its assumed tenure', user(), async (p) => {
    await visit(p, '/'); assert.match(await body(p), /10\.50%/); assert.match(await body(p), /36-month fixed-rate/);
  });
  await run('Strategy picker describes starting order without promising equal results', user({
    loans: [loan('a', { outstanding: '200000', nominal_rate: '.10', rate_type: 'floating', scheduled_emi: '4300' }),
      loan('b', { outstanding: '300000', nominal_rate: '.09', rate_type: 'floating', scheduled_emi: '6300' })] }), async p => {
    await visit(p, '/plan');
    assert.match(await body(p), /32,580/);
    await p.getByRole('button', { name: 'Payoff strategy: Avalanche. Change it', exact: true }).click();
    const d = p.getByRole('dialog', { name: 'Payoff strategy', exact: true });
    assert.match(await d.innerText(), /today.s balances and rates/);
    assert.match(await d.innerText(), /rate changes and new loans can change the order, date and interest/);
    assert.doesNotMatch(await d.innerText(), /comes out the same|same result/i);
    await d.getByRole('button', { name: /SNOWBALL/ }).click();
    await p.getByRole('button', { name: 'Payoff strategy: Snowball. Change it', exact: true }).waitFor();
    await p.waitForFunction(() => document.querySelector('main').textContent.includes('34,638'));
  }, { finoptima_debt_budget: '40000', finoptima_lifecycle: JSON.stringify([{ id: 'reset', kind: 'floating_rate_reset',
    status: 'planned', loanId: 'b', loanIndex: 1, newRate: '.12', effectiveDate: month(1), loggedAt: now.toISOString() }]) });
  await run('Refinance headline and explanation use the revised repayment saving', user({ loans: [loan('home', {
    loan_type: 'home_loan', outstanding: '4000000', nominal_rate: '.10', rate_type: 'floating',
    tenure_months_remaining: 240, scheduled_emi: '38601' })] }), async p => {
    await visit(p, '/'); const text = await body(p);
    const headline = /Save ~₹([\d,]+) over the rest of the loan/.exec(text);
    assert.ok(headline, 'A refinance opportunity must appear');
    assert.ok(text.includes(`net saving of about ₹${headline[1]}`));
    assert.doesNotMatch(text, /13,43,102/);
  }, { finoptima_debt_budget: '90000' });
  await browser.close(); assert.ok(results.every(x => x.passed), 'Browser regressions failed; inspect AUDIT_OUTPUT');
})().catch(e => { console.error(e); process.exitCode = 1; });
