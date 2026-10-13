// Loan Check screen helpers (Sprint G5): live-test L#7 (gap in words),
// L#8 / L#10 (lender picker: name and type, never a silent guess),
// L#9 (spread change input).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const web=path.resolve(__dirname,'..'),root=path.join(web,'src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const Decimal=require('decimal.js');
const lc=require(path.join(root,'lib/loan-check.ts'));

const LIST=[
 {id:'IN_SBI',name:'SBI',type:'commercial_bank',has_rate_card:true,rule_applies:true},
 {id:'IN_HFC_LICHFL',name:'LIC Housing Finance',type:'hfc',has_rate_card:false,rule_applies:false},
];

test('L#7: the gap is said in words, never only as a minus sign',()=>{
 assert.equal(lc.gapWords(new Decimal('-0.015')),'1.50% below');
 assert.equal(lc.gapWords(new Decimal('0.0075')),'0.75% above');
 assert.equal(lc.gapWords(new Decimal('0.0002')),'none');
});

test('L#10: a listed lender brings its type; another lender must state one',()=>{
 assert.deepEqual(lc.resolveChoice({pick:'SBI',otherName:'',otherType:''},LIST),{lender:'SBI',lender_type:'commercial_bank'});
 assert.deepEqual(lc.resolveChoice({pick:'LIC Housing Finance',otherName:'',otherType:''},LIST),{lender:'LIC Housing Finance',lender_type:'hfc'});
 assert.equal(lc.resolveChoice(lc.EMPTY_CHOICE,LIST).missing,'your lender');
 assert.equal(lc.resolveChoice({pick:lc.OTHER,otherName:'My Co-op',otherType:''},LIST).missing,'what kind of lender it is');
 assert.deepEqual(lc.resolveChoice({pick:lc.OTHER,otherName:'My Co-op',otherType:'cooperative_bank'},LIST),{lender:'My Co-op',lender_type:'cooperative_bank'});
});

test('L#8: a saved loan name picks the listed lender, or "another" with no guessed type',()=>{
 assert.equal(lc.choiceFromName('sbi',LIST).pick,'SBI');
 const other=lc.choiceFromName('Some Bank I Typed',LIST);
 assert.equal(other.pick,lc.OTHER); assert.equal(other.otherName,'Some Bank I Typed'); assert.equal(other.otherType,'');
});

test('L#9: spread change in points becomes a signed fraction',()=>{
 assert.deepEqual(lc.parseSpreadChange('+0.25'),{fraction:'0.0025',error:null});
 assert.deepEqual(lc.parseSpreadChange('−0.10'),{fraction:'-0.001',error:null});
 assert.match(lc.parseSpreadChange('abc').error,/points like/);
 assert.match(lc.parseSpreadChange('25').error,/not plausible/);
});

test('L#28 and #54: the screen frames ₹ figures as estimates and letters as drafts',()=>{
 const tool=fs.readFileSync(path.join(root,'app/tools/loan-check/tool.tsx'),'utf8');
 assert.match(tool,/not a confirmed refund/);
 assert.doesNotMatch(tool,/Worth a conversation with your bank/);
 assert.doesNotMatch(tool,/Your bank owes you/);
 const complaint=fs.readFileSync(path.join(root,'app/tools/loan-check/complaint.tsx'),'utf8');
 assert.match(complaint,/locked=\{!allTicked\}/);
 assert.match(complaint,/draft_notice/);
});
