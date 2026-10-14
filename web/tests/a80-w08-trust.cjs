// Audit 80+ W8 web regressions: D2/D12 consent versions and one-tap
// re-consent, D21 devices, D16 readable profile copies, D20 robots/sitemap at
// the edge (the Cloudflare Worker), all without a browser or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test'),{pathToFileURL}=require('node:url');
const web=path.resolve(__dirname,'..'),root=path.join(web,'src'),repo=path.resolve(web,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const read=(p)=>fs.readFileSync(path.join(repo,p),'utf8');

function recorder(status=200,body={}){
 const calls=[];
 const fetcher=async(url,init={})=>{calls.push({url,init});return new Response(status===204?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})};
 return {calls,fetcher};
}

// ── D2/D12: versions agree on both sides; re-consent sends them ───────────
test('web and API carry the same notice and terms versions',()=>{
 const facts=require(path.join(root,'lib/privacy-facts.ts'));
 const py=read('api/privacy_facts.py');
 assert.equal(py.match(/NOTICE_VERSION = "([^"]+)"/)[1],facts.NOTICE_VERSION);
 assert.equal(py.match(/TERMS_VERSION = "([^"]+)"/)[1],facts.TERMS_VERSION);
 assert.match(facts.NOTICE_VERSION,/^\d{4}-\d{2}-\d{2}$/);
});
test('one-tap re-consent posts the current versions and the 18+ tick through the session proxy',async()=>{
 const {agreeToCurrent,CONSENT_PATH}=require(path.join(root,'lib/consent.ts'));
 const facts=require(path.join(root,'lib/privacy-facts.ts'));
 for(const adult of [true,false]){
  const r=recorder(200,{ok:true});
  await agreeToCurrent(adult,r.fetcher);
  assert.equal(r.calls[0].url,CONSENT_PATH);
  assert.ok(CONSENT_PATH.startsWith('/api/session/'),'same-origin proxy, never the API host');
  assert.equal(r.calls[0].init.method,'POST');
  assert.deepEqual(JSON.parse(r.calls[0].init.body),{notice_version:facts.NOTICE_VERSION,terms_version:facts.TERMS_VERSION,age_confirmed:adult});
 }
 const bad=recorder(422,{detail:{message:'Tick the box to confirm you are 18 or older.'}});
 await assert.rejects(agreeToCurrent(false,bad.fetcher),/18 or older/);
});
test('the consent notice is mounted in the root layout and cannot agree without the 18+ tick',()=>{
 assert.match(read('web/src/app/layout.tsx'),/<ConsentNotice\s*\/>/);
 const src=read('web/src/components/auth/ConsentNotice.tsx');
 assert.match(src,/disabled=\{!adult \|\| busy\}/);
 assert.match(src,/consent_required === true/);
 for(const link of ['PRIVACY_PATH','TERMS_PATH','ACCOUNT_PATH'])assert.ok(src.includes(`href={${link}}`),link);
});

// ── D21: devices ───────────────────────────────────────────────────────────
test('device list, sign out one device, sign out everywhere',async()=>{
 const c=require(path.join(root,'lib/consent.ts'));
 const list=recorder(200,{sessions:[{id:'0123456789abcdef',device:'Chrome on Android',started_at:null,last_seen_at:null,expires_at:null,this_device:true}]});
 const got=await c.listDevices(list.fetcher);
 assert.equal(got.length,1);assert.equal(got[0].device,'Chrome on Android');
 assert.equal(list.calls[0].url,c.SESSIONS_PATH);
 const one=recorder(204);
 await c.signOutDevice('0123456789abcdef',one.fetcher);
 assert.equal(one.calls[0].url,`${c.SESSIONS_PATH}/0123456789abcdef/revoke`);
 // Only a well-formed id ever reaches the URL (no path injection).
 for(const id of ['../me','0123','ZZZZZZZZZZZZZZZZ','0123456789abcdef/../x']){
  const r=recorder(204);
  await assert.rejects(c.signOutDevice(id,r.fetcher),/Unknown device/);
  assert.equal(r.calls.length,0);
 }
 const all=recorder(200,{signed_out:3});
 assert.equal(await c.signOutEverywhere(true,all.fetcher),3);
 assert.deepEqual(JSON.parse(all.calls[0].init.body),{keep_this_device:true});
});
test('the session proxy forwards exactly the consent and device routes',()=>{
 const route=read('web/src/app/api/session/[...path]/route.ts');
 assert.match(route,/'auth\/consent': \['GET', 'POST'\]/);
 assert.match(route,/'auth\/sessions': \['GET'\]/);
 assert.match(route,/'auth\/sessions\/revoke-all': \['POST'\]/);
 assert.match(route,/\[0-9a-f\]\{16\}/);
});

// ── D16: readable copies live as long as the sign-in for accounts ─────────
test('readable profile copies: a year for guests, 30 days (SESSION_TTL) for accounts',()=>{
 const store=new Map();
 globalThis.localStorage={getItem:(k)=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:(k)=>store.delete(k)};
 try{
  const m=require(path.join(root,'lib/readable-cookie-age.ts'));
  assert.equal(m.readableCookieMaxAge(),m.GUEST_COOKIE_MAX_AGE);
  store.set(m.ACCOUNT_KEY,'u_1');
  assert.equal(m.readableCookieMaxAge(),m.ACCOUNT_COOKIE_MAX_AGE);
  const ttl=Number(read('api/auth/session.py').match(/SESSION_TTL = timedelta\(days=(\d+)\)/)[1]);
  assert.equal(m.ACCOUNT_COOKIE_MAX_AGE,ttl*24*3600,'account copies never outlive the sign-in');
  assert.match(read('web/src/lib/server-sync.ts'),new RegExp(`const ACCOUNT_KEY = '${m.ACCOUNT_KEY}'`));
 }finally{delete globalThis.localStorage}
});
test('profile chunks and mirrored slices take their lifetime from readableCookieMaxAge (no fixed year)',()=>{
 for(const f of ['web/src/lib/user-store.ts','web/src/lib/server-sync.ts']){
  const src=read(f);
  assert.ok(!/max-age=\$\{COOKIE_MAX_AGE\}/.test(src),`${f} still writes a fixed 365-day readable copy`);
  assert.ok(/max-age=\$\{readableCookieMaxAge\(\)\}/.test(src),f);
 }
});

// ── D20: robots.txt and sitemap.xml never depend on Render being awake ────
const worker=()=>import(pathToFileURL(path.join(repo,'deploy/cloudflare/landing-worker.mjs')).href);
test('the edge robots.txt and sitemap match the app (same pages, same disallow list)',async()=>{
 const w=await worker();
 const site=read('web/src/lib/site.ts');
 assert.equal(site.match(/SITE = '([^']+)'/)[1],w.SITE);
 const pages=JSON.parse(site.match(/PUBLIC_PAGES = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
 assert.deepEqual(w.PUBLIC_PAGES,pages);
 const robots=read('web/src/app/robots.ts');
 const disallow=JSON.parse(robots.match(/disallow: (\[[^\]]+\])/)[1].replace(/'/g,'"'));
 assert.deepEqual(w.ROBOTS_DISALLOW,disallow);
 const txt=w.robotsTxt();
 assert.ok(!/^Disallow: \/$/m.test(txt),'never the sleeping-service "Disallow: /"');
 assert.match(txt,/^Allow: \/$/m);
 assert.match(txt,new RegExp(`^Sitemap: ${w.SITE}/sitemap.xml$`,'m'));
 const xml=w.sitemapXml();
 for(const p of pages)assert.ok(xml.includes(`<loc>${p==='/'?`${w.SITE}/`:`${w.SITE}${p}`}</loc>`),p);
});
test('the Worker answers robots.txt and sitemap.xml itself, without waking Render',async()=>{
 const {default:w}=await worker();
 const calls=[];const saved=globalThis.fetch;
 globalThis.fetch=async(i)=>{calls.push(typeof i==='string'?i:i.url);return new Response('User-agent: *\nDisallow: /')};
 try{
  const ctx={waitUntil:()=>{}};
  for(const [p,type] of [['/robots.txt',/text\/plain/],['/sitemap.xml',/application\/xml/]]){
   const res=await w.fetch(new Request(`https://rightdue.app${p}`),{},ctx);
   assert.equal(res.status,200);assert.match(res.headers.get('Content-Type'),type);
   assert.equal(res.headers.get('X-RightDue-Edge'),'crawl');
   const body=await res.text();
   assert.ok(!/^Disallow: \/$/m.test(body));
  }
  const head=await w.fetch(new Request('https://rightdue.app/robots.txt',{method:'HEAD'}),{},ctx);
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.deepEqual(calls,[],'crawler requests never reach (or wake) Render');
  // Anything else still goes to the app as before.
  await w.fetch(new Request('https://rightdue.app/plan'),{},ctx);
  assert.deepEqual(calls,['https://rightdue.app/plan']);
 }finally{globalThis.fetch=saved}
});
test('wrangler routes include robots.txt and sitemap.xml',()=>{
 const toml=read('deploy/cloudflare/wrangler.toml');
 for(const p of ['/robots.txt','/sitemap.xml','/','/welcome.html'])assert.ok(toml.includes(`pattern = "rightdue.app${p}"`),p);
});
