// v1.0.24 回归测试：跨号防重 + ready 门 + 缩水保护（master 部分）
// 跑真实 master.html 代码（vm + stub），断言同一套/同一品换号不重发、启动未拉到状态不推队、
// 手机状态缩水时总包记录不被删。
// 注意：master.html 里的 let 变量（bootReady/doneMap/shrinkConflicts/PRODUCTS）不在 global 上，
// 要用 vm.runInContext 求值；fetch 里手机状态 URL 是 /paidang/{N}.json（不是 /paidang/acct{N}.json）。
// 用法：node test-v1024-dup.js   （退出码 0 = 全部通过）
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
// 在 ctx 里求值（能读到 let 变量）
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
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
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

function makeContext({ url, storage, fetchImpl }) {
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
    fetch: fetchImpl, localStorage: storage, document: documentStub, scrollTo() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

const bySetNo = n => PRODUCTS.find(x => x.set_no === n);
const isPhoneStateUrl = url => /\/paidang\/acct[1-8]\.json/.test(String(url)); // SYNC_BASE 末尾是 /paidang/acct

async function main() {
  console.log('== v1.0.24 跨号防重 + ready 门 + 缩水保护 ==');
  const now = Date.now();
  const TELFAR_PID = '1732589792904188172'; // 126/127，非爆品
  const FH320_PID = '1732479640669033376';  // 爆品 hot

  // ---------- 场景 1：跨号防重 ----------
  const sentSeed = {
    '8': { '126': { pid: TELFAR_PID, style: '风格14', time: now } },
    '1': { '153': { pid: FH320_PID, style: '风格3', time: now } },
  };
  const storage1 = makeStorage({
    paidang_sent: JSON.stringify(sentSeed),
    paidang_auto_q_a1: JSON.stringify([]), paidang_auto_q_a2: JSON.stringify([]),
    paidang_auto_q_a3: JSON.stringify([]), paidang_auto_q_a4: JSON.stringify([]),
    paidang_auto_q_a5: JSON.stringify([]), paidang_auto_q_a6: JSON.stringify([]),
    paidang_auto_q_a7: JSON.stringify([]), paidang_auto_q_a8: JSON.stringify([]),
  });
  const fetch1 = (url, opts) => {
    if (String(url).includes('products.json')) return Promise.resolve({ ok: true, json: async () => PRODUCTS });
    if (String(url).includes('/paidang/sent.json')) return Promise.resolve({ ok: true, json: async () => ({ h: sentSeed, updated: now }) });
    if (isPhoneStateUrl(url)) return Promise.resolve({ ok: true, json: async () => null });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const ctx1 = makeContext({ url: 'https://example.com/paidang/master.html', storage: storage1, fetchImpl: fetch1 });
  vm.runInContext(MASTER_JS, ctx1);
  await new Promise(r => setTimeout(r, 300));
  ok(ev(ctx1, 'PRODUCTS.length') === PRODUCTS.length, '前置：PRODUCTS 已加载', ev(ctx1, 'PRODUCTS.length'));

  ok(ctx1.sentCanSend(5, bySetNo(126)) === false, '跨号：126 发给过 8 号，5 号不许再发');
  ok(ctx1.sentCanSend(8, bySetNo(126)) === false, '本号：126 发给过 8 号，8 号也不许再发');
  ok(ctx1.sentCanSend(5, bySetNo(127)) === false, '跨号品：TELFAR 24h 内发给过 8 号，127 不许进 5 号队');
  ok(ctx1.sentCanSend(2, bySetNo(153)) === false, '爆品同一套 153 发过，2 号也不许再发');
  const q1 = ctx1.computeAutoQueues();
  const all1 = Object.values(q1).flat();
  ok(!all1.includes(126), '端到端：126 不进任何队', all1.filter(n => n === 126 || n === 127));
  ok(!all1.includes(127), '端到端：127 不进任何队', all1.filter(n => n === 126 || n === 127));
  // 爆品例外（端到端）：FH320 的 8 套分到多个号（跨号品规则不拦爆品）
  const fhAccts = new Set();
  Object.keys(q1).forEach(id => q1[id].forEach(n => { const p = bySetNo(n); if (p && String(p.pid) === FH320_PID) fhAccts.add(id); }));
  ok(fhAccts.size >= 2, '爆品例外：FH320 的套分到多个号', [...fhAccts]);
  ok(new Set(all1).size === all1.length, '端到端：同一套只出现在一队');

  // ---------- 场景 2：ready 门 ----------
  const calls2 = [];
  const fetch2 = (url, opts) => {
    calls2.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    if (String(url).includes('products.json')) return Promise.resolve({ ok: true, json: async () => PRODUCTS });
    if (String(url).includes('/paidang/sent.json')) return Promise.resolve({ ok: true, json: async () => ({ h: {}, updated: now }) });
    if (isPhoneStateUrl(url)) return Promise.reject(new Error('net down'));
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const storage2 = makeStorage({
    paidang_auto_q_a1: JSON.stringify([134]), paidang_auto_q_a2: JSON.stringify([]),
    paidang_auto_q_a3: JSON.stringify([]), paidang_auto_q_a4: JSON.stringify([]),
    paidang_auto_q_a5: JSON.stringify([]), paidang_auto_q_a6: JSON.stringify([]),
    paidang_auto_q_a7: JSON.stringify([]), paidang_auto_q_a8: JSON.stringify([]),
  });
  const ctx2 = makeContext({ url: 'https://example.com/paidang/master.html', storage: storage2, fetchImpl: fetch2 });
  vm.runInContext(MASTER_JS, ctx2);
  await new Promise(r => setTimeout(r, 300));
  ok(ev(ctx2, 'bootReady') === false, 'ready 门：手机状态拉取失败时 bootReady 仍为 false', ev(ctx2, 'bootReady'));
  const beforeQ = calls2.filter(c => c.url.includes('/paidang/queue/') && c.method === 'PUT').length;
  ctx2.computeAutoQueues();
  const afterQ = calls2.filter(c => c.url.includes('/paidang/queue/') && c.method === 'PUT').length;
  ok(afterQ === beforeQ, 'ready 门：未拉到状态时算队不推 Firebase 队', { before: beforeQ, after: afterQ });
  ok(storage2.getItem('paidang_auto_q_a1') !== null, 'ready 门：本地队照常保存');

  // ---------- 场景 3：缩水保护 ----------
  const doneSeed = {};
  ['1732306620069417457', '1731285269014548765', '1731671632272986911', '1732406997809468385',
   '1732479640669033376', '1732571163004670880', '1732738726279811444', '1729411129010721790'].forEach(pid => {
    doneSeed[pid] = { account: 6, time: now };
  });
  const storage3 = makeStorage({ paidang_done: JSON.stringify(doneSeed) });
  const ctx3 = makeContext({ url: 'https://example.com/paidang/master.html', storage: storage3, fetchImpl: fetch1 });
  vm.runInContext(MASTER_JS, ctx3);
  await new Promise(r => setTimeout(r, 300));
  const beforeDone = ev(ctx3, 'Object.keys(doneMap).filter(pid => doneMap[pid].account === 6).length');
  ok(beforeDone === 8, '缩水保护前置：6 号总包有 8 条已做完', beforeDone);
  ctx3.applyPhoneState(6, { done: ['1732306620069417457'], redos: [], redos_img: [] });
  const afterDone = ev(ctx3, 'Object.keys(doneMap).filter(pid => doneMap[pid].account === 6).length');
  ok(afterDone === 8, '缩水保护：手机只剩 1 条时总包 8 条不被删', afterDone);
  ok(!!ev(ctx3, 'shrinkConflicts["6"]'), '缩水保护：冲突被记录下来', ev(ctx3, 'JSON.stringify(shrinkConflicts)'));
  ctx3.applyPhoneState(6, { done: Object.keys(doneSeed), redos: [], redos_img: [] });
  ok(!ev(ctx3, 'shrinkConflicts["6"]'), '缩水保护：完整状态回来后冲突清除');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
