const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const {NextRequest}=require('next/server'),route=require(path.join(root,'app/api/session/[...path]/route.ts'));
test('same-origin sign-in forwards a web-host session cookie and authenticated state, without leaking other cookies or bypassing rate limits',async()=>{
 const original=global.fetch;process.env.API_BASE_URL='https://api.example.com/';process.env.INTERNAL_API_TOKEN='private';
 const seen=[];global.fetch=async(url,opts)=>{seen.push({url,opts});return new Response(JSON.stringify({id:'test'}),{headers:{'set-cookie':'finoptima_session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax','content-type':'application/json'}})};
 try{
  const req=new NextRequest('https://web.example.com/api/session/auth/verify-otp',{method:'POST',headers:{origin:'https://web.example.com',cookie:'finoptima_session=opaque; financial_profile=private'},body:JSON.stringify({email:'test@example.com',code:'123456'})});
  const res=await route.POST(req,{params:{path:['auth','verify-otp']}});assert.equal(res.status,200);assert.match(res.headers.get('set-cookie'),/HttpOnly/);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(seen[0].url,'https://api.example.com/api/auth/verify-otp');assert.equal(seen[0].opts.headers.get('Cookie'),'finoptima_session=opaque');assert.equal(seen[0].opts.headers.get('X-Internal-Token'),null);
  await route.GET(new NextRequest('https://web.example.com/api/session/user/state',{headers:{cookie:'finoptima_session=opaque','x-account-id':'expected'}}),{params:{path:['user','state']}});assert.equal(seen[1].opts.headers.get('Cookie'),'finoptima_session=opaque');assert.equal(seen[1].opts.headers.get('X-Account-Id'),'expected');assert.equal(seen[0].opts.headers.get('X-Account-Id'),null);
 }finally{global.fetch=original;delete process.env.API_BASE_URL;delete process.env.INTERNAL_API_TOKEN;}
});
test('session proxy rejects cross-origin writes, arbitrary upstream paths and unsupported methods before making a request',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('must not run')};
 try{
  for(const origin of ['https://evil.example','null',undefined]){const headers=origin?{origin}:{};assert.equal((await route.POST(new NextRequest('https://web.example.com/api/session/auth/verify-otp',{method:'POST',headers}),{params:{path:['auth','verify-otp']}})).status,403)}
  assert.equal((await route.GET(new NextRequest('https://web.example.com/api/session/admin/delete'),{params:{path:['admin','delete']}})).status,404);
  assert.equal((await route.GET(new NextRequest('https://web.example.com/api/session/auth/verify-otp'),{params:{path:['auth','verify-otp']}})).status,405);assert.equal(calls,0);
 }finally{global.fetch=original}
});
test('proxy preserves empty logout, expiry cookie, authentication failure and throttling; upstream failure is a safe 502',async()=>{
 const original=global.fetch;const req={clone:()=>new NextRequest('https://web.example.com/api/session/auth/logout',{method:'POST',headers:{origin:'https://web.example.com'},body:'{}'})},ctx={params:{path:['auth','logout']}};
 try{
  global.fetch=async()=>new Response(null,{status:204,headers:{'set-cookie':'finoptima_session=; Max-Age=0; Path=/'}});let r=await route.POST(req.clone(),ctx);assert.equal(r.status,204);assert.equal(await r.text(),'');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
  global.fetch=async()=>new Response('Not authenticated',{status:401});assert.equal((await route.POST(req.clone(),ctx)).status,401);
  global.fetch=async()=>new Response('Too many requests',{status:429,headers:{'retry-after':'20'}});r=await route.POST(req.clone(),ctx);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'20');
  global.fetch=async()=>{throw Error('secret provider information')};r=await route.POST(req.clone(),ctx);assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret/);
 }finally{global.fetch=original}
});
test('a fresh device restores goals, contributions, spending, decisions and EF choices, including the plan digests, without writing server state',async()=>{
 const jar=new Map(),data=new Map(),original=global.fetch;global.document={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ')},set cookie(v){const pair=v.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1))}};global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};global.window={localStorage,dispatchEvent(){}};let calls=0;global.fetch=async()=>{calls++;throw Error('hydration must not write')};
 try{
  const input={goals:[{id:'g',kind:'custom',label:'Trip',amount:'10000',targetMonth:'2027-01',bufferPct:'0',priorityBump:false,status:'active'}],goal_contributions:[{id:'c',goalId:'g',amount:'2500.25',date:'2026-10-02'}],monthly_spend:[{id:'s',monthIso:'2026-10',spent:'1000.50',loggedAt:'2026-10-02'}],decisions:[{id:'d'}],ef_split:'0.6'};
  await require(path.join(root,'lib/server-sync.ts')).hydrateLocalStores(input);
  for(const slice of ['goals','goal_contributions','monthly_spend','decisions'])assert.deepEqual(JSON.parse(data.get('finoptima_'+slice)),input[slice]);
  assert.equal(JSON.parse(atob(jar.get('finoptima_goals_digest')))[0].id,'g');assert.equal(JSON.parse(atob(jar.get('finoptima_goal_contributions_digest'))).g,2500.25);assert.equal(JSON.parse(atob(jar.get('finoptima_monthly_spend_digest')))['2026-10'],1000.5);assert.equal(decodeURIComponent(jar.get('finoptima_ef_split')),'0.6');assert.equal(calls,0);
 }finally{global.fetch=original;delete global.document;delete global.localStorage;delete global.window}
});

test('browser account calls use the web host, and PATCH sends only the changed slices',async()=>{
 const original=global.fetch;global.window={};let seen;global.fetch=async(url,opts)=>{seen={url,opts};return Response.json({data:{}})};
 try{await require(path.join(root,'lib/api.ts')).api.patchUserState({goals:[]});assert.equal(seen.url,'/api/session/user/state');assert.equal(seen.opts.method,'PATCH');assert.deepEqual(JSON.parse(seen.opts.body),{data:{goals:[]}});assert.equal(seen.opts.credentials,'include');}
 finally{global.fetch=original;delete global.window}
});

test('first sign-in preserves every saved slice and account changes cannot inherit a previous user profile',()=>{
 const jar=new Map(),data=new Map();global.document={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ')},set cookie(v){const [pair,...attrs]=v.split(';'),i=pair.indexOf('=');if(attrs.some(a=>a.trim()==='max-age=0'))jar.delete(pair.slice(0,i));else jar.set(pair.slice(0,i),pair.slice(i+1))}};global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};global.window={localStorage,dispatchEvent(){}};
 try{
  const sync=require(path.join(root,'lib/server-sync.ts'));data.set('finoptima_goals','[{"id":"g"}]');data.set('finoptima_goal_contributions','[{"id":"c"}]');data.set('finoptima_decisions','[{"id":"d"}]');jar.set('finoptima_strategy','snowball');jar.set('finoptima_user','private');jar.set('finoptima_goals_digest','private');
  sync.prepareAccountCache('A');const snapshot=sync.serializeClientState({user:{country:'IN',loans:[]},marginalRate:'0.2',creditScore:null});assert.equal(snapshot.goals[0].id,'g');assert.equal(snapshot.goal_contributions[0].id,'c');assert.equal(snapshot.decisions[0].id,'d');assert.equal(snapshot.strategy,'snowball');
  sync.prepareAccountCache('A');assert.equal(data.has('finoptima_goals'),true);
  sync.prepareAccountCache('B');assert.equal(data.has('finoptima_goals'),false);assert.equal(jar.has('finoptima_user'),false);assert.equal(jar.has('finoptima_goals_digest'),false);assert.equal(jar.has('finoptima_strategy'),false);assert.equal(data.get('finoptima_account_id'),'B');
 }finally{delete global.document;delete global.localStorage;delete global.window}
});
