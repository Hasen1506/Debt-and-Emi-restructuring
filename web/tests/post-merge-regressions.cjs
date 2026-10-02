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
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loan = (id = 'a', extra = {}) => ({ id, bank: id, loan_type: 'home_loan', outstanding: '500000', nominal_rate: '.09', scheduled_emi: '6000', rate_type: 'floating', ...extra });
const user = (extra = {}) => ({ country: 'US', income_type: 'salaried', monthly_income: '10000', annual_income: '120000', annual_gross_salary: '120000', fixed_expenses: '3000', savings_balance: '50000', primary_bank: 'a', loans: [loan()], ...extra });

function stores(u) {
 const jar=new Map([['finoptima_user',encodeURIComponent(JSON.stringify(u))]]),data=new Map();
 global.document={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ');},set cookie(v){const [pair,...attrs]=v.split(';');const split=pair.indexOf('=');if(attrs.some(a=>a.trim()==='max-age=0'))jar.delete(pair.slice(0,split));else jar.set(pair.slice(0,split),pair.slice(split+1));}};
 global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 global.window={localStorage:global.localStorage,dispatchEvent(){},addEventListener(){},removeEventListener(){}};
 return {jar,data};
}
const clean=()=>{delete global.document;delete global.localStorage;delete global.window};
const entry=(extra={})=>({id:'e',loanId:'a',loanIndex:0,kind:'paid_extra',date:'2026-09-01',loggedAt:'2026-09-01T12:00:00Z',scheduledEmi:'0',amount:'1000',...extra});
const goal=(label='current')=>({id:'g',kind:'custom',label,amount:'10000',targetMonth:'2027-01',bufferPct:'0',deadlineKind:'soft',fundingSources:['surplus'],autoDefer:false,status:'active',createdAt:'2026-09-01T00:00:00Z'});
const decision=(id,extra={})=>({id,kind:'goal_edited',at:new Date().toISOString(),label:id,snapshot:{goal:goal('old')},result:{goalId:'g'},impactDeltaMonths:null,reverted:false,...extra});

test('new reported loan balance supersedes payments already in that statement',()=>{
 const {activityDeltas,applyActivityDeltas}=lib('activity-cookie.ts');
 const l=loan('a',{outstanding:'9000',balance_as_of:'2026-10-01'});
 assert.equal(applyActivityDeltas([l],activityDeltas([entry()],[l],'US'), '2026-10').loans[0].outstanding,'9000');
});
test('new card statement supersedes an older post-payment card balance',()=>{
 const {activityDeltas,applyActivityDeltas}=lib('activity-cookie.ts');
 const l=loan('a',{loan_type:'credit_card',outstanding:'9000',balance_as_of:'2026-10-01'});
 assert.equal(applyActivityDeltas([l],activityDeltas([entry({kind:'paid_full',newOutstanding:'5000'})],[l],'US'), '2026-10').loans[0].outstanding,'9000');
});
test('historical card minimum uses the recorded minimum, not the current balance',()=>{
 const {activityDeltas}=lib('activity-cookie.ts');
 const l=loan('a',{loan_type:'credit_card',bank:'Chase',outstanding:'1000',nominal_rate:'.24'});
 const delta=activityDeltas([entry({kind:'paid_partial',scheduledEmi:'100',amount:'80',penaltyOverride:'0'})],[l],'US');
 assert.equal(delta.length,1);assert.equal(delta[0].count,1);
});
test('planned extra deferral uses residence country at the month boundary',()=>{
 const {activityDeltas}=lib('activity-cookie.ts');
 const delta=activityDeltas([entry({date:'2026-09-30',amount:'1000',plannedExtra:'1000'})],[loan()],'US',new Date('2026-10-01T02:00:00Z'));
 assert.equal(delta[0].deferred?.month,'2026-09');
});
test('older goal undo rejects overwriting a newer edit',()=>{
 process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const {undoPlanDecision}=lib('decision-undo.ts');const {data}=stores(user());
 const older=decision('older'),newer=decision('newer',{snapshot:{goal:goal('middle')}});const decisions=[newer,older];
 data.set('finoptima_goals',JSON.stringify([goal('latest')]));data.set('finoptima_decisions',JSON.stringify(decisions));
 try {assert.throws(()=>undoPlanDecision(decisions,older),/newer|latest/i);assert.equal(JSON.parse(data.get('finoptima_goals'))[0].label,'latest');}finally{clean()}
});
test('failed undo history save restores the goal and projection cookie',()=>{
 process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const {undoPlanDecision}=lib('decision-undo.ts');const {writeGoalsClient}=lib('goals.ts');const {data,jar}=stores(user());
 const d=decision('edit');writeGoalsClient([goal('current')]);data.set('finoptima_decisions',JSON.stringify([d]));const cookie=jar.get('finoptima_goals_digest');const put=localStorage.setItem;
 localStorage.setItem=(k,v)=>{if(k==='finoptima_decisions')throw Error('quota');put(k,v)};
 try {assert.throws(()=>undoPlanDecision([d],d));assert.equal(JSON.parse(data.get('finoptima_goals'))[0].label,'current');assert.equal(jar.get('finoptima_goals_digest'),cookie);}finally{clean()}
});


test('same-day statement cutoff keeps later payments and preserves unchanged anchors',()=>{
 const {activityDeltas,applyActivityDeltas}=lib('activity-cookie.ts');const {stampBalanceDates}=lib('roll-forward.ts');
 const original=loan('a',{outstanding:'10000',balance_as_of:'2026-09-01'});
 const stamped=stampBalanceDates([{...original,outstanding:'9000'}],[original],'2026-10-02','2026-10-02T12:00:00Z')[0];
 const old=entry({date:'2026-10-02',loggedAt:'2026-10-02T10:00:00Z'}),later=entry({id:'later',date:'2026-10-02',loggedAt:'2026-10-02T14:00:00Z',amount:'500'});
 assert.equal(applyActivityDeltas([stamped],activityDeltas([old,later],[stamped],'US'),'2026-10').loans[0].outstanding,'8500.00');
 assert.equal(stampBalanceDates([{...stamped,bank:'Changed'}],[stamped],'2026-10-03')[0].balance_recorded_at,stamped.balance_recorded_at);
});
test('profile balance update refreshes activity projection and rolls back a blocked cookie',()=>{
 process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const {saveProfileClient,loadProfileClient}=lib('user-store.ts');const {syncActivityCookieClient,parseActivityDeltas,applyActivityDeltas}=lib('activity-cookie.ts');
 const u=user({loans:[loan('a',{outstanding:'10000',balance_as_of:'2026-08-01'})]});const {data,jar}=stores(u);const entries=[entry()];data.set('finoptima_activity',JSON.stringify(entries));syncActivityCookieClient(entries,u.loans,'US');
 const updated={...u,loans:[{...u.loans[0],outstanding:'9000',balance_as_of:'2026-10-01'}]};
 try {assert.equal(saveProfileClient({user:updated}),true);assert.equal(parseActivityDeltas(jar.get('finoptima_activity_deltas')).length,0);
  const nextEntries=[entry({date:'2026-10-02',amount:'200'})];data.set('finoptima_activity',JSON.stringify(nextEntries));syncActivityCookieClient(nextEntries,updated.loans,'US');const stale=jar.get('finoptima_activity_deltas');
  const changed={...updated,loans:[{...updated.loans[0],balance_as_of:'2026-10-03',outstanding:'8800'}]};
  assert.equal(applyActivityDeltas(changed.loans,parseActivityDeltas(stale),'2026-10').loans[0].outstanding,'8800');
  const descriptor=Object.getOwnPropertyDescriptor(document,'cookie');Object.defineProperty(document,'cookie',{...descriptor,set(v){if(!v.startsWith('finoptima_activity_deltas='))descriptor.set(v)}});
  assert.equal(saveProfileClient({user:changed}),false);assert.equal(loadProfileClient().user.loans[0].outstanding,'9000');assert.equal(jar.get('finoptima_activity_deltas'),stale);
 }finally{clean()}
});
test('undo reads current history, preserves unrelated decisions and blocks expired or stale goals',()=>{
 process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const {undoPlanDecision}=lib('decision-undo.ts');const {writeGoalsClient}=lib('goals.ts');const {data}=stores(user());
 const d=decision('edit');const unrelated=decision('unrelated',{kind:'hike_toggle',snapshot:{},result:{}});writeGoalsClient([goal('current')]);data.set('finoptima_decisions',JSON.stringify([unrelated,d]));
 try {const next=undoPlanDecision([d],d);assert.equal(next.length,2);assert.equal(next[0].id,'unrelated');assert.equal(next[1].reverted,true);
  const stale=decision('stale',{result:{goalId:'g',goal:goal('expected')}});data.set('finoptima_decisions',JSON.stringify([stale]));assert.throws(()=>undoPlanDecision([stale],stale),/elsewhere/i);
  const expired=decision('expired',{at:'2020-01-01T00:00:00Z'});data.set('finoptima_decisions',JSON.stringify([expired]));assert.throws(()=>undoPlanDecision([expired],expired),/no longer/i);
 }finally{clean()}
});


test('new-loan affordability uses aged balances when an old loan has cleared',()=>{
 process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const {addLoanToProfile}=lib('add-loan-to-profile.ts');const {localIsoDate,getCountryToday}=lib('today.ts');
 const today=getCountryToday('US');today.setMonth(today.getMonth()-4);
 const u=user({monthly_income:'10000',fixed_expenses:'7000',loans:[loan('a',{outstanding:'1000',scheduled_emi:'2500',nominal_rate:'0',balance_as_of:localIsoDate(today)})]});stores(u);
 try {assert.equal(addLoanToProfile({loan_type:'personal_loan',bank:'Chase',outstanding:'10000',scheduled_emi:'2000',nominal_rate:'0',tenure_months_remaining:5}),2);}finally{clean()}
});
test('statement re-anchoring conserves later principal across shuffled loan histories',()=>{
 const {activityDeltas,applyActivityDeltas}=lib('activity-cookie.ts');
 for(let seed=1;seed<=50;seed++) {
  const loans=[loan('a',{outstanding:'10000',balance_as_of:'2026-10-01'}),loan('b',{outstanding:'20000',balance_as_of:'2026-10-01'})];
  const entries=[entry({amount:String(seed*13)}),entry({id:'a-after',date:'2026-10-02',amount:String(seed*7)}),entry({id:'b-before',loanId:'b',loanIndex:1,amount:String(seed*17)}),entry({id:'b-after',loanId:'b',loanIndex:1,date:'2026-10-02',amount:String(seed*11)})];
  if(seed%2)loans.reverse();if(seed%3)entries.reverse();
  const result=applyActivityDeltas(loans,activityDeltas(entries,loans,'US'),'2026-10').loans;
  assert.equal(Number(result.find(l=>l.id==='a').outstanding),10000-seed*7);assert.equal(Number(result.find(l=>l.id==='b').outstanding),20000-seed*11);
 }
});


test('EF undo retains the original finite-range normalization for legacy snapshots',()=>{
 process.env.NEXT_PUBLIC_DISABLE_AUTH='true';const {undoPlanDecision}=lib('decision-undo.ts');const {data,jar}=stores(user());
 try {for(const efSplit of ['Infinity','-1','1.5','0.6']) {
  const d=decision('ef',{kind:'ef_split_change',snapshot:{efSplit},result:{}});data.set('finoptima_decisions',JSON.stringify([d]));undoPlanDecision([d],d);
  assert.equal(Number(jar.get('finoptima_ef_split')),efSplit==='0.6' ? .6 : .3);
 }}finally{clean()}
});
