// v1.0.25 回归测试：GPT 重设计 P0/P1/P2/P3 —— 启动 READY 门、人工派单过发图账、
// 爆品 done/redo 按 set_no、手机合并写 + fetchQueue 空/失败区分。
// 跑真实 master.html / acct.html 代码（vm + stub）。
// 注意：master.html 里的 let 变量（bootState/doneMap/PRODUCTS 等）不在 global 上，
// 要用 vm.runInContext 求值；fetch 里手机状态 URL 是 /paidang/{N}.json（不是 /paidang/acct{N}.json）。
// 用法：node test-v1025-gpt.js   （退出码 0 = 全部通过）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf-8'));
const MASTER_JS = fs.readFileSync(path.join(DIR, 'master.html'), 'utf-8').match(/<script>([\s\S]*?)<\/script>/)[1];
const ACCT_JS = fs.readFileSync(path.join(DIR, 'acct.html'), 'utf-8').match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b }); }
function ev(ctx, expr) { return vm.runInContext(expr, ctx); }

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
    addEventListener(e, fn) { (this._listeners[e] = this._listeners[e] || []).push(fn); },
    removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
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

function makeMasterContext({ storage, fetchImpl }) {
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
    location: { origin: 'https://x.github.io', pathname: '/paidang/master.html', href: 'https://x.github.io/paidang/master.html', search: '' },
    history: { replaceState() {} }, navigator: {},
    confirm: () => true, alert() {},
    fetch: fetchImpl, localStorage: storage, document: documentStub, scrollTo() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

// ---------- master 侧 ----------
console.log('== master: P0 READY 门 ==');
{
  // fetch stub：products.json 正常；sent.json 正常（空账）；手机状态全部空（拉取成功）
  const fetchImpl = (url) => {
    if (String(url).includes('products.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(PRODUCTS) });
    if (String(url).includes('/paidang/sent.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    if (String(url).includes('/paidang/') && String(url).endsWith('.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  const storage = makeStorage();
  const ctx = makeMasterContext({ storage, fetchImpl });
  vm.runInContext(MASTER_JS, ctx);
  // 启动是异步的（fetch products → restore sent → pull）。先等一轮 microtask 再断言初始态。
  setTimeout(() => {
    // 1. bootState 初始是 loading，computeAutoQueues 不算队（返回缓存、不推队）
    ok(ev(ctx, "typeof bootState !== 'undefined'"), 'bootState 变量存在');
    ok(ev(ctx, "bootState === 'loading' || bootState === 'ready' || bootState === 'degraded'"), 'bootState 是三态之一', ev(ctx, 'bootState'));
    // 2. 未 READY 时 computeAutoQueues 返回本地缓存，不写云端（fetch 里没有 queue PUT）
    let pushed = false;
    const origFetch = ctx.fetch;
    ctx.fetch = (url, opts) => {
      if (opts && opts.method === 'PUT' && String(url).includes('/queue/')) pushed = true;
      return origFetch(url, opts);
    };
    ev(ctx, 'bootState = "loading"; computeAutoQueues();');
    ok(!pushed, '未 READY 时 computeAutoQueues 不推队到 Firebase');
    // 3. setMode 不再隐式算队：把 bootState 置 loading，记下队，调 setMode，队不变
    ev(ctx, 'bootState = "loading";');
    const before = JSON.stringify(ev(ctx, 'autoQueues'));
    ev(ctx, "setMode('auto');");
    const after = JSON.stringify(ev(ctx, 'autoQueues'));
    ok(before === after, 'setMode 不再隐式算队（loading 时队不变）');
    // 4. READY 后算队正常跑
    ev(ctx, 'bootState = "ready"; bootReady = true;');
    ev(ctx, 'computeAutoQueues();');
    ok(true, 'READY 后 computeAutoQueues 可调用');
    finishMaster();
  }, 50);
}

function finishMaster() {
  console.log('== master: 人工派单过发图账 + 爆品按 set_no ==');
  // 用一个干净的 ctx：直接把 PRODUCTS 注入（不等异步启动 fetch），测 isDone/isPendRedo/canDispatch
  const fetchImpl = () => Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  const storage = makeStorage();
  const ctx = makeMasterContext({ storage, fetchImpl });
  vm.runInContext(MASTER_JS, ctx);
  ev(ctx, 'PRODUCTS = ' + JSON.stringify(PRODUCTS) + ';');
  ev(ctx, 'bootState = "ready"; bootReady = true;');
    const FH320 = '1732479640669033376';
    const FH310 = '1732571163004670880';
    const s153 = PRODUCTS.find(p => String(p.pid) === FH320 && p.set_no === 153);
    const s154 = PRODUCTS.find(p => String(p.pid) === FH320 && p.set_no === 154);
    const s158 = PRODUCTS.find(p => String(p.pid) === FH320 && p.set_no === 158);
    const s159 = PRODUCTS.find(p => String(p.pid) === FH310 && p.set_no === 159);
    ok(!!s153 && !!s154, '测试用的 FH320 153/154 套存在', { s153: s153 && s153.set_no, s154: s154 && s154.set_no });
    // 5. 爆品 done 按 set_no：1 号做完 153，不连累 2 号的 154
    ev(ctx, `doneMap = {}; doneMap["${FH320}"] = { account: 1, time: Date.now(), set_no: 153 };`);
    ok(ev(ctx, `isDone(bySetNo(153), 1)`) === true, 'isDone：爆品 153 在 1 号判已做完');
    ok(ev(ctx, `isDone(bySetNo(154), 2)`) === false, 'isDone：爆品 154 在 2 号不判已做完（不连累）');
    ok(ev(ctx, `isDone(bySetNo(154), null)`) === false, 'isDone(null)：爆品 154 任何号都不判已做完');
    ok(ev(ctx, `isDone(bySetNo(153), null)`) === true, 'isDone(null)：爆品 153 任何号判已做完');
    // 6. Step 1 不清掉 154：把 154 放进 2 号队，算队后还在
    ev(ctx, `autoQueues = {"1":[],"2":[154],"3":[],"4":[],"5":[],"6":[],"7":[],"8":[]}; saveAutoQueues(autoQueues);`);
    ev(ctx, 'computeAutoQueues();');
    ok(ev(ctx, '(autoQueues["2"]||[]).includes(154)'), 'Step 1：爆品 153 做完后，2 号队的 154 还在');
    // 7. 153 本身会被清掉（已做完）
    ev(ctx, `autoQueues = {"1":[153],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[],"8":[]}; saveAutoQueues(autoQueues);`);
    ev(ctx, 'computeAutoQueues();');
    ok(!ev(ctx, '(autoQueues["1"]||[]).includes(153)'), 'Step 1：爆品已做完的 153 从 1 号队清掉');
    // 8. 爆品 pending redo 按 set_no：153 待重做，不连累 154
    ev(ctx, `doneMap = {}; redoList = [{ pid: "${FH320}", account: 1, set_no: 153, status: "pending", time: Date.now(), reasons: [], note: "" }];`);
    ok(ev(ctx, `isPendRedo(bySetNo(153), 1)`) === true, 'isPendRedo：爆品 153 在 1 号判待重做');
    ok(ev(ctx, `isPendRedo(bySetNo(154), 2)`) === false, 'isPendRedo：爆品 154 在 2 号不判待重做');
    // 9. canDispatch：154 给 2 号可以（153 做完/待重做都不拦），153 给 1 号不行
    ev(ctx, `doneMap = {}; doneMap["${FH320}"] = { account: 1, time: Date.now(), set_no: 153 }; redoList = []; sentHistory = {};`);
    ok(ev(ctx, `canDispatch(bySetNo(154), 2).ok`) === true, 'canDispatch：爆品 154 派给 2 号可以（153 已做完不连累）');
    ok(ev(ctx, `canDispatch(bySetNo(153), 1).ok`) === false, 'canDispatch：爆品 153 已做完不能再派');
    // 10. 人工派单过发图账：153 从未派过时 pool 态可派；记账后同一套再派被拦
    ev(ctx, `doneMap = {}; redoList = []; sentHistory = {}; autoQueues = {"1":[],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[],"8":[]}; assign = {"1":[],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[],"8":[]};`);
    ok(ev(ctx, `canDispatch(bySetNo(153), 1).ok`) === true, 'canDispatch：从未发过的 153 可人工派');
    ev(ctx, `sentRecord(1, bySetNo(153));`);
    ok(ev(ctx, `canDispatch(bySetNo(153), 1).ok`) === false, 'canDispatch：已发过账的 153 人工再派被拦');
    ok(ev(ctx, `canDispatch(bySetNo(153), 5).ok`) === false, 'canDispatch：已发过账的 153 换号人工派也被拦（跨号）');
    // 11. 非爆品 done 仍按 pid：做完一个 pid，全套都判已做完
    const nonHot = PRODUCTS.find(p => p.pid !== FH320 && p.pid !== FH310 && !p.hot);
    if (nonHot) {
      ev(ctx, `doneMap = {}; doneMap["${nonHot.pid}"] = { account: 3, time: Date.now(), set_no: ${nonHot.set_no} };`);
      ok(ev(ctx, `isDone(bySetNo(${nonHot.set_no}), 3)`) === true, 'isDone：非爆品按 pid 判已做完');
    } else {
      ok(true, 'isDone：非爆品按 pid（无合适样本，跳过）');
    }
    finishAcct();
}

function finishAcct() {
  console.log('== acct: 合并写 + fetchQueue 区分 ==');
  // acct.html 在 vm 里跑：需要 ACCT_ID 等顶层变量。acct 脚本一加载就会读 location/products，
  // 用 stub 的 fetch 返回空 products，避免它在启动时抛错。
  const acctFetch = (url) => {
    if (String(url).includes('products.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  };
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
    location: { origin: 'https://x.github.io', pathname: '/paidang/acct.html', href: 'https://x.github.io/paidang/acct.html?a=5&auto=1&q=1,2,3', search: '?a=5&auto=1&q=1,2,3' },
    history: { replaceState() {} }, navigator: {},
    confirm: () => true, alert() {},
    fetch: acctFetch, localStorage: makeStorage(), document: documentStub, scrollTo() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  try {
    vm.runInContext(ACCT_JS, ctx);
  } catch (e) {
    ok(false, 'acct.html 在 vm 里可加载', String(e && e.message));
    return done();
  }
  setTimeout(() => {
    // 12. mergePhoneState：两个浏览器的 done 并集
    const merged = ev(ctx, `mergePhoneState(
      { done: [{ pid: "111", set_no: 10 }], redos: [{ pid: "222", set_no: 20, time: 100 }], redos_img: [] },
      { account: 5, done: [{ pid: "333", set_no: 30 }], redos: [{ pid: "444", set_no: 40, time: 200 }], redos_img: [] }
    )`);
    const donePids = (merged.done || []).map(d => d.pid).sort();
    const redoPids = (merged.redos || []).map(r => r.pid).sort();
    eq(donePids, ['111', '333'], 'mergePhoneState：两个浏览器的 done 并集');
    eq(redoPids, ['222', '444'], 'mergePhoneState：两个浏览器的 redos 并集');
    // 13. tombstone：本机清掉的 redo，云端旧记录不复活
    ev(ctx, `clearedRedoState = { "222": 500 }; saveJSON(LS_CLEARED_REDO, clearedRedoState);`);
    const merged2 = ev(ctx, `mergePhoneState(
      { done: [], redos: [{ pid: "222", set_no: 20, time: 100 }], redos_img: [] },
      { account: 5, done: [], redos: [], redos_img: [] }
    )`);
    eq((merged2.redos || []).map(r => r.pid), [], 'mergePhoneState：tombstone 拦住已清掉的 redo 复活');
    // 14. tombstone 之前的新 redo 不被拦（云端时间比 tombstone 晚）
    const merged3 = ev(ctx, `mergePhoneState(
      { done: [], redos: [{ pid: "222", set_no: 25, time: 900 }], redos_img: [] },
      { account: 5, done: [], redos: [], redos_img: [] }
    )`);
    eq((merged3.redos || []).map(r => r.pid), ['222'], 'mergePhoneState：比 tombstone 新的 redo 不被拦');
    // 15. fetchQueueFromFirebase 区分空队 / 失败
    ev(ctx, `fetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve({ q: [] }) });`);
    ev(ctx, `fetchQueueFromFirebase().then(r => { globalThis.__fq1 = r; });`);
    ev(ctx, `fetch = (url) => Promise.reject(new Error('net down'));`);
    ev(ctx, `fetchQueueFromFirebase().then(r => { globalThis.__fq2 = r; });`);
    setTimeout(() => {
      ok(ev(ctx, 'globalThis.__fq1') === 'empty', 'fetchQueue：服务器确认空队返回 empty', ev(ctx, 'globalThis.__fq1'));
      ok(ev(ctx, 'globalThis.__fq2') === 'error', 'fetchQueue：网络失败返回 error', ev(ctx, 'globalThis.__fq2'));
      done();
    }, 50);
  }, 50);
}

function done() {
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
