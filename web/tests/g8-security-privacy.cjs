// Sprint G8 regressions: grill #51 (privacy notice, terms, Your data),
// #58 (CSP + frame-ancestors), #59 (Turnstile, paused sign-in), #64 (error
// reports), #66 (no production build with auth switched off).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test'),{pathToFileURL}=require('node:url');
const web=path.resolve(__dirname,'..'),root=path.join(web,'src'),repo=path.resolve(web,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const read=(p)=>fs.readFileSync(path.join(repo,p),'utf8');
const mjs=(p,bust='')=>import(pathToFileURL(path.join(web,p)).href+bust);

// ── #66 ────────────────────────────────────────────────────────────────────
test('a production build with NEXT_PUBLIC_DISABLE_AUTH=true is refused unless explicitly allowed',async()=>{
 const {disabledAuthProblem,assertAuthEnabledForProduction}=await mjs('auth-guard.mjs');
 assert.match(disabledAuthProblem({NODE_ENV:'production',NEXT_PUBLIC_DISABLE_AUTH:'true'}),/Refusing a production build/);
 assert.throws(()=>assertAuthEnabledForProduction({NODE_ENV:'production',NEXT_PUBLIC_DISABLE_AUTH:'true'}),/sign-in switched off/);
 assert.equal(disabledAuthProblem({NODE_ENV:'production',NEXT_PUBLIC_DISABLE_AUTH:'true',RIGHTDUE_ALLOW_DISABLED_AUTH:'1'}),null);
 assert.equal(disabledAuthProblem({NODE_ENV:'production',NEXT_PUBLIC_DISABLE_AUTH:'false'}),null);
 assert.equal(disabledAuthProblem({NODE_ENV:'production'}),null);
 assert.equal(disabledAuthProblem({NODE_ENV:'development',NEXT_PUBLIC_DISABLE_AUTH:'true'}),null);
});
test('next.config.mjs itself refuses the combination on load',async()=>{
 const saved={...process.env};
 try{
  Object.assign(process.env,{NODE_ENV:'production',NEXT_PUBLIC_DISABLE_AUTH:'true'});delete process.env.RIGHTDUE_ALLOW_DISABLED_AUTH;
  await assert.rejects(mjs('next.config.mjs','?g8-refuse'),/Refusing a production build/);
  process.env.RIGHTDUE_ALLOW_DISABLED_AUTH='1';
  await mjs('next.config.mjs','?g8-allow');
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
});
test('the container refuses to start with auth switched off, too',()=>{
 const sh=read('deploy/start.sh');
 assert.match(sh,/NEXT_PUBLIC_DISABLE_AUTH:-false}" = "true"/);
 assert.match(sh,/RIGHTDUE_ALLOW_DISABLED_AUTH:-0}" != "1"/);
 assert.ok(sh.indexOf('RIGHTDUE_ALLOW_DISABLED_AUTH')<sh.indexOf('python -m uvicorn'),'the check runs before anything starts');
});

// ── #58 ────────────────────────────────────────────────────────────────────
test('pages get a CSP that forbids framing, other-site scripts, eval and plugins',async()=>{
 const {contentSecurityPolicy,securityHeaders,headerRules}=await mjs('security-headers.mjs');
 const csp=contentSecurityPolicy({});
 assert.match(csp,/frame-ancestors 'none'/);
 assert.match(csp,/object-src 'none'/);
 assert.match(csp,/base-uri 'self'/);
 assert.match(csp,/connect-src 'self'(;|$)/);
 // A split deploy / the E2E run call the API on its own origin (api-base.ts).
 assert.match(contentSecurityPolicy({NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:8100/'}),/connect-src 'self' http:\/\/127\.0\.0\.1:8100(;|$)/);
 assert.match(contentSecurityPolicy({NEXT_PUBLIC_API_BASE_URL:'/api'}),/connect-src 'self'(;|$)/);
 assert.doesNotMatch(csp,/unsafe-eval/);
 assert.doesNotMatch(csp,/challenges\.cloudflare\.com/,'Turnstile origins only when it is on');
 assert.match(csp,/style-src [^;]*https:\/\/fonts\.googleapis\.com/);
 assert.match(csp,/font-src [^;]*https:\/\/fonts\.gstatic\.com/);
 const names=securityHeaders({}).map(h=>h.key);
 for(const h of ['Content-Security-Policy','X-Frame-Options','X-Content-Type-Options','Referrer-Policy','Permissions-Policy'])assert.ok(names.includes(h),h);
 assert.equal(securityHeaders({}).find(h=>h.key==='X-Frame-Options').value,'DENY');
 // Production only (next dev keeps working in preview tools), and never on /api/*.
 assert.deepEqual(headerRules({NODE_ENV:'development'}),[]);
 const [rule]=headerRules({NODE_ENV:'production'});
 assert.equal(rule.source,'/((?!api/).*)');
});
test('with Turnstile on, the CSP allows exactly its script and frame origin',async()=>{
 const {contentSecurityPolicy}=await mjs('security-headers.mjs');
 const csp=contentSecurityPolicy({NEXT_PUBLIC_TURNSTILE_SITE_KEY:'0x4AAA'});
 assert.match(csp,/script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com/);
 assert.match(csp,/frame-src https:\/\/challenges\.cloudflare\.com/);
 assert.match(csp,/frame-ancestors 'none'/);
});
test('next.config.mjs sends the headers in production builds',async()=>{
 const saved={...process.env};
 try{
  process.env.NODE_ENV='production';delete process.env.NEXT_PUBLIC_DISABLE_AUTH;
  const config=(await mjs('next.config.mjs','?g8-headers')).default;
  const rules=await config.headers();
  // UX50 E-08 added a second, HSTS-only rule for /api/* (was 1 rule).
  assert.equal(rules.length,2);
  assert.ok(rules[0].headers.some(h=>h.key==='Content-Security-Policy'&&/frame-ancestors 'none'/.test(h.value)));
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
});

// ── #51 ────────────────────────────────────────────────────────────────────
test('privacy notice, terms and Your data are reachable without signing in',()=>{
 const src=fs.readFileSync(path.join(root,'middleware.ts'),'utf8');
 const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};new Function('module','exports','require',out)(m,m.exports,(id)=>id==='next/server'?{NextResponse:{}}:require(id.startsWith('./')?path.join(root,id):id));
 for(const p of ['/privacy','/terms','/account'])assert.ok(m.exports.isPublicPage(p),p);
 assert.ok(!m.exports.isPublicPage('/plan'));assert.ok(!m.exports.isPublicPage('/privacy-x'));
});
test('the session proxy allows only the two account actions it needs',()=>{
 const src=fs.readFileSync(path.join(root,'app/api/session/[...path]/route.ts'),'utf8');
 assert.match(src,/'auth\/account\/export': \['GET'\]/);
 assert.match(src,/'auth\/account\/delete': \['POST'\]/);
});
test('the privacy notice covers what DPDP Rules 2025 r.3, r.9 and r.14 ask for',()=>{
 const facts=require(path.join(root,'lib/privacy-facts.ts'));
 assert.equal(facts.GRIEVANCE_REPLY_DAYS_MAX,30); // audit80 D12: one promise on both pages
 assert.equal(facts.GRIEVANCE_REPLY_DAYS_LEGAL_MAX,90);
 assert.match(facts.GRIEVANCE_CONTACT.email,/^[^@\s]+@rightdue\.app$/);
 assert.equal(facts.RETENTION.signInRecordsDays,365);
 for(const u of Object.values(facts.SOURCES))assert.match(u,/^https:\/\/www\.meity\.gov\.in\//);
 const page=fs.readFileSync(path.join(root,'app/privacy/page.tsx'),'utf8');
 // Itemised data + purpose (r.3(b)), rights and how to use them (r.3(c), r.14(1)), the Board (s.5(1)(iii)).
 for(const s of ['WHAT WE KEEP, AND WHY','Your email address','The plan you save','Sign-in records','WHO ELSE HANDLES IT','HOW LONG WE KEEP IT','YOUR RIGHTS','s.11','s.12','s.14','s.13','GRIEVANCE_CONTACT.email','BOARD.name','ACCOUNT_PATH','CHILDREN','rule 7'])
  assert.ok(page.includes(s),s);
 // Says it hasn't been checked by a lawyer, and claims no review.
 assert.match(page,/not been checked by a lawyer/);
 const terms=fs.readFileSync(path.join(root,'app/terms/page.tsx'),'utf8');
 assert.match(terms,/not financial, investment, tax or legal\s+advice/);
 assert.match(terms,/never\s+sends anything to a lender/);
});
test('sign-in shows the notice before consent, and the button names the action',()=>{
 const page=fs.readFileSync(path.join(root,'app/login/page.tsx'),'utf8');
 assert.match(page,/href=\{PRIVACY_PATH\}/);assert.match(page,/href=\{TERMS_PATH\}/);
 assert.match(page,/'Agree and send code'/);
 assert.ok(page.indexOf('privacy notice')<page.indexOf("'Agree and send code'"),'the notice sits above the button');
});
test('Your data downloads the export, deletes with the typed email, and clears only RightDue keys',async()=>{
 const acct=require(path.join(root,'lib/account.ts'));
 const calls=[];
 const ok=async(url,init)=>{calls.push([url,init]);return new Response('{"a":1}',{status:200,headers:{'content-disposition':'attachment; filename="rightdue-my-data-2026-10-12.json"'}})};
 const got=await acct.fetchMyData(ok);
 assert.equal(got.filename,'rightdue-my-data-2026-10-12.json');assert.equal(calls[0][0],'/api/session/auth/account/export');
 const del=async(url,init)=>{calls.push([url,init]);return Response.json({deleted:true,deleted_at:'x',removed:{}})};
 await acct.deleteMyAccount('  Me@Example.com ',del);
 assert.equal(calls[1][0],'/api/session/auth/account/delete');assert.equal(calls[1][1].method,'POST');
 assert.deepEqual(JSON.parse(calls[1][1].body),{confirm_email:'me@example.com'});
 const bad=async()=>Response.json({detail:{field:'confirm_email',message:'That is not the email of the signed-in account. Nothing was deleted.'}},{status:400});
 await assert.rejects(acct.deleteMyAccount('x@example.com',bad),/Nothing was deleted/);
 // Local wipe: both old and new prefixes, nothing else.
 const jar=new Map([['finoptima_user','1'],['finoptima_session','s'],['rightdue_user','2'],['other_site','3']]);
 const doc={get cookie(){return [...jar].map(([k,v])=>`${k}=${v}`).join('; ')},set cookie(v){const name=v.split('=')[0];if(/Max-Age=0/.test(v))jar.delete(name)}};
 const store=new Map([['finoptima_decision_log','x'],['rightdue:pending','y'],['unrelated','z']]);
 const storage={get length(){return store.size},key:(i)=>[...store.keys()][i]??null,removeItem:(k)=>store.delete(k)};
 const n=await acct.clearLocalData(doc,storage);
 assert.equal(n,5);assert.deepEqual([...jar.keys()],['other_site']);assert.deepEqual([...store.keys()],['unrelated']);
});
test('a header link opens Your data for a signed-in user',()=>{
 const src=fs.readFileSync(path.join(root,'components/chrome/SessionIndicator.tsx'),'utf8');
 // Audit 80+ E13: brackets are drawn aria-hidden, so the name is the words.
 assert.match(src,/href="\/account"[\s\S]*YOUR DATA/);
});

// ── #59 ────────────────────────────────────────────────────────────────────
test('a paused sign-in (daily cap) gets its own message, not a generic outage',()=>{
 const {authErrorMessage,SIGN_IN_PAUSED_MESSAGE}=require(path.join(root,'lib/auth-error.ts'));
 assert.equal(authErrorMessage(503,JSON.stringify({detail:{code:'sign_in_paused',message:'x'}}),'86400'),SIGN_IN_PAUSED_MESSAGE);
 assert.match(SIGN_IN_PAUSED_MESSAGE,/try again tomorrow/i);
 assert.match(authErrorMessage(400,JSON.stringify({detail:{code:'turnstile_failed',message:'Please complete the check above the button, then send the code again.'}}),null),/complete the check/);
});
test('the Turnstile token is sent only when there is one',async()=>{
 const {api}=require(path.join(root,'lib/api.ts'));
 const previous=global.fetch,bodies=[];
 global.fetch=async(url,init)=>{bodies.push(JSON.parse(init.body));return new Response(null,{status:204})};
 try{await api.requestOtp('a@example.com');await api.requestOtp('a@example.com','tok');}finally{global.fetch=previous}
 assert.deepEqual(bodies,[{email:'a@example.com'},{email:'a@example.com',turnstile_token:'tok'}]);
});
test('Turnstile is off unless its site key is compiled in, and the image can pass one',()=>{
 const src=fs.readFileSync(path.join(root,'components/auth/Turnstile.tsx'),'utf8');
 assert.match(src,/if \(!TURNSTILE_SITE_KEY\) return null;/);
 assert.match(read('Dockerfile'),/ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=\n/);
});

// ── #64 ────────────────────────────────────────────────────────────────────
test('server error reports are off without SENTRY_DSN and carry no figures with it',async()=>{
 const er=require(path.join(root,'lib/error-report.ts'));
 const saved=process.env.SENTRY_DSN;delete process.env.SENTRY_DSN;
 try{
  assert.equal(await er.reportServerError(new Error('x'),{}),null);
  assert.equal(er.parseDsn('nonsense'),null);
  const dsn=er.parseDsn('https://pub@o1.ingest.sentry.io/42');
  assert.equal(dsn.envelopeUrl,'https://o1.ingest.sentry.io/api/42/envelope/');assert.equal(dsn.publicKey,'pub');
  const {body}=er.buildEnvelope(new Error('EMI 18100 failed for loan 77'),{method:'GET',routePath:'/plan',routeType:'render'},dsn);
  const [h,item,payload]=body.trimEnd().split('\n');
  assert.equal(JSON.parse(item).length,Buffer.byteLength(payload));
  assert.equal(JSON.parse(h).dsn,'https://pub@o1.ingest.sentry.io/42');
  assert.doesNotMatch(JSON.stringify(JSON.parse(payload).exception),/18100|77/,'figures are scrubbed from the error text');
  assert.deepEqual(JSON.parse(payload).request,{method:'GET',url:'/plan'});
  process.env.SENTRY_DSN='https://pub@o1.ingest.sentry.io/42';
  const sent=[];const id=await er.reportServerError(new Error('boom'),{routePath:'/x'},async(u,i)=>{sent.push([u,i]);return new Response(null)});
  assert.match(id,/^[0-9a-f]{32}$/);assert.equal(sent[0][0],'https://o1.ingest.sentry.io/api/42/envelope/');
  assert.equal(await er.reportServerError(new Error('boom'),{},async()=>{throw new Error('down')}),null,'a failed send never throws');
 }finally{if(saved===undefined)delete process.env.SENTRY_DSN;else process.env.SENTRY_DSN=saved}
});

// ── #58 founder note: the old brand is gone from non-cookie code ──────────
// (cookie and storage names finoptima_* are migrated by sprint L1.)
test('no finoptima event names or identifiers remain outside cookie/storage keys',()=>{
 const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.(tsx?|mjs|css)$/.test(e.name))o.push(p)}return o};
 const hits=[];
 for(const f of walk(root)){if(f.endsWith(path.join('lib','account.ts'))||f.endsWith(path.join('lib','storage-migration.ts')))continue;const s=fs.readFileSync(f,'utf8');
  for(const m of s.matchAll(/finoptima[^_]/gi))hits.push(`${path.relative(web,f)}: ${m[0]}`)}
 assert.deepEqual(hits,[]);
});
test('the landing page footer links the privacy notice and terms',()=>{
 const html=fs.readFileSync(path.join(web,'public/welcome.html'),'utf8');
 assert.match(html,/href="\/privacy"/);assert.match(html,/href="\/terms"/);
});
// UX50 E-08 / E-09
test('HSTS on every page and every /api response; inline handler attributes blocked', async () => {
 const {contentSecurityPolicy,securityHeaders,headerRules,HSTS}=await mjs('security-headers.mjs');
 assert.equal(HSTS,'max-age=63072000; includeSubDomains; preload');
 assert.equal(securityHeaders({}).find(h=>h.key==='Strict-Transport-Security').value,HSTS);
 const rules=headerRules({NODE_ENV:'production'});
 const api=rules.find(r=>r.source==='/api/:path*');
 assert.ok(api,'an /api rule');
 // audit80 D23: Next's own /api routes never reach FastAPI, so the rule carries the full API policy.
 const h=Object.fromEntries(api.headers.map(x=>[x.key,x.value]));
 assert.equal(h['Strict-Transport-Security'],HSTS);
 assert.equal(h['X-Content-Type-Options'],'nosniff');
 assert.equal(h['Content-Security-Policy'],"default-src 'none'; frame-ancestors 'none'");
 assert.equal(h['X-Frame-Options'],'DENY');
 const csp=contentSecurityPolicy({});
 assert.match(csp,/script-src-attr 'none'/);
 assert.doesNotMatch(csp,/upgrade-insecure-requests/,'would break http:// API origins in local and E2E runs');
});
