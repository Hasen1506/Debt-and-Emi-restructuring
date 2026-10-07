/* Optional browser regression gate. Install Playwright, then run with a local
 * frontend/API. BASE_URL, PLAYWRIGHT_MODULE and CHROME_PATH may be overridden. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const LZ=require('../web/node_modules/lz-string');
const base=process.env.BASE_URL || 'http://127.0.0.1:3211';
const output=process.env.AUDIT_OUTPUT || path.resolve(__dirname,'../audit-browser-results.json');
const loan=(id='a',extra={})=>({id,bank:id==='a'?'HDFC Bank':'ICICI Bank',loan_type:'personal_loan',outstanding:'100000',nominal_rate:'.18',rate_type:'fixed',scheduled_emi:'9000',tenure_months_remaining:24,...extra});
const user=(extra={})=>({country:'IN',income_type:'salaried',monthly_income:'100000',annual_income:'1200000',annual_gross_salary:'1200000',fixed_expenses:'40000',savings_balance:'50000',efund_balance:'100000',efund_target:'100000',primary_bank:'HDFC Bank',tax_regime:'new',inflation_rate:'.046',loans:[loan()],investment_options:[],...extra});
const event=(id,kind,extra)=>({id,kind,status:'planned',effectiveDate:'2026-09-01',loggedAt:'2026-09-01T00:00:00Z',...extra});
async function saved(c){const cookies=await c.cookies();const get=n=>decodeURIComponent(cookies.find(x=>x.name===n)?.value ?? '');let raw=get('finoptima_user');if(raw.startsWith('z1.')){const m=/^z1\.(\d+)\./.exec(raw);let zipped=raw.slice(m[0].length);for(let i=1;i<Number(m[1]);i++)zipped+=get('finoptima_user_'+i);raw=LZ.decompressFromEncodedURIComponent(zipped);}return JSON.parse(raw);}
async function text(p){return p.locator('main').innerText();}
async function checkButton(p,name){await p.getByRole('button',{name}).click();await p.getByRole('button',{name}).waitFor({state:'visible'});await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.disabled && /WORKING|Checking/i.test(b.textContent)),{},{timeout:30000});}
let browser; const results=[];
async function run(name, u, fn, storage={},events=[]){
  if(process.env.AUDIT_FILTER && !name.includes(process.env.AUDIT_FILTER)) return;
  const c=await browser.newContext();
  await c.addCookies([{name:'finoptima_user',value:encodeURIComponent(JSON.stringify(u)),url:base+'/'}, {name:'finoptima_marginal',value:'0',url:base+'/'},
    ...(events.length?[{name:'finoptima_lifecycle',value:encodeURIComponent(JSON.stringify(events)),url:base+'/'}]:[])]);
  await c.addInitScript(store=>{for(const [key,value]of Object.entries(store))if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},storage);
  const p=await c.newPage();p.setDefaultTimeout(30000);p.setDefaultNavigationTimeout(60000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const goto=p.goto.bind(p);
  p.goto=async (...args)=>{const r=await goto(...args);await p.waitForFunction(()=>{
    const el=document.querySelector('main input, main select, main button');return !el || Object.keys(el).some(k=>k.startsWith('__reactProps$'));
  });await p.waitForFunction(()=>document.querySelector('main') && !document.querySelector('main')?.textContent.includes('DEMO PROFILE'));return r;};
  try{await fn(p,c);assert.deepEqual(errors,[],'Browser exceptions');results.push({name,status:'passed'});console.log('PASS',name);}
  catch(e){results.push({name,status:'failed',error:e.message,body:await p.locator('body').innerText().catch(()=>''),exceptions:errors});console.error('FAIL',name,e.message);}
  finally{await c.close();fs.writeFileSync(output,JSON.stringify(results,null,2));}
}
(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  await run('R6: confirm two rate resets in one visit',user({loans:[loan('a',{nominal_rate:'.12'}),loan('b',{nominal_rate:'.15'})]}),async(p,c)=>{
    await p.goto(base+'/debts');await p.getByRole('button',{name:'Confirm',exact:true}).first().click();await p.getByRole('button',{name:'Confirm',exact:true}).last().click();
    assert.deepEqual((await saved(c)).loans.map(l=>Number(l.nominal_rate)),[.08,.09]);
  },{},[event('r1','floating_rate_reset',{loanIndex:0,loanId:'a',newRate:'.08'}),event('r2','floating_rate_reset',{loanIndex:1,loanId:'b',newRate:'.09'})]);
  await run('R6: gross-only salary confirmation updates take-home',user({monthly_income:'50000'}),async(p,c)=>{
    await p.goto(base+'/debts');await p.getByRole('button',{name:'Confirm',exact:true}).click();assert.equal((await saved(c)).monthly_income,'100000.00');
    await p.goto(base+'/');assert.match(await text(p),/51,000/);
  },{},[event('s','salary_reset',{newAnnualGross:'1200000'})]);
  await run('R6: planned property reaches Plan',user({loans:[]}),async(p)=>{
    await p.goto(base+'/plan');await p.getByText(/Future Bank/).first().waitFor({timeout:60000});const body=await text(p);assert.match(body,/Future Bank/);assert.doesNotMatch(body,/ENGINE UNAVAILABLE/);
  },{},[event('p','property_buy',{effectiveDate:'2026-11-01',loanDraft:loan('future',{bank:'Future Bank',loan_type:'home_loan',outstanding:'500000',nominal_rate:'.09',scheduled_emi:'6350',tenure_months_remaining:120})})]);
  await run('R6: property undo after an earlier loan was removed',user({loans:[loan('lifecycle_p',{bank:'Future Bank'})]}),async(p,c)=>{
    await p.goto(base+'/debts');await p.getByRole('button',{name:'Delete',exact:true}).click();assert.equal((await saved(c)).loans.length,0);
  },{},[{...event('p','property_buy',{loanDraft:loan('future',{bank:'Future Bank'})}),status:'confirmed',appliedSnapshot:{addedLoanId:'lifecycle_p',addedLoanIndex:1}}]);
  const cashUser=user({monthly_income:'50000',fixed_expenses:'30000',cash_accounts:[{name:'Salary Checking',kind:'checking',balance:'20000',apy:'0'},{name:'Locked FD',kind:'fd',balance:'100000',apy:'.07'}],savings_balance:'120000'});
  const cashStorage={finoptima_cash_events:{startedAt:'2026-08-01',confirmations:[]}};
  await run('R6: recap credits checking and reduces debt for extra payment',cashUser,async(p,c)=>{
    await p.goto(base+'/debts');await p.getByRole('button',{name:/MONTHLY RECAP/}).click();await p.getByLabel(/^EMIs paid/).fill('29000');await p.getByRole('button',{name:'Save override'}).click();
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('finoptima_cash_events')).confirmations.length===1);
    const s=await saved(c);assert.equal(s.cash_accounts[0].balance,'11000.00');assert.equal(s.cash_accounts[1].balance,'100000');
    const entries=await p.evaluate(()=>JSON.parse(localStorage.getItem('finoptima_activity')));assert.equal(entries.length,1);assert.equal(entries[0].amount,'20000.00');
    await p.goto(base+'/');assert.match(await text(p),/80,000/);
  },cashStorage);
  await run('R6: opening partial month does not prompt full recap',cashUser,async(p)=>{await p.goto(base+'/debts');await p.getByRole('button',{name:'+ Add life event'}).waitFor();assert.equal(await p.getByRole('button',{name:/MONTHLY RECAP/}).count(),0);},{finoptima_cash_events:{startedAt:'2026-09-27',confirmations:[]}});
  await run('R7: no-cost offer uses entered EMI; sticker increase changes cost',user(),async(p)=>{
    await p.goto(base+'/tools/new-debt');await p.getByLabel('What kind of loan are you considering?').selectOption('credit_card');
    await p.getByLabel('Sticker / list price').fill('10000');await p.getByLabel('Cash price elsewhere').fill('10000');await p.getByLabel('Actual offer monthly EMI').fill('1666.67');
    await checkButton(p,'Check this loan');await p.getByText('Effective APR',{exact:true}).waitFor();assert.match(await text(p),/0\.0%/);assert.match(await text(p),/1,667/);
    await p.getByLabel('Sticker / list price').fill('12000');assert.equal(await p.getByText('Effective APR',{exact:true}).count(),0);await p.getByLabel('Actual offer monthly EMI').fill('2000');
    await checkButton(p,'Check this loan');await p.getByText('Effective APR',{exact:true}).waitFor();assert.match(await text(p),/2,000/);assert.doesNotMatch(await text(p),/Effective APR\s*0\.0%/);
  });
  await run('R7: savings fund the down payment and invalid terms hide verdict',user({savings_balance:'1000000',loans:[loan('a',{scheduled_emi:'10000'})]}),async(p)=>{
    await p.goto(base+'/tools/new-debt?mode=purchase');await p.getByLabel('Price (INR)',{exact:true}).fill('2000000');assert.match(await text(p),/Feasible on current surplus/);assert.match(await text(p),/0\/mo to save/);
    await p.getByLabel('Down payment (%)',{exact:true}).fill('150');assert.match(await text(p),/down payment from 0/);assert.doesNotMatch(await text(p),/Feasible on current surplus/);
    await p.getByLabel('Down payment (%)',{exact:true}).fill('20');await p.getByLabel(/Loan tenure/).fill('0');assert.match(await text(p),/tenure up to 40/);
  });
  await run('R7: fractional-year Monte Carlo, losses, purchasing power, invalid inputs',user(),async(p)=>{
    await p.goto(base+'/tools/invest-vs-prepay');await p.getByRole('button',{name:/Equity Mutual Fund/}).click();


    await p.getByLabel('Expected nominal return (%)').fill('12');await p.getByLabel('Annual volatility, 1σ (%)').fill('0');await p.getByLabel('Years held').fill('1.5');assert.match(await text(p),/10\.50%/);
    await p.getByLabel('Loan effective APR (%)').fill('10');await p.getByLabel('Inflation (%)').fill('40');assert.match(await text(p),/Only 0%.*preserve purchasing power/s);
    await p.getByLabel('Expected nominal return (%)').fill('-20');assert.match(await text(p),/-20\.00%/);assert.doesNotMatch(await text(p),/-17\.50%/);
    await p.getByLabel('Years held').fill('0');assert.match(await text(p),/Enter valid returns/);
  });
  await run('R8: New Debt stale verdict cannot save changed principal',user({savings_balance:'0',loans:[loan('a',{scheduled_emi:'5000'})]}),async(p,c)=>{
    await p.goto(base+'/tools/new-debt');await p.getByLabel('Loan amount',{exact:true}).fill('100000');await checkButton(p,'Check this loan');await p.getByRole('button',{name:/Add this personal loan/}).waitFor();
    await p.getByLabel('Loan amount',{exact:true}).fill('1000000');assert.equal(await p.getByRole('button',{name:/Add this personal loan/}).count(),0);assert.equal((await saved(c)).loans.length,1);
    await checkButton(p,'Check this loan');await p.getByRole('button',{name:/Add this personal loan/}).click();await p.waitForFunction(()=>document.cookie.includes('z1.'));const s=await saved(c);assert.equal(s.loans.length,2);assert.ok(Number(s.loans[1].scheduled_emi)>20000);
  });
  async function spare(p){await p.goto(base+'/tools/windfall');await p.getByLabel('SPARE CASH',{exact:true}).fill('10000');await checkButton(p,/WHERE SHOULD IT GO/);await p.getByRole('button',{name:/I DID THIS/}).waitFor();}
  await run('R8: spare cash debits selected savings, credits EF once, and matches Home',user({efund_balance:'0',efund_target:'10000',cash_accounts:[{name:'Savings',kind:'savings',balance:'50000',apy:'.025'}]}),async(p,c)=>{
    await p.goto(base+'/tools/windfall');await p.getByLabel('Funding source',{exact:true}).selectOption('account');await p.getByLabel('Pay from',{exact:true}).selectOption('Savings');await p.getByLabel('SPARE CASH',{exact:true}).fill('10000');await checkButton(p,/WHERE SHOULD IT GO/);
    await p.getByRole('button',{name:/I DID THIS/}).click();const logged=p.getByRole('button',{name:/LOGGED/});await logged.waitFor();assert.equal(await logged.isDisabled(),true);
    const s=await saved(c);assert.equal(s.cash_accounts[0].balance,'40000.00');assert.equal(s.savings_balance,'40000.00');assert.equal(s.efund_balance,'3000.00');
    const entries=await p.evaluate(()=>JSON.parse(localStorage.getItem('finoptima_activity')));assert.equal(entries.length,1);assert.equal(entries[0].amount,'7000.00');
    await p.goto(base+'/');assert.match(await text(p),/93,000/);await p.goto(base+'/debts');assert.match(await text(p),/93,000/);
  });
  await run('R8: investment logging creates a portfolio holding',user({loans:[loan('a',{nominal_rate:'.05'})],investment_options:[{name:'Liquid Fund',expected_return:'.3',liquidity_class:'liquid',is_in_pool:true}]}),async(p,c)=>{
    await spare(p);assert.match(await text(p),/INVEST IN LIQUID FUND/);await p.getByRole('button',{name:/I DID THIS/}).click();await p.getByRole('button',{name:/LOGGED/}).waitFor();const s=await saved(c);assert.equal(s.assets.at(-1).current_market_value,'10000.00');assert.equal(s.assets.at(-1).label,'Liquid Fund');
  });
  await run('Adjacent: insufficient source balance produces no partial financial writes',user({savings_balance:'1000',cash_accounts:[{name:'Savings',kind:'savings',balance:'1000',apy:'0'}]}),async(p,c)=>{
    await p.goto(base+'/tools/windfall');await p.getByLabel('Funding source',{exact:true}).selectOption('account');await p.getByLabel('Pay from',{exact:true}).selectOption('Savings');await p.getByLabel('SPARE CASH',{exact:true}).fill('10000');await checkButton(p,/WHERE SHOULD IT GO/);await p.getByRole('button',{name:/I DID THIS/}).click();assert.match(await text(p),/cannot cover/);assert.equal((await saved(c)).cash_accounts[0].balance,'1000');assert.equal(await p.evaluate(()=>localStorage.getItem('finoptima_activity')),null);
  });
  await run('R8: partial liquidation cannot sell more than owned',user(),async(p)=>{
    await p.goto(base+'/tools/liquidate');
    await p.getByLabel('Purchase price',{exact:true}).fill('100000');await p.getByLabel('Purchase year or date').fill('2018');
    await p.getByLabel('Sale mode').selectOption('partial');await p.getByLabel('Total owned (sq.ft)').fill('100');await p.getByLabel('Quantity to sell (sq.ft)').fill('200');await p.getByLabel('Price per sq.ft').fill('1000');await checkButton(p,'Should I sell?');assert.match(await text(p),/no greater than what you own/);
  });

  await run('Adjacent: a no-cost card offer saves as its own installment and remains projectable',user({savings_balance:'0'}),async(p,c)=>{
    await p.goto(base+'/tools/new-debt');await p.getByLabel('What kind of loan are you considering?').selectOption('credit_card');
    await p.getByLabel('Sticker / list price').fill('12000');await p.getByLabel('Cash price elsewhere').fill('12000');await p.getByLabel('Actual offer monthly EMI').fill('2000');
    await checkButton(p,'Check this loan');await p.getByRole('button',{name:'Add this EMI offer to my profile'}).click();await p.getByRole('status').filter({hasText:'Loan added'}).waitFor();
    const u=await saved(c);assert.equal(u.loans.at(-1).loan_type,'bnpl');assert.equal(u.loans.at(-1).scheduled_emi,'2000.00');assert.ok(Number(u.loans.at(-1).nominal_rate)<.000001);
    await p.goto(base+'/plan');assert.doesNotMatch(await text(p),/NEEDS DETAILS|ENGINE UNAVAILABLE/);assert.match(await text(p),/Quoted EMI offer/i);
  });
  await run('Adjacent: card repayments cannot be below the financed sticker amount',user(),async(p)=>{
    await p.goto(base+'/tools/new-debt');await p.getByLabel('What kind of loan are you considering?').selectOption('credit_card');
    await p.getByLabel('Sticker / list price').fill('12000');await p.getByLabel('Cash price elsewhere').fill('10000');await p.getByLabel('Actual offer monthly EMI').fill('1666.67');await checkButton(p,'Check this loan');
    assert.match(await text(p),/do not cover the financed sticker price/);assert.equal(await p.getByText('Effective APR',{exact:true}).count(),0);
  });
  await run('Adjacent: foreign cash payoff converts both recommendation and Activity units',user({loans:[loan('foreign',{currency:'USD',outstanding:'1000',scheduled_emi:'100'})],fx_to_user_currency:{USD:'80'}}),async(p,c)=>{
    await spare(p);await p.getByRole('button',{name:/I DID THIS/}).click();await p.getByRole('button',{name:/LOGGED/}).waitFor();
    const entries=await p.evaluate(()=>JSON.parse(localStorage.getItem('finoptima_activity')));assert.equal(entries[0].amount,'125.00');
    await p.goto(base+'/');assert.match(await text(p),/70,000/);
  });
  await run('Adjacent: bonus leftover preserves legacy savings without existing accounts',user({loans:[]}),async(p,c)=>{
    await spare(p);await p.getByRole('button',{name:/I DID THIS/}).click();await p.getByRole('button',{name:/LOGGED/}).waitFor();const u=await saved(c);assert.equal(u.savings_balance,'60000.00');assert.equal(u.cash_accounts[0].balance,'60000.00');
  });
  await run('Adjacent: removed rate target reports an error without changing its neighbor',user({loans:[loan('b')]}),async(p,c)=>{
    await p.goto(base+'/debts');await p.getByRole('button',{name:'Confirm',exact:true}).click();assert.match(await text(p),/no longer exists/);assert.equal((await saved(c)).loans[0].nominal_rate,'.18');
  },{},[event('lost','floating_rate_reset',{loanId:'a',loanIndex:0,newRate:'.08'})]);
  await run('Adjacent: empty and pasted invalid partial sale values never crash the form',user(),async(p)=>{
    await p.goto(base+'/tools/liquidate');await p.getByLabel('Sale mode').selectOption('partial');await p.getByLabel('Total owned (sq.ft)').fill('');await p.getByLabel('Quantity to sell (sq.ft)').fill('0');
    await p.getByLabel('Price per sq.ft').fill('0');await checkButton(p,'Should I sell?');assert.match(await text(p),/Enter what you paid|Enter how much you own|positive quantity/);
  });
  await run('Adjacent: future unaffordable property surfaces its month and suppresses payoff promise',user({loans:[],monthly_income:'50000',fixed_expenses:'40000'}),async(p)=>{
    await p.goto(base+'/plan');assert.match(await text(p),/FUTURE FUNDING GAP/);assert.match(await text(p),/NO DATE YET/);assert.doesNotMatch(await text(p),/Debt-freeevery loan/);
    const clearance=p.getByRole('row').filter({hasText:'FUTURE BANK CLEARED'});if(await clearance.count())assert.ok(Number(await clearance.first().getByRole('cell').first().innerText())>=3);
    await p.goto(base+'/');assert.match(await text(p),/NO DATE YET/);assert.match(await text(p),/FUTURE PAYMENTS NEED FUNDING/);
  },{},[event('expensive','property_buy',{effectiveDate:'2026-11-01',loanDraft:loan('future',{bank:'Future Bank',loan_type:'home_loan',outstanding:'5000000',nominal_rate:'.09',scheduled_emi:'63338',tenure_months_remaining:120})})]);
  await run('Adjacent: changed balances invalidate a spare-cash action before financial writes',user(),async(p,c)=>{
    await spare(p);const changed=await saved(c);changed.monthly_income='80000';await c.addCookies([{name:'finoptima_user',value:encodeURIComponent(JSON.stringify(changed)),url:base+'/'}]);
    await p.getByRole('button',{name:/I DID THIS/}).click();assert.match(await text(p),/changed. Run the cash check again/);assert.equal(await p.evaluate(()=>localStorage.getItem('finoptima_activity')),null);
  });
  await run('Adjacent: mobile spare cash walkthrough has no page overflow',user(),async(p)=>{
    await p.setViewportSize({width:390,height:844});await spare(p);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');
    if(process.env.AUDIT_SCREENSHOT) await p.screenshot({path:process.env.AUDIT_SCREENSHOT,fullPage:true});
  });

  await run('Adjacent: purchase default excludes locked FD balances',cashUser,async(p)=>{
    await p.goto(base+'/tools/new-debt?mode=purchase');assert.equal(await p.getByLabel('Savings available for this purchase').inputValue(),'20000.00');
  });
  await run('Adjacent: new loan action invalidates when current debt changes even if EMI room is identical',user({savings_balance:'0'}),async(p,c)=>{
    await p.goto(base+'/tools/new-debt');await p.getByLabel('Loan amount',{exact:true}).fill('100000');await checkButton(p,'Check this loan');await p.getByRole('button',{name:/Add this personal loan/}).waitFor();
    const u=await saved(c);u.loans[0].outstanding='50000';await c.addCookies([{name:'finoptima_user',value:encodeURIComponent(JSON.stringify(u)),url:base+'/'}]);
    await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.getByRole('button',{name:/Add this personal loan/}).waitFor({state:'hidden'});assert.equal((await saved(c)).loans.length,1);
  });

  await run('Adjacent: debt-free users can still manage cash and plan a life event',user({loans:[],cash_accounts:[{name:'Salary',kind:'checking',balance:'20000',apy:'0'}]}),async(p)=>{
    await p.goto(base+'/debts');await p.getByRole('button',{name:'+ Add life event'}).waitFor();await p.getByRole('button',{name:/MONTHLY RECAP/}).waitFor();
  },cashStorage);

  await run('Adjacent: extreme EMI quote cannot be saved with a clipped rate',user({savings_balance:'0'}),async(p,c)=>{
    await p.goto(base+'/tools/new-debt');await p.getByLabel('What kind of loan are you considering?').selectOption('credit_card');
    await p.getByLabel('Sticker / list price').fill('10000');await p.getByLabel('Cash price elsewhere').fill('10000');await p.getByLabel('Actual offer monthly EMI').fill('5000');
    await checkButton(p,'Check this loan');await p.getByText('Effective APR',{exact:true}).waitFor();
    const add=p.getByRole('button',{name:'Add this EMI offer to my profile'});if(await add.count()){await add.click();assert.match(await text(p),/above the 100% annual limit/);}assert.equal((await saved(c)).loans.length,1);
  });
  await browser.close();console.log(`${results.filter(r=>r.status==='passed').length}/${results.length} browser walkthroughs passed`);if(results.some(r=>r.status==='failed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;browser?.close();});
