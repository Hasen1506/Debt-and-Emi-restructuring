// L1 persistence (live-test #2, #3, #27, #33; critiques #58, #63).
// Root cause of "Changes have not reached your account… Retry save" for a
// "signed-out" visitor: the browser still carried a session cookie the
// server no longer honoured. Pages opened (middleware only checks that the
// cookie exists), every save was kept in this browser, but each PATCH to the
// account answered 401, the client reported every non-2xx as one "failed",
// and Retry re-sent the same dead cookie, so the notice could never clear.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);

function store(entries=[]) {
  const data=new Map(entries);
  return {data,api:{get length(){return data.size},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}};
}
function setup(account='A',extra=[]) {
  const ls=store(account?[['rightdue_account_id',account],...extra]:extra),events=[];
  global.localStorage=ls.api;
  global.window={localStorage:ls.api,dispatchEvent:e=>events.push(e.type)};
  for(const f of ['lib/server-sync.ts','lib/storage-migration.ts'])delete require.cache[require.resolve(path.join(root,f))];
  return {data:ls.data,events,sync:require(path.join(root,'lib/server-sync.ts'))};
}
function cleanup(){delete global.window;delete global.localStorage;delete global.document}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('a 401 (sign-in ended, cookie still here) is "signed out", kept on this device, and not retried forever',async t=>{
 const fetch=global.fetch,{sync,data}=setup();let calls=0;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  global.fetch=async()=>{calls++;return json({detail:'Not authenticated'},401)};
  await sync.syncSliceToServer('strategy','snowball');
  const s=sync.getSyncState();
  assert.equal(s.status,'failed');assert.equal(s.problem,'signed_out');assert.equal(s.nextRetryAt,undefined);
  assert.equal(JSON.parse(data.get('rightdue_pending_sync_A')).strategy,'snowball');
  t.mock.timers.tick(10*60*1000);await new Promise(r=>setImmediate(r));
  assert.equal(calls,1,'no automatic retry with a dead session');
  // Signed in again (same account): the queued change goes through.
  global.fetch=async(url,opts)=>{calls++;return json({data:JSON.parse(opts.body).data,version:1})};
  assert.equal(await sync.flushPendingState(),true);
  assert.equal(sync.getSyncState().status,'saved');assert.equal(data.has('rightdue_pending_sync_A'),false);
 }finally{global.fetch=fetch;t.mock.timers.reset();cleanup()}
});

test('offline or a waking server retries on its own on a back-off, and says when',async t=>{
 const fetch=global.fetch,{sync}=setup();let calls=0;
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-12T08:00:00Z')});
 try{
  global.fetch=async()=>{calls++;throw new TypeError('Failed to fetch')};
  await sync.syncSliceToServer('strategy','snowball');
  let s=sync.getSyncState();
  assert.equal(s.problem,'offline');assert.equal(s.nextRetryAt-s.lastAttemptAt,sync.RETRY_DELAYS_MS[0]);
  global.fetch=async(url,opts)=>{calls++;return json({data:{},version:1})};
  t.mock.timers.tick(sync.RETRY_DELAYS_MS[0]);
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(calls,2);assert.equal(sync.getSyncState().status,'saved');
 }finally{global.fetch=fetch;t.mock.timers.reset();cleanup()}
});

test('each failure says what happened, that it is saved on this device, and when it last tried',()=>{
 const {syncMessage}=require(path.join(root,'components/AccountSyncNotice.tsx'));
 const at=Date.parse('2026-10-12T05:12:00Z');
 const m=p=>syncMessage({status:'failed',problem:p,lastAttemptAt:at,nextRetryAt:at+15000,conflictSlices:['profile']},1);
 assert.match(m('signed_out'),/saved on this device.*signed out.*Sign in again/);
 assert.match(m('offline'),/saved on this device.*couldn't be reached.*waking up.*Trying again at \d\d:\d\d.*Last tried \d\d:\d\d/);
 assert.match(m('too_large'),/too large/);
 assert.match(m('conflict'),/Your profile \(income, loans and tax\) changed on another device/);
 assert.doesNotMatch(m('signed_out'),/have not reached your account. Keep this tab open/);
 assert.match(syncMessage({status:'pending'},1),/Saved on this device. Sending/);
});

test('a guest (no account in this browser) never calls the account and never sees the notice',async()=>{
 const fetch=global.fetch,{sync}=setup(null);let calls=0;
 try{global.fetch=async()=>{calls++;return json({})};await sync.syncSliceToServer('strategy','snowball');assert.equal(calls,0);assert.equal(sync.getSyncState().status,'saved')}
 finally{global.fetch=fetch;cleanup()}
});

test('after a reload a dead session with queued changes is shown at once, not after the next save',()=>{
 const {sync}=setup('A',[['rightdue_pending_sync_A',JSON.stringify({profile:{x:1}})]]);
 try{assert.equal(sync.getSyncState().status,'saved');sync.noteSignedOut();assert.equal(sync.getSyncState().problem,'signed_out');assert.equal(sync.pendingCount(),1)}
 finally{cleanup()}
});

test('writes carry the version this device last read, and a jump in version brings the other device\'s parts here',async()=>{
 const fetch=global.fetch,{sync,data}=setup('A',[['rightdue_state_version_A','3']]);const bodies=[];
 try{
  global.fetch=async(url,opts)=>{bodies.push(JSON.parse(opts.body));return json({data:{strategy:'snowball',commitments:[{id:'from-phone'}]},version:6})};
  await sync.syncSliceToServer('strategy','snowball');
  assert.equal(bodies[0].base_version,3);
  assert.equal(data.get('rightdue_state_version_A'),'6');
  assert.equal(JSON.parse(data.get('rightdue_commitments'))[0].id,'from-phone');
 }finally{global.fetch=fetch;cleanup()}
});

test('412: the other device\'s copy is loaded here, this device\'s is kept aside, the rest is still sent, and "use mine" forces it',async()=>{
 const fetch=global.fetch,{sync,data,events}=setup('A',[['rightdue_state_version_A','1'],['rightdue_commitments',JSON.stringify([{id:'mine'}])]]);const bodies=[];
 try{
  global.fetch=async(url,opts)=>{
   const b=JSON.parse(opts.body);bodies.push(b);
   if(bodies.length===1)return json({detail:{code:'stale_state',slices:['commitments'],data:{commitments:[{id:'phone'}],strategy:'avalanche'},version:4}},412);
   return json({data:{...b.data},version:(b.base_version??0)+1});
  };
  await sync.syncSlicesToServer({commitments:[{id:'mine'}],strategy:'snowball'});
  const s=sync.getSyncState();
  assert.equal(s.problem,'conflict');assert.deepEqual(s.conflictSlices,['commitments']);
  assert.equal(JSON.parse(data.get('rightdue_commitments'))[0].id,'phone','account copy shown here');
  assert.deepEqual({data:bodies[1].data,base_version:bodies[1].base_version},{data:{strategy:'snowball'},base_version:4},'the part that did not conflict is sent on the new version');
  assert.equal(bodies[1].device_id,bodies[0].device_id,'every write names this browser');
  assert.ok(events.includes('rightdue:remote-applied'));
  assert.deepEqual(sync.conflictCopy('A'),{commitments:[{id:'mine'}]});
  assert.equal(await sync.keepThisDevice(),true);
  assert.deepEqual(bodies[2].data,{commitments:[{id:'mine'}]});assert.equal(bodies[2].force,true);
  assert.equal(JSON.parse(data.get('rightdue_commitments'))[0].id,'mine');
  assert.equal(sync.conflictCopy('A'),null);assert.equal(sync.getSyncState().status,'saved');
 }finally{global.fetch=fetch;cleanup()}
});

test('a later save of another part does not hide an open conflict (WebKit E2E: the change log synced after the 412)',async()=>{
 const fetch=global.fetch,{sync}=setup('A',[['rightdue_state_version_A','1']]);const bodies=[];
 try{
  global.fetch=async(url,opts)=>{
   const b=JSON.parse(opts.body);bodies.push(b);
   if(bodies.length===1)return json({detail:{code:'stale_state',slices:['profile'],data:{profile:{monthly_income:'90000'}},version:4}},412);
   return json({data:{...b.data},version:(b.base_version??0)+1});
  };
  await sync.syncSliceToServer('profile',{monthly_income:'80000'});
  assert.equal(sync.getSyncState().problem,'conflict');
  // The profile save's change-log entry reaches the account after the 412.
  const sent=sync.syncSliceToServer('change_log',[{what:'Take-home pay'}]);
  assert.equal(sync.getSyncState().problem,'conflict','still shown while the change log is sending');
  await sent;
  assert.deepEqual(bodies[1].data,{change_log:[{what:'Take-home pay'}]});
  const s=sync.getSyncState();
  assert.equal(s.problem,'conflict','still shown once it has been sent');assert.deepEqual(s.conflictSlices,['profile']);
  // Choosing the other device's copy clears it.
  sync.keepOtherDevice();
  assert.equal(sync.getSyncState().status,'saved');assert.equal(sync.getSyncState().problem,undefined);
 }finally{global.fetch=fetch;cleanup()}
});

test('a resent write the account already holds (its answer was lost) is not shown as a conflict',async()=>{
 const fetch=global.fetch,{sync,data}=setup('A',[['rightdue_state_version_A','0']]);let calls=0;
 try{
  // Old-API answer: 412 although the account holds exactly this device's value (keys in another order).
  global.fetch=async()=>{calls++;return json({detail:{code:'stale_state',slices:['profile'],data:{profile:{b:2,a:1}},version:1}},412)};
  await sync.syncSliceToServer('profile',{a:1,b:2});
  assert.equal(sync.getSyncState().status,'saved');assert.equal(sync.conflictCopy('A'),null);
  assert.equal(data.has('rightdue_pending_sync_A'),false);assert.equal(data.get('rightdue_state_version_A'),'1');assert.equal(calls,1);
 }finally{global.fetch=fetch;cleanup()}
});

test('an older version in a late answer never replaces a newer one this device already has',async()=>{
 const fetch=global.fetch,{sync,data}=setup('A',[['rightdue_state_version_A','5']]);
 try{
  global.fetch=async()=>json({data:{},version:3});
  await sync.syncSliceToServer('strategy','snowball');
  assert.equal(data.get('rightdue_state_version_A'),'5');
 }finally{global.fetch=fetch;cleanup()}
});

test('every write names this browser with one stable random id, kept across reloads',async()=>{
 const fetch=global.fetch,{sync,data}=setup('A');const bodies=[];
 try{
  global.fetch=async(url,opts)=>{const b=JSON.parse(opts.body);bodies.push(b);return json({data:b.data,version:bodies.length})};
  await sync.syncSliceToServer('strategy','snowball');await sync.syncSliceToServer('strategy','avalanche');
  assert.ok(typeof bodies[0].device_id==='string'&&bodies[0].device_id.length>=8);
  assert.equal(bodies[1].device_id,bodies[0].device_id);assert.equal(data.get('rightdue_device_id'),bodies[0].device_id);
 }finally{global.fetch=fetch;cleanup()}
});

test('finoptima_* cookies are renamed on the request and in the browser; a new-name value wins; the session stays HttpOnly',()=>{
 const {renameRequestCookies}=require(path.join(root,'lib/storage-migration.ts'));
 assert.equal(renameRequestCookies('rightdue_user=z1.1.abc; other=1',true),null);
 const r=renameRequestCookies('finoptima_session=tok; finoptima_user=old; rightdue_user=new; finoptima_strategy=snowball',true);
 const jar=Object.fromEntries(r.header.split('; ').map(p=>p.split('=')));
 assert.deepEqual(jar,{rightdue_user:'new',rightdue_session:'tok',rightdue_strategy:'snowball'});
 assert.ok(r.setCookies.some(c=>/^rightdue_session=tok; .*HttpOnly.*Secure/.test(c)));
 assert.ok(r.setCookies.some(c=>/^finoptima_session=; .*Max-Age=0/.test(c)));
 assert.ok(!r.setCookies.some(c=>c.startsWith('rightdue_user=')),'the newer value is not overwritten');
});

test('the browser moves its finoptima_* storage once, keeping anything already renamed',()=>{
 const ls=store([['finoptima_goals','[1]'],['finoptima_activity','[old]'],['rightdue_activity','[new]'],['unrelated','x']]),ss=store([['finoptima_debtfree_prompt_dismissed','1']]);
 const jar=new Map([['finoptima_strategy','snowball']]);
 global.window={localStorage:ls.api,sessionStorage:ss.api};
 global.document={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ')},set cookie(v){const [pair,...attrs]=v.split('; ');const i=pair.indexOf('=');const k=pair.slice(0,i);if(attrs.includes('max-age=0'))jar.delete(k);else jar.set(k,pair.slice(i+1))}};
 try{
  const file=path.join(root,'lib/storage-migration.ts');delete require.cache[require.resolve(file)];
  require(file).migrateLegacyClientStorage();
  assert.deepEqual(Object.fromEntries(ls.data),{rightdue_goals:'[1]',rightdue_activity:'[new]',unrelated:'x'});
  assert.deepEqual(Object.fromEntries(ss.data),{rightdue_debtfree_prompt_dismissed:'1'});
  assert.deepEqual(Object.fromEntries(jar),{rightdue_strategy:'snowball'});
 }finally{cleanup()}
});

test('no finoptima_ storage name is left in the web app outside the migration',()=>{
 const hits=[];
 const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.(ts|tsx)$/.test(e.name)&&!f.endsWith('storage-migration.ts')){const src=fs.readFileSync(f,'utf8');for(const m of src.matchAll(/finoptima_[a-z]/g))hits.push(`${path.relative(root,f)}:${m.index}`)}}};
 walk(root);
 assert.deepEqual(hits,[]);
});

test('an exchange-rate refresh that finishes after a profile save keeps the save (only the rates change)',async()=>{
 const load=Module._load;let reads=0,saved;
 const before={user:{country:'IN',loans:[{loan_type:'personal_loan',currency:'USD',outstanding:'1'}],monthly_income:'120000',fx_to_user_currency:{USD:'80'},fx_meta:{USD:{fetched_at:'2026-01-01T00:00:00Z',as_of:null,source:'x'}}},marginalRate:'0.1',creditScore:null,isLive:true};
 const after={...before,user:{...before.user,monthly_income:'70000',loans:[...before.user.loans,{loan_type:'home_loan',outstanding:'2500000'}]}};
 Module._load=function(request,parent,...rest){
  if(request==='@/lib/user-store')return {loadProfileClient:()=>(reads++===0?before:after),saveProfileClient:p=>{saved=p;return true}};
  if(request==='@/lib/api')return {api:{fxRate:async()=>({rate:'84.1',source:'frankfurter',as_of:'2026-10-11'})}};
  if(request==='next/navigation')return {useRouter:()=>({refresh(){}})};
  return load.call(this,request,parent,...rest);
 };
 global.window={dispatchEvent(){}};global.CustomEvent=class{constructor(t,o){this.type=t;this.detail=o?.detail}};
 try{
  const file=path.join(root,'components/fx/FxAutoRefresh.tsx');delete require.cache[require.resolve(file)];
  const {refreshProfileFx}=require(file);await refreshProfileFx();
  assert.equal(saved.user.monthly_income,'70000');assert.equal(saved.user.loans.length,2);assert.equal(saved.user.fx_to_user_currency.USD,'84.1');
 }finally{Module._load=load;cleanup();delete global.CustomEvent}
});
