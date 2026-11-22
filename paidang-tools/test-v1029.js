// v1.0.29 回归测试：①待重做显示用存的套号（acct）；②两个按钮改直推（acct）；
// ③重做按套判，替代套不再被藏（acct）；④总包重做“已收到”戳（master）。
// 用法：node test-v1029.js   （退出码 0 = 全部通过）
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
function masterReset(ctx) {
  ev(ctx, 'bootState = "ready"; bootReady = true; sentHistory = {}; doneMap = {}; redoList = []; redoImgList = []; assign = {"1":[],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[],"8":[]};');
}
function collectText(el) {
  if (!el) return '';
  const out = [];
  const walk = (n) => {
    if (n.textContent) out.push(n.textContent);
    (n.children || []).forEach(walk);
  };
  walk(el);
  return out.join('\n');
}

// ---------- 手机端 harness ----------
function makeAcctCtx({ url, storageSeeds, queueResponses, failSync }) {
  const storage = makeStorage(storageSeeds);
  const documentStub = makeDocument();
  const queueLog = [];
  const syncCalls = [];
  let qIdx = 0;
  const fetchMock = (u, opts) => {
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
    if (s.includes('/acct') && s.includes('firebaseio.com')) {
      syncCalls.push({ url: s, method: (opts && opts.method) || 'GET' });
      if (failSync) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  };
  const ctx = baseCtx({
    location: { origin: 'https://x.github.io', pathname: '/paidang/acct.html', href: 'https://x.github.io/paidang/acct.html' + url, search: url },
    fetch: fetchMock, localStorage: storage, document: documentStub,
  });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ACCT_JS, ctx);
  // 捕获复制文字（备用链接走 clipboard）
  const captured = [];
  ctx.navigator.clipboard = { writeText: (t) => { captured.push(t); return Promise.resolve(); } };
  return { ctx, storage, documentStub, queueLog, syncCalls, captured };
}
function listCardIds(documentStub) {
  const list = documentStub._byId['list'];
  if (!list) return [];
  return (list.children || []).map(c => c.id).filter(Boolean);
}
function redoListLines(documentStub) {
  const rul = documentStub._byId['redoList'];
  if (!rul) return [];
  return (rul.children || []).map(li => {
    const span = (li.children || [])[0];
    return span ? span.textContent : '';
  });
}
function clickBtn(documentStub, id) {
  const btn = documentStub._byId[id];
  if (!btn || !btn._listeners || !btn._listeners['click'] || !btn._listeners['click'].length) return null;
  btn._listeners['click'][0].call(btn);
  return btn;
}

const ANUA_PID = '1729700978019176929'; // Anua：套 51 / 52 / 131
const LED_PID = '1732309713013542929';  // 7 色 LED 面罩：套 19 / 41 / 128

// ---------- acct：修法1 待重做显示用存的套号 ----------
async function testAcctRedoDisplay() {
  console.log('== acct: 修法1 待重做显示用存的套号 ==');
  // D1：3 号 Anua 重做记的是 51 套，队里是 131 套 → 显示 51 套，不显示 131 套，且标“已不在本队”
  {
    const { ctx, documentStub } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: {
        'paidang_auto_q_a3': '131,143,55',
        'paidang_redo_a3': JSON.stringify({
          [ANUA_PID]: { time: 1000, set_no: 51, title_cn: 'Anua 壬二酸 10% 透明质酸舒缓精华 30ml', reasons: ['look'], note: '' },
        }),
      },
      queueResponses: [{ q: [131, 143, 55] }],
    });
    await sleep(600);
    const lines = redoListLines(documentStub);
    ok(lines.length === 1, 'D1 待重做列表有 1 条', lines);
    ok(lines[0] && lines[0].includes('第51套'), 'D1 显示存的套号 51 套', lines[0]);
    ok(lines[0] && !lines[0].includes('第131套'), 'D1 不显示队里那套 131', lines[0]);
    ok(lines[0] && lines[0].includes('已不在本队'), 'D1 51 套不在本队，标“已不在本队”', lines[0]);
    const summary = documentStub._byId['redoListSummary'];
    ok(summary && summary.textContent.includes('整组 1 套'), 'D1 汇总“整组 1 套”', summary && summary.textContent);
  }
  // D2：重做的套就在本队里 → 显示该套号，不标“已不在本队”
  {
    const { documentStub } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: {
        'paidang_auto_q_a3': '131,143,55',
        'paidang_redo_a3': JSON.stringify({
          [ANUA_PID]: { time: 1000, set_no: 131, title_cn: 'Anua 壬二酸 10% 透明质酸舒缓精华 30ml', reasons: ['look'], note: '' },
        }),
      },
      queueResponses: [{ q: [131, 143, 55] }],
    });
    await sleep(600);
    const lines = redoListLines(documentStub);
    ok(lines.length === 1 && lines[0].includes('第131套'), 'D2 本队里的重做套显示 131 套', lines[0]);
    ok(lines[0] && !lines[0].includes('已不在本队'), 'D2 在本队，不标“已不在本队”', lines[0]);
  }
}

// ---------- acct：修法3 重做按套判 ----------
async function testAcctRedoPerSet() {
  console.log('== acct: 修法3 重做按套判，替代套不再被藏 ==');
  // D3：5 号队 5 套全是替代套（同 pid、不同 set_no）→ 全部正常显示为可做，还剩 5
  const redo5 = {};
  redo5['1732309713013542929'] = { time: 1000, set_no: 41, title_cn: '7 色光疗 LED 美容面罩', reasons: [], note: '' };
  redo5['1732305963897557680'] = { time: 1000, set_no: 33, title_cn: 'Shark WANDVAC WV201 手持吸尘器', reasons: [], note: '' };
  redo5['1732321182598533162'] = { time: 1000, set_no: 25, title_cn: 'Chemist At Play 三件套', reasons: [], note: '' };
  redo5['1729408907265151607'] = { time: 1000, set_no: 9, title_cn: 'Playboda 1500 片旋转拼图板', reasons: [], note: '' };
  redo5['1729425019323650375'] = { time: 1000, set_no: 92, title_cn: 'Sudrov 42800mAh 太阳能充电宝', reasons: [], note: '' };
  {
    const { ctx, documentStub } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137,146,142,105',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137,146,142,105',
        'paidang_redo_a5': JSON.stringify(redo5),
      },
      queueResponses: [{ q: [128, 137, 146, 142, 105] }],
    });
    await sleep(600);
    const ids = listCardIds(documentStub);
    ok(['set-128', 'set-137', 'set-146', 'set-142', 'set-105'].every(x => ids.includes(x)),
      'D3 5 套替代套全部正常显示为可做', ids);
    ok(ev(ctx, 'isRedo(bySetNo(128))') === false, 'D3 替代套 128 不算重做', ev(ctx, 'isRedo(bySetNo(128))'));
    ok(ev(ctx, 'isRedo(bySetNo(41))') === true, 'D3 原套号 41 仍算重做', ev(ctx, 'isRedo(bySetNo(41))'));
    ok(ev(ctx, 'isRedo(bySetNo(137))') === false, 'D3 替代套 137 不算重做');
    ok(ev(ctx, 'isRedo(bySetNo(33))') === true, 'D3 原套号 33 仍算重做');
    const remain = documentStub._byId['stRemain'];
    const redoN = documentStub._byId['stRedo'];
    ok(remain && String(remain.textContent) === '5', 'D3 还剩 5 套（不再是 0）', remain && remain.textContent);
    ok(redoN && String(redoN.textContent) === '0', 'D3 队里待重做 0 套', redoN && redoN.textContent);
    const lines = redoListLines(documentStub);
    ok(lines.length === 5, 'D3 待重做列表仍有 5 条旧记录', lines.length);
    ok(lines.every(l => l.includes('已不在本队')), 'D3 5 条旧记录都标“已不在本队”', lines);
    ok(lines.some(l => l.includes('第41套')) && lines.some(l => l.includes('第92套')), 'D3 列表显示旧套号 41 / 92', lines);
  }
  // D4：单张重做也按套判
  {
    const { ctx } = makeAcctCtx({
      url: '?a=5&auto=1&q=128,137',
      storageSeeds: {
        'paidang_auto_q_a5': '128,137',
        'paidang_redo_img_a5': JSON.stringify({
          [LED_PID]: { set_no: 41, title_cn: '7 色光疗 LED 美容面罩', images: { '1': { fn: '图1.jpg', reasons: ['look'], note: '', time: 1000 } } },
        }),
      },
      queueResponses: [{ q: [128, 137] }],
    });
    await sleep(600);
    ok(ev(ctx, 'isRedoImg(bySetNo(128), 1)') === false, 'D4 替代套 128 的图1不算单张重做', ev(ctx, 'isRedoImg(bySetNo(128), 1)'));
    ok(ev(ctx, 'isRedoImg(bySetNo(41), 1)') === true, 'D4 原套号 41 的图1仍算单张重做', ev(ctx, 'isRedoImg(bySetNo(41), 1)'));
  }
}

// ---------- acct：修法2 两个按钮改直推 ----------
async function testAcctPushButtons() {
  console.log('== acct: 修法2 两个按钮改直推 ==');
  const anuaRedo = JSON.stringify({
    [ANUA_PID]: { time: 1000, set_no: 51, title_cn: 'Anua 壬二酸 10% 透明质酸舒缓精华 30ml', reasons: ['look'], note: '' },
  });
  // D5：推送待重做成功 → 回执 + 真的调了推送
  {
    const { documentStub, syncCalls } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: { 'paidang_auto_q_a3': '131,143,55', 'paidang_redo_a3': anuaRedo },
      queueResponses: [{ q: [131, 143, 55] }],
    });
    await sleep(600);
    const btn = clickBtn(documentStub, 'copyRedoBtn');
    ok(btn !== null, 'D5 推送待重做按钮存在');
    await sleep(200);
    ok(/已推送 ✓ \d{2}:\d{2}（1 套）/.test(btn.textContent), 'D5 成功回执“已推送 ✓ HH:MM（1 套）”', btn.textContent);
    ok(syncCalls.some(c => c.method === 'PUT' && c.url.includes('/acct3.json')), 'D5 真的向 Firebase 推了状态', syncCalls);
  }
  // D6：推送待重做失败 → “推送失败，点我重试”
  {
    const { documentStub } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: { 'paidang_auto_q_a3': '131,143,55', 'paidang_redo_a3': anuaRedo },
      queueResponses: [{ q: [131, 143, 55] }],
      failSync: true,
    });
    await sleep(600);
    const btn = clickBtn(documentStub, 'copyRedoBtn');
    await sleep(200);
    ok(btn.textContent === '推送失败，点我重试', 'D6 失败显示“推送失败，点我重试”', btn.textContent);
  }
  // D7：一键同步成功 → 回执带已做完/待重做数
  {
    const p143 = PRODUCTS.find(p => p.set_no === 143);
    const p55 = PRODUCTS.find(p => p.set_no === 55);
    const doneSeed = {};
    doneSeed[String(p143.pid)] = 143;
    doneSeed[String(p55.pid)] = 55;
    const { documentStub, syncCalls } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: {
        'paidang_auto_q_a3': '131,143,55',
        'paidang_done_a3': JSON.stringify(doneSeed),
        'paidang_redo_a3': anuaRedo,
      },
      queueResponses: [{ q: [131, 143, 55] }],
    });
    await sleep(600);
    const btn = clickBtn(documentStub, 'copyStatusBtn');
    ok(btn !== null, 'D7 一键同步按钮存在');
    await sleep(200);
    ok(/已同步 ✓ 已做完 2 套、待重做 1 套 \d{2}:\d{2}/.test(btn.textContent), 'D7 成功回执“已同步 ✓ 已做完 2 套、待重做 1 套 HH:MM”', btn.textContent);
    ok(syncCalls.some(c => c.method === 'PUT' && c.url.includes('/acct3.json')), 'D7 真的向 Firebase 推了状态', syncCalls);
  }
  // D8：一键同步失败 → “同步失败，点我重试”
  {
    const { documentStub } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: { 'paidang_auto_q_a3': '131,143,55', 'paidang_redo_a3': anuaRedo },
      queueResponses: [{ q: [131, 143, 55] }],
      failSync: true,
    });
    await sleep(600);
    const btn = clickBtn(documentStub, 'copyStatusBtn');
    await sleep(200);
    ok(btn.textContent === '同步失败，点我重试', 'D8 失败显示“同步失败，点我重试”', btn.textContent);
  }
  // D9：复制文字备用格式不变，且用存的套号
  {
    const { documentStub, captured } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: { 'paidang_auto_q_a3': '131,143,55', 'paidang_redo_a3': anuaRedo },
      queueResponses: [{ q: [131, 143, 55] }],
    });
    await sleep(600);
    const b1 = clickBtn(documentStub, 'copyRedoTextBtn');
    ok(b1 !== null, 'D9 复制文字备用（待重做）链接存在');
    await sleep(150);
    ok(captured.length >= 1 && captured[0].includes('账号 3 待重做'), 'D9 备用文字开头“账号 3 待重做”', captured[0]);
    ok(captured[0].includes('第51套'), 'D9 备用文字用存的套号 51', captured[0]);
    ok(captured[0].includes(ANUA_PID), 'D9 备用文字带 pid', captured[0]);
    ok(!captured[0].includes('第131套'), 'D9 备用文字不写错套号 131', captured[0]);
    const b2 = clickBtn(documentStub, 'copyStatusTextBtn');
    ok(b2 !== null, 'D9 复制文字备用（状态）链接存在');
    await sleep(150);
    const statusText = captured[captured.length - 1];
    ok(statusText.includes('账号 3 状态同步') && statusText.includes('待重做'), 'D9 备用状态文字格式不变', statusText);
    ok(statusText.includes('第51套'), 'D9 备用状态文字用存的套号 51', statusText);
  }
  // D10：版本号
  {
    const { ctx, documentStub } = makeAcctCtx({
      url: '?a=3&auto=1&q=131,143,55',
      storageSeeds: { 'paidang_auto_q_a3': '131,143,55' },
      queueResponses: [{ q: [131, 143, 55] }],
    });
    await sleep(600);
    ok(ev(ctx, 'APP_VERSION') === 'v1.0.29', 'D10 手机端 APP_VERSION = v1.0.29', ev(ctx, 'APP_VERSION'));
    const vline = documentStub._byId['versionLine'];
    ok(vline && String(vline.textContent).includes('v1.0.29'), 'D10 页头版本动态填 v1.0.29', vline && vline.textContent);
  }
}

// ---------- master：重做“已收到”戳 ----------
async function testMasterReceivedAt() {
  console.log('== master: 重做“已收到”戳 ==');
  // M1：手机新推一条重做 → 总包盖 receivedAt，列表显示“已收到”
  {
    const { ctx, documentStub } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    const data = { done: [], redos: [{ pid: ANUA_PID, set_no: 51, title_cn: 'Anua 壬二酸', time: 1000, reasons: ['look'], note: '' }], redos_img: [] };
    ev(ctx, 'applyPhoneState(3, ' + JSON.stringify(data) + ')');
    const rl = ev(ctx, 'redoList');
    const e = rl.find(r => String(r.pid) === ANUA_PID);
    ok(e && typeof e.receivedAt === 'number' && e.receivedAt > 0, 'M1 新重做收到后盖 receivedAt', e && e.receivedAt);
    ok(e && e.set_no === 51, 'M1 收到后套号仍是 51', e && e.set_no);
    ev(ctx, 'renderRedo()');
    const txt = collectText(documentStub._byId['redoList']);
    ok(txt.includes('已收到'), 'M1 重做列表显示“已收到”', txt);
    ok(txt.includes('第51套'), 'M1 列表显示第 51 套', txt);
  }
  // M2：同一标记时间再拉 → receivedAt 不变；重新打回（新时间）→ receivedAt 更新
  {
    const { ctx } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    const mk = (t) => ({ done: [], redos: [{ pid: ANUA_PID, set_no: 51, title_cn: 'Anua 壬二酸', time: t, reasons: ['look'], note: '' }], redos_img: [] });
    ev(ctx, 'applyPhoneState(3, ' + JSON.stringify(mk(1000)) + ')');
    const recv1 = ev(ctx, 'redoList').find(r => String(r.pid) === ANUA_PID).receivedAt;
    ev(ctx, 'applyPhoneState(3, ' + JSON.stringify(mk(1000)) + ')');
    const recv2 = ev(ctx, 'redoList').find(r => String(r.pid) === ANUA_PID).receivedAt;
    ok(recv2 === recv1, 'M2 同一标记时间再拉：receivedAt 不变', { recv1, recv2 });
    await sleep(10);
    ev(ctx, 'applyPhoneState(3, ' + JSON.stringify(mk(2000)) + ')');
    const recv3 = ev(ctx, 'redoList').find(r => String(r.pid) === ANUA_PID).receivedAt;
    ok(recv3 > recv1, 'M2 重新打回（新时间）：receivedAt 更新', { recv1, recv3 });
  }
  // M3：粘贴同步的新重做也盖 receivedAt
  {
    const { ctx } = makeMasterCtx({});
    await sleep(250);
    masterReset(ctx);
    const text = '账号 3 状态同步\n已做完（0）：\n待重做（1）：\n- pid ' + ANUA_PID + '（第51套） 2026-11-22 10:00 [外观不对]';
    ev(ctx, 'syncFromText(' + JSON.stringify(text) + ')');
    const rl = ev(ctx, 'redoList');
    const e = rl.find(r => String(r.pid) === ANUA_PID);
    ok(e && typeof e.receivedAt === 'number' && e.receivedAt > 0, 'M3 粘贴同步的新重做盖 receivedAt', e && e.receivedAt);
  }
  // M4：版本号
  {
    const { ctx } = makeMasterCtx({});
    await sleep(100);
    ok(ev(ctx, 'APP_VERSION') === 'v1.0.30', 'M4 总包 APP_VERSION = v1.0.30', ev(ctx, 'APP_VERSION'));
  }
}

async function main() {
  await testAcctRedoDisplay();
  await testAcctRedoPerSet();
  await testAcctPushButtons();
  await testMasterReceivedAt();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
