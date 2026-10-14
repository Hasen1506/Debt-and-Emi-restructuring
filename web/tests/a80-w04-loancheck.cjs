// Audit 80+ W4: Loan Check for the hike cycle (A11), the bridge to the plan
// and the amount-free share (A16), the public RBI-decision page (A19),
// unverified rate cards labelled (A21), and no floor rate quoted as the
// user's (E1).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const web=path.resolve(__dirname,'..'),root=path.join(web,'src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const hike=require(path.join(root,'lib/loan-check-hike.ts'));
const read=(p)=>fs.readFileSync(path.join(web,p),'utf8');

test('A16: the share text carries no amounts, rates, dates or lender',()=>{
 for(const where of ['loan-check','rbi-decision']){
  const t=hike.shareText(where);
  const words=t.replace(/https:\/\/\S+/,'');
  assert.doesNotMatch(words,/[₹%$]|\d/,`${where}: ${t}`);
  assert.match(t,/https:\/\/rightdue\.app\//);
  const href=hike.whatsappHref(t);
  assert.ok(href.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(href.slice('https://wa.me/?text='.length)),t);
 }
});

test('A16: a bridge line after every result, including no issue',()=>{
 assert.match(hike.bridgeLine({status:'no_issue',findings:[]}),/fine today/);
 assert.match(hike.bridgeLine({status:'not_applicable',findings:[]}),/fine today/);
 assert.doesNotMatch(hike.bridgeLine({status:'issues_found',findings:[]}),/fine/);
 assert.doesNotMatch(hike.bridgeLine({status:'no_issue',findings:[{kind:'choice_not_offered'}]}),/fine/);
 assert.equal(hike.PLAN_HREF,'/onboarding?from=loan-check');
 const tool=read('src/app/tools/loan-check/tool.tsx');
 // Rendered for any result, not only for claims.
 assert.match(tool,/\{result && <PlanBridge r=\{result\} \/>\}/);
});

test('A11c: rate history rows become fractions, and bad rows are named',()=>{
 assert.deepEqual(hike.historyToRequest([{month:'2025-03',rate:'8.40'},{month:'',rate:''}]),{history:[{month:'2025-03',rate:'0.084'}],error:null});
 assert.match(hike.historyToRequest([{month:'',rate:'8.4'}]).error,/Row 1: pick the month/);
 assert.match(hike.historyToRequest([{month:'2025-03',rate:'abc'}]).error,/Row 1/);
});

test('A11a: the EMI-or-tenure rows say both choices, and when the tenure choice is not allowed',()=>{
 const im={rate_before:'0.079',rate_after:'0.0815',outstanding:'5000000',emi_before:'41511',months_before:240,interest_before:'4962727',emi_after:'42290',emi_change:'779',interest_emi_option:'5149594',months_after:252,months_change:12,interest_tenure_option:'5450490',tenure_option_possible:true,prepay_to_keep_both:'92057',tenure_premium:'300896'};
 const rows=hike.impactRows(im);
 assert.equal(rows.length,3);
 assert.match(rows[0].monthly,/₹42,290 \(\+₹779\)/);
 assert.match(rows[1].months,/252 left \(\+12\)/);
 assert.match(rows[1].interest,/\+₹4,87,763/);
 assert.match(rows[2].option,/Prepay ₹92,057/);
 const no={...im,tenure_option_possible:false,months_after:null,months_change:null,interest_tenure_option:null,tenure_premium:null};
 assert.equal(hike.impactRows(no)[1].monthly,'Not allowed');
});

test('A11: the pitch is the hike cycle everywhere Loan Check is sold',()=>{
 const tools=read('src/lib/tools.ts'), welcome=read('public/welcome.html'), page=read('src/app/tools/loan-check/page.tsx');
 for(const [name,s] of [['tools.ts',tools],['welcome.html',welcome],['page.tsx',page]]){
  assert.doesNotMatch(s,/passing on (RBI )?rate cuts/i,name);
 }
 assert.match(tools,/Rate up: what happens to my EMI\?/);
 assert.match(welcome,/Rate up: what happens to my EMI\?/);
});

test('A19: /rbi-decision is public, in the sitemap, and shows scenarios, never odds',()=>{
 assert.match(read('src/middleware.ts'),/pathname === '\/rbi-decision'/);
 assert.match(read('src/lib/site.ts'),/'\/rbi-decision'/);
 const tool=read('src/app/rbi-decision/tool.tsx');
 assert.match(tool,/PLAN_HREF_MPC/);
 assert.match(tool,/Scenarios, not a forecast/);
 assert.doesNotMatch(tool,/polymarket|kalshi|odds|probabilit/i);
});

test('A21: an unverified rate card is labelled and never offered as click-to-fill',()=>{
 const hint=read('src/components/RateRangeHint.tsx');
 assert.match(hint,/typical, unverified/);
 assert.match(hint,/!unverified && !showPosition/);
 assert.doesNotMatch(hint,/verified \{RATE_CARDS_AS_OF\}/);
});

test('E1: Home "Cheaper rates" shows the range and no "up to" headline',()=>{
 const home=read('src/components/home/HomeRestructure.tsx');
 assert.doesNotMatch(home,/UP TO \{/);
 assert.match(home,/<RangeLine o=\{o\} fc=\{fc\} \/>/);
 assert.match(home,/this uses the middle/);
});
