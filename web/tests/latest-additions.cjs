const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),test=require('node:test');
const root=path.resolve(__dirname,'../src'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);

test('editing assets retains tracked holdings and a failed save keeps the user on the form',()=>{
 const load=Module._load,states=[],effects=[],pushes=[];let index=0,saved,allowSave=false;
 const asset={asset_type:'equity_stocks',label:'Shares',purchase_price:'1000',current_market_value:'2000',purchase_date:'2020-01-02',ticker:'AAPL',quantity:'10',last_price:'200',last_price_at:'2026-10-02',price_currency:'USD',fx_to_user:'85',fx_as_of:'2026-10-01',appreciation_cagr:'.1'};
 const profile={isLive:true,user:{country:'IN',loans:[],assets:[asset]}};
 Module._load=function(request,parent,...rest){
  if(request==='react')return {...load.call(this,request,parent,...rest),useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect(fn){effects.push(fn)}};
  if(request==='next/navigation')return {useRouter:()=>({push:p=>pushes.push(p)})};
  if(request==='@/lib/user-store')return {loadProfileClient:()=>profile,saveProfileClient:p=>{saved=p;return allowSave}};
  return load.call(this,request,parent,...rest);
 };
 try{
  const file=path.join(root,'app/profile/assets/page.tsx');delete require.cache[require.resolve(file)];const Page=require(file).default;
  const render=()=>{index=0;return Page()};render();effects.splice(0).forEach(fn=>fn());let tree=render();
  function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children)]:[]}
  const save=flatten(tree).find(n=>n.type==='button'&&n.props.children==='SAVE · BACK TO PORTFOLIO');assert.ok(save);save.props.onClick();
  assert.deepEqual(saved.user.assets[0],asset);assert.deepEqual(pushes,[]);tree=render();assert.ok(flatten(tree).some(n=>n.props?.role==='alert'));
  allowSave=true;flatten(tree).find(n=>n.type==='button'&&n.props.children==='SAVE · BACK TO PORTFOLIO').props.onClick();assert.deepEqual(pushes,['/portfolio']);
 }finally{Module._load=load}
});

test('queued saves from the previous account never reach the newly signed-in account',async()=>{
 const data=new Map([['finoptima_account_id','A']]);global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};const original=global.fetch;let release,started;const entered=new Promise(r=>started=r),seen=[];
 global.fetch=async(url,opts)=>{seen.push(JSON.parse(opts.body).data);if(seen.length===1){started();await new Promise(r=>release=r)}return Response.json({data:{}})};
 try{const sync=require(path.join(root,'lib/server-sync.ts'));const first=sync.syncSliceToServer('goals',[{id:'A-first'}]);await entered;const queued=sync.syncSliceToServer('profile',{user:'A-private'});data.set('finoptima_account_id','B');release();await Promise.all([first,queued]);assert.deepEqual(seen,[{goals:[{id:'A-first'}]}]);await sync.syncSliceToServer('strategy','snowball');assert.deepEqual(seen[1],{strategy:'snowball'});}
 finally{global.fetch=original;delete global.localStorage}
});
