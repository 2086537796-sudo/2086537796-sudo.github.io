// v1.0.27（一品分号）专测：2026-11-22 用户新规矩——一个品的两套必须分到不同号。
// 测 5 点：①Step 2.6 把同号同品对子拆开；②isDone 按套记（一号做完不连累另一号的另一套）；
// ③canDispatch 拦“这号已有同品另一套”；④重做回流挤走另一套；⑤Step 3 新套优先派给没有该 pid 的号。
// 用法：node test-v1027-split.js   （退出码 0 = 全部通过）
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

const pidOf = n => { const p = PRODUCTS.find(x => x.set_no === n); return p ? String(p.pid) : null; };
const bySetNo = n => PRODUCTS.find(x => x.set_no === n);
// GEYOTO N300（pid 1732505615234143201）：134 / 94 / 93 三套同品
// 圣诞礼品袋（pid 1732529098627912222）：125 / 124 两套同品

async function main() {
  console.log('== v1.0.27 一品分号 ==');

  // ---------- 场景 A：Step 2.6 拆对子（用 2026-11-22 中午的真实 Firebase 队） ----------
  const storageA = makeStorage({
    paidang_auto_q_a1: JSON.stringify([134, 125, 124, 94, 93, 43, 21, 167, 154]),
    paidang_auto_q_a2: JSON.stringify([268, 232, 198, 186, 149, 175, 158]),
    paidang_auto_q_a3: JSON.stringify([144, 143, 72, 55, 177, 162]),
    paidang_auto_q_a4: JSON.stringify([138, 267, 250, 161, 160, 148, 147, 63, 159, 153]),
    paidang_auto_q_a5: JSON.stringify([128, 137, 19, 178, 163]),
    paidang_auto_q_a6: JSON.stringify([157, 215, 165]),
    paidang_auto_q_a7: JSON.stringify([231, 166]),
    paidang_auto_q_a8: JSON.stringify([136, 29]),
  });
  const ctxA = makeContext({ url: 'https://example.com/paidang/master.html', storage: storageA });
  vm.runInContext(MASTER_JS, ctxA);
  await new Promise(r => setTimeout(r, 200));
  const qA = ctxA.computeAutoQueues();
  const allA = Object.values(qA).flat();
  // A1：总套数 = 池里全部未退役套（Step 3 会把未进队的都补进队，拆对子不丢套）
  const liveCount = PRODUCTS.filter(p => !p.retired).length;
  eq(allA.length, liveCount, 'A1 总套数 = 池里未退役套数（拆对子不丢套）');
  // A2：没有一号队里有同一 pid 的两套（爆品除外）
  const hotPids = new Set(PRODUCTS.filter(p => p.hot).map(p => String(p.pid)));
  const dupA = Object.keys(qA).filter(id => {
    const pids = qA[id].map(n => pidOf(n)).filter(pid => !hotPids.has(pid));
    return new Set(pids).size !== pids.length;
  });
  ok(dupA.length === 0, 'A2 没有一号队里有同一 pid 的两套', dupA);
  // A3：GEYOTO N300 的 134/94/93 分到了不同号
  const acctOf = (q, n) => Object.keys(q).find(id => q[id].includes(n));
  const a134 = acctOf(qA, 134), a94 = acctOf(qA, 94), a93 = acctOf(qA, 93);
  ok(a134 && a94 && a93 && a134 !== a94 && a134 !== a93 && a94 !== a93,
    'A3 GEYOTO N300 三套 134/94/93 分到三个不同号', { 134: a134, 94: a94, 93: a93 });
  // A4：圣诞礼品袋 125/124 分到不同号
  ok(acctOf(qA, 125) !== acctOf(qA, 124), 'A4 圣诞礼品袋 125/124 分到不同号', { 125: acctOf(qA, 125), 124: acctOf(qA, 124) });
  // A5：同一套只出现在一队
  ok(new Set(allA).size === allA.length, 'A5 同一套只出现在一队');

  // ---------- 场景 B：isDone 按套记 ----------
  const storageB = makeStorage({
    // 1 号做完了 GEYOTO N300 的 134（按套记），2 号队里还有同品的 94
    paidang_done: JSON.stringify({ '1732505615234143201': { account: 1, time: 1, sets: { '134': 1 } } }),
    paidang_auto_q_a1: JSON.stringify([134, 125]),
    paidang_auto_q_a2: JSON.stringify([94, 268]),
  });
  const ctxB = makeContext({ url: 'https://example.com/paidang/master.html', storage: storageB });
  vm.runInContext(MASTER_JS, ctxB);
  await new Promise(r => setTimeout(r, 200));
  const qB = ctxB.computeAutoQueues();
  // B1：134 做完了，从 1 号队里清掉
  ok(!qB['1'].includes(134), 'B1 做完的 134 从 1 号队清掉', qB['1']);
  // B2：94 还在 2 号队里（没被 134 的做完连累）
  ok(qB['2'].includes(94), 'B2 同品另一套 94 还在 2 号队里（按套记）', qB['2']);
  // B3：isDone 按套判
  ok(ctxB.isDone(bySetNo(134), 1) === true, 'B3 isDone(134, 1号) = true');
  ok(ctxB.isDone(bySetNo(94), 2) === false, 'B3 isDone(94, 2号) = false（另一套没做完）');
  ok(ctxB.isDone(bySetNo(94), null) === false, 'B3 isDone(94, 任意号) = false');
  ok(ctxB.isDone(bySetNo(134), 2) === false, 'B3 isDone(134, 2号) = false（不是这号做的）');

  // ---------- 场景 C：canDispatch 拦同品（独立场景：1 号人工派了 134，94 还没进任何队） ----------
  const storageC = makeStorage({
    paidang_assign: JSON.stringify({ '1': [134] }),
  });
  const ctxC = makeContext({ url: 'https://example.com/paidang/master.html', storage: storageC });
  vm.runInContext(MASTER_JS, ctxC);
  await new Promise(r => setTimeout(r, 200));
  // C1：94（同品另一套）派给已有 134 的 1 号 → 被“一品两套分不同号”拦住
  const r1 = ctxC.canDispatch(bySetNo(94), 1);
  ok(r1.ok === false && /一品两套分不同号/.test(r1.why), 'C1 手动派 94 给已有 134 的 1 号 → 被拦', r1);
  // C2：94 派给没有该品的 2 号 → 不因同品被拦
  const r2 = ctxC.canDispatch(bySetNo(94), 2);
  ok(r2.ok === true || !/一品两套分不同号/.test(r2.why || ''), 'C2 手动派 94 给没有该品的 2 号 → 不因同品被拦', r2);

  // ---------- 场景 D：重做回流挤走另一套 ----------
  const storageD = makeStorage({
    paidang_redo: JSON.stringify([
      { pid: '1732505615234143201', account: 1, set_no: 134, title_cn: 'GEYOTO N300', time: 1, note: '', status: 'returned', reasons: [] },
    ]),
    paidang_auto_q_a1: JSON.stringify([94, 93, 125]),
    paidang_auto_q_a2: JSON.stringify([268]),
  });
  const ctxD = makeContext({ url: 'https://example.com/paidang/master.html', storage: storageD });
  vm.runInContext(MASTER_JS, ctxD);
  await new Promise(r => setTimeout(r, 200));
  const qD = ctxD.computeAutoQueues();
  // D1：重做 134 回到 1 号队首
  eq(qD['1'][0], 134, 'D1 重做 134 回到 1 号队首');
  // D2：94、93 被挤出 1 号（同一号不能有同品两套）
  ok(!qD['1'].includes(94) && !qD['1'].includes(93), 'D2 同品另一套 94/93 被挤出 1 号', qD['1']);
  // D3：94、93 还在池子里（没丢）
  const allD = Object.values(qD).flat();
  ok(allD.includes(94) && allD.includes(93), 'D3 94/93 还在池子里（没丢）', allD);

  // ---------- 场景 E：老格式 done（只报 pid、没 set_no）——从队里推断套号 ----------
  // 现实：8 台手机里 7 台跑老版 acct.html，done 只报 pid（63 套里 61 套没 set_no）。
  // 1 号队里有 GEYOTO N300 的 134，2 号队里有同品的 94；1 号报 pid 做完（没 set_no）。
  const storageE = makeStorage({
    paidang_auto_q_a1: JSON.stringify([134, 125]),
    paidang_auto_q_a2: JSON.stringify([94, 268]),
  });
  const ctxE = makeContext({ url: 'https://example.com/paidang/master.html', storage: storageE });
  vm.runInContext(MASTER_JS, ctxE);
  await new Promise(r => setTimeout(r, 200));
  // 先算一次队，让 autoQueues 落到内存（推断要用它）
  ctxE.computeAutoQueues();
  // 1 号报做完：老格式，只给 pid，不给 set_no
  ctxE.applyPhoneState(1, { done: [{ pid: '1732505615234143201' }], redos: [], redos_img: [] });
  // E1：134 被推断为做完（从 1 号队里找到的）
  ok(ctxE.isDone(bySetNo(134), 1) === true, 'E1 老格式 done：134 被推断为做完');
  // E2：94 不受影响
  ok(ctxE.isDone(bySetNo(94), 2) === false, 'E2 老格式 done：同品另一套 94 没被连累');
  // E3：再算一次队，134 从 1 号队清掉，94 还在 2 号队
  const qE = ctxE.computeAutoQueues();
  ok(!qE['1'].includes(134), 'E3 老格式 done：134 从 1 号队清掉', qE['1']);
  ok(qE['2'].includes(94), 'E3 老格式 done：94 还在 2 号队', qE['2']);
  // E4：1 号再报一次同样的老格式 done（重复上报），不误删、不复活
  ctxE.applyPhoneState(1, { done: [{ pid: '1732505615234143201' }], redos: [], redos_img: [] });
  ok(ctxE.isDone(bySetNo(134), 1) === true, 'E4 重复上报老格式 done：134 仍是做完');
  ok(ctxE.isDone(bySetNo(94), 2) === false, 'E4 重复上报老格式 done：94 仍不受影响');

  // ---------- 场景 F：启动迁移（旧格式 done 只记 pid → 按套记） ----------
  // 圣诞礼品袋（pid 1732529098627912222）：125 / 124 两套。
  // 旧 doneMap：5 号做完了一套（只记 pid，没套号）；124 还在 6 号队里（没做完）；125 不在任何队里。
  // 迁移应把 125 认成做完的那套。
  const storageF = makeStorage({
    paidang_done: JSON.stringify({ '1732529098627912222': { account: 5, time: 1 } }),
    paidang_auto_q_a6: JSON.stringify([124, 268]),
  });
  const ctxF = makeContext({ url: 'https://example.com/paidang/master.html', storage: storageF });
  vm.runInContext(MASTER_JS, ctxF);
  await new Promise(r => setTimeout(r, 200));
  // 注意：启动链里已经跑过 migrateOldDone（日志会打“迁移了 1 条”），这里只验最终结果。
  ok(ctxF.isDone(bySetNo(125), 5) === true, 'F1 迁移后 isDone(125, 5号) = true');
  ok(ctxF.isDone(bySetNo(124), 6) === false, 'F2 迁移后 isDone(124, 6号) = false（还在队里的那套没做完）');
  const qF = ctxF.computeAutoQueues();
  ok(!Object.values(qF).flat().includes(125), 'F3 125 不再进队（已做完）');
  ok(qF['6'].includes(124), 'F3 124 还在 6 号队里', qF['6']);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
