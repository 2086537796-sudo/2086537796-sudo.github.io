# paidang-tools — 派单系统运维工具

> 仓库 `2086537796-sudo/2086537796-sudo.github.io` 的 `paidang-tools/` 目录。
> 配套文档：仓库根目录 `HANDOVER.md`（总交接文档，2026-11-22 实测版）。先读 HANDOVER.md 再用这里的工具。
>
> **总规矩：GitHub 推送一律串行，绝不并行**（并行 PUT 会大量 HTTP 409）。推之前先看一眼仓库最近提交时间——若 1 分钟内刚有人推过，等 2 分钟再推。部署后用 GitHub API 直读 SHA 核实，不要只看 CDN（CDN 缓存几分钟，Pages 自身部署可滞后约 11 分钟）。

## 部署（推总包 / 手机端页面）

| 文件 | 干什么 | 怎么用 |
|---|---|---|
| `deploy_master.py` | 把本地 master.html 推到 `paidang/master.html`（Contents API，串行）。推前校验 APP_VERSION，并核对线上当前 sha。 | `python3 deploy_master.py <本地文件> [提交信息]` |
| `deploy_acct.py` | 把本地 acct.html 推到 `paidang/acct.html`（同上）。**只推基于线上 v1.0.25 真件改的 acct.html**，内有 WIP / done_clears 拦截。 | `python3 deploy_acct.py <本地文件> [提交信息]` |

当前线上版本：总包 + 手机端都是 **v1.0.29**（master sha `e64553cd8b04`，acct sha `e975e1220d2d`，2026-11-22 16:08 部署）。源码在本地 `workspace/派单系统/work/`：总包源码是 `master-rule.html`，手机端是 `acct.html`。**永不部署 `acct-WIP-gpt-round2-DO-NOT-DEPLOY.html`**（GPT round-2 半成品，已封存）。

## 入池与二维码

| 文件 | 干什么 | 怎么用 |
|---|---|---|
| `auto_pool.py` | 扫描源文件夹，把干净的 3 图套入池：原样复制图片到 `data/`，追加 products.json。**2026-11-22 16:17 原图铁规后已改成原样复制**（`resize_to_1080` 放大 + 锐化已删，勿恢复）。只认 `图N.jpg` / `图N-vN.jpg`（`图N-1080.jpg` 不认，入池前改名）；只处理 3 图套，4 图套手动入池；每次跑会把源文件夹里所有 ready 的套都入池（含未验的），跑完必须删掉未验的新套。 | `python3 auto_pool.py --pool`（先看 `--help` / `--dry-run`） |
| `feishu_qr_to_cart.py` | 读飞书「图文选品」四个表，把二维码解成 TikTok affiliate 链接，写入 products.json 的 cart_url。**只补没有码的套，已有码的绝不覆盖。**凭证从环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 读，绝不写进文件。 | `FEISHU_APP_ID=... FEISHU_APP_SECRET=... ~/workspace/.venv-qr/bin/python feishu_qr_to_cart.py`（约 5 分钟） |
| `pool102_list.py` | 102 套入池清单（2026-11-22 审计 B1：89 直接 + 13 小问题；新套号从 269 起按此顺序编）。字段：(pid, style_no, title_cn, title_en)。 | 清单文件，供 `pool102_apply.py` 读 |
| `pool102_apply.py` | 把 POOL102 的 102 套入池（本地部分）：原样复制图片到 data/，追加 products.json。不做任何图片处理，不推 GitHub（推图另有脚本）。 | `python3 work/pool102_apply.py [--dry-run]` |

## 测试与模拟（改代码前必跑）

| 文件 | 干什么 | 怎么用 |
|---|---|---|
| `test-v1023-redo.js`（19 项）→ `test-v1029.js`（45 项） | 各版本回归测试：v1023 重做、v1024 防重、v1025 GPT round-1、v1026 缩水警告、v1027 一品分号、v1028 补货、v1029 重做套号显示 + 一键直推。**合计 181 项，0 失败是上线前提。**跑法是把 master.html / acct.html 的 `<script>` 抽进 `vm.runInContext` 跑真实代码（`let` 变量不在 global 上）。 | `node test-v102X.js`（退出码 0 = 全过） |
| `test-auto.js` | 自动派单逻辑测试（早期版，47 项）。 | `node test-auto.js`（退出码 0 = 全过） |
| `sim_boot.js`、`sim_resort.js`、`sim_resort2.js`、`sim_resort3.js`、`sim_resort4.js` | 启动链 / 重排模拟：用真实 Firebase 队 + 真实 products.json 跑 `computeAutoQueues()`，看算出的队对不对，再决定要不要上线。 | `node sim_boot.js` 等（先读文件头注释） |

## 图片比对、推送、验证

| 文件 | 干什么 | 怎么用 |
|---|---|---|
| `compare_images.py` | 比对本地 `data/` 与线上 `paidang/data/`，输出缺失 / 内容不一致两类清单（写 `image_push_list.json`）。 | `python3 compare_images.py` |
| `push_images.py` | 串行推图片到 GitHub（Contents API）。先推内容不一致，再推缺失。断点续推（状态存 `image_push_state.json`）；失败重试一次后记入失败清单。 | `python3 push_images.py` |
| `push_restore.py` | 同上，专用于还原原图批次（状态存 `restore_push_state.json`）。 | `python3 push_restore.py` |
| `verify_cdn.py` | 从 CDN 下载指定图算 Laplacian，与本地比对；另抽查 5 张主图.jpg。Laplacian 只作参考，**再也不触发任何处理**（原图铁规）。 | `python3 verify_cdn.py` |
| `restore_originals.py` | 把 data/ 里被放大/锐化过的图，字节级原样拷回源文件夹的生成原图（768×1024，不放大、不锐化、不重编码），再配 `push_restore.py` 重推。2026-11-22 已跑完：435/435 推完，失败 0。 | 按文件头注释操作；跑完用 `verify_cdn.py` 抽查 |

## ⚠️ push_queues.js — 危险品，标注勿用

| 文件 | 干什么 | 为什么标危险 |
|---|---|---|
| `push_queues.js` | 在 VM 里跑总包算队逻辑（用 Firebase 的队 + done 重建），把算出的队直接 PUT 回 Firebase。 | **不要在总包页开着时用。**2026-11-22 15:26 实测：推了 116 套，2 分钟后被用户开着的总包页用本地更全的 doneMap 重算覆盖回 88 套。**总包页才是队的主。**留在这里只作历史记录和离线模拟参考。 |

## 故意没放进来的东西

- `repo/`（git 克隆）、`data.bak-q80-*`（旧版备份）、`acct-WIP-gpt-round2-DO-NOT-DEPLOY.html`（半成品，永不部署）。
- `fix_q80_images.py`、`repool_all.py`（放大/锐化/重编码流程，2026-11-22 16:17 原图铁规后**全部停用**，勿恢复）。
- `products.json`、`master.html`、`acct.html` 本体（已在 `paidang/` 线上位置，不重复放）。
- 私有凭据文件、源图文件夹（`workspace/新品-双风格-2026-11-21/`，太大；data/ 里已有入池图）、各旁聊记录、用户个人文件。

## 常用核实命令

```bash
# 线上版本（API 直读，1.5 秒生效，别只看 CDN）
gh api repos/2086537796-sudo/2086537796-sudo.github.io/contents/paidang/master.html --jq '.sha'
# 最近提交（推之前看一眼，1 分钟内有人推过就等 2 分钟）
gh api repos/2086537796-sudo/2086537796-sudo.github.io/commits?per_page=3 --jq '.[] | .commit.author.date + " " + .commit.message'
# Firebase 各号队
curl -s https://paidang-sync-default-rtdb.firebaseio.com/paidang/queue/acct1.json
```
