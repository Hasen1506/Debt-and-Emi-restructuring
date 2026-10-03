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
  const jar=new Map([['finoptima_user',encodeURIComponent(JSON.stringify(u))],['finoptima_marginal','.24'],['finoptima_score','780']]);
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

test('saving a spending cut raises the debt budget, preserves cents and can undo both',async()=>{
  const {commitSpendingCut,undoSpendingCut}=lib('commit-spending-cut.ts');
  const {loadProfileClient}=lib('user-store.ts');const {readDebtBudgetClient}=lib('debt-budget.ts');
  const u=user({fixed_expenses:'60000'});const s=stores(u);s.jar.set('finoptima_debt_budget','50000.25');
  try{
    const entries=commitSpendingCut(u,10000.25,1,'50000.25');
    assert.equal(loadProfileClient().user.fixed_expenses,'49999.75');
    assert.equal(readDebtBudgetClient(),'60000.5');
    assert.equal(loadProfileClient().creditScore,780);
    assert.equal(undoSpendingCut(entries[0].id).length,0);
    assert.equal(loadProfileClient().user.fixed_expenses,'60000');
    assert.equal(readDebtBudgetClient(),'50000.25');
    assert.deepEqual(JSON.parse(s.data.get('finoptima_commitments')),[]);
    await new Promise(r=>setImmediate(r));
  }finally{cleanup();}
});

test('all spare cash stays uncapped and stale debt budgets cannot save an outdated preview',async()=>{
  const {commitSpendingCut}=lib('commit-spending-cut.ts');const {readDebtBudgetClient}=lib('debt-budget.ts');
  const u=user({fixed_expenses:'60000'});let s=stores(u);
  try{
    commitSpendingCut(u,10000,1,'');assert.equal(readDebtBudgetClient(),'');
    s=stores(u);s.jar.set('finoptima_debt_budget','45000');
    assert.throws(()=>commitSpendingCut(u,10000,1,'50000'),/debt budget changed/);
    assert.equal(s.data.size,0);
    await new Promise(r=>setImmediate(r));
  }finally{cleanup();}
});

test('blocked profile, budget and log writes roll back every part of a spending cut',async()=>{
  const {commitSpendingCut}=lib('commit-spending-cut.ts');const {loadProfileClient}=lib('user-store.ts');
  const u=user({fixed_expenses:'60000'});
  try{
    for(const target of ['finoptima_user','finoptima_debt_budget','finoptima_commitments']){
      const s=stores(u,k=>k.startsWith(target));s.jar.set('finoptima_debt_budget','50000');
      s.data.set('finoptima_commitments','[]');
      if(target==='finoptima_commitments'){
        const set=localStorage.setItem;
        localStorage.setItem=(k,v)=>{if(k===target)throw Error('quota');return set(k,v);};
      }
      assert.throws(()=>commitSpendingCut(u,10000,1,'50000'));
      assert.equal(loadProfileClient().user.fixed_expenses,'60000');
      assert.equal(s.jar.get('finoptima_debt_budget'),'50000');
      assert.equal(s.data.get('finoptima_commitments'),'[]');
    }
    await new Promise(r=>setImmediate(r));
  }finally{cleanup();}
});

test('undo refuses to overwrite later spending or debt-budget changes',async()=>{
  const {commitSpendingCut,undoSpendingCut}=lib('commit-spending-cut.ts');
  const {saveProfileClient,loadProfileClient}=lib('user-store.ts');
  const u=user({fixed_expenses:'60000'});const s=stores(u);s.jar.set('finoptima_debt_budget','50000');
  try{
    const entries=commitSpendingCut(u,10000,1,'50000');s.jar.set('finoptima_debt_budget','65000');
    assert.throws(()=>undoSpendingCut(entries[0].id),/changed after this cut/);
    s.jar.set('finoptima_debt_budget','60000');
    saveProfileClient({...loadProfileClient(),user:{...loadProfileClient().user,fixed_expenses:'45000'}});
    assert.throws(()=>undoSpendingCut(entries[0].id),/changed after this cut/);
    assert.equal(loadProfileClient().user.fixed_expenses,'45000');
    assert.equal(JSON.parse(s.data.get('finoptima_commitments')).length,1);
    await new Promise(r=>setImmediate(r));
  }finally{cleanup();}
});

test('Activity uses the capped final payment and keeps the raw minimum only for stale validation',()=>{
  const {buildHistory}=require(path.join(root,'components/activity/history.ts'));
  const u=user({country:'IN',loans:[loan('a',{loan_type:'personal_loan',outstanding:'1000',scheduled_emi:'9500',nominal_rate:'.14'})]});
  const row=buildHistory({user:u,entries:[],spend:[],life:[],today:'2026-10-03',planPay:{0:{amount:1012,minimum:1012,extra:0}}})[0].rows[0];
  assert.equal(row.planned,'₹1,012');assert.equal(row.ref.amount,'1012');assert.equal(row.ref.minimum,'1012.00');
  assert.equal(row.ref.configuredMinimum,'9500.00');
  // A changed card minimum (e.g. planned new spend) must still use the engine payment.
  u.loans[0]={...u.loans[0],loan_type:'credit_card',outstanding:'80000',scheduled_emi:'0',nominal_rate:'.42'};
  const card=buildHistory({user:u,entries:[],spend:[],life:[],today:'2026-10-03',planPay:{0:{amount:50000,minimum:4500,extra:45500}}})[0].rows[0];
  assert.equal(card.ref.amount,'50000');assert.equal(card.ref.minimum,'4500.00');assert.equal(card.ref.extra,'45500');
});

test('debt-budget parser preserves cents and rejects negative or malformed totals',()=>{
  const {normalizeDebtBudget}=lib('debt-budget.ts');
  assert.equal(normalizeDebtBudget('₹50,000.25'),'50000.25');
  for(const bad of ['-50000','abc50000','0','.','0.001'])assert.equal(normalizeDebtBudget(bad),'');
});

test('related account slices reach the server in one patch and remain together for retry',async()=>{
  process.env.NEXT_PUBLIC_DISABLE_AUTH='false';
  const data=new Map([['finoptima_account_id','cut-account']]);
  global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  global.window={dispatchEvent(){}};
  const {syncSlicesToServer,flushPendingState}=lib('server-sync.ts');
  const {api}=lib('api.ts');const previous=api.patchUserState;const writes=[];
  try{
    const change={profile:{user:{fixed_expenses:'50000'}},debt_budget:'60000',commitments:[{id:'cut'}]};
    api.patchUserState=async value=>{writes.push(value);throw Error('offline');};
    await syncSlicesToServer(change);
    assert.deepEqual(writes,[change]);
    assert.deepEqual(JSON.parse(data.get('finoptima_pending_sync_cut-account')),change);
    api.patchUserState=async value=>{writes.push(value);return {data:value};};
    assert.equal(await flushPendingState(),true);
    assert.deepEqual(writes[1],change);
  }finally{api.patchUserState=previous;cleanup();}
});
