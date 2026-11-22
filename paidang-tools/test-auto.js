// 派单系统 · 自动派单逻辑测试
// 跑真实代码：把 master.html / acct.html 的 <script> 放进 vm，用 stub 的 localStorage / DOM / fetch 跑起来再断言。
// 用法：node test-auto.js   （退出码 0 = 全部通过）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(DIR, 'products.json'), 'utf-8'));

function extractScript(file) {
  const html = fs.readFileSync(path.join(DIR, file), 'utf-8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no script in ' + file);
  return m[1];
}
const MASTER_JS = extractScript('master.html');
const ACCT_JS = extractScript('acct.html');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b }); }

// ---------- stub ----------
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
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    style: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); if (f) this._s.add(c); else this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); },
    },
    _listeners: {},
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach(c => this.children.push(c)); },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    click() {},
    focus() {},
    select() {},
    textContent: '',
    hidden: false,
    value: '',
    disabled: false,
    checked: false,
  };
  // 像真浏览器一样：写 innerHTML 会清空子节点（页面靠 listEl.innerHTML='' 清列表）
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = String(v); el.children = []; },
    configurable: true,
  });
  return el;
}

function makeContext({ url, storage, confirmRet }) {
  const u = new URL(url);
  const byId = {};
  const documentStub = {
    _byId: byId,
    getElementById(id) {
      if (!byId[id]) byId[id] = makeEl('div');
      return byId[id];
    },
    createElement(tag) { return makeEl(tag); },
    createTextNode(t) { return { textContent: String(t), nodeType: 3 }; },
    querySelector(sel) {
      if (!byId['qs:' + sel]) byId['qs:' + sel] = makeEl('div');
      return byId['qs:' + sel];
    },
    querySelectorAll() { return []; },
    body: makeEl('body'),
  };
  const ctx = {
    console,
    setTimeout, clearTimeout,
    URL, URLSearchParams,
    encodeURI, decodeURI,
    JSON, Math, Date, RegExp, Array, Object, Set, Map, Promise,
    location: {
      origin: u.origin,
      pathname: u.pathname,
      href: u.href,
      search: u.search,
    },
    history: { replaceState() {} },
    navigator: {},
    confirm: () => (confirmRet === undefined ? true : confirmRet),
    alert() {},
    fetch: () => Promise.resolve({ ok: true, json: async () => PRODUCTS }),
    localStorage: storage,
    document: documentStub,
    scrollTo() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

async function loadScript(ctx, js) {
  vm.runInContext(js, ctx);
  await new Promise(r => setTimeout(r, 60)); // 等 fetch().then 跑完（PRODUCTS 加载 + 初始 render）
}

// 从手机列表里读出卡片的套号（卡片 h2 是“第N套（完整版）”）
function listSetNos(ctx) {
  const list = ctx.document.getElementById('list');
  const out = [];
  for (const card of list.children) {
    const head = card.children && card.children[0];
    const h2 = head && head.children && head.children[0];
    if (h2 && typeof h2.textContent === 'string') {
      const m = h2.textContent.match(/第(\d+)套/);
      if (m) out.push(parseInt(m[1], 10));
    }
  }
  return out;
}
function pidsOfSets(setNos) {
  return setNos.map(n => { const p = PRODUCTS.find(x => x.set_no === n); return p ? String(p.pid) : null; });
}
function pidOfSet(n) { const p = PRODUCTS.find(x => x.set_no === n); return p ? String(p.pid) : null; }

// 新算法不变量检查（多处复用）：队 = computeAutoQueues() 返回的 { "1": [...], ... }
function queueIds(q) { return Object.keys(q).sort((a, b) => a - b); }
function allQueuedSets(q) { return queueIds(q).map(id => q[id]).flat(); }
function checkQueueInvariants(q, label) {
  const ids = queueIds(q);
  const dupInQueue = ids.some(id => { const ps = pidsOfSets(q[id]); return new Set(ps).size !== ps.length; });
  ok(!dupInQueue, label + '：每队内 pid 不重复');
  const pidToAccts = {};
  ids.forEach(id => { pidsOfSets(q[id]).forEach(pid => { (pidToAccts[pid] = pidToAccts[pid] || []).push(id); }); });
  const pairSplit = Object.values(pidToAccts).every(a => new Set(a).size === a.length);
  ok(pairSplit, label + '：同 pid 的两套在不同号');
  return pidToAccts;
}
function checkDescending(q, label) {
  const desc = a => a.every((v, i) => i === 0 || a[i - 1] > v);
  ok(queueIds(q).every(id => desc(q[id])), label + '：每队内 set_no 从大到小');
}

// ---------- master 测试 ----------
async function masterTests() {
  console.log('== master.html 自动排队 ==');

  // 1. 全新状态：44 套全进队、8 个号都有套、分配均匀（6/6/6/6/5/5/5/5）、每队内降序
  {
    const storage = makeStorage({});
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    const ids = queueIds(q);
    eq(ids, ['1', '2', '3', '4', '5', '6', '7', '8'], '全新：8 个号都有队');
    const all = allQueuedSets(q);
    eq(all.length, 44, '全新：44 套全进队');
    eq(new Set(all).size, 44, '全新：44 套无重复');
    const pidToAccts = checkQueueInvariants(q, '全新');
    ok(Object.keys(pidToAccts).length === 29, '全新：覆盖全部 29 个 pid');
    checkDescending(q, '全新');
    eq(ids.map(id => q[id].length), [6, 6, 6, 6, 5, 5, 5, 5], '全新：各队长度 6/6/6/6/5/5/5/5');
    eq(q['1'], [45, 37, 29, 21, 13, 5], '全新：账号 1 队内容');
    eq(q['2'], [44, 36, 28, 20, 12, 4], '全新：账号 2 队内容');
    eq(q['3'], [43, 35, 27, 19, 11, 3], '全新：账号 3 队内容');
    eq(q['4'], [42, 34, 26, 18, 10, 2], '全新：账号 4 队内容');
    eq(q['5'], [41, 33, 25, 17, 9], '全新：账号 5 队内容');
    eq(q['6'], [40, 32, 24, 16, 8], '全新：账号 6 队内容');
    eq(q['7'], [39, 31, 23, 15, 7], '全新：账号 7 队内容');
    eq(q['8'], [38, 30, 22, 14, 6], '全新：账号 8 队内容');
    const link1 = ctx.buildAutoLink(1);
    ok(link1.startsWith('https://example.com/paidang/acct.html?a=1&auto=1&q='), '自动链接格式 a=1&auto=1&q=', link1.slice(0, 90));
    ok(link1.split('q=')[1].split(',').length === 6, '自动链接 q 里是整条队（6 个）');
  }

  // 2. 增量追加：已有队保序（队首不动），新套只往队尾追加；44 套全进队
  //    注意 45/44 是同 pid（红大衣两套），预置队用 pid 互不相同的套才符合真实队的状态
  {
    const storage = makeStorage({
      paidang_auto_q_a1: JSON.stringify([45, 43]),
      paidang_auto_q_a2: JSON.stringify([42, 41]),
    });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    eq(q['1'].slice(0, 2), [45, 43], '增量：账号 1 队首 [45,43] 不动');
    eq(q['2'].slice(0, 2), [42, 41], '增量：账号 2 队首 [42,41] 不动');
    const all = allQueuedSets(q);
    eq(all.length, 44, '增量：追加后 44 套全进队');
    eq(new Set(all).size, 44, '增量：44 套无重复');
    const pidToAccts = checkQueueInvariants(q, '增量');
    ok(Object.keys(pidToAccts).length === 29, '增量：追加后仍覆盖 29 个 pid');
    checkDescending(q, '增量');
    eq(queueIds(q).map(id => q[id].length), [6, 6, 6, 6, 5, 5, 5, 5], '增量：各队长度 6/6/6/6/5/5/5/5');
    eq(q['1'], [45, 43, 29, 20, 13, 5], '增量：账号 1 队内容');
    eq(q['2'], [42, 41, 28, 21, 12, 4], '增量：账号 2 队内容');
    eq(q['3'], [44, 35, 27, 19, 11, 3], '增量：账号 3 队内容');
    eq(q['4'], [40, 34, 26, 17, 10, 2], '增量：账号 4 队内容');
    eq(q['5'], [39, 33, 25, 18, 9], '增量：账号 5 队内容');
    eq(q['6'], [38, 32, 24, 16, 8], '增量：账号 6 队内容');
    eq(q['7'], [37, 31, 23, 15, 7], '增量：账号 7 队内容');
    eq(q['8'], [36, 30, 22, 14, 6], '增量：账号 8 队内容');
  }

  // 3. 已做完的 pid 不进队（同 pid 的另一套也不进）
  {
    const pid45 = pidOfSet(45);
    const storage = makeStorage({ paidang_done: JSON.stringify({ [pid45]: { account: 1, time: 1 } }) });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    const all = allQueuedSets(q);
    ok(!all.includes(45) && !all.includes(44), '已做完：pid 的两套（44/45）都不进队');
    eq(all.length, 42, '已做完：剩下 42 套');
    ok(new Set(pidsOfSets(all)).size === 28, '已做完：剩下 28 个 pid');
  }

  // 4. 人工派单占用的 pid 不进自动队
  {
    const storage = makeStorage({ paidang_assign: JSON.stringify({ '1': [45, 44] }) });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    const all = allQueuedSets(q);
    ok(!all.includes(45) && !all.includes(44), '人工占用：45/44 不进自动队');
    ok(!pidsOfSets(all).includes(pidOfSet(45)), '人工占用：该 pid 不在任何自动队里');
  }

  // 5. 重做回流只回原号、插队首；另一号的回流不进这号的队
  {
    const pidWig = pidOfSet(10); // OQ 假发，套 10 和 22
    const storage = makeStorage({
      paidang_auto_q_a1: JSON.stringify([45, 44, 43]),
      paidang_auto_q_a2: JSON.stringify([42, 41, 40]),
      paidang_redo: JSON.stringify([
        { pid: pidWig, account: 1, set_no: 10, title_cn: 'OQ', time: 1, status: 'returned' },
        { pid: pidOfSet(24), account: 2, set_no: 24, title_cn: 'Dowinx', time: 1, status: 'returned' },
      ]),
    });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    eq(q['1'][0], 10, '重做回流：账号 1 的回流套 10 插到队首');
    ok(q['1'].slice(1, 4).join(',') === '45,44,43', '重做回流：原有队 [45,44,43] 顺序不动，跟在回流后面');
    ok(!q['2'].includes(10) && !q['2'].includes(22), '重做回流：账号 1 的回流不进账号 2 的队');
    ok(q['2'][0] === 24, '重做回流：账号 2 自己的回流套 24 在它队首');
    ok(!q['1'].includes(24), '重做回流：账号 2 的回流不进账号 1 的队');
    const link1 = ctx.buildAutoLink(1);
    ok(link1.includes('&cr=' + pidWig), '重做回流：自动链接带 cr= 清手机重做标记', link1.slice(-80));
  }

  // 6. 重做回流被别的号占住 pid 时不插（等对方腾出来）
  {
    const pidWig = pidOfSet(10);
    const storage = makeStorage({
      paidang_auto_q_a1: JSON.stringify([45, 44]),
      paidang_auto_q_a2: JSON.stringify([22, 42, 41]), // 22 是同 pid 的另一套，被 2 号占着
      paidang_redo: JSON.stringify([
        { pid: pidWig, account: 1, set_no: 10, title_cn: 'OQ', time: 1, status: 'returned' },
      ]),
    });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    ok(!q['1'].includes(10), '重做回流被占：pid 在 2 号队里，1 号队不插套 10');
    ok(q['2'].includes(22), '重做回流被占：2 号队里的套 22 不动');
  }

  // 7. 待重做（pending）的 pid 不进队
  {
    const pidWig = pidOfSet(10);
    const storage = makeStorage({
      paidang_redo: JSON.stringify([
        { pid: pidWig, account: 1, set_no: 10, title_cn: 'OQ', time: 1, status: 'pending' },
      ]),
    });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    const all = allQueuedSets(q);
    ok(!all.includes(10) && !all.includes(22), '待重做：pid 的两套都不进队');
  }

  // 8. pidState 跨模式防重复：自动队里的 pid，人工派单也派不出去
  {
    const storage = makeStorage({ paidang_auto_q_a1: JSON.stringify([45, 44]) });
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const st = ctx.pidState(pidOfSet(45));
    eq(st.state, 'assigned', '跨模式：自动队里的 pid 状态是已派');
    eq(st.account, 1, '跨模式：自动队里的 pid 属于账号 1');
    const p45 = PRODUCTS.find(x => x.set_no === 45);
    ok(ctx.canDispatch(p45, 2).ok === false, '跨模式：人工不能把自动队里的 pid 派给账号 2');
    ok(ctx.canDispatch(p45, 1).ok === false, '跨模式：人工也不能重复派给同一号（已在队里）');
  }

  // 9. 真实池子（products.json：44 套、29 个 pid）全新跑一遍：44 套全进队、8 个号都有套、
  //    同号内无重复 pid、同 pid 的两套在不同号、每队降序、分配均匀
  {
    const storage = makeStorage({});
    const ctx = makeContext({ url: 'https://example.com/paidang/master.html', storage });
    await loadScript(ctx, MASTER_JS);
    const q = ctx.computeAutoQueues();
    const ids = queueIds(q);
    ok(ids.length === 8 && ids.every(id => q[id].length > 0), '真实池子：8 个号都有套', ids.map(id => q[id].length));
    const all = allQueuedSets(q);
    eq(all.length, 44, '真实池子：44 套全进队');
    eq(new Set(all).size, 44, '真实池子：44 套无重复');
    const pidToAccts = checkQueueInvariants(q, '真实池子');
    ok(Object.keys(pidToAccts).length === 29, '真实池子：覆盖全部 29 个 pid');
    checkDescending(q, '真实池子');
    const lens = ids.map(id => q[id].length);
    ok(Math.max(...lens) - Math.min(...lens) <= 1, '真实池子：分配均匀（最大队与最小队差 ≤1）', lens);
    // 锁定各号分到的套号（全新状态的标准答案）
    eq(q['1'], [45, 37, 29, 21, 13, 5], '真实池子：账号 1 分到 [45,37,29,21,13,5]');
    eq(q['2'], [44, 36, 28, 20, 12, 4], '真实池子：账号 2 分到 [44,36,28,20,12,4]');
    eq(q['3'], [43, 35, 27, 19, 11, 3], '真实池子：账号 3 分到 [43,35,27,19,11,3]');
    eq(q['4'], [42, 34, 26, 18, 10, 2], '真实池子：账号 4 分到 [42,34,26,18,10,2]');
    eq(q['5'], [41, 33, 25, 17, 9], '真实池子：账号 5 分到 [41,33,25,17,9]');
    eq(q['6'], [40, 32, 24, 16, 8], '真实池子：账号 6 分到 [40,32,24,16,8]');
    eq(q['7'], [39, 31, 23, 15, 7], '真实池子：账号 7 分到 [39,31,23,15,7]');
    eq(q['8'], [38, 30, 22, 14, 6], '真实池子：账号 8 分到 [38,30,22,14,6]');
  }
}

// ---------- acct 测试 ----------
async function acctTests() {
  console.log('== acct.html 自动模式 ==');
  const Q25 = Array.from({ length: 25 }, (_, i) => 45 - i); // 45..21

  // 1. 首组 = 队里前 10 个未消费的套
  {
    const storage = makeStorage({});
    const ctx = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + Q25.join(','), storage });
    await loadScript(ctx, ACCT_JS);
    eq(listSetNos(ctx), [45, 44, 43, 42, 41, 40, 39, 38, 37, 36], '手机首组：队里前 10 个');
  }

  // 2. 刷新取下一组：10 → 10 → 5 → 空（提示队发完了）
  {
    const storage = makeStorage({});
    const ctx = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + Q25.join(','), storage });
    await loadScript(ctx, ACCT_JS);
    ctx.refreshBatch();
    eq(listSetNos(ctx), [35, 34, 33, 32, 31, 30, 29, 28, 27, 26], '刷新 1 次：下一组 10 个');
    ctx.refreshBatch();
    eq(listSetNos(ctx), [25, 24, 23, 22, 21], '刷新 2 次：最后一组 5 个');
    ctx.refreshBatch();
    eq(listSetNos(ctx), [], '刷新 3 次：队空了，不出空组');
    const emptyText = ctx.document.getElementById('empty').textContent;
    ok(emptyText.includes('这条队的货发完了') && emptyText.includes('找总包要新链接'), '队空提示：显示“这条队的货发完了，找总包要新链接”', emptyText);
  }

  // 3. 已做完的套跳过（按 pid 记：45 和 44 是同 pid，标 45 的 pid 做完会连 44 一起跳过）
  {
    const storage = makeStorage({ paidang_done_a1: JSON.stringify({ [pidOfSet(45)]: true, [pidOfSet(43)]: true }) });
    const ctx = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + Q25.join(','), storage });
    await loadScript(ctx, ACCT_JS);
    eq(listSetNos(ctx), [42, 41, 40, 39, 38, 37, 36, 35, 34, 33], '已做完跳过：45/44/43 不在首组里，往后补位');
  }

  // 4. 新链接不丢已做完记录：同一台手机，先开旧队链接做了一组，再开新队链接，已做完的仍被跳过
  {
    const storage = makeStorage({ paidang_done_a1: JSON.stringify({ [pidOfSet(45)]: true }) });
    const qOld = Q25.join(',');
    const qNew = Array.from({ length: 30 }, (_, i) => 45 - i).join(','); // 45..16
    const ctx1 = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + qOld, storage });
    await loadScript(ctx1, ACCT_JS);
    eq(listSetNos(ctx1)[0], 43, '新链接前：旧队首组跳过已做完的 45（同 pid 的 44 也一起跳过），从 43 开始');
    ctx1.refreshBatch(); // 把首组标为已看过
    const ctx2 = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + qNew, storage });
    await loadScript(ctx2, ACCT_JS);
    const batch = listSetNos(ctx2);
    ok(!batch.includes(45) && !batch.includes(44), '新链接：已做完的 45（同 pid 的 44）仍被跳过');
    eq(batch, [43, 42, 41, 40, 39, 38, 37, 36, 35, 34], '新链接：从队首未消费的重新开始（已跳过记录已重置）');
  }

  // 5. cr 清重做标记 + 把重做套从“已跳过”里放出来
  {
    const pid40 = pidOfSet(40);
    const storage = makeStorage({
      paidang_redo_a1: JSON.stringify({ [pid40]: { time: 1, set_no: 40, title_cn: 'x' } }),
      paidang_auto_seen_a1: JSON.stringify([40]),
    });
    const ctx = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + Q25.join(',') + '&cr=' + pid40, storage });
    await loadScript(ctx, ACCT_JS);
    const batch = listSetNos(ctx);
    ok(batch.includes(40), 'cr：重做套 40 重新出现在组里', batch);
    ok(!JSON.parse(storage.getItem('paidang_redo_a1') || '{}')[pid40], 'cr：本机重做标记已清除');
  }

  // 6. 人工模式行为不变：s= 链接照旧，刷新按产品顺序拉下一组
  //    （注：套 1 已随 VGR 下架，池子从套 2 开始，故用 s=2,3,4）
  {
    const storage = makeStorage({});
    const ctx = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&s=2,3,4', storage });
    await loadScript(ctx, ACCT_JS);
    eq(listSetNos(ctx), [2, 3, 4], '人工：s= 链接照旧显示 2,3,4');
    ctx.refreshBatch();
    eq(listSetNos(ctx), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14], '人工：刷新按产品顺序拉下一组 5..14');
    const title = ctx.document.getElementById('acctTitle').textContent;
    ok(!title.includes('自动'), '人工：标题不带自动标记', title);
  }

  // 7. 自动模式标题带标记；没 q 的自动链接给明确提示
  {
    const storage = makeStorage({});
    const ctx = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1&q=' + Q25.join(','), storage });
    await loadScript(ctx, ACCT_JS);
    ok(ctx.document.getElementById('acctTitle').textContent.includes('自动派单'), '自动：标题带“自动派单”标记');
    const storage2 = makeStorage({});
    const ctx2 = makeContext({ url: 'https://example.com/paidang/acct.html?a=1&auto=1', storage: storage2 });
    await loadScript(ctx2, ACCT_JS);
    const err = ctx2.document.getElementById('errorBox').textContent;
    ok(err.includes('自动链接') && err.includes('没有排队信息'), '自动：没 q 的链接给明确提示', err);
  }
}

(async () => {
  await masterTests();
  await acctTests();
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本出错：', e); process.exit(2); });
