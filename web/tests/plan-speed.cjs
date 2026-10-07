const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
Module._load=function(request,parent,...rest){return request==='server-only'?{}:load.call(this,request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const {createEngineCache}=require(path.join(root,'lib/server-engine-cache.ts'));
test('unchanged concurrent engine calls run once while strategy/profile/goal changes miss the cache',async()=>{
 const cached=createEngineCache();let calls=0;const run=async()=>({run:++calls});const input={user:{income:'100000'},strategy:'avalanche',goals:[]};
 const [a,b]=await Promise.all([cached('simulate',input,run),cached('simulate',input,run)]);assert.equal(calls,1);assert.deepEqual(a,b);
 for(const other of [{...input,strategy:'snowball'},{...input,user:{income:'90000'}},{...input,goals:[{id:'g'}]}])await cached('simulate',other,run);
 await cached('baseline',input,run);assert.equal(calls,5);
});
test('calculation cache expires, evicts oldest entries, and never caches a failed request',async()=>{
 let now=0,calls=0;const cached=createEngineCache(100,2,()=>now),run=async()=>++calls;
 await cached('sim','a',run);await cached('sim','b',run);await cached('sim','a',run);await cached('sim','c',run);await cached('sim','b',run);assert.equal(calls,4);
 now=101;await cached('sim','b',run);assert.equal(calls,5);
 await assert.rejects(cached('sim','error',async()=>{throw Error('offline')}));assert.equal(await cached('sim','error',run),6);
});
test('public calculations and rate catalogues omit cookies; same-origin account calls retain them',async()=>{
 const fetch=global.fetch;global.window={};const seen=[];global.fetch=async(url,opts)=>{seen.push({url,opts});return Response.json({})};
 try{const {api}=require(path.join(root,'lib/api.ts'));await api.institutions('IN');await api.centralRates();await api.simulate({user:{country:'IN'}});await api.requestOtp('test@example.com');await api.getUserState();assert.deepEqual(seen.map(s=>s.opts.credentials),['omit','omit','omit','include','include']);assert.equal(seen[3].url,'/api/session/auth/request-otp');assert.equal(seen[4].url,'/api/session/user/state')}
 finally{global.fetch=fetch;delete global.window}
});
