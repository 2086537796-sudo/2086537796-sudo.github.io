#!/usr/bin/env python3
"""从 CDN 下载指定图算 Laplacian，与本地比对；另抽查 5 张主图.jpg。"""
import json, os, sys, urllib.request, urllib.parse, urllib.error
import cv2
import numpy as np

DATA = os.path.expanduser('~/workspace/派单系统/data')
BASE = 'https://2086537796-sudo.github.io/paidang/data/'

# (set_no, 图号) —— 3 号队之前线上更软的 13 张
TARGETS = [(143, 1), (143, 2), (143, 3), (55, 2), (63, 1),
           (267, 1), (267, 2), (267, 3), (131, 1), (131, 2), (131, 3),
           (86, 2), (12, 2)]

def lap_var(img_bytes):
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    return round(float(cv2.Laplacian(img, cv2.CV_64F).var()), 1)

def lap_file(path):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    return round(float(cv2.Laplacian(img, cv2.CV_64F).var()), 1)

def main():
    prods = json.load(open(os.path.expanduser('~/workspace/派单系统/products.json'), encoding='utf-8'))
    by_set = {p['set_no']: p for p in prods}
    print(f'{"套":>4} {"图":>2} {"本地Lap":>8} {"线上Lap":>8} {"差值":>6}  结果')
    bad = []
    for sn, n in TARGETS:
        p = by_set[sn]
        fn = f'图{n}.jpg'
        local = lap_file(os.path.join(DATA, p['folder'], fn))
        url = BASE + urllib.parse.quote(p['folder'] + '/' + fn)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            print(f'{sn:>4} 图{n}  本地 {local}  线上 HTTP {e.code}  FAIL')
            bad.append((sn, n, f'HTTP {e.code}'))
            continue
        except Exception as e:
            print(f'{sn:>4} 图{n}  本地 {local}  线上 ERR {e}  FAIL')
            bad.append((sn, n, str(e)[:60]))
            continue
        online = lap_var(body)
        diff = None if (local is None or online is None) else round(abs(local - online), 1)
        ok = diff is not None and diff <= 1.0
        print(f'{sn:>4} 图{n}  {local:>8} {online:>8} {diff:>6}  {"OK" if ok else "MISMATCH"}')
        if not ok:
            bad.append((sn, n, f'local={local} online={online}'))
    print()
    print('--- 抽查 5 张主图.jpg ---')
    # 找 5 个有主图.jpg 的目录
    mains = []
    for root, _d, files in os.walk(DATA):
        if '主图.jpg' in files:
            mains.append(os.path.relpath(os.path.join(root, '主图.jpg'), DATA))
        if len(mains) >= 5:
            break
    for rel in mains:
        url = BASE + urllib.parse.quote(rel)
        try:
            req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f'  {rel} -> HTTP {r.status}')
                if r.status != 200:
                    bad.append(('main', rel, f'HTTP {r.status}'))
        except urllib.error.HTTPError as e:
            print(f'  {rel} -> HTTP {e.code} FAIL')
            bad.append(('main', rel, f'HTTP {e.code}'))
        except Exception as e:
            print(f'  {rel} -> ERR {e} FAIL')
            bad.append(('main', rel, str(e)[:60]))
    print()
    print('VERIFY', 'PASS' if not bad else f'FAIL {len(bad)} 项: {bad}')

if __name__ == '__main__':
    main()
