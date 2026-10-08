// Honesty regressions (8 Oct 2026 audit, R1 and R8).
// RightDue's plans come from the engine and the user's own numbers. No person
// reviews them, so the product must never say they are professionally reviewed,
// and invest-vs-prepay must say it is not investment advice.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const web=path.resolve(__dirname,'..'),root=path.join(web,'src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);

// Phrases that would claim human or professional review of the output.
const FALSE_REVIEW=[/reviewed by (qualified|certified|licensed|registered)?\s*(professionals?|experts?|advisers?|advisors?|humans?|people)/i,/qualified professionals?/i,/(expert|professional|human)[- ]reviewed/i,/vetted by/i];

function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name.startsWith('.'))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else if(/\.(html|tsx?|md|json|txt)$/.test(e.name))out.push(p)}return out}

test('no user-facing copy claims recommendations are reviewed by professionals',()=>{
 const files=[...walk(path.join(web,'public')),...walk(root)];
 const hits=[];
 for(const f of files){const s=fs.readFileSync(f,'utf8');for(const re of FALSE_REVIEW)if(re.test(s))hits.push(`${path.relative(web,f)}: ${re}`)}
 assert.deepEqual(hits,[]);
});

test('landing page says plans are automatic estimates, not financial advice',()=>{
 const html=fs.readFileSync(path.join(web,'public/welcome.html'),'utf8');
 assert.match(html,/generated automatically by RightDue's engine/);
 assert.match(html,/not financial advice/);
 assert.match(html,/Invest or prepay\?[\s\S]*?not investment advice/);
});

test('invest-vs-prepay page renders a not-investment-advice line',()=>{
 const {INVEST_VS_PREPAY_DISCLAIMER}=require(path.join(root,'lib/disclaimers.ts'));
 assert.match(INVEST_VS_PREPAY_DISCLAIMER,/not investment advice/i);
 for(const re of FALSE_REVIEW)assert.doesNotMatch(INVEST_VS_PREPAY_DISCLAIMER,re);
 const page=fs.readFileSync(path.join(root,'app/tools/invest-vs-prepay/page.tsx'),'utf8');
 const out=ts.transpileModule(page,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 // The disclaimer is rendered as a child of the page, not only imported.
 assert.match(out,/children:\s*\[[\s\S]*InvestVsPrepayDeepTool[\s\S]*INVEST_VS_PREPAY_DISCLAIMER/);
});
