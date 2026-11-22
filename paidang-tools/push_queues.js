// 按真实启动链模拟总包 v1.0.27（localStorage 预置 Firebase 队 + 旧格式 doneMap + 待重做），
// 跑 computeAutoQueues()，把算出的队直接推回 Firebase queue/acctN.json，并校验。
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = __dirname;
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf-8'));
const MASTER_JS = fs.readFileSync(path.join(DIR, 'master.html'), 'utf-8').match(/<script>([\s\S]*?)<\/script>/)[1];
const https = require('https');
const FB = 'https://paidang-sync-default-rtdb.firebaseio.com/paidang';
function get(p){return new Promise((res,rej)=>{https.get(FB+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){res(null)}})}).on('error',rej)})}
function put(p, obj){return new Promise((res,rej)=>{
  const body = JSON.stringify(obj);
  const req = https.request(FB+p, {method:'PUT', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, r=>{
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({status:r.statusCode, body:d}));
  });
  req.on('error',rej); req.write(body); req.end();
})}
function makeStorage(initial){const store=Object.assign({},initial||{});return{getItem(k){return k in store?store[k]:null},setItem(k,v){store[k]=String(v)},removeItem(k){delete store[k]},clear(){for(const k of Object.keys(store))delete store[k]}}}
function makeEl(tag){const el={tagName:(tag||'div').toUpperCase(),children:[],style:{},classList:{_s:new Set(),add(...c){c.forEach(x=>this._s.add(x))},remove(...c){c.forEach(x=>this._s.delete(x))},toggle(c,f){if(f===undefined)f=!this._s.has(c);if(f)this._s.add(c);else this._s.delete(c);return f},contains(c){return this._s.has(c)}},_listeners:{},addEventListener(ev,fn){(this._listeners[ev]=this._listeners[ev]||[]).push(fn)},removeEventListener(){},appendChild(c){this.children.push(c);return c},append(...cs){cs.forEach(c=>this.children.push(c))},setAttribute(){},getAttribute(){return null},querySelector(){return makeEl('div')},querySelectorAll(){return[]},click(){},focus(){},select(){},textContent:'',hidden:false,value:'',disabled:false,checked:false};let _h='';Object.defineProperty(el,'innerHTML',{get(){return _h},set(v){_h=String(v);el.children=[]},configurable:true});return el}
async function main(){
  const seeds={}; const doneMap={}; const redoList=[];
  const beforeQ = {};
  for(let n=1;n<=8;n++){
    const q=await get('/queue/acct'+n+'.json');
    beforeQ[n] = (q&&q.q)||[];
    seeds['paidang_auto_q_a'+n]=JSON.stringify(beforeQ[n]);
    const st=await get('/acct'+n+'.json')||{done:[],redos:[]};
    (st.done||[]).forEach(d=>{const pid=String(d.pid||d); if(!doneMap[pid]) doneMap[pid]={account:n,time:1};});
    (st.redos||[]).forEach(r=>{redoList.push({pid:String(r.pid),account:n,set_no:r.set_no||null,title_cn:'',time:1,note:'',status:'pending',reasons:r.reasons||[]});});
  }
  seeds['paidang_done']=JSON.stringify(doneMap);
  seeds['paidang_redo']=JSON.stringify(redoList);
  console.log('预置旧done:',Object.keys(doneMap).length,'条; 待重做:',redoList.length,'条');
  const storage=makeStorage(seeds);
  const ctx={console,setTimeout,clearTimeout,URL,URLSearchParams,encodeURI,decodeURI,JSON,Math,Date,RegExp,Array,Object,Set,Map,Promise,location:{origin:'https://example.com',pathname:'/paidang/master.html',href:'https://example.com/paidang/master.html',search:''},history:{replaceState(){}},navigator:{},confirm:()=>true,alert(){},fetch:()=>Promise.resolve({ok:true,json:async()=>PRODUCTS}),localStorage:storage,document:{_byId:{},getElementById(id){if(!this._byId[id])this._byId[id]=makeEl('div');return this._byId[id]},createElement(t){return makeEl(t)},createTextNode(t){return{textContent:String(t),nodeType:3}},querySelector(s){if(!this._byId['qs:'+s])this._byId['qs:'+s]=makeEl('div');return this._byId['qs:'+s]},querySelectorAll(){return[]},body:makeEl('body')},scrollTo(){}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(MASTER_JS,ctx);
  await new Promise(r=>setTimeout(r,800));
  const q=ctx.computeAutoQueues();
  const pidOf=n=>{const p=PRODUCTS.find(x=>x.set_no===n);return p?String(p.pid):null};
  const hot=new Set(PRODUCTS.filter(p=>p.hot).map(p=>String(p.pid)));
  let bad=[];
  Object.keys(q).forEach(id=>{const ps=q[id].map(pidOf).filter(p=>!hot.has(p));if(new Set(ps).size!==ps.length)bad.push(id)});
  console.log('算出各号队：');
  Object.keys(q).sort((a,b)=>a-b).forEach(id=>console.log('  '+id+'号 ['+q[id].join(',')+']'));
  console.log('同号同品残留:',bad.length?bad:'无');
  console.log('总套数:',Object.values(q).flat().length);
  if (bad.length) { console.error('有同号同品残留，拒绝推送'); process.exit(3); }
  // 推送到 Firebase（串行，避免冲突）
  const now = Date.now();
  for (const id of Object.keys(q).sort((a,b)=>a-b)) {
    const r = await put('/queue/acct'+id+'.json', {q: q[id], updated: now});
    console.log('推送 acct'+id+': HTTP '+r.status+' 队'+q[id].length+'套（之前'+beforeQ[id].length+'套）');
    if (r.status !== 200) { console.error('推送失败 acct'+id, r.body); process.exit(4); }
  }
  // 校验：重读 Firebase
  console.log('--- 校验重读 ---');
  let ok = true, total = 0;
  for (let n=1;n<=8;n++) {
    const qq = await get('/queue/acct'+n+'.json');
    const got = (qq&&qq.q)||[];
    total += got.length;
    const want = q[String(n)];
    const match = JSON.stringify(got)===JSON.stringify(want);
    if (!match) { ok=false; console.log('acct'+n+' 不一致！Firebase:['+got.join(',')+'] 期望:['+want.join(',')+']'); }
    else console.log('acct'+n+' ✓ '+got.length+'套');
  }
  console.log('校验总套数:', total, ok?'全部一致':'有不一致');
  if (!ok) process.exit(5);
}
main().catch(e=>{console.error(e);process.exit(2)});
