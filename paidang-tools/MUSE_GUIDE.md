# MUSE 生图 & 修图协作规范（`paidang v2.0`）

> **分工边界**：**DMIT 服务端全面托管派单、防重复与手机端状态**；MUSE **只做 3 件事**：
> 1. 生成高质量、1:1 对版原图并自检；
> 2. 推图入库（自动分号派单）；
> 3. 拉取手机提交的修图/重做工单，修完传回替换。
> **严禁修改服务器文件、严禁对成图做放大/锐化/重新压缩编码（必须原图字节直传）。**

---

## 零、一次性环境变量设置（不要把 Token 写进 Git 或任何代码）

```bash
export PAIDANG_SERVER="https://paidang.179-255-144-162.sslip.io:8443"
export PAIDANG_TOKEN="<管理员发给你的 muse_token>"
```

检查连通性：
```bash
python3 paidang_push.py health
```

---

## 一、推送一套新生成的原图（自动秒派）

```bash
python3 paidang_push.py push-set \
  --pid 1732416036567814805 \
  --title-cn "产品中文标题" \
  --title-en "English Title" \
  --style "风格9" \
  --images /path/to/图1.jpg /path/to/图2.jpg /path/to/图3.jpg \
  --ref /path/to/主图.jpg
```
- 如果已有加车码，可加 `--cart-url "https://affiliate-us.tiktok.com/..."`；不填时总台会自动沿用同 PID 已有加车码。
- 如果是加急或爆品，可分别加上 `--urgent` 或 `--hot`。
- 推送后接口会**立即返回分配的 `set_no` 和目标账号**，无需再推 GitHub 或打开浏览器算队。

---

## 二、查看并处理手机提交的修图 / 重做工单

1. **拉取所有未处理的修图单**：
```bash
python3 paidang_push.py list-redos
```
每条工单会直接给出 `id`、`kind`（`image` 单张修图 / `set` 整组重做）、`img_indices`（坏掉的图号）、`reasons`、`note`、坏图原图下载直链 `full_url` 以及产品参考图直链 `full_ref_url`。

2. **如果是 `kind = "image"`（单张修图）** —— 下载原图按理由修好或重新生图后，上传替换该张（自动版本化 `v2` 并秒关工单，手机刷新立刻看到新图）：
```bash
python3 paidang_push.py fix-image \
  --ticket 12 \
  --img 2 \
  --file /path/to/修好的图2.jpg
```

3. **如果是 `kind = "set"`（整组重做）** —— 换新风格生完一整套后，带 `--redo-ticket <工单ID>` 推图即可（总台会自动把旧套退役，并将新套插回原账号队首）：
```bash
python3 paidang_push.py push-set \
  --redo-ticket 15 \
  --pid 1732416036567814805 \
  --title-cn "产品中文标题" \
  --style "风格12" \
  --images /path/to/图1.jpg /path/to/图2.jpg /path/to/图3.jpg \
  --ref /path/to/主图.jpg
```

---

## 三、补充 / 同步飞书加车码

- 查看当前缺码的活跃 PID：
```bash
python3 paidang_push.py missing-cart
```
- 从 `qr_links.json` 批量同步（`{pid: url}` 格式）：
```bash
python3 paidang_push.py sync-cart --json-file qr_links.json
```
- 单个补码：
```bash
python3 paidang_push.py set-cart --pid 1732416036567814805 --url "https://affiliate-us.tiktok.com/..."
```
