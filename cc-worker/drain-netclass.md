---
description: 用本地 Claude Code 消化 netclass-sidekick 题库队列（零 API 费）
argument-hint: "[数量=10] [--platform chaoxing|zhihuishu|unipus] [--type single|multi|judge|fill]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
---

# /drain-netclass — 消化 netclass-sidekick 题库 pending 队列

你现在是 netclass-sidekick 服务的答题 worker。每次运行从服务端拉 N 道待处理题，
用你的推理能力（数学题配合 vision 看合成图）答完，批量回写。

## 参数

`$ARGUMENTS` — 通常一个数字比如 `10`。也支持 `--platform X` / `--type Y` 过滤。

默认 `count=10`。

## 环境

凭据存在 `~/.netclass-drain.env`：
```bash
NETCLASS_SERVER=http://182.254.180.181:8080
NETCLASS_ADMIN_KEY=<X-Admin-Key>
```

Phase 0 服务端：腾讯云轻量 Node + Hono + better-sqlite3（commit cde7115 迁移）。
`ADMIN_KEY` 由 `deploy/scripts/init.sh` 首次部署时生成并打印到 SSH 控制台一次。

如果 env 文件不存在，停下并告诉用户：
> 找不到 `~/.netclass-drain.env`。在项目根目录跑 `./cc-worker/install.sh` 初始化。

## 工作流

### 步骤 1 — 拉取 pending 队列

把 `$ARGUMENTS` 解析为 `COUNT`（默认 10）+ 可选过滤（`--platform`、`--type`）。
**先加载 env**，这样 `NETCLASS_SERVER` 和 `NETCLASS_ADMIN_KEY` 对后续每个 curl 都可见。

```bash
set -a && source ~/.netclass-drain.env && set +a
curl -sS -H "X-Admin-Key: $NETCLASS_ADMIN_KEY" \
     "$NETCLASS_SERVER/admin/pending?limit=${COUNT:-10}" \
     > /tmp/netclass-pending.json

# 校验
jq '.items | length' /tmp/netclass-pending.json
```

用 Read 读 `/tmp/netclass-pending.json`。如果 `items` 为空，打印"队列空，无事可做"并退出。

### 步骤 2 — 逐条处理

对 `items` 里每个 `item`：

1. **若有图片，先下载**（R2 公共 URL，无 referer 限制）：
   ```bash
   [ -n "$IMG_URL" ] && curl -sS -o /tmp/nc-q-${ID}.png "$IMG_URL"
   ```

2. **Read 题目信息**：
   - 从 `/tmp/netclass-pending.json` 拿到 text、options、tex_spans
   - 若下载了 `composite_image_url`，Read `/tmp/nc-q-${ID}.png` 作为 vision 输入

3. **推理答案**：
   - 单选：找正确字母
   - 多选：找所有正确字母
   - 判断题：true / false
   - 填空：给出准确答案文本
   - 若把握不到 ≥ 0.7，**不提交**，标记 uncertain 并在 `note` 写原因

4. **构造 JSON 条目**：
   ```json
   {
     "id": "<hash>",
     "answer": {"value": "D", "raw": ["D"]},
     "confidence": 0.95,
     "source": "cc_drain",
     "note": "代入 y(0)=1 得 C=1，特解 y=x²+1 → D"
   }
   ```

汇总成一个数组。

### 步骤 3 — 批量提交

用 Write 工具把数组写进 `/tmp/netclass-answers.json`，然后 POST：

```bash
curl -sS -X POST \
     -H "X-Admin-Key: $NETCLASS_ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/netclass-answers.json \
     "$NETCLASS_SERVER/admin/submit"
```

### 步骤 4 — 汇报

展示给用户：

```
drain 完成 — 10 题耗时 2 分 34 秒
  ✓ 已入库：8   （写入 D1 questions 表）
  ⚠ 不确定：1   （置信度 < 0.7，保留在 pending 等复审）
  ✗ 已拒绝：1   （已被其他人回答过）
```

列出 uncertain / rejected 条目的 ID + 备注。

### 步骤 5 — 清理

```bash
rm -f /tmp/netclass-pending.json /tmp/netclass-answers.json /tmp/nc-q-*.png
```

## 规则

1. **置信度 < 0.7 绝不提交** — 标记 uncertain 即可。质量优先于吞吐。
2. **题目模糊**（如"谈谈你对 X 的看法"这种主观题），跳过并 `note: "主观题，需人工复审"`。
3. **图片下载失败**（R2 403 或网络问题），跳过并记录原因。**没图别硬答**。
4. **连续 3 条失败**就停整批 — 服务端或队列可能挂了。
5. **只通过 `/admin/submit` API 回写**，绝不手写 SQL 改 pending 队列。
6. **绝不放 cron 里自动跑** — 本命令必须手动触发。

## 故障排查

- `401 admin_required` — Admin key 过时或拼错。SSH 上服务端：编辑 `/opt/netclass/server/.env` 的 `ADMIN_KEY=...`，跑 `sudo systemctl restart netclass`。同步更新 `~/.netclass-drain.env`。
- `/admin/pending` 返回 503 或连接拒绝 — 服务端挂了。SSH 看日志：`sudo journalctl -u netclass -n 100 --no-pager`。
- `curl: (7) Failed to connect` — IP 变了 / 防火墙拦了 / 腾讯云安全组改了。腾讯云控制台确认 8080 端口对 0.0.0.0/0 开放。
- Read 读 PNG 失败 — 服务端 STORAGE 未启用（Phase 0 R2 可选，Node 本地盘 fallback 待 Phase 1 接入）。当前 Phase 0 纯文本题能答，数学题需等 R2 或本地盘落地。
- Vision 看公式模糊 — 客户端 vision/compose 合图 bug。提 issue 指向 `client/src/vision/compose.ts`。
