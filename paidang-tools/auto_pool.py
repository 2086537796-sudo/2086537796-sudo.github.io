#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动入池 auto_pool.py —— 生产好的图文套自动进派单池。

扫描 delivery 根目录（新品-双风格-2026-11-21/<pid>/风格N-xxx/）：
- 每张图默认选最新版：图N.jpg 算 v1，图N-v2.jpg / 图N-v3.jpg … 取版本号最高的那个
  （用户 2026-11-21 22:56 立规矩：版本图默认选后者，选不了就放弃）。
- 缺图的（图1/2/3 任一张没有任何版本）跳过并列出来。
- (pid, 风格号) 已在 products.json 里的跳过（幂等，重复跑只进新套）。

【原图直传铁规（用户 2026-11-22 立）：入池一律原图直传，不做任何放大、锐化、重编码。
生成站下载下来是什么样，data/ 里就是什么样，手机下载到的也是原图。
resize_to_1080 已删，改成 copy_original 原样复制；不要再加任何锐化/缩放。】

入池动作（每套）：
- data/ 下新建文件夹 {set_no:02d}-{slug}-风格{style_no}
- 三张图原样拷进去（用选中的版本文件，存成 图1/2/3.jpg；不改尺寸、不重编码、不锐化）
- 主图1.jpg 原样拷进去改名 主图.jpg，做产品原图对照
- products.json 追加一条：set_no 顺延、title_cn 取提示词表、title_en 取内置表
  （内置表没有的 pid 用 title_cn 顶上并打警告，cart_url 留空→卡片显示“需要做码”，
  之后用 feishu_qr_to_cart.py 补）

用法：
  python3 auto_pool.py --dry-run   # 只看会进哪些套，不改任何文件
  python3 auto_pool.py --pool      # 真正入池（先备份 products.json.bak）
"""
import argparse
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))          # workspace/派单系统
WS = os.path.dirname(ROOT)                                  # workspace
SRC_ROOT = os.path.join(WS, "新品-双风格-2026-11-21")
POOL_JSON = os.path.join(ROOT, "products.json")
DATA_DIR = os.path.join(ROOT, "data")
PROMPT_FILES = [
    os.path.join(SRC_ROOT, "提示词.md"),
    os.path.join(SRC_ROOT, "提示词-新5品-2026-11-21.md"),
    os.path.join(SRC_ROOT, "提示词-新5品2-2026-11-21.md"),
    os.path.join(SRC_ROOT, "提示词-67品-2026-11-21.md"),
    os.path.join(SRC_ROOT, "提示词-加急2品-2026-11-21.md"),
]

# pid -> 英文标题（提示词表里没有英文标题，这里人工维护；新品加进来时补一行）。
# 没有的 pid 会用 title_cn 顶上并在报告里打警告。
TITLE_EN = {
    "1729411670017675346": "KODAK Dock Plus 4x6 Photo Printer",
    "1729420976371438117": "PRUNUS J-369 Emergency Weather Radio",
    "1729472017600516508": "Nex Playground Kids Motion Gaming Console",
    "1729554111586341743": "Sylstar 2400LM Rechargeable Work Light Bar",
    "1729623258387353774": "VEVOR 25.4CC Gas Chainsaw 12 Inch",
    "1729700978019176929": "Anua Azelaic Acid 10% Hyaluron Soothing Serum 30ml",
    "1730470200737173796": "Halara UltraSculpt Tummy Control Flare Yoga Pants",
    "1730753543438766332": "BougeRV Outdoor Water Filter Straw 2-Pack",
    "1731690879829578686": "Crocs Adult Classic Lined Clogs",
    "1731884676262629426": "Cymbiotika Liposomal Glutathione 26 Packets",
    "1731964266240381900": "CTOLITY AP400 500W Portable Power Station",
    "1732017379984117841": "Mellow Sleep MarshMellow Double Fill Comforter",
    "1729386189118345319": "GNC W22 Solar Power Bank",
    "1732356168622380010": "Salud 2-in-1 Skin + Beauty Drink Mix Packets, Pomegranate",
    "1731436713834943484": "Efurden 4400-Watts Inverter Generator, Open Frame",
    "1732374724804449255": "Momcozy Wellness 1 Wearable Breast Pump, 180ml",
    "1732394975748198834": "Ribbler 40cm Running Cat Plush Toy with Hood",
    "1732397931521020139": "medicube PDRN Pink Collagen Jelly Eye Mask",
    "1732479640669033376": "Shark FacialPro Glow + DePuffi FH320",
    "1732308279963849156": "Westinghouse Solar Camping Lantern",
    "1732023707344540098": "SKIN1004 Hyalu-Cica Sunscreen Serum 50ml",
    "1732282938510054238": "Ovios 108 Inch U-Shaped Beige Chenille Cloud Sofa",
    "1732328256112661037": "LIBRIDS C600 Portable Power Station",
    "1732406997809468385": "GEYOTO N Series Portable Power Station",
    "1732448481972097354": "SEESE BK2000 Electric Portable Water Purifier",
    "1732475855367279311": "UMAY X5FD Walking Pad (30% Incline)",
    "1732482884355527584": "Shark CryoGlow LED Face Mask FW312",
    "1732726397815263641": "GOPURE MaxLift3 Face & Neck Duo",
    "1729499195713491090": "R&W Co. Highly Scented Mop Soap 32oz",
    "1729397121852085015": "CLEARSTEM MINDBODYSKIN Hormonal Acne Supplement 90 Capsules",
    "1732523065170039712": "Shark Depuffi FH220 Hot/Cold Facial Sculpting Device",
    "1732682338557268686": "LED Drawing Board for Kids",
    "1732729427117446070": "Bellavita Luxury Men's Perfume 4-Piece Set",
    "1732754196310954965": "Men's Funny Christmas Pajama Pants (Fake Butt Print)",
    "1732813210720965507": "Comfrt Half-Zip Hoodie Mega (CloudTouch Thick Fleece)",
    "1732814024146981616": "Electric Windshield Ice Scraper 1600 RPM",
}

BASE_IMAGES = ["图1.jpg", "图2.jpg", "图3.jpg"]
VERSION_RE = re.compile(r"^图([123])-v(\d+)\.jpg$")
BASE_RE = re.compile(r"^图([123])\.jpg$")
STYLE_RE = re.compile(r"^风格(\d+)-(.+)$")

# 爆品 pid：这些品 8 套分到 8 个号（一个号一套），不受同品归一限制。
# 入池时自动给这些 pid 的套打 hot:true；master.html 按 hot 分发。
HOT_PIDS = {
    "1732571163004670880",  # FH310 Shark FacialPro Glow
    "1732479640669033376",  # FH320 Shark FacialPro Glow + DePuffi
}

# 单张指定用哪个版本：(pid, 风格号, 图号) -> 文件名。用户点名要原版时用。
# Mellow 风格3 图1：用户 2026-11-21 22:56 定用原版（不用图1-v2.jpg）。
OVERRIDES = {
    ("1732017379984117841", 3, 1): "图1.jpg",
}


def pick_final(files, pid, sno, img_no):
    """一张图选最终版：版本号最高的（图N.jpg 算 v1）；OVERRIDES 优先。"""
    ov = OVERRIDES.get((pid, sno, img_no))
    if ov and ov in files:
        return ov
    best, best_v = None, 0
    for f in files:
        m = BASE_RE.match(f)
        if m and int(m.group(1)) == img_no and best_v < 1:
            best, best_v = f, 1
            continue
        m = VERSION_RE.match(f)
        if m and int(m.group(1)) == img_no and int(m.group(2)) > best_v:
            best, best_v = f, int(m.group(2))
    return best


def parse_titles():
    """从三份提示词表的产品表里解析 pid -> 品名（title_cn）。"""
    titles = {}
    for f in PROMPT_FILES:
        if not os.path.exists(f):
            continue
        txt = open(f, encoding="utf-8").read()
        for m in re.finditer(r"\|\s*\d+\s*\|\s*(\d{16,})\s*\|\s*([^|]+?)\s*\|", txt):
            pid, name = m.group(1).strip(), m.group(2).strip()
            titles.setdefault(pid, name)
        for m in re.finditer(r"^##\s*\d+\.\s*(.+?)\s*[—-]\s*(\d{16,})", txt, re.M):
            pid, name = m.group(2).strip(), m.group(1).strip()
            titles.setdefault(pid, name)
    return titles


def slugify(title_en):
    """文件夹 slug：英文标题首词，小写，只留字母数字。"""
    w = (title_en or "").split()[0] if (title_en or "").split() else "product"
    w = re.sub(r"[^a-z0-9]", "", w.lower())
    return w or "product"


def copy_original(src, dst):
    """原图直传（用户 2026-11-22 铁规）：字节级原样复制，不改尺寸、不重编码、不锐化。
    生成站下载下来是什么样，data/ 里就是什么样。返回 (动作, None)。
    旧的 resize_to_1080（768->1080 放大 + UnsharpMask 锐化）已删，勿恢复。"""
    if os.path.abspath(src) != os.path.abspath(dst):
        shutil.copyfile(src, dst)
    return "copy-original", None


def scan():
    """返回 (poolable, incomplete)：poolable 是可入池的 (pid, style_no, style_name, style_dir, chosen)，
    chosen 是 {图号: 选中的源文件名}；incomplete 是缺图的 (pid, style_no, style_name, 现有文件)。"""
    poolable, incomplete = [], []
    if not os.path.isdir(SRC_ROOT):
        print("delivery 根目录不存在:", SRC_ROOT)
        return poolable, incomplete
    for pid in sorted(os.listdir(SRC_ROOT)):
        pdir = os.path.join(SRC_ROOT, pid)
        if not pid.isdigit() or not os.path.isdir(pdir):
            continue
        for st in sorted(os.listdir(pdir)):
            sdir = os.path.join(pdir, st)
            if not os.path.isdir(sdir):
                continue
            m = STYLE_RE.match(st)
            if not m:
                continue
            sno, sname = int(m.group(1)), m.group(2)
            files = set(os.listdir(sdir))
            chosen = {}
            missing = []
            for n in (1, 2, 3):
                f = pick_final(files, pid, sno, n)
                if f:
                    chosen[n] = f
                else:
                    missing.append(n)
            if missing:
                incomplete.append((pid, sno, sname, sorted(files)))
                continue
            poolable.append((pid, sno, sname, sdir, chosen))
    return poolable, incomplete


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只看会进哪些套，不改文件")
    ap.add_argument("--pool", action="store_true", help="真正入池")
    args = ap.parse_args()
    if not (args.dry_run or args.pool):
        ap.print_help()
        return 1
    dry = args.dry_run

    titles_cn = parse_titles()
    pool = json.load(open(POOL_JSON, encoding="utf-8"))
    pooled = set()
    for x in pool:
        m = re.search(r"风格\s*(\d+)", x.get("style", ""))
        if m:
            pooled.add((x["pid"], int(m.group(1))))
    next_no = max(x["set_no"] for x in pool) + 1 if pool else 2

    poolable, incomplete = scan()
    todo = [c for c in poolable if (c[0], c[1]) not in pooled]
    already = [c for c in poolable if (c[0], c[1]) in pooled]

    print("池里已有 %d 套，下一 set_no=%d" % (len(pool), next_no))
    print("可入池（未入池）：%d 套" % len(todo))
    print("已在池里：%d 套" % len(already))
    print("缺图（未完成）：%d 套" % len(incomplete))
    for pid, sno, sname, files in incomplete:
        print("  未完成 %s 风格%d %s：现有 %s" % (pid, sno, sname, ",".join(files)))

    if not todo:
        print("没有可入池的新套。")
        return 0

    if dry:
        print("\n--dry-run：下面这些套会被入池（未改文件）--")
    else:
        shutil.copyfile(POOL_JSON, POOL_JSON + ".bak")
        print("已备份 products.json -> products.json.bak")

    new_entries = []
    warnings = []
    for pid, sno, sname, sdir, chosen in todo:
        title_cn = titles_cn.get(pid, "")
        if not title_cn:
            warnings.append("%s：提示词表里找不到品名" % pid)
            title_cn = "未知产品"
        title_en = TITLE_EN.get(pid)
        if not title_en:
            warnings.append("%s：TITLE_EN 里没有英文标题，先用中文标题顶上" % pid)
            title_en = title_cn
        set_no = next_no
        next_no += 1
        folder = "%02d-%s-风格%d" % (set_no, slugify(title_en), sno)
        style = "风格 %d %s" % (sno, sname)
        ver_note = " / ".join("图%d=%s" % (n, chosen[n]) for n in (1, 2, 3))
        if dry:
            print("  第%d套 %s 风格%d %s | %s / %s | %s" % (set_no, pid, sno, sname, title_cn, title_en, ver_note))
            continue
        # 建文件夹、拷图（用选中的版本文件，原样存成 图1/2/3.jpg；不改尺寸、不锐化）
        dest = os.path.join(DATA_DIR, folder)
        os.makedirs(dest, exist_ok=True)
        for n in (1, 2, 3):
            act, _lv = copy_original(os.path.join(sdir, chosen[n]), os.path.join(dest, "图%d.jpg" % n))
            print("    图%d %s（原图直传）" % (n, act))
        # 产品原图对照：主图1.jpg -> 主图.jpg（原样复制）
        ref_src = os.path.join(SRC_ROOT, pid, "主图1.jpg")
        if os.path.exists(ref_src):
            copy_original(ref_src, os.path.join(dest, "主图.jpg"))
        else:
            warnings.append("%s：没有 主图1.jpg，ref 缺失" % pid)
        new_entries.append({
            "set_no": set_no,
            "folder": folder,
            "pid": pid,
            "title_cn": title_cn,
            "title_en": title_en,
            "style": style,
            "images": list(BASE_IMAGES),
            "zip": "第%d套.zip" % set_no,
            "cart_url": "",
            "ref": "主图.jpg",
            **({"hot": True} if pid in HOT_PIDS else {}),
        })
        print("  已入池 第%d套 %s 风格%d %s | %s | %s" % (set_no, pid, sno, sname, title_cn, ver_note))

    if not dry and new_entries:
        pool.extend(new_entries)
        with open(POOL_JSON, "w", encoding="utf-8") as f:
            json.dump(pool, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("\nproducts.json 已更新：%d 套 -> %d 套，新 set_no %d-%d" % (
            len(pool) - len(new_entries), len(pool),
            new_entries[0]["set_no"], new_entries[-1]["set_no"]))
        print("cart_url 全部留空（卡片显示“需要做码”），跑 feishu_qr_to_cart.py 补。")
    if warnings:
        print("\n警告：")
        for w in warnings:
            print("  !", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
