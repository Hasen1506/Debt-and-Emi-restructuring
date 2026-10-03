const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const LZ = require('../web/node_modules/lz-string');
const base = process.env.BASE_URL || 'http://127.0.0.1:3215';
const output = process.env.AUDIT_OUTPUT || path.resolve(__dirname, '../pr23-results.json');
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

// Local auth-bypassed web/API, feeds off. Browser requests need the web
// origin in CORS_ORIGINS. Seeded months move with the test's current date.
const current=date().slice(0,7), next=date(1).slice(0,7);
const emi=(x={})=>loan('a',{nominal_rate:'.12',balance_as_of:date(),currency:'INR',...x});
const payment=(x={})=>({id:'extra',loanId:'a',loanIndex:0,kind:'paid_extra',amount:'10000',scheduledEmi:'0',date:date(),loggedAt:now.toISOString(),...x});
async function paceView(p) {await p.goto(base+'/activity');await p.waitForFunction(()=>document.cookie.includes('finoptima_activity_deltas='));await p.goto(base+'/plan');return p.locator('section[aria-labelledby="plan-pace-h"]');}
async function blockCookie(p,key) {await p.evaluate(key=>{const d=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');Object.defineProperty(document,'cookie',{get(){return d.get.call(this)},set(v){if(!v.startsWith(key))d.set.call(this,v)}})},key);}
const regularMonths=(amount)=>[date(-2),date(-1)].map((d,i)=>payment({id:'pace'+i,date:d,kind:'paid_partial',amount:String(amount),scheduledEmi:'9000',penaltyOverride:'0'}));
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  await run('P01 Deferred first EMI agrees on Home and Activity',user({loans:[emi({first_emi_month:next})]}),async p=>{
    await p.goto(base+'/');assert.match(await body(p),/No loan payment is due this month/);
    assert.doesNotMatch(await body(p),/engine can.t be reached/i);
    await p.goto(base+'/activity');assert.doesNotMatch(await body(p),/TO PAY/);
    const d=await logDialog(p);await d.getByRole('button',{name:/SAVE/}).click();assert.equal((await store(p,'finoptima_activity')).length,0);
    await d.getByRole('button',{name:/MISSED/i}).click();await d.getByRole('button',{name:/SAVE/}).click();assert.equal((await store(p,'finoptima_activity')).length,0);
    await d.getByRole('button',{name:/PAID EXTRA/i}).click();await d.getByLabel(/Extra, on top/).fill('1000');
    await d.getByRole('button',{name:/BONUS/i}).click();await saveLog(p);
    const e=(await store(p,'finoptima_activity'))[0];assert.equal(e.scheduledEmi,'0.00');assert.equal(e.amount,'1000.00');
  });
  await run('P02 Bonus-only prepayment leaves Home regular EMI due',user({loans:[emi()]}),async p=>{
    await p.goto(base+'/activity');await p.goto(base+'/');const text=await body(p);
    assert.doesNotMatch(text,/ALL DONE|AFTER EMI/);await p.getByRole('button',{name:/Mark .* paid/}).waitFor();assert.equal(await p.getByRole('button',{name:/Mark .* paid/}).count(),1);
  },{finoptima_activity:[payment()]});
  await run('P03 A partial EMI does not claim all payments are done',user({loans:[emi()]}),async p=>{
    await p.goto(base+'/');await p.getByText(/· PARTIAL/).waitFor();const text=await body(p);assert.match(text,/PARTIAL/);assert.doesNotMatch(text,/ALL DONE/);
  },{finoptima_activity:[payment({kind:'paid_partial',amount:'4000',scheduledEmi:'9000',penaltyOverride:'0'})]});
  for(const target of ['finoptima_activity','finoptima_activity_deltas']) {
    await run('P04 Home failed '+target+' write keeps the EMI unpaid',user({loans:[emi()]}),async p=>{
      await p.goto(base+'/');
      if(target==='finoptima_activity')await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='finoptima_activity')throw Error('quota blocked');return set.call(this,k,v)}});
      else await blockCookie(p,target);
      await p.getByRole('button',{name:/Mark .* paid/}).click();assert.equal((await store(p,'finoptima_activity')).length,0);
      assert.equal(await p.getByRole('button',{name:/Mark .* paid/}).count(),1);assert.doesNotMatch(await body(p),/ALL DONE/);
      assert.match(await p.locator('main').getByRole('alert').innerText(),/quota|could not be saved/);
    });
  }
  await run('P05 Bonus-only history cannot manufacture an average',user({loans:[emi({outstanding:'500000'})]}),async p=>{
    const section=await paceView(p);assert.match(await section.innerText(),/Once two months/);assert.doesNotMatch(await section.innerText(),/averaged|debt-free in/);
  },{finoptima_activity:[date(-2),date(-1)].map((d,i)=>payment({id:String(i),date:d,source:'bonus'}))});
  await run('P06 Monthly surplus extras count in the repayment average',user({loans:[emi({outstanding:'500000'})]}),async p=>{
    const section=await paceView(p);assert.match(await section.innerText(),/averaged ₹15,000/);assert.doesNotMatch(await section.innerText(),/₹30,000.*one.off/i);
  },{finoptima_activity:regularMonths(15000).map(e=>({...e,kind:'paid_extra',source:'surplus'}))});
  await run('P07 Payments below minimums have no false payoff date or adopt button',user({loans:[emi({outstanding:'500000'})]}),async p=>{
    const section=await paceView(p);const text=await section.innerText();assert.match(text,/averaged ₹4,000/);assert.match(text,/cannot give a payoff date/);
    assert.doesNotMatch(text,/you.d be debt-free/);assert.equal(await section.getByRole('button').count(),0);
  },{finoptima_activity:regularMonths(4000)});
  await run('P08 Pace beyond saved spending capacity has no false date or adopt button',user({loans:[emi({outstanding:'500000'})]}),async p=>{
    const section=await paceView(p);const text=await section.innerText();assert.match(text,/averaged ₹80,000/);assert.match(text,/do not support that monthly total/);
    assert.doesNotMatch(text,/you.d be debt-free/);assert.equal(await section.getByRole('button').count(),0);
  },{finoptima_activity:regularMonths(80000).map(e=>({...e,kind:'paid_extra',source:'surplus'}))});
  await run('P09 NRI rate advice separates INR and USD loans by benchmark',user({country:'US',is_nri_us:true,monthly_income:'6000',annual_gross_salary:'72000',annual_income:'72000',fixed_expenses:'1500',fx_to_user_currency:{INR:'.012'},loans:[emi({loan_type:'home_loan',rate_type:'floating'}),emi({id:'usd',bank:'Chase',loan_type:'credit_card',currency:'USD',outstanding:'2000',scheduled_emi:'0',nominal_rate:'.24'}),emi({id:'in-card',bank:'ICICI',loan_type:'credit_card',scheduled_emi:'0',nominal_rate:'.42'})]}),async p=>{
    await p.goto(base+'/plan');const rbi=p.locator('section[aria-labelledby="rate-decisions-IN-h"]');const fed=p.locator('section[aria-labelledby="rate-decisions-US-h"]');
    assert.match(await rbi.innerText(),/HDFC.*home loan/i);assert.match(await rbi.innerText(),/ICICI.*aren.t linked/i);assert.doesNotMatch(await rbi.innerText(),/Chase/);
    assert.match(await fed.innerText(),/Chase.*VARIABLE APR/s);assert.doesNotMatch(await fed.innerText(),/ICICI/);
  });
  await run('P10 Assumptions and Home caption describe saved rate and pay-rise changes',user({annual_hike_rate:'0',hike_schedule:[[1,3,'.10']],loans:[emi({rate_type:'floating',rate_drift_annualized:'.01'})]}),async p=>{
    await p.goto(base+'/');assert.match(await body(p),/WITH YOUR SAVED RATE CHANGES/);
    await p.goto(base+'/plan');const show=p.getByRole('button',{name:'Show what the plan takes as given'});if(await show.count())await show.click();
    const section=p.locator('section[aria-labelledby="plan-givens-h"]');const text=await section.innerText();
    assert.match(text,/saved rate changes/);assert.match(text,/Saved pay-rise phase: 10.0%/);assert.doesNotMatch(text,/Every loan keeps|with no pay rise/);
  });
  await run('P11 Paid-at-entry failure rolls back both profile and Activity',user({loans:[emi()]}),async(p,c)=>{
    await p.goto(base+'/profile?step=loans');await p.getByLabel(/Balance|Outstanding/).first().fill('99000');
    await p.getByRole('button',{name:'PAID ALREADY',exact:true}).click();
    await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='finoptima_activity')throw Error('quota blocked');return set.call(this,k,v)}});
    await p.getByRole('button',{name:/SAVE CHANGES/}).click();
    assert.equal((await profile(c)).loans[0].outstanding,'100000');assert.equal((await store(p,'finoptima_activity')).length,0);
    assert.match(await body(p),/didn.t keep|could not|cookies blocked/i);
  });
  await run('P12 Paid-at-entry succeeds once and shows the EMI paid on Home',user({loans:[emi()]}),async(p,c)=>{
    await p.goto(base+'/profile?step=loans');await p.getByLabel(/Balance|Outstanding/).first().fill('99000');
    await p.getByRole('button',{name:'PAID ALREADY',exact:true}).click();await p.getByRole('button',{name:/SAVE CHANGES/}).click();
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('finoptima_activity')||'[]').length===1);
    assert.equal((await profile(c)).loans[0].outstanding,'99000');assert.equal((await store(p,'finoptima_activity'))[0].amount,'9000.00');
    await p.goto(base+'/');assert.match(await body(p),/AFTER [A-Z]+ EMI/);
  });
  await run('P13 Setup preview and saved plan defer a new loan by the same month',user({loans:[emi()]}),async(p,c)=>{
    await p.goto(base+'/onboarding');await p.getByRole('button',{name:/CONTINUE.*WHAT YOU OWE/}).click();
    await p.getByLabel('Balance left to repay',{exact:true}).fill('100001');
    await p.getByRole('button',{name:/NEW LOAN.*FIRST EMI/}).click();
    const response=p.waitForResponse(r=>r.url().endsWith('/api/simulate')&&r.request().method()==='POST');
    await p.getByRole('button',{name:/CONTINUE.*SEE YOUR PLAN/}).click();const r=await response;
    const args=r.request().postDataJSON();assert.equal(args.user.loans[0].first_payment_month,2);
    const result=await r.json();assert.equal(Number(result.trajectory.find(t=>t.month===1).total_paid),0);
    await p.getByRole('button',{name:/SAVE.*OPEN MY PLAN/}).click();
    await p.waitForURL(base+'/',{waitUntil:'domcontentloaded'});assert.equal((await profile(c)).loans[0].first_emi_month,next);
    await p.goto(base+'/');assert.match(await body(p),/No loan payment is due this month/);
  });
  await run('P14 Pace must stay affordable after modeled costs rise',user({inflation_rate:'.25',loans:[emi({outstanding:'500000'})]}),async(p,c)=>{
    await c.addCookies([{name:'finoptima_inflation_modeling',value:'on',url:base},{name:'finoptima_inflation_rate',value:'.25',url:base}]);
    const section=await paceView(p);assert.match(await section.innerText(),/averaged ₹55,000/);
    assert.match(await section.innerText(),/do not support that monthly total/);
    assert.doesNotMatch(await section.innerText(),/you.d be debt-free/);assert.equal(await section.getByRole('button').count(),0);
  },{finoptima_activity:regularMonths(55000).map(e=>({...e,kind:'paid_extra',source:'surplus'}))});
  await run('P15 Stale Home cannot overwrite a newer payment ledger',user({loans:[emi()]}),async p=>{
    await p.goto(base+'/');const mark=p.getByRole('button',{name:/Mark .* paid/});await mark.waitFor();
    await p.evaluate(e=>localStorage.setItem('finoptima_activity',JSON.stringify([e])),payment());
    await mark.click();assert.equal((await store(p,'finoptima_activity')).length,1);
    assert.equal((await store(p,'finoptima_activity'))[0].scheduledEmi,'0');
    assert.match(await p.locator('main').getByRole('alert').innerText(),/Activity changed/);
  });
  await run('P16 Stale Home cannot pay a loan deleted in the current profile',user({loans:[emi()]}),async(p,c)=>{
    await p.goto(base+'/');const mark=p.getByRole('button',{name:/Mark .* paid/});await mark.waitFor();
    const u=await profile(c);u.loans=[];await c.addCookies([{name:'finoptima_user',value:encodeURIComponent(JSON.stringify(u)),url:base}]);
    await mark.click();assert.equal((await store(p,'finoptima_activity')).length,0);
    assert.match(await p.locator('main').getByRole('alert').innerText(),/profile changed/);
  });
  await browser.close();console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,total:results.length,output}));
  if(results.some(x=>x.status==='failed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
