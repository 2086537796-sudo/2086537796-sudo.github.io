#!/usr/bin/env python3
"""部署 master.html 到 GitHub Pages（Contents API，串行推送）。
用法：python3 deploy_master.py <本地文件> [提交信息]
部署前会校验本地文件的 APP_VERSION，并核对线上当前 sha。
"""
import base64, json, subprocess, sys, urllib.request, urllib.parse

REPO = "2086537796-sudo/2086537796-sudo.github.io"
PATH = "paidang/master.html"

def gh_token():
    out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True)
    return out.stdout.strip()

def api(method, url, token, body=None):
    req = urllib.request.Request(url, method=method,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def main():
    local = sys.argv[1]
    msg = sys.argv[2] if len(sys.argv) > 2 else "deploy master.html"
    data = open(local, "rb").read()
    # 校验 APP_VERSION
    text = data.decode("utf-8")
    import re
    m = re.search(r"const APP_VERSION = '([^']+)'", text)
    print("本地 APP_VERSION:", m.group(1) if m else "未找到！")
    token = gh_token()
    url = f"https://api.github.com/repos/{REPO}/contents/{urllib.parse.quote(PATH)}"
    cur = api("GET", url, token)
    print("线上当前 sha:", cur["sha"], "| size:", cur["size"])
    body = {"message": msg, "content": base64.b64encode(data).decode(), "sha": cur["sha"], "branch": "main"}
    res = api("PUT", url, token, body)
    print("部署成功，新 sha:", res["content"]["sha"], "| size:", res["content"]["size"])
    print("commit:", res["commit"]["sha"][:12])

if __name__ == "__main__":
    main()
