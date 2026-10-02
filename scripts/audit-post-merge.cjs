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
    p.goto = async (...a) => { const r = await goto(...a); await p.waitForFunction(() => { const e = document.querySelector('main input,main button,main select'); return document.querySelector('main') && (!e || Object.keys(e).some(k => k.startsWith('__reactProps$'))); }); assert.ok(!p.url().includes('/login'), 'Test must reach app, not login'); return r; };
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
async function windfall(p, amt = '10000') { await p.goto(base + '/tools/windfall'); await p.getByLabel('Amount, after tax').fill(amt); await p.waitForFunction(() => document.querySelector('#wf-out') && !document.querySelector('main').textContent.includes('Working out the best split')); await p.waitForTimeout(1100); }

const payment=(extra={})=>({id:'p',loanId:'a',loanIndex:0,kind:'paid_extra',date:date(-1),loggedAt:new Date(now.getTime()-30*86400000).toISOString(),scheduledEmi:'0',amount:'1000',...extra});
const change=(id,extra={})=>({id,kind:'goal_edited',at:new Date(now.getTime()-60000).toISOString(),label:id,snapshot:{goal:goal('g',{label:'Original'})},result:{goalId:'g'},impactDeltaMonths:null,reverted:false,...extra});
const oldLoan=loan('a',{balance_as_of:date(-2),outstanding:'100000',nominal_rate:'0',scheduled_emi:'1000'});
async function updateBalance(p,value){await p.goto(base+'/profile?step=loans');await p.getByLabel('Outstanding balance',{exact:true}).fill(value);await p.getByRole('button',{name:/SAVE CHANGES/}).click();}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 await run('B01 Fresh statement replaces earlier history; new same-day payments still count',user({loans:[oldLoan]}),async(p,c)=>{
  await p.goto(base+'/activity');await updateBalance(p,'90000');assert.equal((await profile(c)).loans[0].outstanding,'90000');assert.ok((await profile(c)).loans[0].balance_recorded_at);
  await p.goto(base+'/plan');assert.equal(await p.getByRole('slider',{name:'Pay a lump sum'}).getAttribute('max'),'90000');
  await p.goto(base+'/activity');const d=await logDialog(p);await d.getByRole('button',{name:/PAID EXTRA/i}).click();await d.getByLabel(/Extra, on top/).fill('500.25');await d.getByRole('button',{name:/A bonus or gift/i}).click();await saveLog(p);
  assert.equal((await store(p,'finoptima_activity')).length,2);await p.goto(base+'/plan');assert.equal(await p.getByRole('slider',{name:'Pay a lump sum'}).getAttribute('max'),'89499.75');await p.reload();assert.equal(await p.getByRole('slider',{name:'Pay a lump sum'}).getAttribute('max'),'89499.75');
 },{finoptima_activity:[payment()]});
 await run('B02 Fresh card statement replaces older reported card balance',user({loans:[loan('a',{loan_type:'credit_card',outstanding:'10000',nominal_rate:'.24',scheduled_emi:'500',balance_as_of:date(-2)})]}),async(p,c)=>{
  await p.goto(base+'/activity');await updateBalance(p,'9000');assert.equal((await profile(c)).loans[0].outstanding,'9000');await p.goto(base+'/plan');assert.equal(await p.getByRole('slider',{name:'Pay a lump sum'}).getAttribute('max'),'9000');
 },{finoptima_activity:[payment({kind:'paid_full',scheduledEmi:'500',amount:'500',newOutstanding:'5000'})]});
 await run('B03 Blocked projection cookie rejects profile update and preserves old history',user({loans:[oldLoan]}),async(p,c)=>{
  await p.goto(base+'/activity');await p.goto(base+'/profile?step=loans');await p.getByLabel('Outstanding balance',{exact:true}).fill('90000');await p.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');Object.defineProperty(document,'cookie',{get(){return d.get.call(document)},set(v){if(!v.startsWith('finoptima_activity_deltas='))d.set.call(document,v)}})});await p.getByRole('button',{name:/SAVE CHANGES/}).click();assert.equal((await profile(c)).loans[0].outstanding,'100000');assert.match(await body(p),/wasn.t saved|couldn.t save|didn.t.*save|could not save|couldn.t.*keep/i);assert.equal((await store(p,'finoptima_activity')).length,1);
 },{finoptima_activity:[payment()]});
 await run('B04 Aged balance can receive a lump payment and remain consistent',user({loans:[loan('a',{balance_as_of:date(-4),outstanding:'100000',nominal_rate:'0',scheduled_emi:'10000'})]}),async p=>{
  await p.goto(base+'/plan');const slider=p.getByRole('slider',{name:'Pay a lump sum'});assert.equal(await slider.getAttribute('max'),'70000');await p.getByRole('textbox',{name:'Pay a lump sum',exact:true}).fill('10000');await p.getByRole('textbox',{name:'Pay a lump sum',exact:true}).press('Enter');await p.getByRole('button',{name:/Log it/}).click();assert.equal((await store(p,'finoptima_activity')).length,1);await p.reload();assert.equal(await slider.getAttribute('max'),'60000');
 });
 await run('B05 Older goal undo is blocked; newest-first undo restores correctly',user({loans:[]}),async p=>{
  await p.goto(base+'/activity');await p.getByRole('button',{name:'Undo older',exact:true}).click();assert.match(await p.locator('main').getByRole('alert').innerText(),/newer/i);assert.equal((await store(p,'finoptima_goals'))[0].label,'Latest');
  await p.getByRole('button',{name:'Undo newer',exact:true}).click();assert.equal((await store(p,'finoptima_goals'))[0].label,'Middle');await p.getByRole('button',{name:'Undo older',exact:true}).click();assert.equal((await store(p,'finoptima_goals'))[0].label,'Original');assert.equal((await store(p,'finoptima_decisions')).filter(d=>d.reverted).length,2);
 },{finoptima_goals:[goal('g',{label:'Latest'})],finoptima_decisions:[change('newer',{snapshot:{goal:goal('g',{label:'Middle'})},at:now.toISOString()}),change('older')]});
 await run('B06 Undo quota failure preserves goal and plan cookie',user({loans:[]}),async(p,c)=>{
  await p.goto(base+'/activity');const before=(await c.cookies()).find(c=>c.name==='finoptima_goals_digest')?.value;await p.evaluate(()=>{const put=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='finoptima_decisions')throw Error('quota blocked');return put.call(this,k,v)}});await p.getByRole('button',{name:'Undo edit',exact:true}).click();assert.equal((await store(p,'finoptima_goals'))[0].label,'Current');assert.equal((await c.cookies()).find(c=>c.name==='finoptima_goals_digest')?.value,before);assert.equal((await store(p,'finoptima_decisions'))[0].reverted,false);assert.match(await p.locator('main').getByRole('alert').innerText(),/quota/i);
 },{finoptima_goals:[goal('g',{label:'Current'})],finoptima_decisions:[change('edit')]});
 await run('B07 Actual goal edit records guarded result and can be undone',user({loans:[]}),async p=>{
  await p.goto(base+'/goals');await p.getByRole('button',{name:'Edit Initial',exact:true}).click();await p.getByLabel('Name',{exact:true}).fill('Edited');await p.getByRole('button',{name:/^\[ SAVE \]$/}).click();const d=(await store(p,'finoptima_decisions'))[0];assert.equal(d.result.goal.label,'Edited');await p.goto(base+'/activity');await p.getByRole('button',{name:/Undo Changed goal: Edited/}).click();assert.equal((await store(p,'finoptima_goals'))[0].label,'Initial');
 },{finoptima_goals:[goal('g',{label:'Initial'})]});
 await run('B08 Stale undo keeps another tab’s unrelated decisions',user({loans:[]}),async p=>{
  await p.goto(base+'/activity');await p.evaluate(d=>{const old=JSON.parse(localStorage.getItem('finoptima_decisions'));localStorage.setItem('finoptima_decisions',JSON.stringify([d,...old]));},change('unrelated',{kind:'hike_toggle',snapshot:{},result:{}}));await p.getByRole('button',{name:'Undo edit',exact:true}).click();const records=await store(p,'finoptima_decisions');assert.equal(records.length,2);assert.equal(records[0].id,'unrelated');assert.equal(records[1].reverted,true);
 },{finoptima_goals:[goal('g',{label:'Current'})],finoptima_decisions:[change('edit')]});
 await run('B09 Goal creation with initial money rolls back when decision history fails',user({loans:[]}),async p=>{
  await p.goto(base+'/goals');await p.getByLabel(/How much it needs/).fill('10000');await p.getByRole('button',{name:/^1 year$/i}).click();await p.getByRole('button',{name:/MORE.*OPTIONAL/}).click();await p.getByLabel('Already saved for it').fill('1000');await p.evaluate(()=>{const put=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='finoptima_decisions')throw Error('history quota');return put.call(this,k,v)}});await p.getByRole('button',{name:/ADD GOAL/}).click();assert.equal((await store(p,'finoptima_goals')).length,0);assert.equal((await store(p,'finoptima_goal_contributions')).length,0);assert.match(await p.locator('main').getByRole('alert').innerText(),/quota/);
 });
 await run('B10 Failed edit history leaves the previous goal intact',user({loans:[]}),async p=>{
  await p.goto(base+'/goals');await p.getByRole('button',{name:'Edit Initial',exact:true}).click();await p.getByLabel('Name',{exact:true}).fill('Edited');await p.evaluate(()=>{const put=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='finoptima_decisions')throw Error('history quota');return put.call(this,k,v)}});await p.getByRole('button',{name:/^\[ SAVE \]$/}).click();assert.equal((await store(p,'finoptima_goals'))[0].label,'Initial');assert.equal((await store(p,'finoptima_decisions')).length,0);assert.match(await p.locator('main').getByRole('alert').innerText(),/quota/);
 },{finoptima_goals:[goal('g',{label:'Initial'})]});
 await run('B11 Failed cancel history keeps the goal active',user({loans:[]}),async p=>{
  await p.goto(base+'/goals');await p.evaluate(()=>{const put=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='finoptima_decisions')throw Error('history quota');return put.call(this,k,v)}});await p.getByRole('button',{name:'Cancel Initial',exact:true}).click();assert.equal((await store(p,'finoptima_goals'))[0].status,'active');assert.equal((await store(p,'finoptima_decisions')).length,0);assert.match(await p.locator('main').getByRole('alert').innerText(),/quota/);
 },{finoptima_goals:[goal('g',{label:'Initial'})]});
 await run('B12 Blocked EF undo cookie preserves split and undo history',user({loans:[]}),async(p,c)=>{
  await c.addCookies([{name:'finoptima_ef_split',value:'0.5',url:base}]);await p.goto(base+'/activity');await p.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');Object.defineProperty(document,'cookie',{get(){return d.get.call(document)},set(v){if(!v.startsWith('finoptima_ef_split='))d.set.call(document,v)}})});await p.getByRole('button',{name:'Undo EF choice',exact:true}).click();assert.equal((await c.cookies()).find(c=>c.name==='finoptima_ef_split').value,'0.5');assert.equal((await store(p,'finoptima_decisions'))[0].reverted,false);assert.match(await p.locator('main').getByRole('alert').innerText(),/could not be saved/);
 },{finoptima_decisions:[change('EF choice',{kind:'ef_split_change',snapshot:{efSplit:'0.3'},result:{efSplit:'0.5'}})]});
 await run('B13 Historical card minimum survives lower current balance',user({country:'US',monthly_income:'5000',fixed_expenses:'2000',loans:[loan('a',{loan_type:'credit_card',currency:'USD',bank:'Chase',outstanding:'1000',nominal_rate:'.24',scheduled_emi:'0'})]}),async(p,c)=>{
  await p.goto(base+'/activity');const raw=(await c.cookies()).find(c=>c.name==='finoptima_activity_deltas').value;const payload=JSON.parse(LZ.decompressFromEncodedURIComponent(raw.slice(3)));assert.equal(payload.deltas[0].count,1);assert.ok(Number(payload.deltas[0].penalty)>0);
 },{finoptima_activity:[payment({kind:'paid_partial',amount:'80',scheduledEmi:'100'})]});
 await browser.close();console.log(JSON.stringify({passed:results.filter(r=>r.status==='passed').length,total:results.length,output}));if(results.some(r=>r.status!=='passed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
