const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
function setup(account='A') {
 const data=new Map([['finoptima_account_id',account]]),events=[];
 global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 global.window={localStorage,dispatchEvent:e=>events.push(e.type)};
 const file=path.join(root,'lib/server-sync.ts');delete require.cache[require.resolve(file)];
 return {data,events,sync:require(file),reload:()=>{delete require.cache[require.resolve(file)];return require(file)}};
}
function cleanup(){delete global.window;delete global.localStorage}

test('a response fetched for one account cannot hydrate after another tab changes accounts',async()=>{
 const original=global.fetch,{sync,data}=setup('A');let entered,release;
 const started=new Promise(r=>entered=r);
 try {
  global.fetch=async()=>{entered();await new Promise(r=>release=r);return Response.json({data:{strategy:'private-A'}})};
  const hydration=sync.hydrateFromServer();await started;
  data.set('finoptima_account_id','B');release();
  assert.equal(await hydration,false);
 }finally{global.fetch=original;cleanup()}
});

test('failed writes survive a module reload and retry before stale server hydration',async()=>{
 const fetch=global.fetch,{data,sync,reload}=setup();
 try {
  global.fetch=async()=>{throw Error('offline')};await sync.syncSliceToServer('goals',[{id:'new'}]);
  assert.equal(sync.getSyncStatus(),'failed');assert.equal(JSON.parse(data.get('finoptima_pending_sync_A')).goals[0].id,'new');
  let saved,calls=[];global.fetch=async(url,opts)=>{calls.push(opts.method??'GET');if(opts.method==='PATCH'){saved=JSON.parse(opts.body).data;assert.equal(opts.headers['X-Account-Id'],'A');return Response.json({data:saved})}return Response.json({data:saved})};
  const fresh=reload();await fresh.hydrateFromServer();
  assert.deepEqual(calls,['PATCH','GET']);assert.equal(data.get('finoptima_pending_sync_A'),undefined);assert.equal(JSON.parse(data.get('finoptima_goals'))[0].id,'new');
 }finally{global.fetch=fetch;cleanup()}
});

test('failed pending retry prevents GET hydration from overwriting local changes',async()=>{
 const fetch=global.fetch,{data,sync}=setup();let calls=0;
 try{global.fetch=async()=>{calls++;throw Error('offline')};await sync.syncSliceToServer('strategy','snowball');const before=calls;assert.equal(await sync.hydrateFromServer(),false);assert.equal(calls,before+1);assert.equal(JSON.parse(data.get('finoptima_pending_sync_A')).strategy,'snowball')}
 finally{global.fetch=fetch;cleanup()}
});

test('newer edits made during a request remain queued until their own acknowledgement',async()=>{
 const fetch=global.fetch,{sync,data}=setup();let entered,release;const started=new Promise(r=>entered=r),writes=[];
 try {
  global.fetch=async(url,opts)=>{writes.push(JSON.parse(opts.body).data);if(writes.length===1){entered();await new Promise(r=>release=r)}return Response.json({data:{}})};
  const first=sync.syncSliceToServer('strategy','avalanche');await started;const second=sync.syncSliceToServer('strategy','snowball');release();await Promise.all([first,second]);
  assert.deepEqual(writes,[{strategy:'avalanche'},{strategy:'snowball'}]);assert.equal(data.has('finoptima_pending_sync_A'),false);assert.equal(sync.getSyncStatus(),'saved');
 }finally{global.fetch=fetch;cleanup()}
});

test('pending values stay with their original account and anonymous changes do not write',async()=>{
 const fetch=global.fetch,{sync,data}=setup();let writes=[];
 try {
  global.fetch=async()=>{throw Error('offline')};await sync.syncSliceToServer('profile',{private:'A'});
  data.set('finoptima_account_id','B');global.fetch=async(url,opts)=>{writes.push(JSON.parse(opts.body).data);return Response.json({data:{}})};
  assert.equal(await sync.flushPendingState(),true);assert.deepEqual(writes,[]);await sync.syncSliceToServer('strategy','snowball');assert.deepEqual(writes,[{strategy:'snowball'}]);assert.ok(data.has('finoptima_pending_sync_A'));
  data.delete('finoptima_account_id');await sync.syncSliceToServer('profile',{private:'anon'});assert.equal(writes.length,1);
 }finally{global.fetch=fetch;cleanup()}
});

test('storage quota failure keeps an in-memory retry',async()=>{
 const fetch=global.fetch,{sync}=setup();const set=localStorage.setItem;
 try{localStorage.setItem=()=>{throw Error('quota')};global.fetch=async()=>{throw Error('offline')};await sync.syncSliceToServer('strategy','snowball');localStorage.setItem=set;let sent;global.fetch=async(url,opts)=>{sent=JSON.parse(opts.body).data;return Response.json({data:{}})};assert.equal(await sync.flushPendingState(),true);assert.deepEqual(sent,{strategy:'snowball'})}
 finally{global.fetch=fetch;cleanup()}
});

test('session listeners update after login, and failed saves or logout retain the authenticated state',async()=>{
 const load=Module._load,effects=[],handlers=new Map();let state,ref={current:0},allowFlush=true,allowLogout=true,cleared=0,currentUser=null;
 global.window={addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key),dispatchEvent:e=>handlers.get(e.type)?.()};
 Module._load=function(request,parent,...rest){
  if(request==='react')return {...load.call(this,request,parent,...rest),useState:initial=>[state??=initial,next=>state=next],useRef:()=>ref,useEffect:fn=>effects.push(fn)};
  if(request==='@/lib/api')return {api:{me:async()=>{if(!currentUser)throw Error('401');return currentUser},logout:async()=>{if(!allowLogout)throw Error('offline');currentUser=null}}};
  if(request==='./server-sync'&&parent.filename.endsWith('auth.ts'))return {flushPendingState:async()=>allowFlush,clearAccountCache:()=>cleared++};
  return load.call(this,request,parent,...rest);
 };
 try {
  const file=path.join(root,'lib/auth.ts');delete require.cache[require.resolve(file)];const {useSession}=require(file),session=useSession(),dispose=effects[0]();await new Promise(r=>setImmediate(r));assert.equal(state.status,'anon');
  currentUser={id:'A',email:'test@example.com'};handlers.get('finoptima:session-changed')();await new Promise(r=>setImmediate(r));assert.equal(state.status,'authed');
  allowFlush=false;await assert.rejects(session.logout(),/not reached/);assert.equal(cleared,0);assert.equal(state.status,'authed');
  allowFlush=true;allowLogout=false;await assert.rejects(session.logout(),/offline/);assert.equal(cleared,0);assert.equal(state.status,'authed');
  allowLogout=true;await session.logout();assert.equal(cleared,1);assert.equal(state.status,'anon');dispose();assert.equal(handlers.size,0);
 }finally{Module._load=load;delete global.window}
});
