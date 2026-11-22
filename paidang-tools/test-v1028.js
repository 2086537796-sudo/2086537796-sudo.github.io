// v1.0.28 回归测试：①手机端队空自动补货（acct.html）；②总包重做已解决标记（master）；
// ③总包空队自动补货触发（master）。跑真实 master.html / acct.html 代码（vm + stub）。
// 用法：node test-v1028.js   （退出码 0 = 全部通过）
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
function makeDocument() {
  const byId = {};
  return {
    _byId: byId,
    getElementById(id) { if (!byId[id]) byId[id] = makeEl('div'); return byId[id]; },
    createElement(tag) { return makeEl(tag); },
    createTextNode(t) { return { textContent: String(t), nodeType: 3 }; },
    querySelector(sel) { if (!byId['qs:' + sel]) byId['qs:' + sel] = makeEl('div'); return byId['qs:' + sel]; },
    querySelectorAll() { return []; },
    body: makeEl('body'),
  };
}
function baseCtx(extra) {
  return Object.assign({
    console, setTimeout, clearTimeout, URL, URLSearchParams,
    encodeURI, decodeURI, JSON, Math, Date, RegExp, Array, Object, Set, Map, Promise,
    history: { replaceState() {} }, navigator: {},
    confirm: () => true, alert() {},
    scrollTo() {},
  }, extra || {});
}

// ---------- 总包 harness ----------
function makeMasterCtx(storageSeeds) {
  const storage = makeStorage(storageSeeds);
  const documentStub = makeDocument();
  const ctx = baseCtx({
    location: { origin: 'https://example.com', pathname: '/paidang/master.html', href: 'https://example.com/paidang/master.html', search: '' },
    fetch: () => Promise.resolve({ ok: true, json: async () => PRODUCTS }),
    localStorage: storage, document: documentStub,
  });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MASTER_JS, ctx);
  return { ctx, storage, documentStub };
}
// 启动链跑完后，把总包状态强制成“干净可控”：ready + 空账本（各场景再按需改）
function masterReset(ctx) {
  ev(ctx, 'bootState = "ready"; bootReady = true; sentHistory = {}; doneMap = {}; redoList = []; redoImgList = []; assign = {"1":[],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[],"8":[]};');
}
function masterSetQueues(storage, queues) {
  Object.keys(queues).forEach(id => storage.setItem('paidang_auto_q_a' + id, JSON.stringify(queues[id])));
}
const LED_PID = '1732309713013542929';   // 7 色 LED 面罩：套 19 / 41 / 128
const SHARK_PID = '1732305963897557680'; // Shark WV201：套 33 / 137

async function testMasterRedoResolved() {
  console.log('== master: 修法2 重做已解决标记 ==');
  // B1：替代套已在原号队里（且已发过账，autoReturnRedos 不会抢先标）→ 标 returned，替代套留队
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    ev(ctx, `redoList = [{ pid: "${LED_PID}", account: 5, set_no: 41, title_cn: "7 色光疗 LED 美容面罩", time: 1, note: "", status: "pending", reasons: [] },
                         { pid: "${SHARK_PID}", account: 6, set_no: 33, title_cn: "Shark WV201", time: 1, note: "", status: "pending", reasons: [] }];`);
    ev(ctx, `sentHistory = { "5": { "128": { pid: "${LED_PID}", style: "", time: Date.now() } }, "6": { "137": { pid: "${SHARK_PID}", style: "", time: Date.now() } } };`);
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [128], 6: [145], 7: [231], 8: [39] });
    const q = ctx.computeAutoQueues();
    const rl = ev(ctx, 'redoList');
    const led = rl.find(r => String(r.pid) === LED_PID);
    const shark = rl.find(r => String(r.pid) === SHARK_PID);
    ok(led && led.status === 'returned', 'B1 替代套已进队：LED 重做标 returned', led && led.status);
    ok(shark && shark.status === 'pending', 'B1 替代套没进队：Shark 重做保持 pending', shark && shark.status);
    ok(q['5'].includes(128), 'B1 替代套 128 仍在 5 号队里', q['5']);
    const saved = JSON.parse(storage.getItem('paidang_redo') || '[]');
    const savedLed = saved.find(r => String(r.pid) === LED_PID);
    ok(savedLed && savedLed.status === 'returned', 'B1 标记已存盘（LS_REDO）', savedLed && savedLed.status);
  }
  // B2：替代套不在原号队里 → 保持 pending
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    ev(ctx, `redoList = [{ pid: "${LED_PID}", account: 5, set_no: 41, title_cn: "7 色光疗 LED 美容面罩", time: 1, note: "", status: "pending", reasons: [] }];`);
    ev(ctx, `sentHistory = { "5": { "128": { pid: "${LED_PID}", style: "", time: Date.now() } } };`);
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [137], 6: [145], 7: [231], 8: [39] });
    ctx.computeAutoQueues();
    const rl = ev(ctx, 'redoList');
    const led = rl.find(r => String(r.pid) === LED_PID);
    ok(led && led.status === 'pending', 'B2 替代套不在原号队里：保持 pending', led && led.status);
  }
  // B3：重做本身就是最新套（池里没有新版）→ 保持 pending
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    ev(ctx, `redoList = [{ pid: "${LED_PID}", account: 5, set_no: 128, title_cn: "7 色光疗 LED 美容面罩", time: 1, note: "", status: "pending", reasons: [] }];`);
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [128], 6: [145], 7: [231], 8: [39] });
    ctx.computeAutoQueues();
    const rl = ev(ctx, 'redoList');
    const led = rl.find(r => String(r.pid) === LED_PID);
    ok(led && led.status === 'pending', 'B3 没有新版可派：保持 pending', led && led.status);
  }
}

async function testMasterRefillTrigger() {
  console.log('== master: 修法3 空队自动补货触发 ==');
  // C1：5 号队空 + 池里有货 → 触发重算并补货
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [], 6: [145], 7: [231], 8: [39] });
    const triggered = ctx.refillEmptyQueuesIfNeeded();
    ok(triggered === true, 'C1 队空+有货：触发重算', triggered);
    const q5 = JSON.parse(storage.getItem('paidang_auto_q_a5') || '[]');
    ok(q5.length > 0, 'C1 5 号队被补货（不再是空队）', q5);
  }
  // C2：没有空队 → 不触发
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [128], 6: [145], 7: [231], 8: [39] });
    const triggered = ctx.refillEmptyQueuesIfNeeded();
    ok(triggered === false, 'C2 没有空队：不触发', triggered);
    eq(JSON.parse(storage.getItem('paidang_auto_q_a5') || '[]'), [128], 'C2 队不变');
  }
  // C3：没 ready（degraded）→ 不触发（READY 门不破）
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    ev(ctx, 'bootState = "degraded";');
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [], 6: [145], 7: [231], 8: [39] });
    const triggered = ctx.refillEmptyQueuesIfNeeded();
    ok(triggered === false, 'C3 degraded：不触发', triggered);
    eq(JSON.parse(storage.getItem('paidang_auto_q_a5') || '[]'), [], 'C3 队不变');
  }
  // C4：队空但池里没货（全做完了）→ 不触发
  {
    const { ctx, storage } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    const dm = {};
    PRODUCTS.forEach(p => {
      dm[String(p.pid)] = dm[String(p.pid)] || { sets: {} };
      dm[String(p.pid)].sets[String(p.set_no)] = 1;
    });
    ev(ctx, 'doneMap = ' + JSON.stringify(dm) + ';');
    masterSetQueues(storage, { 1: [124], 2: [232], 3: [143], 4: [138], 5: [], 6: [145], 7: [231], 8: [39] });
    const triggered = ctx.refillEmptyQueuesIfNeeded();
    ok(triggered === false, 'C4 队空但没货：不触发', triggered);
  }
  // C5：版本号
  {
    const { ctx } = makeMasterCtx({});
    await sleep(100);
    ok(ev(ctx, 'APP_VERSION') === 'v1.0.30', 'C5 总包 APP_VERSION = v1.0.30', ev(ctx, 'APP_VERSION'));
  }
}

// ---------- 手机端 harness ----------
function makeAcctCtx({ url, storageSeeds, queueResponses }) {
  const storage = makeStorage(storageSeeds);
  const documentStub = makeDocument();
  const queueLog = [];
  const timeoutCalls = [];
  let qIdx = 0;
  const fetchMock = (u) => {
    const s = String(u);
    if (s.includes('products.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(PRODUCTS) });
    if (s.includes('/queue/acct')) {
      queueLog.push(s);
      const r = queueResponses[Math.min(qIdx, queueResponses.length - 1)];
      qIdx++;
      if (r === 'error') return Promise.reject(new Error('net down'));
      if (r === 'empty') return Promise.resolve({ ok: true, json: () => Promise.resolve({ q: [] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(r) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  };
  const trackingSetTimeout = (fn, ms, ...args) => { timeoutCalls.push(ms); return setTimeout(fn, ms, ...args); };
  const ctx = baseCtx({
    location: { origin: 'https://x.github.io', pathname: '/paidang/acct.html', href: 'https://x.github.io/paidang/acct.html' + url, search: url },
    fetch: fetchMock, localStorage: storage, document: documentStub,
    setTimeout: trackingSetTimeout,
  });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ACCT_JS, ctx);
  return { ctx, storage, documentStub, queueLog, timeoutCalls };
}
function listCardIds(documentStub) {
  const list = documentStub._byId['list'];
  if (!list) return [];
  return (list.children || []).map(c => c.id).filter(Boolean);
}
function seenList(storage) {
  try { return JSON.parse(storage.getItem('paidang_auto_seen_a5') || '[]'); } catch (e) { return []; }
}

async function testAcctRefill() {
  console.log('== acct: 修法1 队空自动补货 ==');
  // A1：启动时队已被消费完，总包推了新套 → 启动自动补货，旧跳过记录放出来，新套也进来
  {
    const { ctx, storage, documentStub } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137',
        'paidang_auto_seen_a5': JSON.stringify([128, 137]),
      },
      queueResponses: [{ q: [128, 137] }, { q: [128, 137, 146, 142] }],
    });
    await sleep(500);
    const ids = listCardIds(documentStub);
    ok(ids.includes('set-128') && ids.includes('set-137') && ids.includes('set-146') && ids.includes('set-142'),
      'A1 启动自动补货：旧跳过套 + 新套都出现', ids);
    const seen = seenList(storage);
    ok(!seen.includes(128) && !seen.includes(137), 'A1 旧跳过记录已放出（autoSeen 清掉）', seen);
    ok(ev(ctx, 'APP_VERSION') === 'v1.0.29', 'A6 手机端 APP_VERSION = v1.0.29', ev(ctx, 'APP_VERSION'));
    const vline = documentStub._byId['versionLine'];
    ok(vline && String(vline.textContent).includes('v1.0.29'), 'A6 页头版本动态填 v1.0.29', vline && vline.textContent);
  }
  // A2：keepSkipped——刚跳过的那组不放出来，其余旧跳过记录放出来
  {
    const { ctx, storage, documentStub, queueLog } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137,146,142',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137,146,142',
        'paidang_auto_seen_a5': JSON.stringify([128, 137]),
      },
      queueResponses: [{ q: [128, 137, 146, 142] }],
    });
    await sleep(400);
    // 启动后当前组是 [146,142]（128/137 在 autoSeen 里）；模拟点了“拉下一组”跳过它们
    ev(ctx, 'autoSeen.add(146); autoSeen.add(142); saveAutoSeen(); currentAssigned = computeAutoBatch();');
    ok(ev(ctx, 'computeAutoBatch().length') === 0, 'A2 前置：四套全在 autoSeen 里，当前组空');
    const before = queueLog.length;
    const refilled = await ev(ctx, 'refillAutoBatchIfEmpty(new Set([146, 142]))');
    ok(refilled === true, 'A2 keepSkipped 下仍补到货', refilled);
    const ids = listCardIds(documentStub);
    eq(ids, ['set-128', 'set-137'], 'A2 只放出旧跳过套，刚跳过的不出现', ids);
    const seen = seenList(storage);
    ok(seen.includes(146) && seen.includes(142) && !seen.includes(128) && !seen.includes(137),
      'A2 autoSeen：刚跳过的保留，旧的已放出', seen);
    ok(queueLog.length > before, 'A2 补货时确实去 Firebase 拉了队');
  }
  // A3：总包队真空 → 返回 false，并排了 60 秒再拉的定时器
  {
    const { ctx, storage, timeoutCalls } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137,146,142',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137,146,142',
        'paidang_auto_seen_a5': JSON.stringify([128, 137]),
      },
      queueResponses: [{ q: [128, 137, 146, 142] }, 'empty'],
    });
    await sleep(400);
    ev(ctx, 'autoSeen.add(146); autoSeen.add(142); saveAutoSeen(); currentAssigned = computeAutoBatch();');
    ok(ev(ctx, 'computeAutoBatch().length') === 0, 'A3 前置：当前组空');
    const refilled = await ev(ctx, 'refillAutoBatchIfEmpty()');
    ok(refilled === false, 'A3 总包队空：返回 false', refilled);
    ok(timeoutCalls.includes(60000), 'A3 空队排了 60 秒再拉的定时器', timeoutCalls);
  }
  // A4：拉队网络失败 → 返回 false
  {
    const { ctx } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137,146,142',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137,146,142',
        'paidang_auto_seen_a5': JSON.stringify([128, 137]),
      },
      queueResponses: [{ q: [128, 137, 146, 142] }, 'error'],
    });
    await sleep(400);
    ev(ctx, 'autoSeen.add(146); autoSeen.add(142); saveAutoSeen(); currentAssigned = computeAutoBatch();');
    const refilled = await ev(ctx, 'refillAutoBatchIfEmpty()');
    ok(refilled === false, 'A4 拉队失败：返回 false', refilled);
  }
  // A5：当前组还有货 → 直接返回 false，不拉队
  {
    const { ctx, queueLog } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137,146,142',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137,146,142',
        'paidang_auto_seen_a5': JSON.stringify([128, 137]),
      },
      queueResponses: [{ q: [128, 137, 146, 142] }],
    });
    await sleep(400);
    ok(ev(ctx, 'computeAutoBatch().length') === 2, 'A5 前置：当前组有 2 套');
    const before = queueLog.length;
    const refilled = await ev(ctx, 'refillAutoBatchIfEmpty()');
    ok(refilled === false, 'A5 有货：返回 false', refilled);
    ok(queueLog.length === before, 'A5 有货：没去 Firebase 拉队', { before, after: queueLog.length });
  }
}

async function main() {
  await testMasterRedoResolved();
  await testMasterRefillTrigger();
  await testAcctRefill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
