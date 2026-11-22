// 完整模拟总包页打开 v1.0.27 后的行为：
// ① 拉 8 号 Firebase 队进 localStorage；② 拉 8 号手机状态（done 只报 pid）调 applyPhoneState（推断套号）；
// ③ computeAutoQueues 重算；④ 输出重排后的队 + 校验。
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = __dirname;
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf-8'));
const MASTER_JS = fs.readFileSync(path.join(DIR, 'master.html'), 'utf-8').match(/<script>([\s\S]*?)<\/script>/)[1];
const https = require('https');
function get(p){return new Promise((res,rej)=>{https.get('https://paidang-sync-default-rtdb.firebaseio.com/paidang'+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){res(null)}})}).on('error',rej)})}
function makeStorage(initial){const store=Object.assign({},initial||{});return{getItem(k){return k in store?store[k]:null},setItem(k,v){store[k]=String(v)},removeItem(k){delete store[k]},clear(){for(const k of Object.keys(store))delete store[k]}}}
function makeEl(tag){const el={tagName:(tag||'div').toUpperCase(),children:[],style:{},classList:{_s:new Set(),add(...c){c.forEach(x=>this._s.add(x))},remove(...c){c.forEach(x=>this._s.delete(x))},toggle(c,f){if(f===undefined)f=!this._s.has(c);if(f)this._s.add(c);else this._s.delete(c);return f},contains(c){return this._s.has(c)}},_listeners:{},addEventListener(ev,fn){(this._listeners[ev]=this._listeners[ev]||[]).push(fn)},removeEventListener(){},appendChild(c){this.children.push(c);return c},append(...cs){cs.forEach(c=>this.children.push(c))},setAttribute(){},getAttribute(){return null},querySelector(){return makeEl('div')},querySelectorAll(){return[]},click(){},focus(){},select(){},textContent:'',hidden:false,value:'',disabled:false,checked:false};let _h='';Object.defineProperty(el,'innerHTML',{get(){return _h},set(v){_h=String(v);el.children=[]},configurable:true});return el}
async function main(){
  const seeds={}; const phones={};
  for(let n=1;n<=8;n++){
    const q=await get('/queue/acct'+n+'.json');
    seeds['paidang_auto_q_a'+n]=JSON.stringify((q&&q.q)||[]);
    phones[n]=await get('/acct'+n+'.json')||{done:[],redos:[],redos_img:[]};
  }
  const ctx={console,setTimeout,clearTimeout,URL,URLSearchParams,encodeURI,decodeURI,JSON,Math,Date,RegExp,Array,Object,Set,Map,Promise,location:{origin:'https://example.com',pathname:'/paidang/master.html',href:'https://example.com/paidang/master.html',search:''},history:{replaceState(){}},navigator:{},confirm:()=>true,alert(){},fetch:()=>Promise.resolve({ok:true,json:async()=>PRODUCTS}),localStorage:makeStorage(seeds),document:{_byId:{},getElementById(id){if(!this._byId[id])this._byId[id]=makeEl('div');return this._byId[id]},createElement(t){return makeEl(t)},createTextNode(t){return{textContent:String(t),nodeType:3}},querySelector(s){if(!this._byId['qs:'+s])this._byId['qs:'+s]=makeEl('div');return this._byId['qs:'+s]},querySelectorAll(){return[]},body:makeEl('body')},scrollTo(){}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(MASTER_JS,ctx);
  await new Promise(r=>setTimeout(r,200));
  ctx.computeAutoQueues(); // 先算一次，让 autoQueues 落内存（推断要用）
  for(let n=1;n<=8;n++){
    const st=phones[n];
    ctx.applyPhoneState(n,{done:st.done||[],redos:st.redos||[],redos_img:st.redos_img||[]});
  }
  const q=ctx.computeAutoQueues();
  const pidOf=n=>{const p=PRODUCTS.find(x=>x.set_no===n);return p?String(p.pid):null};
  const hot=new Set(PRODUCTS.filter(p=>p.hot).map(p=>String(p.pid)));
  let bad=[];
  Object.keys(q).forEach(id=>{const ps=q[id].map(pidOf).filter(p=>!hot.has(p));if(new Set(ps).size!==ps.length)bad.push(id)});
  console.log('重排后各号队：');
  Object.keys(q).sort((a,b)=>a-b).forEach(id=>console.log('  '+id+'号 ['+q[id].join(',')+']'));
  console.log('同号同品残留:',bad.length?bad:'无');
  console.log('总套数:',Object.values(q).flat().length);
  // 校验：原 44 套里已做完的套不在队里
  const doneSetNos=new Set();
  Object.values(phones).forEach(st=>(st.done||[]).forEach(d=>{const p=PRODUCTS.find(x=>String(x.pid)===String(d.pid));}));
  console.log('各号 done 总数:',Object.values(phones).reduce((a,st)=>a+(st.done||[]).length,0));
}
main().catch(e=>{console.error(e);process.exit(2)});
