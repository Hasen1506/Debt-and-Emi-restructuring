// Local auth-bypassed browser: simulate an account arriving after Setup mounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://127.0.0.1:3002';
const user={country:'IN',income_type:'salaried',monthly_income:'80000',annual_income:'960000',fixed_expenses:'20000',variable_expenses:'10000',loans:[{id:'a',bank:'HDFC Bank',loan_type:'personal_loan',outstanding:'100000',nominal_rate:'.12',rate_type:'fixed',scheduled_emi:'9000',tenure_months_remaining:24}],investment_options:[]};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});const results=[];
 for(const kind of ['untouched','typed draft','country draft']){
  const c=await browser.newContext();await c.route('https://**/*',r=>r.abort());const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto(base+'/onboarding',{waitUntil:'domcontentloaded',timeout:60000});const income=p.getByLabel('Take-home pay a month',{exact:true});await income.waitFor();await p.waitForFunction(()=>{const e=document.querySelector('main input');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'))});
   if(kind==='typed draft')await income.fill('12345');
   if(kind==='country draft')await p.getByRole('button',{name:'USA · $',exact:true}).click();
   await p.evaluate(user=>{document.cookie='finoptima_user='+encodeURIComponent(JSON.stringify(user))+'; path=/';window.dispatchEvent(new Event('finoptima:hydrated'));},user);
   if(kind==='untouched'){
    await p.getByRole('heading',{name:'Update your numbers',exact:true}).waitFor();assert.equal((await income.inputValue()).replace(/,/g,''),'80000');assert.equal((await p.getByLabel('Spending a month, without EMIs',{exact:true}).inputValue()).replace(/,/g,''),'30000');
   }else if(kind==='typed draft'){assert.equal((await income.inputValue()).replace(/,/g,''),'12345');assert.equal(await p.getByRole('heading',{name:'Update your numbers',exact:true}).count(),0);}
   else{assert.equal(await p.getByRole('button',{name:'+ I also have loans in India',exact:true}).count(),1);}
   assert.deepEqual(errors,[]);results.push({name:kind,passed:true});
  }catch(e){results.push({name:kind,passed:false,error:e.message,pageErrors:errors});}finally{await c.close();}
 }
 await browser.close();console.log(JSON.stringify(results,null,2));const output=process.env.AUDIT_OUTPUT||path.resolve('render-account-results.json');fs.writeFileSync(output,JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
