# -*- coding: utf-8 -*-
"""把 POOL102 的 102 套入池（本地部分）：原样复制图片到 data/，追加 products.json。
不做任何图片处理（字节级原样复制）。不推 GitHub（推图另有脚本）。
用法：python3 work/pool102_apply.py [--dry-run]
"""
import json, os, re, shutil, sys

ROOT = '/home/hatch/workspace/派单系统'
SRC_ROOT = '/home/hatch/workspace/新品-双风格-2026-11-21'
POOL_JSON = os.path.join(ROOT, 'products.json')
DATA_DIR = os.path.join(ROOT, 'data')
sys.path.insert(0, os.path.join(ROOT, 'work'))
from pool102_list import POOL102

STYLE_NAMES = {
    1: '通用类', 2: '国防焦虑', 3: '生活化节庆送礼', 4: '沉浸式使用场景',
    5: '拉踩对比', 6: '擦边', 7: '宗教信仰', 8: '送礼', 9: '生活化分享类',
    10: '痛点类', 11: '节日', 12: '第三人称女装', 13: '第一人称女装',
    14: '四宫格小红书', 15: '道德绑架',
}

def pick_final(d, n):
    cands = []
    for fn in os.listdir(d):
        m = re.match(rf'^图{n}(?:-v(\d+))?\.jpg$', fn)
        if m:
            cands.append((int(m.group(1)) if m.group(1) else 1, fn))
    if not cands:
        return None
    cands.sort()
    return cands[-1][1]

def slug_of(title_en, pid):
    words = re.findall(r'[A-Za-z0-9]+', title_en)
    if words:
        return words[0].lower()
    return pid[-4:]

def main():
    dry = '--dry-run' in sys.argv
    prods = json.load(open(POOL_JSON, encoding='utf-8'))
    max_no = max(p['set_no'] for p in prods)
    start = max_no + 1
    print(f'现有 {len(prods)} 套，最大套号 {max_no}，新套号从 {start} 开始')
    new_entries = []
    copied = []
    problems = []
    for i, (pid, st, cn, en) in enumerate(POOL102):
        set_no = start + i
        pdir = os.path.join(SRC_ROOT, pid)
        style_dirs = [d for d in os.listdir(pdir) if re.match(rf'^风格{st}-', d)] if os.path.isdir(pdir) else []
        if len(style_dirs) != 1:
            problems.append((pid, st, f'风格文件夹 {style_dirs}'))
            continue
        sdir = os.path.join(pdir, style_dirs[0])
        chosen = {}
        ok = True
        for n in (1, 2, 3):
            f = pick_final(sdir, n)
            if f is None:
                problems.append((pid, st, f'缺图{n}'))
                ok = False
            else:
                chosen[n] = f
        if not ok:
            continue
        slug = slug_of(en, pid)
        folder = f'{set_no}-{slug}-风格{st}'
        dest = os.path.join(DATA_DIR, folder)
        # 参考图：pid 根目录 主图.jpg 或 主图1.jpg
        ref_src = None
        for cand in ('主图.jpg', '主图1.jpg'):
            if os.path.exists(os.path.join(pdir, cand)):
                ref_src = os.path.join(pdir, cand)
                break
        if not dry:
            os.makedirs(dest, exist_ok=True)
            for n in (1, 2, 3):
                src = os.path.join(sdir, chosen[n])
                dst = os.path.join(dest, f'图{n}.jpg')
                shutil.copyfile(src, dst)  # 字节级原样复制
                copied.append((src, dst))
            if ref_src:
                shutil.copyfile(ref_src, os.path.join(dest, '主图.jpg'))
        entry = {
            'set_no': set_no,
            'folder': folder,
            'pid': pid,
            'title_cn': cn,
            'title_en': en,
            'style': f'风格 {st} {STYLE_NAMES[st]}',
            'images': ['图1.jpg', '图2.jpg', '图3.jpg'],
            'zip': '',
            'cart_url': '',
            'ref': '主图.jpg' if ref_src else '',
        }
        new_entries.append(entry)
    print(f'待入池 {len(new_entries)} 套（新套号 {start}–{start + len(new_entries) - 1}），问题 {len(problems)}')
    for p in problems:
        print('  问题:', p)
    if dry:
        print('dry-run，不写文件')
        return
    # 备份并追加 products.json
    shutil.copyfile(POOL_JSON, POOL_JSON + '.bak-pool102')
    prods.extend(new_entries)
    with open(POOL_JSON, 'w', encoding='utf-8') as f:
        json.dump(prods, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'已追加 products.json：总数 {len(prods)} 套，在用 {sum(1 for p in prods if not p.get("retired"))} 套')
    print(f'已复制图片文件 {len(copied)} 个 + 参考图 {len(new_entries)} 个')
    # 核对字节一致
    bad = 0
    for src, dst in copied:
        if os.path.getsize(src) != os.path.getsize(dst):
            bad += 1
            print('  大小不一致:', src, dst)
    print('字节大小核对不一致:', bad)
    # 写新套清单供推图脚本用
    with open(os.path.join(ROOT, 'work', 'pool102_new.json'), 'w', encoding='utf-8') as f:
        json.dump(new_entries, f, indent=1, ensure_ascii=False)
    print('新套清单已写 work/pool102_new.json')

if __name__ == '__main__':
    main()
