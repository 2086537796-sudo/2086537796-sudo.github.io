#!/usr/bin/env python3
"""飞书选品表二维码 -> TikTok 加购物车链接 -> 写进派单系统 products.json。
v3（2026-11-22 修订）：全面版——一次读全四个表，冲突自动裁决。

用法（凭证从环境变量读，不写进文件）：
    FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx python3 feishu_qr_to_cart.py

流程：
  1. 用 App ID/Secret 换 tenant_access_token（带重试）；
  2. 读「图文选品」表（G9bywokl3iyBFnk8lNFckSWvndg）中全部四个 sheet：
       爆品TAP码（820a36，A 列 pid、D 列生码）、
       测试已出单&趋势品（PSnY8Q，A 列 pid、E 列生码）、
       杰-内容图文选品（ym6FPH，A 列 pid、D 列 TAP码）、
       精选必做（pnv0AT，A 列 pid、D 列 TAP码）；
     每个 pid 把四个表里所有能解出的二维码链接都收集起来；
  3. 只处理派单池 products.json 里的 pid（不在池子里的不管）；
  4. 通过 Drive API 下载二维码图，用 OpenCV 解码成 TikTok affiliate 链接；
  5. 链接裁决（解决同一个 pid 在不同表里码不一样的问题，2026-11-22
     Sweetcrispy 毛巾桶实测：爆品TAP码的码是错的，杰-内容图文选品的才是对的）：
       - 四个表解出的链接都一样 -> 直接用；
       - 不一样 -> 查冲突行 B 列有没有产品图，有产品图的行优先；
         再按表优先：精选必做 > 杰-内容图文选品 > 爆品TAP码 > 测试已出单&趋势品；
       - 冲突明细写进 qr_links.json 的 conflicts，人工复核；
  6. 把链接写进 products.json 的 cart_url 字段（手机端 acct.html 的卡片上会
     出现「🛒 加购物车（跳 TikTok）」按钮，一点就跳 TikTok 加购）；
  7. 打印汇总：解出几个、冲突几个、哪几个 pid 表里没有、哪几个有 pid 但没二维码。

加固点（沿用 v2，见下）：
  a. 所有 API 调用都带 3 次重试 + 退避；
  b. A 列和二维码列分段拉（每段 1000 行），不一次拉 5600 行；
  c. 同一个 pid 有多行时，把所有带 fileToken 的行都记下来，逐个试着解；
  d. 疑似缺失的 pid 做二次确认：直接拉那一行 A:Z 全列再看一遍；
  e. 下载和解码各重试一次，解码失败先试放大 2 倍再解。
"""
import json, os, sys, time

SHEET_TOKEN = "G9bywokl3iyBFnk8lNFckSWvndg"
# 四个表都可能有 pid 和二维码（用户 2026-11-22 01:33 截图确认第四个 tab 存在，
# 浏览器 2026-11-22 01:50 核实：第四个 tab 叫「精选必做」，sheet_id pnv0AT，
# A=产品id、B=产品图、C=店铺图、D=TAP码、E=对标网址1、F=对标网址2）。
SHEETS = [
    {"sheet_id": "820a36", "name": "爆品TAP码", "pid_col": "A", "qr_col": "D"},
    {"sheet_id": "PSnY8Q", "name": "测试已出单&趋势品", "pid_col": "A", "qr_col": "E"},
    {"sheet_id": "ym6FPH", "name": "杰-内容图文选品", "pid_col": "A", "qr_col": "D"},
    {"sheet_id": "pnv0AT", "name": "精选必做", "pid_col": "A", "qr_col": "D"},
]
# 冲突裁决时表的优先级（有产品图的表更可信：行里带产品图说明码和品对得上；
# 爆品TAP码行里经常只有 pid+码，曾出现错码）。
SHEET_PRIORITY = {"精选必做": 0, "杰-内容图文选品": 1, "爆品TAP码": 2, "测试已出单&趋势品": 3}
BASE = "/home/hatch/workspace/派单系统"
PRODUCTS_JSON = os.path.join(BASE, "products.json")
OUT_JSON = os.path.join(BASE, "qr_links.json")
MAX_ROW = 5600
CHUNK = 1000
TRIES = 3


def api(method, url, **kw):
    """带重试的通用请求：网络抖动、5xx、飞书 code!=0 都重试。"""
    import requests
    last = None
    for i in range(TRIES):
        try:
            r = requests.request(method, url, timeout=90, **kw)
            r.raise_for_status()
            d = r.json()
            if isinstance(d, dict) and d.get("code") not in (None, 0):
                raise RuntimeError(f"feishu code={d.get('code')} msg={d.get('msg')}")
            return d
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise last


def get_token(app_id, app_secret):
    d = api("post",
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret})
    return d["tenant_access_token"]


def get_values(token, sheet_id, rng):
    d = api("get",
            (f"https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/"
             f"{SHEET_TOKEN}/values/{sheet_id}!{rng}"),
            headers={"Authorization": f"Bearer {token}"})
    return d["data"]["valueRange"].get("values", [])


def decode_qr(img_path):
    import cv2
    img = cv2.imread(img_path)
    if img is None:
        return ""
    det = cv2.QRCodeDetector()
    data, _, _ = det.detectAndDecode(img)
    if not data:
        img2 = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        data, _, _ = det.detectAndDecode(img2)
    return data or ""


def download_qr(token, file_token, tag):
    """下载二维码图，带一次重试；返回本地路径，失败返回 None。"""
    import requests
    url = f"https://open.feishu.cn/open-apis/drive/v1/medias/{file_token}/download"
    headers = {"Authorization": f"Bearer {token}"}
    for i in range(2):
        try:
            resp = requests.get(url, headers=headers, timeout=60)
            if resp.status_code == 200 and resp.content:
                path = f"/tmp/qr_{tag}.png"
                open(path, "wb").write(resp.content)
                return path
        except Exception:
            pass
        time.sleep(2)
    return None


def row_has_image(token, sheet_id, row):
    """查某一行 B 列（产品图）有没有图。"""
    try:
        vals = get_values(token, sheet_id, f"B{row}:B{row}")
        cell = vals[0][0] if vals and vals[0] else None
        return isinstance(cell, dict) and bool(cell.get("fileToken"))
    except Exception:
        return False


def main():
    import requests
    app_id = os.environ.get("FEISHU_APP_ID")
    app_secret = os.environ.get("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        print("请设置环境变量 FEISHU_APP_ID 和 FEISHU_APP_SECRET 再跑。")
        sys.exit(1)

    token = get_token(app_id, app_secret)
    print("token OK，正在分段读四个表的 pid 列和二维码列 ...")
    # 每个表：pid -> {"code": [(行号, fileToken)], "rows": [出现过的所有行号]}
    sheet_maps = []
    for s in SHEETS:
        col_a, col_q = [], []
        for start in range(1, MAX_ROW + 1, CHUNK):
            end = min(start + CHUNK - 1, MAX_ROW)
            col_a += get_values(token, s["sheet_id"], f"{s['pid_col']}{start}:{s['pid_col']}{end}")
            col_q += get_values(token, s["sheet_id"], f"{s['qr_col']}{start}:{s['qr_col']}{end}")
        m = {}
        for i, r in enumerate(col_a):
            if r and r[0] and "产品id" not in str(r[0]):
                pid = str(r[0]).strip()
                cell = col_q[i][0] if i < len(col_q) and col_q[i] else None
                ft = cell.get("fileToken") if isinstance(cell, dict) else None
                ent = m.setdefault(pid, {"code": [], "rows": []})
                ent["rows"].append(i + 1)
                if ft:
                    ent["code"].append((i + 1, ft))
        sheet_maps.append((s, m))
        with_code = sum(1 for v in m.values() if v["code"])
        print(f"  {s['name']}：{len(m)} 个 pid，其中 {with_code} 个带二维码")

    pool = json.load(open(PRODUCTS_JSON))
    pool_pids = sorted(set(s["pid"] for s in pool))
    print(f"派单池 {len(pool_pids)} 个 pid")

    links, missing, no_code, conflicts = {}, [], [], []
    for pid in pool_pids:
        # 四个表全部解一遍，收集所有链接（带表名、行号）
        cands = []  # [{sheet, row, link}]
        for s, m in sheet_maps:
            ent = m.get(pid)
            if not ent:
                continue
            for row, ft in ent["code"]:
                path = download_qr(token, ft, f"{pid}_{s['sheet_id']}_{row}")
                if not path:
                    continue
                data = decode_qr(path)
                if data:
                    cands.append({"sheet": s["name"], "sheet_id": s["sheet_id"],
                                  "row": row, "link": data})
        if not cands:
            # 没解出来：二次确认——直接拉这一行 A:Z 再看一遍，排除当时没加载出来的误判
            present_anywhere = any(pid in m for _, m in sheet_maps)
            if present_anywhere:
                confirmed_empty = True
                for s, m in sheet_maps:
                    ent = m.get(pid)
                    if not ent:
                        continue
                    for row in ent["rows"]:
                        full = get_values(token, s["sheet_id"], f"A{row}:Z{row}")
                        qi = ord(s["qr_col"]) - 65
                        cell = full[0][qi] if full and full[0] and len(full[0]) > qi else None
                        if isinstance(cell, dict) and cell.get("fileToken"):
                            confirmed_empty = False
                if confirmed_empty:
                    no_code.append({"pid": pid,
                                    "reason": "二次确认：表里有 pid，但二维码格子确实是空的"})
                else:
                    no_code.append({"pid": pid,
                                    "reason": "二次确认发现有码但前面下载/解码失败，请重跑"})
            else:
                missing.append(pid)
            time.sleep(0.1)
            continue

        uniq = sorted(set(c["link"] for c in cands))
        if len(uniq) == 1:
            links[pid] = uniq[0]
            continue

        # 冲突：同一个 pid 在不同表/行解出不一样的链接 -> 裁决
        for c in cands:
            c["has_image"] = row_has_image(token, c["sheet_id"], c["row"])
        # 有产品图的行优先；再按表优先级
        cands.sort(key=lambda c: (0 if c["has_image"] else 1, SHEET_PRIORITY[c["sheet"]]))
        chosen = cands[0]
        links[pid] = chosen["link"]
        conflicts.append({"pid": pid, "chosen": chosen,
                          "candidates": cands,
                          "note": "多个表解出不同链接，按 有产品图>表优先级 裁决，人工复核"})
        print(f"CONFLICT {pid}：{len(uniq)} 个不同链接，选用 [{chosen['sheet']} row {chosen['row']}]"
              f"（有产品图={chosen['has_image']}）-> {chosen['link']}")
        time.sleep(0.1)

    # 写回 products.json：只补没有码的套，已有码的绝不动（2026-11-22 教训：v3
    # 曾把 17 个线上正在用的链接换成另一张表里没验证过的链接，差点全换错；
    # 已确认错的链接（如 Sweetcrispy）由人工改，脚本不自动覆盖）
    n = 0
    skipped = 0
    for s in pool:
        if s["pid"] in links:
            if not s.get("cart_url"):
                s["cart_url"] = links[s["pid"]]
                n += 1
            else:
                skipped += 1
    json.dump(pool, open(PRODUCTS_JSON, "w"), ensure_ascii=False, indent=2)
    json.dump({"links": links, "conflicts": conflicts,
               "missing_from_sheet": missing, "no_code": no_code},
              open(OUT_JSON, "w"), ensure_ascii=False, indent=2)

    print(f"\n完成：解出 {len(links)} 个链接（{len(conflicts)} 个冲突已裁决），新补了 {n} 套图的 cart_url，已有码跳过 {skipped} 套")
    print(f"四个表里都没有的 pid（{len(missing)}）：{missing}")
    print(f"有 pid 但二维码格子是空的（{len(no_code)}）：")
    for f in no_code:
        print("  ", f["pid"], "-", f["reason"])
    if conflicts:
        print(f"冲突明细（{len(conflicts)}）：")
        for c in conflicts:
            print("  ", c["pid"], "选用", c["chosen"]["sheet"], "row", c["chosen"]["row"],
                  "->", c["chosen"]["link"])
            for cand in c["candidates"]:
                if cand is not c["chosen"]:
                    print("      备选", cand["sheet"], "row", cand["row"],
                          "有产品图=", cand["has_image"], "->", cand["link"])
    print("\n改完 products.json 后记得重新部署派单站，手机端才会出现加购物车按钮。")


if __name__ == "__main__":
    main()
