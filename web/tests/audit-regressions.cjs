const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname,'../src');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request,parent,...rest) {
  if(request.startsWith('@/')) request=path.join(root,request.slice(2));
  return originalResolve.call(this,request,parent,...rest);
};
for(const ext of ['.ts','.tsx']) require.extensions[ext] = (module,file) => {
  const output = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,resolveJsonModule:true}}).outputText;
  module._compile(output,file);
};
const lib = name => require(path.join(root,'lib',name));
const {analyzePurchase} = lib('purchase-advisor.ts');
const {simulateMonteCarlo} = lib('monte-carlo.ts');
const {pendingMonths} = lib('cash-events.ts');
const {allocateCash,recapNet} = lib('cash-allocation.ts');
const lc = lib('lifecycle-events.ts');
const {applyActivityDeltas,activityDeltas} = lib('activity-cookie.ts');
const loan = (id='a') => ({id,loan_type:'personal_loan',bank:id,outstanding:'100000',nominal_rate:'0.12',scheduled_emi:'9000',tenure_months_remaining:12});
const user = () => ({country:'IN',income_type:'salaried',tax_regime:'new',annual_income:'600000',monthly_income:'50000',fixed_expenses:'10000',savings_balance:'50000',efund_balance:'0',efund_target:'10000',primary_bank:'HDFC Bank',loans:[loan('a'),loan('b')]});
const event = (id,kind,extra={}) => ({id,kind,status:'planned',effectiveDate:'2026-09-01',loggedAt:`2026-09-01T00:00:0${id==='a'?1:2}.000Z`,...extra});

test('purchase uses existing savings and covers current-month cash purchases',()=>{
  const input={type:'home',price:2000000,targetMonth:'2026-10',downPaymentPct:.2,loanTenureYears:20,loanRateAnnual:.085,country:'IN',taxRegime:'new',marginalRate:.3,monthlySurplus:50000,availableSavings:1000000,today:new Date(2026,8,27)};
  const a=analyzePurchase(input); assert.equal(a.feasibility,'feasible');assert.equal(a.downPayment.monthlySavingRequired,0);assert.equal(a.downPayment.savingsUsed,400000);
  const cash=analyzePurchase({...input,price:100000,targetMonth:'2026-09',downPaymentPct:1,monthlySurplus:0});assert.equal(cash.feasibility,'feasible');assert.equal(cash.loan.monthlyEmi,0);assert.equal(cash.loan.totalInterestOverTenure,0);
  const gap=analyzePurchase({...input,availableSavings:300000});assert.equal(gap.downPayment.remainingToSave,100000);assert.equal(gap.downPayment.monthlySavingRequired,100000);
  for(const patch of [{downPaymentPct:1.5},{loanTenureYears:0},{loanRateAnnual:-1},{price:Infinity},{targetMonth:'2026-13'},{availableSavings:-1}]) assert.throws(()=>analyzePurchase({...input,...patch}));
});
test('Monte Carlo zero volatility matches deterministic return for every fractional period and loss',()=>{
  for(const years of [.1,1,1.01,1.5,2.75,40,100]) for(const expectedReturn of [-.2,0,.12]) {
    const r=simulateMonteCarlo({years,expectedReturn,volatility:0,taxRate:.125,trials:100,inflation:.4});
    const expected=expectedReturn>0?expectedReturn*.875:expectedReturn;
    assert.ok(Math.abs(r.percentilesNominal[50]-expected)<1e-12);
    assert.ok(Math.abs(r.percentilesReal[50]-((1+expected)/1.4-1))<1e-12);
  }
  for(const patch of [{years:NaN},{years:Infinity},{years:0},{expectedReturn:-1},{volatility:-1},{trials:1.5},{taxRate:2}]) assert.throws(()=>simulateMonteCarlo({years:5,expectedReturn:.12,volatility:.18,taxRate:.125,...patch}));
});
test('recap starts with the first complete month and never prompts current or confirmed months',()=>{
  assert.deepEqual(pendingMonths({startedAt:'2026-08-27',confirmations:[]},new Date(2026,8,30)),[]);
  assert.deepEqual(pendingMonths({startedAt:'2026-08-01',confirmations:[]},new Date(2026,8,30)),['2026-08']);
  assert.deepEqual(pendingMonths({startedAt:'2026-08-27',confirmations:[]},new Date(2026,9,1)),['2026-09']);
});
test('cash allocation conserves tracked wealth for account, legacy savings, investment, EF and leftover',()=>{
  const u={...user(),loans:[loan()],cash_accounts:[{name:'Salary',kind:'checking',balance:'50000',apy:'0'},{name:'Locked',kind:'fd',balance:'100000',apy:'.07'}],savings_balance:'150000'};
  const input={total:'10000',ef:'3000',debt:'7000',investment:'0',source:'account',accountName:'Salary',date:'2026-09-30'};
  const a=allocateCash(u,input);assert.equal(a.cash_accounts[0].balance,'40000.00');assert.equal(a.cash_accounts[1].balance,'100000');assert.equal(a.efund_balance,'3000.00');assert.equal(a.savings_balance,'140000.00');assert.equal(u.cash_accounts[0].balance,'50000');
  assert.throws(()=>allocateCash(u,{...input,accountName:'Locked'}));assert.throws(()=>allocateCash(u,{...input,total:'90000',debt:'87000'}));
  const legacy=allocateCash(user(),input);assert.equal(legacy.savings_balance,'40000.00');
  const bonus=allocateCash(user(),{...input,source:'external',ef:'0',debt:'0'});assert.equal(bonus.cash_accounts[0].balance,'60000.00');assert.equal(bonus.savings_balance,'60000.00');
  const invest=allocateCash(u,{...input,ef:'0',debt:'0',investment:'10000',investmentName:'Liquid Fund'});assert.equal(invest.assets[0].label,'Liquid Fund');assert.equal(invest.assets[0].current_market_value,'10000.00');assert.equal(invest.savings_balance,'140000.00');
  const ext=allocateCash(u,{...input,source:'external',ef:'0',debt:'4000'});assert.equal(ext.cash_accounts[0].balance,'56000.00');assert.equal(ext.savings_balance,'156000.00');
});
test('recap cash math separates extra funding without inventing money or accepting invalid amounts',()=>{
  assert.equal(recapNet('50000','30000','29000','0','9000','surplus').toString(),'-9000');
  assert.equal(recapNet('50000','30000','29000','0','9000','one_off').toString(),'11000');
  assert.equal(recapNet('50000','30000','5000','0','9000','one_off').toString(),'15000');
  for(const v of ['NaN','Infinity','-1','bad']) assert.throws(()=>recapNet(v,'0','0','0','0','surplus'));
});
test('multiple lifecycle confirmations preserve both loans and undo resolves ids after deletion',()=>{
  const u=user();const a=event('a','floating_rate_reset',{loanIndex:0,loanId:'a',newRate:'.08'});const b=event('b','floating_rate_reset',{loanIndex:1,loanId:'b',newRate:'.09'});
  const first=lc.applyConfirmedEventWithRefresh(u,'.2',a);const second=lc.applyConfirmedEventWithRefresh(first.user,first.marginalRate,b);
  assert.deepEqual(second.user.loans.map(l=>l.nominal_rate),['.08','.09']);
  const undone=lc.undoConfirmedEvent({...second.user,loans:second.user.loans.slice(1)},{...b,appliedSnapshot:second.snapshot});assert.equal(undone.loans[0].nominal_rate,'0.12');
  const property=event('p','property_buy',{loanDraft:loan('future')});const added=lc.applyConfirmedEvent(u,property);
  const remaining={...added.user,loans:added.user.loans.slice(2)};assert.equal(lc.undoConfirmedEvent(remaining,{...property,appliedSnapshot:added.snapshot}).loans.length,0);
});
test('salary estimates take-home consistently and planned/overdue properties reach the engine',()=>{
  const u=user();const salary=event('a','salary_reset',{newAnnualGross:'1200000'});
  const result=lc.applyConfirmedEvent(u,salary);assert.equal(result.user.monthly_income,'100000.00');assert.equal(result.user.annual_gross_salary,'1200000');
  const props=event('p','property_buy',{loanDraft:loan('future')});const events=lc.plannedEventsForEngine([salary,props],'2026-09-30',u.loans,u);
  assert.equal(events.length,2);assert.equal(events[0].new_monthly_take_home,result.user.monthly_income);assert.equal(events[1].effective_month,1);assert.equal(events[1].loan_draft.id,'lifecycle_p');
});
test('undoing an older stacked reset preserves the latest effect and transfers its baseline',()=>{
  const u=user();const a=event('a','floating_rate_reset',{loanIndex:0,loanId:'a',newRate:'.08'});const b=event('b','floating_rate_reset',{loanIndex:0,loanId:'a',newRate:'.06'});
  const first=lc.applyConfirmedEventWithRefresh(u,'.2',a);const second=lc.applyConfirmedEventWithRefresh(first.user,first.marginalRate,b);
  const aa={...a,status:'confirmed',appliedSnapshot:{...first.snapshot,appliedAt:'2026-09-01T00:00:01Z'}};const bb={...b,status:'confirmed',appliedSnapshot:{...second.snapshot,appliedAt:'2026-09-01T00:00:02Z'}};
  const undo=lc.undoLifecycleInStack(second.user,aa,[aa,bb]);assert.equal(undo.user.loans[0].nominal_rate,'.06');assert.equal(lc.undoConfirmedEvent(undo.user,undo.events.find(e=>e.id==='b')).loans[0].nominal_rate,'0.12');
});
test('card balance anchor includes only subsequent extra payments and Home/Plan share the same projection',()=>{
  const loans=[{...loan(),loan_type:'credit_card'}];
  const entry=(id,date,amount,extra={})=>({id,date,loanIndex:0,loanId:'a',kind:'paid_extra',amount,scheduledEmi:'0',loggedAt:date+'T10:00:00Z',...extra});
  const entries=[entry('older','2026-09-01','10000'),entry('anchor','2026-09-02','10000',{newOutstanding:'80000'}),entry('later','2026-09-03','5000')];
  const result=applyActivityDeltas(loans,activityDeltas(entries,loans,'IN'));assert.equal(result.loans[0].outstanding,'75000.00');
  assert.equal(applyActivityDeltas([loan()], [{loanIndex:0,loanId:'a',overdue:'0',penalty:'0',principalReduction:'10000'}]).loans[0].outstanding,'90000.00');
});

function browserStores({user:u=user(),blocked=false}={}) {
  const jar=new Map([['finoptima_user',encodeURIComponent(JSON.stringify(u))],['finoptima_marginal','0']]);
  const data=new Map();
  global.document={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ');},set cookie(value){
    const [pair,...attributes]=value.split(';');const split=pair.indexOf('=');const name=pair.slice(0,split);
    if(typeof blocked==='function' ? blocked(name) : blocked)return;
    if(attributes.some(a=>a.trim()==='max-age=0'))jar.delete(name);else jar.set(name,pair.slice(split+1));
  }};
  global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  global.window={localStorage:global.localStorage,dispatchEvent:()=>{},addEventListener:()=>{},removeEventListener:()=>{}};
  return {jar,data,setBlocked:b=>blocked=b};
}
test('lifecycle confirmation is transactional, supports compressed history and undo after reordering',()=>{
  process.env.NEXT_PUBLIC_DISABLE_AUTH='true';
  const {commitLifecycle}=lib('commit-lifecycle.ts');const {loadProfileClient}=lib('user-store.ts');
  const store=browserStores();
  const events=[event('a','floating_rate_reset',{loanId:'a',loanIndex:0,newRate:'.08'}),event('b','floating_rate_reset',{loanId:'b',loanIndex:1,newRate:'.09'})];
  lc.writeLifecycleClient(events);assert.equal(lc.readLifecycleClient().length,2);assert.ok(decodeURIComponent(store.jar.get('finoptima_lifecycle')).startsWith('z1.'));
  commitLifecycle('a','confirmed');commitLifecycle('b','confirmed');assert.deepEqual(loadProfileClient().user.loans.map(l=>l.nominal_rate),['.08','.09']);
  commitLifecycle('a','delete');assert.deepEqual(loadProfileClient().user.loans.map(l=>l.nominal_rate),['0.12','.09']);
  const before=store.jar.get('finoptima_lifecycle');
  assert.throws(()=>lc.writeLifecycleClient([{...lc.readLifecycleClient()[0],note:require('node:crypto').randomBytes(10000).toString('base64')}]),/exceed browser storage/);assert.equal(store.jar.get('finoptima_lifecycle'),before);
  store.setBlocked(name=>name.startsWith('finoptima_user'));assert.throws(()=>commitLifecycle('b','cancelled'),/profile could not be saved/);assert.equal(lc.readLifecycleClient()[0].status,'confirmed');assert.equal(loadProfileClient().user.loans[1].nominal_rate,'.09');
  delete global.document;delete global.window;delete global.localStorage;
});
test('cash transaction rolls back the activity and recap if profile cookies are blocked',()=>{
  process.env.NEXT_PUBLIC_DISABLE_AUTH='true';
  const {commitCashChange}=lib('commit-cash-change.ts');const {loadProfileClient}=lib('user-store.ts');
  const store=browserStores({blocked:true});store.data.set('finoptima_activity','[]');
  const profile=loadProfileClient();assert.throws(()=>commitCashChange(profile,{...profile.user,savings_balance:'1'},[{id:'x'}],{confirmations:[{monthKey:'2026-08'}]}),/did not save/);
  assert.equal(store.data.get('finoptima_activity'),'[]');assert.equal(store.data.has('finoptima_cash_events'),false);assert.equal(loadProfileClient().user.savings_balance,'50000');
  delete global.document;delete global.window;delete global.localStorage;
});
test('clearing a stored credit score also clears the local cookie',()=>{
  process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const store=browserStores();store.jar.set('finoptima_score','780');
  const {saveProfileClient,loadProfileClient}=lib('user-store.ts');assert.equal(saveProfileClient({...loadProfileClient(),creditScore:null}),true);assert.equal(loadProfileClient().creditScore,null);
  delete global.document;delete global.window;delete global.localStorage;
});
test('parallel slice saves serialize atomic patches and a failed save never replaces unrelated state',async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  process.env.NEXT_PUBLIC_DISABLE_AUTH='false';
  const storage = new Map([['finoptima_account_id','queue-test']]);
  global.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const {api}=lib('api.ts');const patch=api.patchUserState;let state={untouched:'keep'};const writes=[];let active=0,maxActive=0;
  api.patchUserState=async value=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));state={...state,...value};writes.push(value);active--;return {data:state};};
  const {syncSliceToServer}=lib('server-sync.ts');const profile={user:{monthly_income:'100000'}};
  await Promise.all([syncSliceToServer('profile',profile),syncSliceToServer('activity',[{amount:'7000'}]),syncSliceToServer('cash_events',{confirmations:[]})]);
  assert.equal(maxActive,1);assert.equal(state.untouched,'keep');assert.equal(state.profile.user.monthly_income,'100000');assert.equal(state.activity[0].amount,'7000');assert.deepEqual(state.cash_events,{confirmations:[]});
  const successfulWrites=writes.length;api.patchUserState=async()=>{throw new Error('network unavailable');};await syncSliceToServer('profile',{user:{monthly_income:'1'}});assert.equal(writes.length,successfulWrites);assert.equal(state.profile.user.monthly_income,'100000');
  api.patchUserState=patch;delete process.env.NEXT_PUBLIC_DISABLE_AUTH;delete global.localStorage;
});

test('legacy property undo finds the unique matching loan after balances and positions change',()=>{
  const draft={...loan('legacy'),bank:'Property lender',loan_type:'home_loan'};
  const e=event('legacy','property_buy',{loanDraft:draft,status:'confirmed',appliedSnapshot:{addedLoanIndex:1}});
  const u={...user(),loans:[{...draft,outstanding:'90000',nominal_rate:'.09'}]};
  assert.equal(lc.undoConfirmedEvent(u,e).loans.length,0);
  assert.throws(()=>lc.undoConfirmedEvent({...u,loans:[u.loans[0],{...u.loans[0],id:'other'}]},e),/uniquely/);
});
