const ts=require('typescript');const fs=require('fs');const path=require('path');
const [src,out]=process.argv.slice(2);
for(const f of ['design-canvas.jsx','ledger-skin-home.jsx','ledger-skin-rest.jsx','ledger-skin-v2.jsx','ledger-skin-v2-screens.jsx']){
 const code=fs.readFileSync(path.join(src,f),'utf8');
 const r=ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2019,module:ts.ModuleKind.None}});
 fs.writeFileSync(path.join(out,f.replace('.jsx','.js')),r.outputText);
}
fs.copyFileSync(path.join(src,'app-content.js'),path.join(out,'app-content.js'));
