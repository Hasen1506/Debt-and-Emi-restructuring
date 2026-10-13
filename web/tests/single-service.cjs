// One Render service: Next.js proxies /api/* to FastAPI in the same container
// (next.config.mjs, lib/api-base, Dockerfile, deploy/start.sh).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const ENV=['API_INTERNAL_URL','API_BASE_URL','NEXT_PUBLIC_API_BASE_URL'];
function withEnv(env,fn){const saved=Object.fromEntries(ENV.map(k=>[k,process.env[k]]));for(const k of ENV)delete process.env[k];Object.assign(process.env,env);try{return fn()}finally{for(const k of ENV){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}}}
const base=require(path.join(root,'lib/api-base.ts'));

test('server reaches the API in the container by default; older settings still win over the default',()=>{
 withEnv({},()=>assert.equal(base.serverApiBase(),'http://127.0.0.1:8000'));
 withEnv({API_INTERNAL_URL:'http://127.0.0.1:9000/'},()=>assert.equal(base.serverApiBase(),'http://127.0.0.1:9000'));
 withEnv({API_BASE_URL:'https://api.example.com/'},()=>assert.equal(base.serverApiBase(),'https://api.example.com'));
 withEnv({NEXT_PUBLIC_API_BASE_URL:'https://api.example.com'},()=>assert.equal(base.serverApiBase(),'https://api.example.com'));
 // An empty NEXT_PUBLIC value (same-origin browser) must not become the server's base.
 withEnv({NEXT_PUBLIC_API_BASE_URL:''},()=>assert.equal(base.serverApiBase(),'http://127.0.0.1:8000'));
});
test('the browser calls the API on its own origin unless a separate API host is configured',()=>{
 withEnv({},()=>assert.equal(base.browserApiBase(),''));
 withEnv({NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:8100/'},()=>assert.equal(base.browserApiBase(),'http://127.0.0.1:8100'));
});
test('API paths reach FastAPI only as a fallback, so Next.js route handlers keep theirs',async()=>{
 const config=(await import(path.resolve(__dirname,'../next.config.mjs'))).default;
 const r=await config.rewrites();
 assert.ok(!Array.isArray(r),'rewrites must be {beforeFiles, afterFiles, fallback}');
 assert.deepEqual(r.beforeFiles,[]);assert.deepEqual(r.afterFiles,[]);
 assert.deepEqual(r.fallback,[{source:'/api/:path*',destination:'http://127.0.0.1:8000/api/:path*'}]);
 // Next's own /api handlers: none of them may be a FastAPI path.
 const own=fs.readdirSync(path.join(root,'app/api'));
 // healthz: Render's health check (live re-test 3 NEW-19), answered here.
 // client-error: browser error reports to Sentry (UX50 E-03), answered here.
 assert.deepEqual(own.sort(),['client-error','healthz','holdings','session']);
 const apiDir=path.resolve(__dirname,'../../api'),py=[];
 (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='tests')continue;const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.py'))py.push(fs.readFileSync(f,'utf8'))}})(apiDir);
 const source=py.join('\n');
 for(const name of own)assert.doesNotMatch(source,new RegExp(`["']/(?:api/)?${name}[/"']`),`FastAPI also serves /api/${name}`);
});
test('the session proxy passes the visitor X-Forwarded-For through unchanged, so sign-in limits see the visitor',async()=>{
 const route=require(path.join(root,'app/api/session/[...path]/route.ts'));
 const original=global.fetch,seen=[];
 global.fetch=async(url,opts)=>{seen.push({url,opts});return url.endsWith('/api/health')?Response.json({status:'ok'}):Response.json({ok:true})};
 try{
  await withEnv({},async()=>{
   const xff='203.0.113.9, 198.51.100.7, 172.64.0.1';
   const res=await route.POST(new (require('next/server').NextRequest)('https://rightdue.app/api/session/auth/request-otp',{method:'POST',headers:{origin:'https://rightdue.app','x-forwarded-for':xff,host:'rightdue.app','x-forwarded-proto':'https'},body:JSON.stringify({email:'a@example.com'})}),{params:Promise.resolve({path:['auth','request-otp']})});
   assert.equal(res.status,200);
   const call=seen.find(s=>s.url.endsWith('/api/auth/request-otp'));
   assert.equal(call.url,'http://127.0.0.1:8000/api/auth/request-otp');
   assert.equal(call.opts.headers.get('X-Forwarded-For'),xff);
   assert.equal(call.opts.headers.get('X-Internal-Token'),null);
  });
 }finally{global.fetch=original}
});
test('the container start script fails fast and runs one API worker on loopback only',()=>{
 const sh=fs.readFileSync(path.resolve(__dirname,'../../deploy/start.sh'),'utf8');
 assert.match(sh,/--host "\$API_HOST"/);assert.match(sh,/API_HOST=127\.0\.0\.1/);assert.match(sh,/--workers 1/);
 assert.match(sh,/wait -n/);assert.match(sh,/HOSTNAME=0\.0\.0\.0 PORT="\$WEB_PORT" node server\.js/);
});
