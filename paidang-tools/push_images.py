#!/usr/bin/env python3
"""串行推送 data/ 图片到 GitHub Pages（Contents API）。先推内容不一致，再推缺失。
断点续推：状态存 image_push_state.json；失败重试一次后记入失败清单。"""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.parse, urllib.error

REPO = '2086537796-sudo/2086537796-sudo.github.io'
DATA = os.path.expanduser('~/workspace/派单系统/data')
LIST = os.path.expanduser('~/workspace/派单系统/work/image_push_list.json')
STATE = os.path.expanduser('~/workspace/派单系统/work/image_push_state.json')

def gh_token():
    out = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, check=True)
    return out.stdout.strip()

def api(method, url, token, body=None):
    req = urllib.request.Request(url, method=method,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.status, json.load(r)

def main():
    token = gh_token()
    with open(LIST, encoding='utf-8') as f:
        lst = json.load(f)
    # 顺序：先 mismatch（208），后 missing（571）
    queue = [('mismatch', x) for x in lst['mismatch']] + [('missing', x) for x in lst['missing']]
    total = len(queue)
    state = {'done': [], 'failed': []}
    if os.path.exists(STATE):
        with open(STATE, encoding='utf-8') as f:
            state = json.load(f)
    done = set(state['done'])
    failed = state['failed']
    print(f'total={total} already_done={len(done)} already_failed={len(failed)}', flush=True)

    def save():
        with open(STATE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False)

    pushed = 0
    for idx, (kind, item) in enumerate(queue, 1):
        rel = item['rel']
        if rel in done:
            continue
        fp = os.path.join(DATA, rel)
        if not os.path.exists(fp):
            failed.append({'rel': rel, 'kind': kind, 'err': 'local file gone'})
            print(f'[{idx}/{total}] SKIP local-gone {rel}', flush=True)
            continue
        with open(fp, 'rb') as f:
            data = f.read()
        path = 'paidang/data/' + rel
        url = f'https://api.github.com/repos/{REPO}/contents/{urllib.parse.quote(path)}'
        ok = False
        last_err = ''
        for attempt in (1, 2):
            try:
                body = {'message': f'push image {rel}', 'content': base64.b64encode(data).decode(), 'branch': 'main'}
                if kind == 'mismatch':
                    # 更新需带当前 sha；第一次用清单里的 online_sha，重试时重拉
                    sha = item.get('online_sha') if attempt == 1 else None
                    if sha is None:
                        _s, cur = api('GET', url, token)
                        sha = cur.get('sha')
                    body['sha'] = sha
                status, res = api('PUT', url, token, body)
                if status in (200, 201) and res.get('content', {}).get('sha'):
                    ok = True
                    break
                last_err = f'HTTP {status}: {str(res)[:200]}'
            except urllib.error.HTTPError as e:
                last_err = f'HTTP {e.code}: {e.read()[:200]!r}'
                time.sleep(2)
            except Exception as e:
                last_err = f'{type(e).__name__}: {e}'
                time.sleep(2)
        if ok:
            done.add(rel)
            state['done'] = sorted(done)
            pushed += 1
        else:
            failed.append({'rel': rel, 'kind': kind, 'err': last_err})
            state['failed'] = failed
            print(f'[{idx}/{total}] FAILED {rel} :: {last_err}', flush=True)
        if pushed % 50 == 0 and pushed:
            save()
            print(f'progress: pushed {pushed} this run, total done {len(done)}/{total}, failed {len(failed)}', flush=True)
        # 每 10 张存一次状态，防中断丢失
        if (idx % 10) == 0:
            save()
    save()
    print(f'DONE pushed_this_run={pushed} total_done={len(done)}/{total} failed={len(failed)}', flush=True)
    if failed:
        print('FAILED LIST:', flush=True)
        for x in failed:
            print('  ', x['rel'], '|', x['kind'], '|', x['err'][:150], flush=True)

if __name__ == '__main__':
    main()
