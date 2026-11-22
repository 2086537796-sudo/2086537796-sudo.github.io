#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
还原原图 restore_originals.py —— 把 data/ 里被 resize_to_1080 处理过的图，
字节级原样拷回源文件夹的生成原图（768x1024，不放大、不锐化、不重编码）。

用户铁规（2026-11-22 16:17）：不要乱操作锐化，锐化痕迹很重；
生成出来下载的是原图、传输的是原图、手机下载还是原图。
以后入池一律原图直传（auto_pool.py 已改成原样复制）。

源文件夹查找（按优先级）：
  1. 新品-双风格-2026-11-21/<pid>/风格<N>-*/（风格号与 products.json 的 style 一致）
  2. 新品6件/<pid>/（扁平）
  3. 新品8件/<pid>/（扁平）
  4. Cider 套2：对标视频/taylorbise/换脸/图N-换脸v2.jpg
  套22/23（OQ/Mamushow 新版）：新品6件/<pid>/图N-新.jpg
选版规则与 auto_pool.py 一致：图N.jpg 算 v1，图N-vM.jpg 取版本号最高的；
OVERRIDES（Mellow 风格3 图1 用原版图1.jpg）优先。

用法：
  python3 restore_originals.py --dry-run   # 只比对、不改文件
  python3 restore_originals.py --apply     # 真正拷回原图
报告写到 work/restore_report.json
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # workspace/派单系统
WS = os.path.dirname(ROOT)
SRC_ROOT = os.path.join(WS, "新品-双风格-2026-11-21")
SIX_ROOT = os.path.join(WS, "新品6件")
EIGHT_ROOT = os.path.join(WS, "新品8件")
CIDER_DIR = os.path.join(WS, "对标视频", "taylorbise", "换脸")
POOL_JSON = os.path.join(ROOT, "products.json")
DATA_DIR = os.path.join(ROOT, "data")
REPORT = os.path.join(ROOT, "work", "restore_report.json")

STYLE_RE = re.compile(r"^风格(\d+)-(.+)$")
VER_RE = re.compile(r"^图(\d+)-v(\d+)\.jpg$")
BASE_RE = re.compile(r"^图(\d+)\.jpg$")
NEW_RE = re.compile(r"^图(\d+)-新\.jpg$")
CIDER_RE = re.compile(r"^图(\d+)-换脸v(\d+)\.jpg$")

OVERRIDES = {
    ("1732017379984117841", 3, 1): "图1.jpg",
}
# 特殊套：指定源文件名（按 图号 -> 文件名）
SPECIAL_SRC = {
    2: {1: "图1-换脸v2.jpg", 2: "图2-换脸v2.jpg", 3: "图3-换脸v2.jpg"},
    22: {1: "图1-新.jpg", 2: "图2-新.jpg", 3: "图3-新.jpg"},
    23: {1: "图1-新.jpg", 2: "图2-新.jpg", 3: "图3-新.jpg"},
}


def blob_sha(fp):
    data = open(fp, "rb").read()
    h = hashlib.sha1()
    h.update(b"blob %d\x00" % len(data))
    h.update(data)
    return h.hexdigest()


def file_sha(fp):
    return hashlib.sha1(open(fp, "rb").read()).hexdigest()


def pick_final(files, img_no, override=None):
    """一张图选最终版：版本号最高的（图N.jpg 算 v1）；OVERRIDES 优先。"""
    if override and override in files:
        return override
    best, best_v = None, 0
    for f in files:
        m = BASE_RE.match(f)
        if m and int(m.group(1)) == img_no and best_v < 1:
            best, best_v = f, 1
            continue
        m = VER_RE.match(f)
        if m and int(m.group(1)) == img_no and int(m.group(2)) > best_v:
            best, best_v = f, int(m.group(2))
    return best


def candidate_dirs(pid, sno):
    """按优先级返回候选源目录列表。"""
    dirs = []
    pdir = os.path.join(SRC_ROOT, pid)
    if sno is not None and os.path.isdir(pdir):
        for st in sorted(os.listdir(pdir)):
            m = STYLE_RE.match(st)
            if m and int(m.group(1)) == sno:
                dirs.append(os.path.join(pdir, st))
    for base in (SIX_ROOT, EIGHT_ROOT):
        d = os.path.join(base, pid)
        if os.path.isdir(d):
            dirs.append(d)
    return dirs


def resolve_source(p, img_no, data_fn):
    """返回 (源文件绝对路径, 来源说明)，找不到返回 (None, 原因)。"""
    set_no = p["set_no"]
    pid = p["pid"]
    style = p.get("style", "")
    m = re.search(r"风格\s*(\d+)", style)
    sno = int(m.group(1)) if m else None

    # 特殊套：指定文件名
    if set_no in SPECIAL_SRC and img_no in SPECIAL_SRC[set_no]:
        want = SPECIAL_SRC[set_no][img_no]
        search = []
        if set_no == 2:
            search = [CIDER_DIR]
        else:
            search = [os.path.join(SIX_ROOT, pid)]
        for d in search:
            fp = os.path.join(d, want)
            if os.path.exists(fp):
                return fp, "特殊指定 %s" % want
        return None, "特殊指定文件 %s 不存在" % want

    dirs = candidate_dirs(pid, sno)
    if set_no == 2:
        dirs.append(CIDER_DIR)
    if not dirs:
        return None, "无候选源目录（pid %s 风格 %s）" % (pid, sno)

    # 数据文件名本身就是版本名：按精确文件名全目录搜
    vm = VER_RE.match(data_fn)
    if vm:
        for d in dirs:
            fp = os.path.join(d, data_fn)
            if os.path.exists(fp):
                return fp, "精确版本名 %s @ %s" % (data_fn, os.path.basename(d))
        return None, "版本文件 %s 在候选目录里都不存在" % data_fn

    # 未版本化：按优先级，在第一个能选出该图号的目录里取最高版
    for d in dirs:
        files = set(os.listdir(d))
        ov = OVERRIDES.get((pid, sno, img_no))
        f = pick_final(files, img_no, ov)
        if f:
            return os.path.join(d, f), "pick_final %s @ %s" % (f, os.path.basename(d))
    return None, "候选目录里都没有 图%d 的任何版本" % img_no


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.print_help()
        return 1
    apply = args.apply

    pool = json.load(open(POOL_JSON, encoding="utf-8"))
    restored, identical, missing, mtime_flags = [], [], [], []
    total = 0
    for p in pool:
        for fn in (p.get("images") or []):
            total += 1
            dst = os.path.join(DATA_DIR, p["folder"], fn)
            if not os.path.exists(dst):
                missing.append({"set_no": p["set_no"], "file": fn,
                                "reason": "data 缺失 %s" % dst})
                continue
            vm = VER_RE.match(fn)
            bm = BASE_RE.match(fn)
            img_no = int((vm or bm).group(1)) if (vm or bm) else None
            if img_no is None:
                missing.append({"set_no": p["set_no"], "file": fn,
                                "reason": "文件名格式不明"})
                continue
            src, how = resolve_source(p, img_no, fn)
            if not src:
                missing.append({"set_no": p["set_no"], "file": fn,
                                "reason": how})
                continue
            if blob_sha(src) == blob_sha(dst):
                identical.append({"set_no": p["set_no"], "file": fn})
                continue
            # 时间 sanity：源文件若比 data 文件新，可能是入池后新生成的版本，标记出来
            if os.path.getmtime(src) > os.path.getmtime(dst):
                mtime_flags.append({"set_no": p["set_no"], "file": fn,
                                    "src": src, "how": how})
            entry = {"set_no": p["set_no"], "folder": p["folder"], "file": fn,
                     "src": src, "how": how,
                     "src_size": os.path.getsize(src),
                     "dst_size": os.path.getsize(dst),
                     "src_sha": file_sha(src)[:12],
                     "dst_sha": file_sha(dst)[:12]}
            if apply:
                shutil.copyfile(src, dst)
                # 校验拷完字节一致
                if file_sha(src) != file_sha(dst):
                    entry["copy_ok"] = False
                    missing.append({"set_no": p["set_no"], "file": fn,
                                    "reason": "拷贝后 SHA 不一致！"})
                    continue
                entry["copy_ok"] = True
            restored.append(entry)

    print("总图数（products.json images 计）: %d" % total)
    print("已是原图（跳过）: %d" % len(identical))
    print("需还原（内容不同）: %d" % len(restored))
    print("找不到源：%d" % len(missing))
    for x in missing:
        print("  缺失 套%s %s：%s" % (x["set_no"], x["file"], x["reason"]))
    print("源比 data 新的标记（入池后可能新生成，需人工确认）: %d" % len(mtime_flags))
    for x in mtime_flags:
        print("  标记 套%s %s：%s" % (x["set_no"], x["file"], x["how"]))
    if apply:
        print("已拷回原图：%d 张" % len([r for r in restored if r.get("copy_ok")]))
    else:
        print("--dry-run，未改文件--")

    report = {"total": total, "identical": len(identical),
              "restored": restored, "missing": missing,
              "mtime_flags": mtime_flags, "applied": apply}
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print("报告已写：%s" % REPORT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
