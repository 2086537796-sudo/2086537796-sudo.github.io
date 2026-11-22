// v1.0.26 回归测试：缩水警告误报修复 —— 同一差异只弹一次警告（签名存 localStorage，
// 刷新页面不再重复弹）；手机推来完全空包时，总包把存的记录写回 Firebase 帮手机恢复。
// 跑真实 master.html 代码（vm + stub）。
// 用法：node test-v1026-shrink.js   （退出码 0 = 全部通过）
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

function makeContext({ storage, fetchImpl, toasts }) {
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

const isPhoneStateUrl = url => /\/paidang\/acct[1-8]\.json/.test(String(url));
const DONE_PIDS = ['1732306620069417457', '1731285269014548765', '1731671632272986911', '1732406997809468385',
  '1732479640669033376', '1732571163004670880', '1732738726279811444', '1729411129010721790'];

async function main() {
  console.log('== v1.0.26 缩水警告误报修复 ==');
  const now = Date.now();
  const doneSeed = {};
  DONE_PIDS.forEach(pid => { doneSeed[pid] = { account: 6, time: now }; });

  // ---------- 场景 1：手机推来完全空包 → 警告只弹一次 + 自动恢复写回 Firebase ----------
  const puts = [];
  const toasts = [];
  const fetch1 = (url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'PUT' && isPhoneStateUrl(u)) {
      puts.push({ url: u, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (u.includes('products.json')) return Promise.resolve({ ok: true, json: async () => PRODUCTS });
    if (u.includes('/paidang/sent.json')) return Promise.resolve({ ok: true, json: async () => ({ h: {}, updated: now }) });
    if (isPhoneStateUrl(u)) return Promise.resolve({ ok: true, json: async () => null });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const storage1 = makeStorage({ paidang_done: JSON.stringify(doneSeed) });
  const ctx1 = makeContext({ storage: storage1, fetchImpl: fetch1, toasts });
  vm.runInContext(MASTER_JS, ctx1);
  // 包一层 toast 抓调用（master 里的 toast 写 DOM，包起来只记消息）
  const origToast = ctx1.toast;
  ctx1.toast = msg => { toasts.push(msg); return origToast(msg); };
  await new Promise(r => setTimeout(r, 300));

  ctx1.applyPhoneState(6, { done: [], redos: [], redos_img: [] });
  await new Promise(r => setTimeout(r, 100));
  const afterDone = ev(ctx1, 'Object.keys(doneMap).filter(pid => doneMap[pid].account === 6).length');
  ok(afterDone === 8, '空包：总包 8 条不被删', afterDone);
  ok(!!ev(ctx1, 'shrinkConflicts["6"]'), '空包：冲突被记录下来');
  const warned1 = JSON.parse(storage1.getItem('paidang_shrink_warned') || '{}');
  ok(warned1['6'] === '8-0', '空包：警告签名 8-0 已存 localStorage', warned1);
  const warnToasts1 = toasts.filter(m => m.includes('少了一半以上'));
  ok(warnToasts1.length === 1, '空包：警告只弹一次', warnToasts1.length);
  ok(puts.length === 1, '空包：自动恢复写回 Firebase 一次', puts.length);
  ok(puts[0] && puts[0].body.done.length === 8, '空包：恢复的包里有 8 条 done', puts[0] && puts[0].body.done.length);
  ok(puts[0] && puts[0].url.endsWith('/paidang/acct6.json'), '空包：恢复写到 acct6.json', puts[0] && puts[0].url);
  const restoreToasts = toasts.filter(m => m.includes('写回云端'));
  ok(restoreToasts.length === 1, '空包：恢复成功后有提示', restoreToasts.length);

  // 同一个空包再推一次：警告不重弹，恢复不重写（5 分钟节流）
  const toastCountBefore = toasts.length;
  const putCountBefore = puts.length;
  ctx1.applyPhoneState(6, { done: [], redos: [], redos_img: [] });
  await new Promise(r => setTimeout(r, 100));
  ok(toasts.length === toastCountBefore, '同一差异再推：警告不重弹', { before: toastCountBefore, after: toasts.length });
  ok(puts.length === putCountBefore, '同一差异再推：恢复不重写（5 分钟节流）', { before: putCountBefore, after: puts.length });

  // ---------- 场景 2：模拟刷新页面（新 ctx，同一份 localStorage）→ 警告仍不重弹 ----------
  const toasts2 = [];
  const puts2 = [];
  const fetch2 = (url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'PUT' && isPhoneStateUrl(u)) { puts2.push({ url: u }); return Promise.resolve({ ok: true, json: async () => ({}) }); }
    if (u.includes('products.json')) return Promise.resolve({ ok: true, json: async () => PRODUCTS });
    if (u.includes('/paidang/sent.json')) return Promise.resolve({ ok: true, json: async () => ({ h: {}, updated: now }) });
    if (isPhoneStateUrl(u)) return Promise.resolve({ ok: true, json: async () => null });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const ctx2 = makeContext({ storage: storage1, fetchImpl: fetch2, toasts: toasts2 });
  vm.runInContext(MASTER_JS, ctx2);
  const origToast2 = ctx2.toast;
  ctx2.toast = msg => { toasts2.push(msg); return origToast2(msg); };
  await new Promise(r => setTimeout(r, 300));
  ctx2.applyPhoneState(6, { done: [], redos: [], redos_img: [] });
  await new Promise(r => setTimeout(r, 100));
  const warnToasts2 = toasts2.filter(m => m.includes('少了一半以上'));
  ok(warnToasts2.length === 0, '刷新页面后同一差异：警告不重弹', warnToasts2.length);
  ok(puts2.length === 0, '刷新页面后同一差异：恢复也不重写（节流还在）', puts2.length);

  // ---------- 场景 3：完整状态回来 → 冲突清除 + 签名清除，下次新差异会再弹 ----------
  ctx2.applyPhoneState(6, { done: DONE_PIDS, redos: [], redos_img: [] });
  ok(!ev(ctx2, 'shrinkConflicts["6"]'), '完整状态回来：冲突清除');
  const warnedAfter = JSON.parse(storage1.getItem('paidang_shrink_warned') || '{}');
  ok(!warnedAfter['6'], '完整状态回来：警告签名清除', warnedAfter);

  // ---------- 场景 4：部分缩水（不是空包）→ 只警告，不自动恢复 ----------
  const toasts4 = [];
  const puts4 = [];
  const fetch4 = (url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'PUT' && isPhoneStateUrl(u)) { puts4.push({ url: u }); return Promise.resolve({ ok: true, json: async () => ({}) }); }
    if (u.includes('products.json')) return Promise.resolve({ ok: true, json: async () => PRODUCTS });
    if (u.includes('/paidang/sent.json')) return Promise.resolve({ ok: true, json: async () => ({ h: {}, updated: now }) });
    if (isPhoneStateUrl(u)) return Promise.resolve({ ok: true, json: async () => null });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const storage4 = makeStorage({ paidang_done: JSON.stringify(doneSeed) });
  const ctx4 = makeContext({ storage: storage4, fetchImpl: fetch4, toasts: toasts4 });
  vm.runInContext(MASTER_JS, ctx4);
  const origToast4 = ctx4.toast;
  ctx4.toast = msg => { toasts4.push(msg); return origToast4(msg); };
  await new Promise(r => setTimeout(r, 300));
  ctx4.applyPhoneState(6, { done: ['1732306620069417457'], redos: [], redos_img: [] });
  await new Promise(r => setTimeout(r, 100));
  const afterDone4 = ev(ctx4, 'Object.keys(doneMap).filter(pid => doneMap[pid].account === 6).length');
  ok(afterDone4 === 8, '部分缩水：总包 8 条不被删', afterDone4);
  const warnToasts4 = toasts4.filter(m => m.includes('少了一半以上'));
  ok(warnToasts4.length === 1, '部分缩水：警告弹一次', warnToasts4.length);
  ok(puts4.length === 0, '部分缩水（非空包）：不自动恢复写回', puts4.length);
  const warned4 = JSON.parse(storage4.getItem('paidang_shrink_warned') || '{}');
  ok(warned4['6'] === '8-1', '部分缩水：警告签名 8-1 已存', warned4);

  // 数字变了（8-1 → 8-2）：警告再弹一次
  ctx4.applyPhoneState(6, { done: ['1732306620069417457', '1731285269014548765'], redos: [], redos_img: [] });
  await new Promise(r => setTimeout(r, 100));
  const warnToasts4b = toasts4.filter(m => m.includes('少了一半以上'));
  ok(warnToasts4b.length === 2, '数字变了：警告再弹一次', warnToasts4b.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
