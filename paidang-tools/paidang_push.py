#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
paidang_push.py — MUSE 生图/修图专用零依赖 CLI 客户端
======================================================
仅负责把验收通过的原图推入 DMIT 派单总台、拉取修图工单、回传修好后的原图、补充加车码。
不操作任何服务器源码、不修改网页代码。

环境变量配置（或传 --server / --token）：
  PAIDANG_SERVER  例如 https://paidang.179-255-144-162.sslip.io:8443
  PAIDANG_TOKEN   你的 muse_token（或 admin_token）
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Tuple
import urllib.error
import urllib.request
import uuid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _get_cfg(args: argparse.Namespace) -> Tuple[str, str]:
    srv = (getattr(args, "server", None) or os.environ.get("PAIDANG_SERVER") or "").strip().rstrip("/")
    tok = (getattr(args, "token", None) or os.environ.get("PAIDANG_TOKEN") or "").strip()
    if not srv:
        raise SystemExit("缺少 PAIDANG_SERVER 环境变量或 --server 参数")
    return srv, tok


def _req_json(srv: str, tok: str, path: str, method: str = "GET", payload: Any = None) -> Dict[str, Any]:
    headers = {"Accept": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{srv}{path}", data=data, headers=headers, method=method)
    try:
        with _opener().open(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {body}")


def _req_multipart(
    srv: str,
    tok: str,
    path: str,
    fields: Dict[str, str],
    files: List[Tuple[str, Path]],
) -> Dict[str, Any]:
    boundary = "----PaidangBoundary" + uuid.uuid4().hex
    parts: List[bytes] = []
    for k, v in fields.items():
        if v is None or v == "":
            continue
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode("utf-8")
        )
    for field_name, file_path in files:
        p = Path(file_path)
        if not p.is_file():
            raise SystemExit(f"文件不存在: {p}")
        ctype, _ = mimetypes.guess_type(str(p))
        raw = p.read_bytes()
        header = (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{p.name}\"\r\n"
            f"Content-Type: {ctype or 'application/octet-stream'}\r\n\r\n"
        ).encode("utf-8")
        parts.append(header + raw + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
        "Accept": "application/json",
    }
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(f"{srv}{path}", data=body, headers=headers, method="POST")
    try:
        with _opener().open(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_err = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {body_err}")


def cmd_health(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    res = _req_json(srv, tok, "/healthz")
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_push_set(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    fields = {
        "pid": str(args.pid),
        "title_cn": args.title_cn or "",
        "title_en": args.title_en or "",
        "style": args.style or "",
        "cart_url": args.cart_url or "",
        "is_urgent": "1" if args.urgent else "0",
        "is_hot": "1" if args.hot else "0",
        "redo_ticket_id": str(args.redo_ticket) if args.redo_ticket else "",
    }
    files: List[Tuple[str, Path]] = [("images", Path(x)) for x in args.images]
    if args.ref:
        files.append(("ref", Path(args.ref)))
    res = _req_multipart(srv, tok, "/api/sets", fields, files)
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_list_redos(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    q = f"/api/redos?status={args.status}"
    if args.kind:
        q += f"&kind={args.kind}"
    res = _req_json(srv, tok, q)
    for tk in res.get("tickets", []):
        for im in tk.get("bad_images", []):
            im["full_url"] = srv + im["url"]
        if tk.get("ref_url"):
            tk["full_ref_url"] = srv + tk["ref_url"]
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_fix_image(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    fields = {
        "img_idx": str(args.img),
        "resolved_by": args.by or "muse",
        "close": "1",
    }
    res = _req_multipart(srv, tok, f"/api/redos/{args.ticket}/fix-image", fields, [("file", Path(args.file))])
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_set_cart(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    res = _req_json(
        srv, tok, "/api/cart/set", method="POST",
        payload={"pid": str(args.pid), "cart_url": args.url, "overwrite": bool(args.overwrite)},
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_sync_cart(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    raw = json.loads(Path(args.json_file).read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        items = [{"pid": str(k), "cart_url": str(v)} for k, v in raw.items() if v]
    elif isinstance(raw, list):
        items = raw
    else:
        raise SystemExit("JSON 格式需为 {pid: url} 或 [{pid, cart_url}]")
    res = _req_json(
        srv, tok, "/api/cart/sync", method="POST",
        payload={"items": items, "overwrite": bool(args.overwrite)},
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_missing_cart(args: argparse.Namespace) -> None:
    srv, tok = _get_cfg(args)
    res = _req_json(srv, tok, "/api/cart/missing")
    print(json.dumps(res, ensure_ascii=False, indent=2))


def main() -> None:
    p = argparse.ArgumentParser(description="Paidang v2.0 MUSE CLI")
    p.add_argument("--server", help="DMIT 服务地址（默认读 PAIDANG_SERVER）")
    p.add_argument("--token", help="MUSE 访问口令（默认读 PAIDANG_TOKEN）")
    sub = p.add_subparsers(dest="cmd", required=True)

    s_h = sub.add_parser("health", help="查看服务健康与池子统计")
    s_h.set_defaults(func=cmd_health)

    s_p = sub.add_parser("push-set", help="推送一套原图并自动派单")
    s_p.add_argument("--pid", required=True)
    s_p.add_argument("--title-cn", default="")
    s_p.add_argument("--title-en", default="")
    s_p.add_argument("--style", default="")
    s_p.add_argument("--cart-url", default="")
    s_p.add_argument("--images", nargs="+", required=True, help="成图文件路径列表（原图直传，不压缩）")
    s_p.add_argument("--ref", help="产品参考主图路径（可选）")
    s_p.add_argument("--urgent", action="store_true")
    s_p.add_argument("--hot", action="store_true")
    s_p.add_argument("--redo-ticket", type=int, help="如为整组重做回流，填对应工单 ID")
    s_p.set_defaults(func=cmd_push_set)

    s_lr = sub.add_parser("list-redos", help="拉取待处理修图 / 重做工单")
    s_lr.add_argument("--status", default="open", choices=["open", "resolved", "cancelled", "all"])
    s_lr.add_argument("--kind", choices=["image", "set"], default="")
    s_lr.set_defaults(func=cmd_list_redos)

    s_fx = sub.add_parser("fix-image", help="上传修好后的单张原图并自动结单")
    s_fx.add_argument("--ticket", type=int, required=True)
    s_fx.add_argument("--img", type=int, required=True, help="第几张图（如 1 / 2 / 3）")
    s_fx.add_argument("--file", required=True, help="修好的原图路径")
    s_fx.add_argument("--by", default="muse")
    s_fx.set_defaults(func=cmd_fix_image)

    s_sc = sub.add_parser("set-cart", help="为单个 PID 设置加车链接")
    s_sc.add_argument("--pid", required=True)
    s_sc.add_argument("--url", required=True)
    s_sc.add_argument("--overwrite", action="store_true", default=True)
    s_sc.set_defaults(func=cmd_set_cart)

    s_sy = sub.add_parser("sync-cart", help="从 JSON 批量同步加车链接")
    s_sy.add_argument("--json-file", required=True)
    s_sy.add_argument("--overwrite", action="store_true", default=False)
    s_sy.set_defaults(func=cmd_sync_cart)

    s_mc = sub.add_parser("missing-cart", help="查看当前缺加车码的活跃 PID")
    s_mc.set_defaults(func=cmd_missing_cart)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
