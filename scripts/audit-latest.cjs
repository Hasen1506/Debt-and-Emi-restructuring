const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const LZ = require('../web/node_modules/lz-string');
const base = process.env.BASE_URL || 'http://127.0.0.1:3215';
const output = process.env.AUDIT_OUTPUT || path.resolve(__dirname, '../audit-latest-results.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
const now = new Date();
const date = (n = 0) => { const d = new Date(now.getFullYear(), now.getMonth() + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const loan = (id = 'a', x = {}) => ({ id, bank: id === 'a' ? 'HDFC Bank' : 'ICICI Bank', loan_type: 'personal_loan', outstanding: '100000', nominal_rate: '.18', rate_type: 'fixed', scheduled_emi: '9000', tenure_months_remaining: 24, ...x });
const user = (x = {}) => ({ country: 'IN', income_type: 'salaried', monthly_income: '100000', annual_income: '1200000', annual_gross_salary: '1200000', fixed_expenses: '40000', savings_balance: '50000', efund_balance: '100000', efund_target: '100000', primary_bank: 'HDFC Bank', tax_regime: 'new', inflation_rate: '.046', loans: [loan()], investment_options: [], ...x });
const goal = (id = 'g', x = {}) => ({ id, kind: 'custom', label: 'Test goal', amount: '100000', targetMonth: date(12).slice(0, 7), bufferPct: '0', deadlineKind: 'soft', fundingSources: ['surplus'], autoDefer: false, status: 'active', createdAt: now.toISOString(), ...x });
async function profile(c) { const cs = await c.cookies(); const get = n => decodeURIComponent(cs.find(x => x.name === n)?.value ?? ''); let raw = get('finoptima_user'); if (raw.startsWith('z1.')) {
    const m = /^z1\.(\d+)\./.exec(raw);
    let zipped = raw.slice(m[0].length);
    for (let i = 1; i < Number(m[1]); i++)
        zipped += get('finoptima_user_' + i);
    raw = LZ.decompressFromEncodedURIComponent(zipped);
} return JSON.parse(raw); }
const body = p => p.locator('main').innerText();
const store = (p, k) => p.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), k);
let browser;
const results = [];
async function run(name, u, fn, storage = {}) {
    if (process.env.AUDIT_FILTER && !name.includes(process.env.AUDIT_FILTER))
        return;
    const c = await browser.newContext();
    if (process.env.AUDIT_BLOCK_EXTERNAL === '1')
        await c.route('https://**/*', r => r.abort());
    await c.addCookies([{ name: 'finoptima_user', value: encodeURIComponent(JSON.stringify(u)), url: base }, { name: 'finoptima_marginal', value: '0', url: base }]);
    if (storage.finoptima_goals)
        await c.addCookies([{ name: 'finoptima_goals_digest', value: Buffer.from(JSON.stringify(storage.finoptima_goals)).toString('base64'), url: base }]);
    await c.addInitScript(s => { for (const [k, v] of Object.entries(s))
        if (!localStorage.getItem(k))
            localStorage.setItem(k, JSON.stringify(v)); }, storage);
    const p = await c.newPage();
    p.setDefaultTimeout(10000);
    p.setDefaultNavigationTimeout(60000);
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    const goto = p.goto.bind(p);
    p.goto = async (...a) => { const r = await goto(a[0], { ...(a[1] || {}), waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => { const e = document.querySelector('main input,main button,main select'); return document.querySelector('main') && (!e || Object.keys(e).some(k => k.startsWith('__reactProps$'))); }); assert.ok(!p.url().includes('/login'), 'Test must reach app, not login'); return r; };
    try {
        await fn(p, c);
        assert.deepEqual(errors, [], 'Browser exceptions');
        results.push({ name, status: 'passed' });
        console.log('PASS', name);
    }
    catch (e) {
        results.push({ name, status: 'failed', error: e.message, body: await body(p).catch(() => ''), exceptions: errors });
        console.log('FAIL', name, e.message);
    }
    finally {
        await c.close();
        fs.writeFileSync(output, JSON.stringify(results, null, 2));
    }
}
async function logDialog(p) { await p.getByRole('button', { name: /LOG AN ENTRY/ }).click(); return p.getByRole('dialog'); }
async function saveLog(p) { await p.getByRole('dialog').getByRole('button', { name: /SAVE/ }).last().click(); await p.getByRole('dialog').waitFor({ state: 'hidden' }); }
async function blockProfile(p) { await p.evaluate(() => { const o = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie'); Object.defineProperty(document, 'cookie', { get() { return o.get.call(this); }, set(v) { if (!v.startsWith('finoptima_user'))
        o.set.call(this, v); } }); }); }
async function windfall(p, amt = '10000') { await p.goto(base + '/tools/windfall'); await p.getByLabel('Amount, after tax').fill(amt); await p.getByLabel('Amount, after tax').press('Tab'); await p.waitForFunction(() => document.querySelector('#wf-out') && !document.querySelector('main').textContent.includes('Working out the best split')); await p.waitForTimeout(1100); }
(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    await run('A01 Activity payment, edit and undo survive reload', user(), async (p, c) => { await p.goto(base + '/activity'); let d = await logDialog(p); await d.getByRole('button', { name: /PAID PART OF IT/i }).click(); await d.getByLabel('Amount paid', { exact: true }).fill('4500'); await d.getByLabel('Fee on your statement').fill('0'); await saveLog(p); assert.equal(Number((await store(p, 'finoptima_activity'))[0].amount), 4500); await p.getByRole('button', { name: /^Change HDFC/ }).first().click(); await p.getByLabel('Amount paid', { exact: true }).fill('6000'); await saveLog(p); assert.equal(Number((await store(p, 'finoptima_activity'))[0].amount), 6000); await p.reload(); await p.getByRole('button', { name: /^Remove HDFC/ }).first().click(); assert.equal((await store(p, 'finoptima_activity')).length, 0); });
    await run('A02 Windfall extra must leave regular EMI due', user(), async (p) => { await p.goto(base + '/activity'); assert.match(await body(p), /TO PAY/, 'Extra payment must not hide unpaid regular EMI'); }, { finoptima_activity: [{ id: 'extra', loanId: 'a', loanIndex: 0, kind: 'paid_extra', amount: '1000', scheduledEmi: '0', date: date(), loggedAt: now.toISOString() }] });
    await run('A03 Paid full below EMI must be rejected', user(), async (p) => { await p.goto(base + '/activity'); const d = await logDialog(p); await d.getByLabel('Amount paid', { exact: true }).fill('1'); await d.getByRole('button', { name: /SAVE/ }).click(); assert.equal((await store(p, 'finoptima_activity')).length, 0, '1 rupee cannot count as full 9000 EMI'); assert.equal(await d.count(), 1); });
    await run('A04 Payment cents are preserved', user(), async (p) => { await p.goto(base + '/activity'); const d = await logDialog(p); await d.getByRole('button', { name: /PAID PART OF IT/i }).click(); await d.getByLabel('Amount paid', { exact: true }).fill('4500.25'); await d.getByLabel('Fee on your statement').fill('0'); await saveLog(p); assert.equal((await store(p, 'finoptima_activity'))[0].amount, '4500.25'); });
    await run('A05 No success when activity storage fails', user(), async (p) => { await p.goto(base + '/activity'); await p.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'finoptima_activity')
        throw Error('quota blocked'); return o.call(this, k, v); }; }); const d = await logDialog(p); await d.getByRole('button', { name: /SAVE/ }).click(); await d.waitFor({ state: 'hidden' }); assert.equal((await store(p, 'finoptima_activity')).length, 0); assert.match(await body(p), /TO PAY/, 'Unpaid row remains after a failed save'); assert.match(await p.locator('main').getByRole('alert').innerText(), /quota/); });
    await run('A06 Budget change exact amount; zero spending supported', user(), async (p, c) => { await p.goto(base + '/activity'); let d = await logDialog(p); await d.getByRole('button', { name: /SPENDING/ }).click(); await d.getByRole('button', { name: /FROM NOW ON/i }).click(); await d.getByLabel('Spending a month', { exact: true }).fill('12345.67'); await saveLog(p); assert.equal((await profile(c)).fixed_expenses, '12345.67'); d = await logDialog(p); await d.getByRole('button', { name: /SPENDING/ }).click(); await d.getByLabel('Spent this month', { exact: true }).fill('0'); await saveLog(p); assert.equal(Number((await store(p, 'finoptima_monthly_spend'))[0].spent), 0); });
    await run('A07 Deep link invalid payment target is rejected', user({ loans: [loan('closed', { outstanding: '0' }), loan('open')] }), async (p) => { await p.goto(base + '/activity?log=payment&loan=0'); const d = p.getByRole('dialog'); await d.getByRole('button', { name: /SAVE/ }).click(); const e = await store(p, 'finoptima_activity'); assert.ok(e.length === 0 || e[0].loanId === 'open', 'Closed hidden target must not receive payment'); });
    await run('A08 Stale payment loan ID survives profile reorder', user({ loans: [loan('a'), loan('b', { loan_type: 'auto_loan' })] }), async (p, c) => { await p.goto(base + '/activity'); const d = await logDialog(p); await d.getByRole('button', { name: /PAID PART OF IT/i }).click(); await d.getByLabel('Amount paid', { exact: true }).fill('4000'); const u = await profile(c); u.loans.reverse(); await c.addCookies([{ name: 'finoptima_user', value: encodeURIComponent(JSON.stringify(u)), url: base }]); await saveLog(p); const e = (await store(p, 'finoptima_activity'))[0]; assert.equal(e.loanId, 'a'); assert.equal(e.loanIndex, 1, 'Save must resolve stable loan against current profile'); });
    await run('A09 Stale deleted payment loan is rejected', user(), async (p, c) => { await p.goto(base + '/activity'); const d = await logDialog(p); const u = await profile(c); u.loans = []; await c.addCookies([{ name: 'finoptima_user', value: encodeURIComponent(JSON.stringify(u)), url: base }]); await d.getByRole('button', { name: /SAVE/ }).click(); assert.equal((await store(p, 'finoptima_activity')).length, 0); });
    await run('W01 Engine allocation conserves cash and logs once', user(), async (p, c) => { await windfall(p); await p.getByRole('button', { name: /LOG IT/ }).click(); await p.getByText(/Logged:/).waitFor(); assert.equal((await store(p, 'finoptima_activity')).length, 1); const u = await profile(c); assert.equal(Number(u.savings_balance), 50000); assert.equal(Number((await store(p, 'finoptima_activity'))[0].amount), 10000); assert.equal(await p.getByRole('button', { name: /LOGGED/ }).isDisabled(), true, 'Repeated click must not duplicate cash action'); });
    await run('W02 Goal allocation removes money from spendable savings', user({ loans: [], savings_balance: '50000' }), async (p, c) => { await windfall(p); await p.getByRole('button', { name: 'MY SPLIT', exact: true }).click(); const s = p.getByRole('slider'); assert.equal(await s.count(), 1); await s.fill('10000'); await p.getByRole('button', { name: /LOG IT/ }).click(); const u = await profile(c); const g = await store(p, 'finoptima_goal_contributions'); assert.equal(Number(g[0].amount), 10000); assert.equal(Number(u.savings_balance), 50000, 'External gift in goal cannot also remain in savings'); }, { finoptima_goals: [goal()] });
    await run('W03 Goal allocation from own account debits account', user({ loans: [], cash_accounts: [{ name: 'Bank', kind: 'checking', balance: '50000', apy: '.025' }] }), async (p, c) => { await windfall(p); await p.getByRole('button', { name: /MY SAVINGS/i }).click(); await p.getByLabel('From the account').selectOption('Bank'); await p.getByRole('button', { name: 'MY SPLIT', exact: true }).click(); await p.getByRole('slider').fill('10000'); await p.getByRole('button', { name: /LOG IT/ }).click(); assert.equal(Number((await profile(c)).cash_accounts[0].balance), 40000); }, { finoptima_goals: [goal()] });
    await run('W04 Smaller total invalidates previous manual split', user(), async (p, c) => { await windfall(p, '20000'); await p.getByRole('button', { name: 'MY SPLIT', exact: true }).click(); await p.getByRole('slider').fill('20000'); await p.getByLabel('Amount, after tax').fill('10000'); assert.equal(await p.getByRole('button', { name: /LOG IT/ }).isDisabled(), true); assert.equal((await store(p, 'finoptima_activity')).length, 0); assert.ok(!((await body(p)).includes('Logged:'))); });
    await run('W05 Stale closed loan cannot consume another cash allocation', user(), async (p, c) => { await windfall(p); const u = await profile(c); u.loans[0].outstanding = '0'; await c.addCookies([{ name: 'finoptima_user', value: encodeURIComponent(JSON.stringify(u)), url: base }]); await p.getByRole('button', { name: /LOG IT/ }).click(); assert.equal((await store(p, 'finoptima_activity')).length, 0); });
    await run('W06 Contribution storage failure rolls back whole cash action', user({ loans: [], cash_accounts: [{ name: 'Bank', kind: 'checking', balance: '50000', apy: '.025' }] }), async (p, c) => { await windfall(p); await p.getByRole('button', { name: /MY SAVINGS/i }).click(); await p.getByLabel('From the account').selectOption('Bank'); await p.getByRole('button', { name: 'MY SPLIT', exact: true }).click(); await p.getByRole('slider').fill('10000'); await p.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'finoptima_goal_contributions')
        throw Error('quota blocked'); return o.call(this, k, v); }; }); await p.getByRole('button', { name: /LOG IT/ }).click(); assert.equal((await store(p, 'finoptima_cash_events')).transfers?.length || 0, 0); assert.equal(Number((await profile(c)).cash_accounts[0].balance), 50000); }, { finoptima_goals: [goal()] });
    await run('G01 Goal create, add cents, cancel and reopen preserve contributions', user({ loans: [] }), async (p) => { await p.goto(base + '/goals'); await p.getByLabel(/How much it needs/).fill('15L'); await p.getByRole('button', { name: /^1 year$/i, exact: true }).click(); await p.getByRole('button', { name: /ADD GOAL/ }).click(); await p.getByRole('button', { name: /Open .*payment/i }).click(); await p.getByLabel('Add money put in today').fill('1234.56'); await p.getByRole('button', { name: /^\[ADD\]$/ }).click(); assert.equal((await store(p, 'finoptima_goal_contributions'))[0].amount, '1234.56'); await p.getByRole('button', { name: /Cancel .*payment/i }).click(); await p.getByRole('button', { name: /CLOSED/ }).click(); await p.getByRole('button', { name: /Reopen/ }).click(); assert.equal((await store(p, 'finoptima_goal_contributions')).length, 1); });
    await run('G02 Saving a goal does not report success after quota failure', user({ loans: [] }), async (p) => { await p.goto(base + '/goals'); await p.getByLabel(/How much it needs/).fill('10000'); await p.getByRole('button', { name: /^1 year$/i, exact: true }).click(); await p.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'finoptima_goals')
        throw Error('quota blocked'); return o.call(this, k, v); }; }); await p.getByRole('button', { name: /ADD GOAL/ }).click(); assert.equal((await store(p, 'finoptima_goals')).length, 0); assert.equal(await p.getByRole('button', { name: /Open .*payment/i }).count(), 0); });
    for (const blocked of ['finoptima_goals_digest', 'finoptima_goal_contributions_digest', 'finoptima_goal_contributions'])
        await run('G03 Atomic goal and already saved rollback: ' + blocked, user({ loans: [] }), async (p) => {
            await p.goto(base + '/goals');
            await p.getByLabel(/How much it needs/).fill('10000');
            await p.getByRole('button', { name: /^1 year$/i, exact: true }).click();
            await p.getByRole('button', { name: /MORE.*OPTIONAL/ }).click();
            await p.getByLabel('Already saved for it').fill('1000.25');
            await p.evaluate(key => { if (key === 'finoptima_goal_contributions') {
                const o = Storage.prototype.setItem;
                Storage.prototype.setItem = function (k, v) { if (k === key)
                    throw Error('quota blocked'); return o.call(this, k, v); };
            }
            else {
                const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
                Object.defineProperty(document, 'cookie', { get() { return d.get.call(document); }, set(v) { if (!v.startsWith(key + '='))
                        d.set.call(document, v); } });
            } }, blocked);
            await p.getByRole('button', { name: /ADD GOAL/ }).click();
            assert.equal((await store(p, 'finoptima_goals')).length, 0);
            assert.equal((await store(p, 'finoptima_goal_contributions')).length, 0);
            assert.equal(await p.getByRole('button', { name: /Open .*payment/i }).count(), 0);
            assert.ok(await p.locator('main').getByRole('alert').count());
        });
    await run('W07 Blocked payment cookie rolls back cash allocation', user(), async (p, c) => { await windfall(p); await p.evaluate(() => { const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie'); Object.defineProperty(document, 'cookie', { get() { return d.get.call(document); }, set(v) { if (!v.startsWith('finoptima_activity_deltas='))
            d.set.call(document, v); } }); }); await p.getByRole('button', { name: /LOG IT/ }).click(); assert.equal((await store(p, 'finoptima_activity')).length, 0); assert.equal((await store(p, 'finoptima_cash_events')).transfers?.length || 0, 0); assert.equal(Number((await profile(c)).savings_balance), 50000); assert.doesNotMatch(await body(p), /Logged:/); });
    await run('A10 Spare cash waits for plan and preserves exact cents', user(), async (p) => { await p.goto(base + '/activity'); await p.route('**/simulate', async (route) => { await new Promise(r => setTimeout(r, 800)); await route.continue(); }); const d = await logDialog(p); await d.getByRole('button', { name: /PAID EXTRA/i }).click(); await d.getByLabel(/Extra, on top/).fill('1000.25'); await d.getByRole('button', { name: /This month.s spare cash/i }).click(); const save = d.getByRole('button', { name: /SAVE/ }); assert.equal(await save.isDisabled(), true); await save.waitFor(); await p.waitForFunction(() => !Array.from(document.querySelectorAll('[role=dialog] button')).find(b => b.textContent.includes('SAVE'))?.disabled); await save.click(); const e = (await store(p, 'finoptima_activity'))[0]; assert.equal(e.plannedExtra, '1000.25'); assert.equal(e.amount, '10000.25'); });
    await run('G04 Goal with initial savings survives reload; deletion keeps contribution history', user({ loans: [] }), async (p) => { await p.goto(base + '/goals'); await p.getByLabel(/How much it needs/).fill('10000'); await p.getByRole('button', { name: /^1 year$/i, exact: true }).click(); await p.getByRole('button', { name: /MORE.*OPTIONAL/ }).click(); await p.getByLabel('Already saved for it').fill('1000.25'); await p.getByRole('button', { name: /ADD GOAL/ }).click(); assert.equal((await store(p, 'finoptima_goals')).length, 1); assert.equal((await store(p, 'finoptima_goal_contributions'))[0].amount, '1000.25'); await p.reload(); await p.getByRole('button', { name: /Open .*payment/i }).click(); await p.getByRole('button', { name: /Cancel .*payment/i }).click(); await p.getByRole('button', { name: /CLOSED/ }).click(); await p.getByRole('button', { name: /Delete .*payment/i }).click(); assert.equal((await store(p, 'finoptima_goals')).length, 0); assert.equal((await store(p, 'finoptima_goal_contributions')).length, 1); });
    await run('R01 Rolled balance matches NRI tool current snapshot', user({ country: 'US', is_nri_us: true, monthly_income: '5000', fixed_expenses: '1000', fx_to_user_currency: { INR: '.0125' }, loans: [loan('a', { balance_as_of: date(-4), outstanding: '100000', scheduled_emi: '10000', nominal_rate: '0', currency: 'INR' })] }), async (p) => { await p.goto(base + '/tools/nri-prepay'); assert.match(await body(p), /70,000/, 'Four months old means three completed EMIs before current plan'); assert.doesNotMatch(await body(p), /Still owed.*100,000/); });
    const profiles = { IN: user(), US: user({ country: 'US', monthly_income: '5000', fixed_expenses: '2000', loans: [loan('a', { currency: 'USD', bank: 'Chase', outstanding: '10000', scheduled_emi: '300' })] }), NRI: user({ country: 'US', is_nri_us: true, monthly_income: '6000', fixed_expenses: '2000', fx_to_user_currency: { INR: '.0125' }, loans: [loan('a', { currency: 'INR' })] }), EMPTY: user({ loans: [] }) };
    for (const kind of ['IN', 'US']) {
        const u = profiles[kind];
        await run('T ' + kind + ' New debt answer invalidates after changes and adds quoted loan', u, async (p, c) => { await p.goto(base + '/tools/new-debt'); await p.getByLabel('How much', { exact: true }).fill('10000'); await p.getByLabel('Savings outside your emergency fund').fill('0'); await p.getByRole('button', { name: /Check this loan/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); await p.getByLabel('How much', { exact: true }).fill('20000'); assert.equal(await p.getByText(/^The answer$/i, { exact: true }).count(), 0); await p.getByRole('button', { name: /Check this loan/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); const add = p.getByRole('button', { name: /Add .*profile/ }); assert.equal(await add.count(), 1, 'Affordable quoted loan must offer saving'); if (await add.count()) {
            await add.click();
            assert.equal((await profile(c)).loans.length, 2);
            assert.equal(Number((await profile(c)).loans[1].outstanding), 20000);
        } await p.getByLabel('How much', { exact: true }).fill('99999999'); await p.getByRole('button', { name: /Check this loan/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); assert.equal(await p.getByRole('button', { name: /Add .*profile/ }).count(), 0, 'Unaffordable debt must not offer saving'); });
        await run('T ' + kind + ' Purchase math and invalid down payment', u, async (p) => { await p.goto(base + '/tools/new-debt?mode=purchase'); await p.getByLabel('Price', { exact: true }).fill('100000'); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); assert.doesNotMatch(await body(p), /NaN|undefined/); await p.getByLabel('Down payment (%)', { exact: true }).fill('150'); assert.doesNotMatch(await body(p), /You can afford it/); assert.match(await body(p), /100|between|valid/i); });
        await run('T ' + kind + ' Sell to repay computes and validates partial quantity', u, async (p) => { await p.goto(base + '/tools/liquidate'); await p.getByLabel('What you paid', { exact: true }).fill('100000'); await p.getByLabel('When you bought it', { exact: true }).fill('2020'); await p.getByLabel('What it would sell for', { exact: true }).fill('150000'); if (kind === 'US')
            await p.getByRole('button', { name: /No: rental/i }).click(); await p.getByRole('button', { name: /Should I sell/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); assert.doesNotMatch(await body(p), /NaN/); await p.getByRole('button', { name: /Part of it/i, exact: true }).click(); assert.equal(await p.getByText(/^The answer$/i, { exact: true }).count(), 0); await p.getByLabel(/You own/).fill('10'); await p.getByLabel(/You.d sell/).fill('11'); await p.getByLabel(/Price per/).fill('10000'); await p.getByRole('button', { name: /Should I sell/i }).click(); assert.equal(await p.getByText(/^The answer$/i, { exact: true }).count(), 0); assert.match(await body(p), /own|quantity|exceed/i); });
        await run('T ' + kind + ' Invest vs prepay responds to return and downside', u, async (p) => { await p.goto(base + '/tools/invest-vs-prepay'); const returns = p.getByLabel(/It earns a year|Today's rate/); await returns.fill('1'); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); const low = await body(p); await returns.fill('40'); assert.notEqual(await body(p), low); assert.doesNotMatch(await body(p), /NaN|undefined/); });
    }
    await run('T IN Loan check clears complaint and offers when input changes', user({ loans: [loan('a', { loan_type: 'home_loan', rate_type: 'floating', outstanding: '2000000', scheduled_emi: '20000', tenure_months_remaining: 180, nominal_rate: '.09' })] }), async (p) => { await p.goto(base + '/tools/loan-check'); await p.getByLabel('Month the loan started: month').selectOption('01'); await p.getByLabel('Month the loan started: year').selectOption('2020'); await p.getByLabel('Rate when the loan started (%)').fill('9'); await p.getByRole('button', { name: /Check my loan/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); await p.getByLabel('Rate when the loan started (%)').fill('8'); assert.equal(await p.getByText(/^The answer$/i, { exact: true }).count(), 0); });
    await run('T NRI result invalidates for changed rate; payoff logs once', profiles.NRI, async (p, c) => { await p.goto(base + '/tools/nri-prepay'); await p.getByLabel('Your savings earn, a year before tax').fill('1'); await p.getByRole('button', { name: /Should I prepay/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); await p.getByLabel('Your savings earn, a year before tax').fill('2'); assert.equal(await p.getByText(/^The answer$/i, { exact: true }).count(), 0); await p.getByRole('button', { name: /Should I prepay/i }).click(); await p.getByText(/^The answer$/i, { exact: true }).waitFor(); const apply = p.getByRole('button', { name: /I paid it off/ }); assert.equal(await apply.count(), 1, 'Prepay recommendation must offer recording payoff'); if (await apply.count()) {
        await apply.click();
        assert.equal((await store(p, 'finoptima_activity'))[0].loanId, 'a');
        assert.equal(await apply.count(), 0);
    } });
    const routes = ['/', '/plan', '/activity', '/goals', '/portfolio', '/tools/windfall', '/tools/new-debt', '/tools/new-debt?mode=purchase', '/tools/liquidate', '/tools/invest-vs-prepay', '/tools/loan-check', '/tools/nri-prepay'];
    for (const [kind, u] of Object.entries(profiles))
        await run('M ' + kind + ' all pages desktop/mobile', u, async (p) => { for (const route of routes) {
            await p.goto(base + route);
            assert.doesNotMatch(await body(p), /NaN|undefined|Internal Server Error|DEMO PROFILE/);
            await p.setViewportSize({ width: 390, height: 844 });
            await p.waitForTimeout(180);
            assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow ' + route);
            await p.setViewportSize({ width: 1200, height: 900 });
        } });
    await browser.close();
    console.log(JSON.stringify({ passed: results.filter(x => x.status === 'passed').length, total: results.length, output }));
    if (results.some(x => x.status === 'failed'))
        process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
