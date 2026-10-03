const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {api}=require(path.join(root,'lib/api.ts'));
test('a plain hosting 429 gives a useful sign-in message, without retrying an email mutation',async()=>{
 const previous=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response('Too Many Requests\n',{status:429})};
 try{await assert.rejects(api.requestOtp('test@example.com'),/Wait a minute and try again/);assert.equal(calls,1)}finally{global.fetch=previous}
});
test('OTP verification shows the server explanation without raw JSON or API paths',async()=>{
 const previous=global.fetch;global.fetch=async()=>Response.json({detail:'That code has expired.'},{status:400});
 try{await assert.rejects(api.verifyOtp('test@example.com','123456'),e=>e.message==='That code has expired.')}finally{global.fetch=previous}
});
test('sign-in honors Retry-After and hides an upstream failure body',()=>{
 const {authErrorMessage}=require(path.join(root,'lib/auth-error.ts'));
 assert.match(authErrorMessage(429,'unknown','30'),/Wait 30 seconds/);
 assert.doesNotMatch(authErrorMessage(503,'private upstream error',null),/private|503|api/);
 assert.match(authErrorMessage(429,'unknown','invalid'),/Wait a minute/);
});
