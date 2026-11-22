#!/usr/bin/env python3
"""比对本地 data/ 与线上 paidang/data/，输出缺失 / 内容不一致两类清单。"""
import hashlib, json, os, subprocess, sys, urllib.request

DATA = os.path.expanduser('~/workspace/派单系统/data')
OUT = os.path.expanduser('~/workspace/派单系统/work/image_push_list.json')

def gh_token():
    out = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, check=True)
    return out.stdout.strip()

def blob_sha(data: bytes) -> str:
    h = hashlib.sha1()
    h.update(b'blob %d\0' % len(data))
    h.update(data)
    return h.hexdigest()

def main():
    tok = gh_token()
    req = urllib.request.Request(
        'https://api.github.com/repos/2086537796-sudo/2086537796-sudo.github.io/git/trees/main?recursive=1',
        headers={'Authorization': f'Bearer {tok}', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        tree = json.load(r)
    print('tree truncated:', tree.get('truncated'), 'entries:', len(tree.get('tree', [])))
    online = {}
    for t in tree.get('tree', []):
        if t['type'] == 'blob' and t['path'].startswith('paidang/data/'):
            online[t['path'][len('paidang/data/'):]] = t['sha']
    print('online data files:', len(online))

    missing, mismatch, ok = [], [], 0
    local_files = []
    for root, _dirs, files in os.walk(DATA):
        for fn in files:
            if fn.lower().endswith(('.jpg', '.jpeg', '.png')):
                local_files.append(os.path.join(root, fn))
    print('local image files:', len(local_files))
    for fp in sorted(local_files):
        rel = os.path.relpath(fp, DATA)
        with open(fp, 'rb') as f:
            data = f.read()
        sha = blob_sha(data)
        if rel not in online:
            missing.append({'rel': rel, 'sha': sha, 'size': len(data)})
        elif online[rel] != sha:
            mismatch.append({'rel': rel, 'sha': sha, 'size': len(data), 'online_sha': online[rel]})
        else:
            ok += 1
    print('identical:', ok, '| missing:', len(missing), '| mismatch:', len(mismatch))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'missing': missing, 'mismatch': mismatch, 'identical': ok}, f, ensure_ascii=False)
    print('written:', OUT)

if __name__ == '__main__':
    main()
