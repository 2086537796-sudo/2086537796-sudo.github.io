// v1.0.23 回归测试：重做自动回流 + 旧套退役 + 防重不变量
// 跑真实 master.html 代码（vm + stub），断言 4 个待重做自动派回原账号、旧套不回队、无重复。
// 用法：node test-v1023-redo.js   （退出码 0 = 全部通过）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf-8'));
const MASTER_JS = fs.readFileSync(path.join(DIR, 'master.html'), 'utf-8').match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b }); }

function makeStorage(initial) {
  const store = Object.assign({}, initial || {});
  return {
    _store: store,
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
}
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], style: {},
    classList: { _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); if (f) this._s.add(c); else this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); } },
    _listeners: {},
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach(c => this.children.push(c)); },
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl('div'); }, querySelectorAll() { return []; },
    click() {}, focus() {}, select() {},
    textContent: '', hidden: false, value: '', disabled: false, checked: false,
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', { get() { return _html; }, set(v) { _html = String(v); el.children = []; }, configurable: true });
  return el;
}
function makeContext({ url, storage }) {
  const u = new URL(url);
  const byId = {};
  const documentStub = {
    _byId: byId,
    getElementById(id) { if (!byId[id]) byId[id] = makeEl('div'); return byId[id]; },
    createElement(tag) { return makeEl(tag); },
    createTextNode(t) { return { textContent: String(t), nodeType: 3 }; },
    querySelector(sel) { if (!byId['qs:' + sel]) byId['qs:' + sel] = makeEl('div'); return byId['qs:' + sel]; },
    querySelectorAll() { return []; },
    body: makeEl('body'),
  };
  const ctx = {
    console, setTimeout, clearTimeout, URL, URLSearchParams,
    encodeURI, decodeURI, JSON, Math, Date, RegExp, Array, Object, Set, Map, Promise,
    location: { origin: u.origin, pathname: u.pathname, href: u.href, search: u.search },
    history: { replaceState() {} }, navigator: {},
    confirm: () => true, alert() {},
    fetch: () => Promise.resolve({ ok: true, json: async () => PRODUCTS }),
    localStorage: storage, document: documentStub, scrollTo() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

async function main() {
  console.log('== v1.0.23 重做自动回流 ==');
  // 场景：手机 6 号待重做 Dowinx 24 / 柴火炉 16 / AOPO 40，手机 4 号待重做 GEYOTO 64；
  // 新版 157/155/145/138 已入池；旧套 112/24/16/40/64 已退役。
  const redoSeed = [
    { pid: '1732306620069417457', account: 6, set_no: 24, title_cn: 'Dowinx', time: 1, note: '', status: 'pending', reasons: [] },
    { pid: '1731285269014548765', account: 6, set_no: 16, title_cn: '柴火炉', time: 1, note: '', status: 'pending', reasons: [] },
    { pid: '1731671632272986911', account: 6, set_no: 40, title_cn: 'AOPO', time: 1, note: '', status: 'pending', reasons: [] },
    { pid: '1732406997809468385', account: 4, set_no: 64, title_cn: 'GEYOTO', time: 1, note: '', status: 'pending', reasons: [] },
  ];
  const storage = makeStorage({
    paidang_redo: JSON.stringify(redoSeed),
    paidang_auto_q_a6: JSON.stringify([130, 129, 151, 150, 152, 113, 112]),
    paidang_auto_q_a4: JSON.stringify([267, 250, 161, 160, 148, 147, 81, 80]),
    paidang_auto_q_a1: JSON.stringify([134, 125, 124]),
    paidang_auto_q_a2: JSON.stringify([268, 232, 198]),
    paidang_auto_q_a3: JSON.stringify([144, 143, 72]),
    paidang_auto_q_a5: JSON.stringify([127, 126, 75]),
    paidang_auto_q_a7: JSON.stringify([96, 95, 74]),
    paidang_auto_q_a8: JSON.stringify([88, 87, 60]),
  });
  const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
  vm.runInContext(MASTER_JS, ctx);
  await new Promise(r => setTimeout(r, 200)); // 等 products.json + sent.json 两段 fetch 跑完

  const q = ctx.computeAutoQueues();
  const all = Object.values(q).flat();
  const pidOf = n => { const p = PRODUCTS.find(x => x.set_no === n); return p ? String(p.pid) : null; };

  // 1. 新版派回原账号队首
  eq(q['6'].slice(0, 3), [157, 155, 145], '6 号队首是三套重做新版 157/155/145');
  eq(q['4'][0], 138, '4 号队首是 GEYOTO 重做 138');
  // 2. 旧套（已退役）不在任何队里
  [112, 24, 16, 40, 64].forEach(n => ok(!all.includes(n), '旧套 ' + n + ' 不在任何队里', all.filter(x => [112, 24, 16, 40, 64].includes(x))));
  // 3. 112 已退役；152 与 113 是同品两套（GNC W22），按新规矩必须分到不同号
  const acctOf = n => Object.keys(q).find(id => q[id].includes(n));
  ok(!all.includes(112) && acctOf(152) && acctOf(113) && acctOf(152) !== acctOf(113), '112 退役；152 与 113（同品两套）分到不同号', { '152': acctOf(152), '113': acctOf(113) });
  // 4. redoList 四条都变 returned
  const rl = JSON.parse(storage.getItem('paidang_redo'));
  ok(rl.every(r => r.status === 'returned'), '四条重做都自动标成 returned', rl.map(r => r.status));
  // 5. 全局不变量：同一套只在一队；一品分号——同一号队里绝不能有同一 pid 的两套（爆品除外）
  //    （2026-11-22 新规矩，取代旧的“同一 pid 只在一队”）
  ok(new Set(all).size === all.length, '同一套只出现在一队', all.length + ' vs ' + new Set(all).size);
  const pidAccts = {};
  Object.keys(q).forEach(id => q[id].forEach(n => { const pid = pidOf(n); (pidAccts[pid] = pidAccts[pid] || new Set()).add(id); }));
  const hotPids = new Set(PRODUCTS.filter(p => p.hot).map(p => String(p.pid)));
  const dupInAcct = Object.keys(q).filter(id => {
    const pids = q[id].map(n => pidOf(n));
    return new Set(pids).size !== pids.length;
  });
  ok(dupInAcct.length === 0, '一品分号：同一号队里没有同一 pid 的两套', dupInAcct);
  const split = Object.keys(pidAccts).filter(pid => !hotPids.has(pid) && pidAccts[pid].size > 1);
  ok(split.length > 0, '一品分号：同品两套确实分到了不同号', split.length + ' 个 pid 分号');
  // 6. 重做新版不在别的号队里
  [157, 155, 145].forEach(n => ok(!Object.keys(q).some(id => id !== '6' && q[id].includes(n)), '新版 ' + n + ' 只在 6 号队'));
  ok(!Object.keys(q).some(id => id !== '4' && q[id].includes(138)), '新版 138 只在 4 号队');
  // 7. 第二次算队仍稳定（returned 不翻回 pending、不重复插队）
  const q2 = ctx.computeAutoQueues();
  eq(q2['6'].slice(0, 3), [157, 155, 145], '第二次算队：6 号队首仍是 157/155/145');
  eq(q2['4'][0], 138, '第二次算队：4 号队首仍是 138');
  eq(Object.values(q2).flat().length, all.length, '第二次算队：总套数不变（无重复插入）');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
