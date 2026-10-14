const { profileSource } = require('./lib/profile-source.cjs'); // Audit 80 E15: Profile is split into parts/
// Regression tests for the 2026-10-07 audit fixes (BUG_REPORT, PASS2, live QA).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
Module._load=function(request,parent,...rest){return request==='server-only'?{}:load.call(this,request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const lib=(f)=>require(path.join(root,'lib',f));
const read=(f)=>fs.readFileSync(path.join(root,f),'utf8');

// ── Country switch (live QA #12/#16/#18) ─────────────────────────────────
const cs=lib('country-switch.ts');
const base={monthlyIncome:'50000',fixedExpenses:'20000',variableExpenses:'',annualGrossSalary:'',annualBusinessIncome:'',extraIncomeAnnualTax:'',savingsBalance:'100000',efundBalance:'',efundTarget:'',cashAccounts:[{name:'SB',balance:'10000',apy:'3',kind:'savings'}],incomeStreams:[],loans:[{loan_type:'home_loan',bank:'HDFC',outstanding:'2000000',scheduled_emi:'18100',nominal_rate:'0.085'},{loan_type:'personal_loan',bank:'X',outstanding:'25000',scheduled_emi:'600',nominal_rate:'0.105',currency:'USD'}],fxRates:{}};

test('country switch converts income and spending instead of copying ₹ as $',()=>{
 const out=cs.convertForCountrySwitch(base,'IN','US',0.012,false);
 assert.equal(out.monthlyIncome,'600');assert.equal(out.fixedExpenses,'240');assert.equal(out.savingsBalance,'1200');
 assert.equal(out.cashAccounts[0].balance,'120');assert.equal(out.variableExpenses,'');
 assert.equal(out.loans[0].outstanding,'24000');assert.equal(out.loans[0].scheduled_emi,'217.20');assert.equal(out.loans[0].currency,undefined);
 // A loan already in dollars is now in the home currency: untagged, unchanged.
 assert.equal(out.loans[1].outstanding,'25000');assert.equal(out.loans[1].currency,undefined);
});
test('country switch can keep existing loans in rupees, tagged, with the rate saved',()=>{
 const out=cs.convertForCountrySwitch(base,'IN','US',0.012,true);
 assert.equal(out.loans[0].outstanding,'2000000');assert.equal(out.loans[0].currency,'INR');assert.equal(out.fxRates.INR,'0.012');
 assert.equal(out.monthlyIncome,'600');
});
test('country switch refuses a missing or silly rate and is a no-op for the same currency',()=>{
 assert.throws(()=>cs.convertForCountrySwitch(base,'IN','US',0,false));
 assert.throws(()=>cs.convertForCountrySwitch(base,'IN','US',NaN,false));
 assert.equal(cs.convertForCountrySwitch(base,'IN','IN',0,false),base);
 assert.equal(cs.validSwitchRate(83),true);assert.equal(cs.validSwitchRate(-1),false);
 assert.equal(cs.hasAmountsInCurrency(base,'IN'),true);assert.equal(cs.loansInHomeCurrency(base.loans,'IN'),1);
 assert.equal(cs.convertAmount('',2),'');assert.equal(cs.convertAmount('10.5',2),'21');
});

// ── Wake-up progress (BUG-6/BUG-7) ───────────────────────────────────────
const wp=lib('wake-progress.ts');
test('wake-up hint stays hidden for a quick reply, then counts up and holds below 100%',()=>{
 assert.equal(wp.wakeProgress(1000).show,false);
 const mid=wp.wakeProgress(30000,'send');
 assert.equal(mid.show,true);assert.equal(mid.seconds,30);assert.equal(mid.pct,50);assert.match(mid.message,/send your code/);assert.match(mid.message,/30s/);
 const late=wp.wakeProgress(120000,'verify');
 assert.equal(late.pct,95);assert.match(late.message,/Still waking up/);assert.match(late.message,/check your code/);
 assert.equal(wp.wakeProgress(-5).show,false);
 assert.ok(wp.RESEND_COOLDOWN_S>0);
});

// ── Safe redirect after sign-in (M4) ─────────────────────────────────────
const {safeRedirect}=lib('safe-redirect.ts');
test('post-login redirect keeps same-origin paths and refuses every off-site trick',()=>{
 const o='https://rightdue.app';
 assert.equal(safeRedirect('/plan?x=1#top',o),'/plan?x=1#top');
 for(const bad of ['/\t/evil.com','/\n/evil.com','//evil.com','/\\evil.com','https://evil.com','evil.com','',null,undefined,'/\u0000x'])
  assert.equal(safeRedirect(bad,o),'/',JSON.stringify(bad));
 assert.match(read('app/login/page.tsx'),/safeRedirect/);
});

// ── Tenure rules (live QA #27; API needs ≥3 months for new debt) ─────────
const tr=lib('tenure-rules.ts');
test('tenure rules refuse a one-month loan, fractions and absurd lengths',()=>{
 assert.match(tr.tenureError('personal_loan',1),/too short/);
 assert.match(tr.tenureError('credit_card','2'),/shortest is 3/);
 assert.equal(tr.tenureError('credit_card',3),null);
 assert.equal(tr.tenureError('home_loan',240),null);
 assert.match(tr.tenureError('home_loan',481),/more than 40 years/);
 assert.match(tr.tenureError('auto_loan','1.5'),/whole number/);
 assert.match(tr.tenureError('auto_loan',''),/Enter/);
 assert.equal(tr.tenureError('unknown_kind',3),null);
});

// ── Amount parsing (P2-21, live QA #23/#24) ──────────────────────────────
const am=lib('amount.ts');
test('amount parsing rejects negatives and huge values, and never stores exponent form',()=>{
 assert.equal(am.parseAmountText('25L').value,'2500000');
 assert.equal(am.parseAmountText('$250k','USD').value,'250000');
 assert.equal(am.parseAmountText('1,23,456.789').value,'123456.79');
 assert.match(am.parseAmountText('-100').error,/negative/);
 assert.match(am.parseAmountText('99999999999999999999999').error,/more than/);
 assert.equal(am.parseAmountText('99999999999999999999999').value,null);
 assert.equal(am.parseAmountText('1000000000000').value,'1000000000000');
 assert.doesNotMatch(am.parseAmountText('100000000000').value,/e/);
 assert.equal(am.isImmediateAmountError('-5',am.parseAmountText('-5')),true);
 assert.equal(am.isImmediateAmountError('12x',am.parseAmountText('12x')),false);
});

// ── Compact money at rounding boundaries (P2-21) ─────────────────────────
test('compact money picks its unit after rounding',()=>{
 const {formatCurrencyCompact:f}=lib('api.ts');
 assert.equal(f(99999.995,'INR'),'₹1.00L');assert.equal(f(999.995,'INR'),'₹1.0k');
 assert.equal(f(999.995,'USD'),'$1.0k');assert.equal(f(950,'USD'),'$950.00');assert.equal(f(99960,'INR'),'₹1.00L');
 assert.equal(f(99940,'INR'),'₹99.9k');assert.equal(f(1234567,'USD'),'$1.23M');assert.equal(f(-99999.995,'INR'),'−₹1.00L');
});

// ── Secure cookies (M9) ──────────────────────────────────────────────────
test('browser-set cookies get Secure on HTTPS only, once',()=>{
 const {withSecureFlag}=lib('secure-cookies.ts');
 assert.equal(withSecureFlag('a=1; path=/; SameSite=Lax','https:'),'a=1; path=/; SameSite=Lax; Secure');
 assert.equal(withSecureFlag('a=1; path=/; Secure','https:'),'a=1; path=/; Secure');
 assert.equal(withSecureFlag('a=1; path=/;','https:'),'a=1; path=/; Secure');
 assert.equal(withSecureFlag('a=1; path=/','http:'),'a=1; path=/');
 assert.equal(withSecureFlag('secure=1; path=/','https:'),'secure=1; path=/; Secure');
 assert.match(read('app/layout.tsx'),/<SecureCookies \/>/);
});
test('the cookie setter wrapper adds Secure in a browser on HTTPS',()=>{
 const jar=[];
 class Doc{} Object.defineProperty(Doc.prototype,'cookie',{configurable:true,enumerable:true,get(){return jar.join('; ')},set(v){jar.push(v)}});
 global.Document=Doc;global.document=new Doc();global.location={protocol:'https:'};
 try{
  const file=path.join(root,'lib/secure-cookies.ts');delete require.cache[require.resolve(file)];
  const m=require(file);assert.equal(m.installSecureCookieDefault(),true);
  document.cookie='x=1; path=/; SameSite=Lax';assert.equal(jar[0],'x=1; path=/; SameSite=Lax; Secure');
 }finally{delete global.Document;delete global.document;delete global.location}
});

// ── Session proxy: origin check (M6) and several Set-Cookie headers ─────
const ro=lib('request-origin.ts');
const H=(o)=>({get:(k)=>o[k.toLowerCase()]??null});
test('session proxy accepts the HTTPS origin behind a TLS-terminating proxy',()=>{
 const allowed=ro.allowedOrigins(undefined,H({host:'rightdue.app','x-forwarded-proto':'https'}),'http:','rightdue.app');
 assert.ok(ro.isAllowedOrigin('https://rightdue.app',allowed));
 assert.ok(!ro.isAllowedOrigin('https://evil.com',allowed));
 assert.ok(!ro.isAllowedOrigin(null,allowed));
});
test('WEB_ORIGIN may list several origins and replaces the guess',()=>{
 const allowed=ro.allowedOrigins('https://rightdue.app, https://finoptima-web.onrender.com/',H({host:'x'}),'http:','x');
 assert.deepEqual(allowed,['https://rightdue.app','https://finoptima-web.onrender.com']);
 assert.ok(ro.isAllowedOrigin('https://finoptima-web.onrender.com',allowed));
 assert.ok(!ro.isAllowedOrigin('http://x',allowed));
});
test('every upstream Set-Cookie is forwarded separately',()=>{
 const h=new Headers();h.append('Set-Cookie','a=1; Path=/; HttpOnly');h.append('Set-Cookie','b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT');
 assert.deepEqual(ro.setCookieHeaders(h),['a=1; Path=/; HttpOnly','b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT']);
 assert.deepEqual(ro.setCookieHeaders(new Headers()),[]);
 const route=read('app/api/session/[...path]/route.ts');
 assert.match(route,/setCookieHeaders\(upstream\.headers\)/);assert.match(route,/responseHeaders\.append\('Set-Cookie'/);
 assert.doesNotMatch(route,/headers\.get\('set-cookie'\)/);
});

// ── Server-side engine budget (M10) ──────────────────────────────────────
test('server-side engine runs are budgeted per requester',()=>{
 const {createMissBudget}=lib('server-engine-cache.ts');
 let t=0;const allow=createMissBudget(3,1000,()=>t);
 assert.equal(allow('a'),true);assert.equal(allow('a'),true);assert.equal(allow('a'),true);assert.equal(allow('a'),false);
 assert.equal(allow('b'),true);t=1500;assert.equal(allow('a'),true);
});

// ── Logout clears per-user browser data (P2-18) ──────────────────────────
test('sign-out clears the per-user keys outside the synced slices',()=>{
 const data=new Map([['rightdue_account_id','A'],['rightdue_set_aside','{}'],['rightdue_balances_entered','2026-10-01'],['rightdue_stale_snooze_until','x'],['rightdue_pending_sync_A','{"goals":[]}'],['rightdue_pending_sync_B','{}'],['other','keep']]);
 const ss=new Map([['rightdue_trail','[]'],['rightdue_debtfree_prompt_dismissed','1']]);
 const store=(m)=>({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]??null,get length(){return m.size}});
 global.localStorage=store(data);global.sessionStorage=store(ss);global.window={localStorage,dispatchEvent(){}};global.document={cookie:''};
 try{
  const file=path.join(root,'lib/server-sync.ts');delete require.cache[require.resolve(file)];
  const sync=require(file);sync.clearAccountCache();
  for(const k of ['rightdue_set_aside','rightdue_balances_entered','rightdue_stale_snooze_until'])assert.equal(data.has(k),false,k);
  assert.equal(ss.size,0);
  assert.equal(data.has('rightdue_pending_sync_A'),true,'kept until a successful sign-out');
  sync.clearPendingSync();
  assert.equal(data.has('rightdue_pending_sync_A'),false);assert.equal(data.has('rightdue_pending_sync_B'),false);assert.equal(data.get('other'),'keep');
  assert.match(read('lib/auth.ts'),/clearPendingSync\(\)/);
 }finally{delete global.localStorage;delete global.sessionStorage;delete global.window;delete global.document}
});

// ── Local "today" instead of UTC (P2-19) ─────────────────────────────────
test('no UTC date is used as today in the three places PASS2 named',()=>{
 for(const f of ['app/tools/loan-check/outcome.tsx','components/DecisionLogControls.tsx','lib/holdings.ts'])
  assert.doesNotMatch(read(f),/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/,f);
});

// ── Mixed ₹/$ rows and the stale card placeholder (QA #17/#19/#26) ──────
test('mixed-currency months say how they add up',()=>{
 assert.match(read('components/plan/PlanSchedule.tsx'),/TOTAL \(\$\{ccy\}\)/);
 const page=read('components/activity/ActivityPage.tsx');assert.match(page,/export function dueNote/);
 assert.match(profileSource(),/const currency = loanCurrency\(loan, country\);/);
});
