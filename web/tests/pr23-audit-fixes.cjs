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
const loan = (id = 'a', extra = {}) => ({ id, bank: id, loan_type: 'home_loan', outstanding: '500000', nominal_rate: '.09', scheduled_emi: '6000', rate_type: 'floating', ...extra });
const user = (extra = {}) => ({ country: 'US', income_type: 'salaried', monthly_income: '10000', annual_income: '120000', annual_gross_salary: '120000', fixed_expenses: '3000', savings_balance: '50000', primary_bank: 'a', loans: [loan()], ...extra });

function stores(u, blocked=()=>false) {
  const jar=new Map([['rightdue_user',encodeURIComponent(JSON.stringify(u))],['rightdue_marginal','.24'],['rightdue_score','780']]);
  const data=new Map();
  global.document={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ');},set cookie(value){
    const [pair,...attrs]=value.split(';');const split=pair.indexOf('=');const key=pair.slice(0,split);
    if(blocked(key))return;
    if(attrs.some(a=>a.trim()==='max-age=0'))jar.delete(key);else jar.set(key,pair.slice(split+1));
  }};
  global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  global.window={localStorage:global.localStorage,dispatchEvent(){},addEventListener(){},removeEventListener(){}};
  process.env.NEXT_PUBLIC_DISABLE_AUTH='true';
  return {jar,data};
}
function cleanup(){delete global.document;delete global.localStorage;delete global.window;}

const emiLoan = (extra={}) => loan('a', {outstanding:'100000', nominal_rate:'.12', scheduled_emi:'9000', balance_as_of:'2026-06-01', currency:'INR', ...extra});
const payment = (extra={}) => ({id:'e', loanId:'a', loanIndex:0, kind:'paid_extra', amount:'10000', scheduledEmi:'0', date:'2026-10-02', loggedAt:'2026-10-02T10:00:00Z', ...extra});
const {paymentState, regularPaid}=lib('payment-state.ts');
test('a payment short by less than fifty cents remains partially paid',()=>{
  assert.equal(paymentState([payment({kind:'paid_partial',amount:'1499.51'})],1500,1500),'part');
  assert.equal(paymentState([payment({kind:'paid_full',amount:'1500'})],1500,1500.49),'emi_paid');
});

test('Home cash flow defers a new loan EMI until its first calendar payment month',()=>{
  const {deriveMetrics,cashFlowForMonth}=lib('derived.ts');
  const profile={user:user({monthly_income:'100000',fixed_expenses:'40000',variable_expenses:'0',
    loans:[emiLoan({first_emi_month:'2026-11'})]}),marginalRate:'0',creditScore:null,isLive:true};
  const metrics=deriveMetrics(profile);
  const october=cashFlowForMonth(profile,metrics,'2026-10');
  assert.equal(october.emiBurden.toFixed(2),'0.00');assert.equal(october.surplus.toFixed(2),'60000.00');
  const november=cashFlowForMonth(profile,metrics,'2026-11');
  assert.equal(november.emiBurden.toFixed(2),'9000.00');assert.equal(november.surplus.toFixed(2),'51000.00');
  assert.equal(metrics.emiBurden.toFixed(2),'9000.00','Recurring commitments remain visible to other planning tools');
});
test('a principal-only bonus never pays the regular EMI, including when it exceeds the EMI',()=>{
  assert.equal(paymentState([payment()],9000,9000),'due');
  assert.equal(regularPaid([payment()]).toNumber(),0);
  assert.equal(paymentState([payment(),payment({id:'regular',kind:'paid_partial',amount:'4000',scheduledEmi:'9000'})],9000,9000),'part');
  assert.equal(paymentState([payment(),payment({id:'missed',kind:'missed',amount:'0',scheduledEmi:'9000'})],9000,9000),'missed');
  assert.equal(paymentState([payment({amount:'14000',scheduledEmi:'9000'})],9000,15000),'emi_paid');
  assert.equal(paymentState([payment({kind:'paid_full',amount:'9000',scheduledEmi:'9000'})],9000,9000),'paid');
});

test('Home does not deduct a phantom EMI after a principal-only prepayment',()=>{
  const {owedNow}=lib('owed-now.ts');
  const row=owedNow([emiLoan({outstanding:'90000'})],[payment()],'2026-10')[0];
  assert.equal(row.status,'due');assert.equal(row.owed.toNumber(),90000);
});

test('Home does not subtract an old planned extra included in a fresh statement balance',()=>{
  const {owedNow}=lib('owed-now.ts');
  const l=emiLoan({outstanding:'100000',balance_as_of:'2026-10-03',balance_recorded_at:'2026-10-03T10:00:00Z'});
  const row=owedNow([l],[payment({scheduledEmi:'9000',amount:'19000',plannedExtra:'10000'})],'2026-10')[0];
  assert.equal(row.status,'paid');assert.equal(row.owed.toNumber(),92000);
  for(const extra of [{rate_basis:'flat'},{pre_emi_months_remaining:2}]) {
    assert.equal(owedNow([emiLoan(extra)],[payment({kind:'paid_full',amount:'9000'})],'2026-10')[0].owed.toNumber(),100000);
  }
});

test('Activity has no automatic EMI before its calendar start, including when the engine is unavailable',()=>{
  const {buildHistory}=require(path.join(root,'components/activity/history.ts'));
  const u=user({country:'IN',loans:[emiLoan({first_emi_month:'2026-11'})]});
  const args={user:u,entries:[],spend:[],life:[],today:'2026-10-03'};
  assert.equal(buildHistory(args).flatMap(m=>m.rows).filter(r=>r.pending).length,0);
  assert.equal(buildHistory({...args,planPay:{0:{amount:0,minimum:0,extra:0}}}).flatMap(m=>m.rows).filter(r=>r.pending).length,0);
  const due=buildHistory({...args,today:'2026-11-03'}).flatMap(m=>m.rows).find(r=>r.pending);
  assert.equal(due.ref.amount,'9000.00');
});

test('preview and saved projections derive the same relative first EMI and clear elapsed deferral',()=>{
  const {prepareLoanPaymentTiming}=lib('roll-forward.ts');
  for(const [month,expected] of [['2026-10',2],['2026-11',1],['2026-12',1]])
    assert.equal(prepareLoanPaymentTiming([emiLoan({first_emi_month:'2026-11',first_payment_month:2})],month)[0].first_payment_month,expected);
});

test('confirming a newly borrowed life-event loan preserves its first EMI deferral',()=>{
  const {applyConfirmedEvent}=lib('lifecycle-events.ts');
  const event={id:'new',kind:'property_buy',effectiveDate:'2026-10-03',status:'confirmed',loanDraft:emiLoan()};
  const added=applyConfirmedEvent(user(),event).user.loans[1];
  assert.equal(added.first_emi_month,'2026-11');assert.equal(added.balance_after_emi,false);
  assert.equal(applyConfirmedEvent(user(),{...event,loanDraft:emiLoan({first_emi_month:'2026-12'})}).user.loans[1].first_emi_month,'2026-12');
});

test('bonus-only and closure-only months cannot manufacture a zero repayment average',()=>{
  const {paceMonths,paceSummary}=lib('pace.ts');const loans=[emiLoan()];
  for(const kind of ['paid_extra','closed']) {
    const entries=['2026-08','2026-09'].map((m,i)=>payment({id:String(i),date:m+'-03',kind,source:'bonus'}));
    const result=paceSummary(paceMonths(entries,loans,'2026-10'),loans,'IN',{});
    assert.equal(result.average,null);assert.equal(result.counted,0);
  }
});

test('regular extras from monthly surplus count as a sustainable repayment pace',()=>{
  const {paceMonths,paceSummary}=lib('pace.ts');const loans=[emiLoan()];
  const entries=['2026-08','2026-09'].map((m,i)=>payment({id:String(i),date:m+'-03',amount:'15000',scheduledEmi:'9000',source:'surplus'}));
  const result=paceSummary(paceMonths(entries,loans,'2026-10'),loans,'IN',{});
  assert.equal(result.average,15000);assert.equal(result.counted,2);
  assert.equal(result.months.reduce((s,m)=>s+m.oneOff,0),0);
});

test('paid-at-entry records an EMI alongside an existing bonus and remains idempotent',async()=>{
  const {saveProfileWithPaidEmis}=lib('paid-at-entry.ts');const {loadProfileClient}=lib('user-store.ts');
  const u=user({country:'IN',loans:[emiLoan({balance_as_of:'2026-10-03',balance_after_emi:true})]});
  const s=stores(u);s.data.set('rightdue_activity',JSON.stringify([payment()]));
  try {
    const profile=loadProfileClient();assert.equal(saveProfileWithPaidEmis(profile,'2026-10-03'),true);
    assert.equal(saveProfileWithPaidEmis(profile,'2026-10-03'),true);
    const entries=JSON.parse(s.data.get('rightdue_activity'));
    assert.equal(entries.length,2);assert.equal(regularPaid(entries).toNumber(),9000);
    assert.equal(paymentState(entries,9000,9000),'paid');
    await new Promise(r=>setImmediate(r));
  } finally {cleanup();}
});

test('paid-at-entry records only the missing regular payment after a partial EMI',async()=>{
  const {saveProfileWithPaidEmis}=lib('paid-at-entry.ts');const {loadProfileClient}=lib('user-store.ts');
  const u=user({country:'IN',loans:[emiLoan({balance_as_of:'2026-10-03',balance_after_emi:true})]});const s=stores(u);
  s.data.set('rightdue_activity',JSON.stringify([payment({kind:'paid_partial',amount:'4000',scheduledEmi:'9000'})]));
  try {
    assert.equal(saveProfileWithPaidEmis(loadProfileClient(),'2026-10-03'),true);
    const entries=JSON.parse(s.data.get('rightdue_activity'));assert.equal(entries.length,2);assert.equal(regularPaid(entries).toNumber(),9000);
    await new Promise(r=>setImmediate(r));
  } finally {cleanup();}
});

test('blocked activity storage, profile cookies or empty-delta projection cookies roll back the profile and ledger',async()=>{
  const {saveProfileWithPaidEmis}=lib('paid-at-entry.ts');const {loadProfileClient}=lib('user-store.ts');
  const u=user({country:'IN',loans:[emiLoan()]});
  for(const target of ['storage','rightdue_user','rightdue_activity_deltas']) {
    const s=stores(u,k=>target===k);s.data.set('rightdue_activity','[]');
    if(target==='storage') {const set=localStorage.setItem;localStorage.setItem=(k,v)=>{if(k==='rightdue_activity'&&v!=='[]') throw Error('quota');return set(k,v);};}
    try {
      const profile=loadProfileClient();const next={...profile,user:{...u,monthly_income:'12000',loans:[emiLoan({balance_as_of:'2026-10-03',balance_after_emi:true})]}};
      assert.equal(saveProfileWithPaidEmis(next,'2026-10-03'),false,target);
      assert.equal(loadProfileClient().user.monthly_income,u.monthly_income,target);
      assert.equal(s.data.get('rightdue_activity'),'[]',target);assert.equal(s.jar.has('rightdue_activity_deltas'),false,target);
      await new Promise(r=>setImmediate(r));
    } finally {cleanup();}
  }
});

test('an empty-delta regular payment must still verify its activity cookie and roll back if blocked',()=>{
  const {commitActivity}=lib('commit-activity.ts');const {syncActivityCookieClient}=lib('activity-cookie.ts');const u=user({country:'IN',loans:[emiLoan()]});
  const s=stores(u,k=>k==='rightdue_activity_deltas');s.data.set('rightdue_activity','[]');
  try {
    const entries=[payment({kind:'paid_full',amount:'9000',scheduledEmi:'9000'})];
    assert.equal(syncActivityCookieClient(entries,u.loans,'IN'),false);
    assert.throws(()=>commitActivity(entries,u),/could not be saved/);assert.equal(s.data.get('rightdue_activity'),'[]');
  } finally {cleanup();}
});

test('defaults and benchmark decisions follow an INR or USD loan market across residence countries',()=>{
  const rt=lib('rate-type.ts');const rd=lib('rate-decision.ts');
  assert.equal(rt.likelyRateType('home_loan','US','INR'),'floating');
  assert.equal(rt.likelyRateType('home_loan','IN','USD'),'fixed');
  assert.equal(rd.followsCentralBank(emiLoan({loan_type:'credit_card'}),'US'),null);
  assert.equal(rd.followsCentralBank(emiLoan({loan_type:'credit_card',currency:'USD'}),'IN'),'card');
  assert.equal(rt.rateTypeChoice(emiLoan({rate_type:'floating'})),'floating');
  assert.equal(rt.patchLoanKeepingRateType(emiLoan({rate_type_assumed:true}),{currency:'USD'},'IN').rate_type,'fixed');
  assert.equal(rt.patchLoanKeepingRateType(emiLoan({rate_type_assumed:false}),{currency:'USD'},'IN').rate_type,'floating');
});

test('mixed-market advice renders separate RBI and Fed sections for the same user',()=>{
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const {RateDecisions}=require(path.join(root,'components/plan/RateDecisions.tsx'));
  const markup=renderToStaticMarkup(React.createElement(RateDecisions,{plan:{user:user({loans:[emiLoan(),emiLoan({id:'usd',currency:'USD',loan_type:'credit_card'})]})}}));
  assert.match(markup,/IF RBI MOVES RATES/);assert.match(markup,/IF THE FED MOVES RATES/);
  assert.match(markup,/VARIABLE APR/);
});

test('assumptions describe modeled rate resets, drift and phased pay rises instead of claiming none',()=>{
  const {planGivens}=lib('plan-givens.ts');const u=user({country:'IN',annual_hike_rate:'0',hike_schedule:[[1,3,'.10']],loans:[emiLoan({rate_drift_annualized:'.01'})]});
  const opts={today:'2026-10-03',inflation:{on:false,rate:0},hike:{on:true,rate:0,month:4},runArgs:{user:u,lifecycle_events:[{kind:'floating_rate_reset',effective_month:2,loan_index:0,new_rate:'.10'},{kind:'salary_reset',effective_month:3,new_monthly_take_home:'15000'}]}};
  const givens=Object.fromEntries(planGivens(u,opts).map(g=>[g.key,g]));
  assert.doesNotMatch(givens.rates.lines.join(' '),/Every loan keeps/);assert.match(givens.rates.lines.join(' '),/10.00% in plan month 2/);
  assert.match(givens.rates.lines.join(' '),/1.00 percentage points/);
  assert.doesNotMatch(givens.income.lines.join(' '),/no pay rise/);assert.match(givens.income.lines.join(' '),/10.0% a year/);
  assert.match(givens.income.lines.join(' '),/salary change in plan month 3/);assert.match(givens.events.lines.join(' '),/saved life events are included/);
});
