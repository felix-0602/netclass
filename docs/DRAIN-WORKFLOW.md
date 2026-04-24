# Drain Workflow — 用本地 Claude Code 订阅消化题库队列

> **核心思路**：服务端**不**调任何付费 AI API。所有题目审核、答题都靠 Founder（你）在本地 Claude Code（VSCode 或 terminal）里手动触发 `/drain-netclass` 完成。
> 这样：
> 1. 零 API 费（走你 CC Max 订阅额度）
> 2. 质量最高（每道题你亲自把关的 CC 出答案）
> 3. 合规风险最小（不存在"商用调 API"的痕迹）
>
> 代价：**延迟从秒级变成小时级**。你必须接受用户看到"已提交审核，稍后命中"的异步 UX。

## 1. 一次 drain 做什么

```
你 → 打开 VSCode → 开 Claude Code 窗口 → 输入:  /drain-netclass 10

     ┌────────────────────────────────────────────────┐
     │  drain-netclass.md 执行                         │
     │  ─────────────────────────────                  │
     │  1. Bash:  curl GET /admin/pending?limit=10     │
     │            → 拿 10 条 JSON 存 /tmp/pending.json │
     │                                                 │
     │  2. Read:  /tmp/pending.json                    │
     │     对每条：                                     │
     │       ├─ 若 composite_image_url 存在：           │
     │       │    Bash curl -o /tmp/q_<hash>.png        │
     │       │    Read /tmp/q_<hash>.png               │
     │       └─ 综合题干 + 选项 + 图片作答              │
     │                                                 │
     │  3. 对每题输出 {id, answer, confidence, note}   │
     │                                                 │
     │  4. Bash:  curl POST /admin/submit              │
     │            with batched answers                 │
     │                                                 │
     │  5. 打印 summary:                               │
     │     - accepted: 10                              │
     │     - rejected: 0                               │
     │     - elapsed: 2m 13s                           │
     └────────────────────────────────────────────────┘

     → D1 questions 表入库                             
     → 下次用户访问同题 → /answer 命中，0 延迟返回
```

## 2. 安装手册

### 2.1 一次性配置

```bash
# 1. 在项目根
cd d:\Projects\learning

# 2. 运行安装脚本（建立 symlink 或 copy 到 ~/.claude/commands/）
./cc-worker/install.sh
#    → 把 cc-worker/drain-netclass.md 同步到 ~/.claude/commands/drain-netclass.md

# 3. 配置服务端地址 + admin key（本地 env，不 commit）
cat > ~/.netclass-drain.env <<EOF
NETCLASS_SERVER=https://netclass-sidekick.<你的账户>.workers.dev
NETCLASS_ADMIN_KEY=<从服务端部署时拿到的 X-Admin-Key>
EOF
chmod 600 ~/.netclass-drain.env
```

### 2.2 日常使用

打开 VSCode → Claude Code 面板（或 terminal 里 `claude`）→ 输入：

```
/drain-netclass 10
```

参数可选：
- `10` = 本次处理多少题（默认 5，推荐一次 10-20 题）
- `--platform chaoxing` = 只处理某平台
- `--type single` = 只处理单选（先易后难）
- `--priority 8+` = 只处理高优先级（付费用户触发的题）

## 3. drain-netclass.md 文件结构

文件位置：`cc-worker/drain-netclass.md`（项目内开发）+ `~/.claude/commands/drain-netclass.md`（运行时）。

```markdown
---
description: Drain pending netclass question queue via local Claude Code
allowed-tools:
  - Bash
  - Read
  - Write
---

# Drain Netclass Question Queue

Process $ARGUMENTS pending questions from the netclass-sidekick server.

Usage: `/drain-netclass [count=10] [--platform X] [--type Y]`

## Step 1 — Load env + pull queue

Load env:
!`source ~/.netclass-drain.env`

Pull N pending items:
!`curl -s -H "X-Admin-Key: $NETCLASS_ADMIN_KEY" \
      "$NETCLASS_SERVER/admin/pending?limit=$ARGUMENTS" \
      > /tmp/netclass-pending.json`

Read the queue:
→ Read /tmp/netclass-pending.json

## Step 2 — For each pending question

(You, Claude, do this)

For each item in `items`:
  - If `composite_image_url` is present:
    !`curl -s -o /tmp/netclass-q-{id}.png "{composite_image_url}"`
    → Read /tmp/netclass-q-{id}.png
  - Based on `text`, `options`, and the image (if any), determine the correct answer.
  - Assign a confidence score (0.0 - 1.0). Below 0.7 → mark uncertain.
  - Write a one-line `note` explaining your reasoning.

Collect all answers into a single JSON array.

## Step 3 — Submit batch

Write array to temp file:
→ Write /tmp/netclass-answers.json with the batch

POST to admin:
!`curl -s -X POST \
      -H "X-Admin-Key: $NETCLASS_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d @/tmp/netclass-answers.json \
      "$NETCLASS_SERVER/admin/submit"`

## Step 4 — Summary

Print:
  - Total processed
  - Accepted (D1 insertion succeeded)
  - Rejected (with reasons)
  - Uncertain (confidence < 0.7, will need re-review)
  - Elapsed time
```

## 4. CC Read 工具对图片的支持

Claude Code 的 `Read` 工具**原生支持** PNG/JPG 图像——读一张图就相当于把那张图作为 vision 输入。经测试（见 `docs/recon/reconnaissance-2026-04-24.md` § 更新 1）识别率 100%。

## 5. 延迟模型 + 用户预期管理

| 场景 | 延迟 |
|---|---|
| 题库已命中（cache） | 30-200ms |
| 首次触发 pending，Founder 在线立即处理 | ~5-15 分钟 |
| Founder 睡觉 / 上课 | 下次你触发 drain 之前都不会处理 |
| 热门题（同一题多用户触发） | 先触发者等，后触发者直接命中 |

**对客户端 UX 的要求**：
- 遇 pending → 不阻塞，跳过或让用户手填
- UI 显示"题库暂无此题，已提交审核，稍后再试会命中"
- 提供"手动标记此题我答了"按钮 → 走 `/contribute`

## 6. 何时不用 drain 而必须迁走

| 触发器 | 应对 |
|---|---|
| DAU > 30 | 评估是否上 DeepSeek API 作为 drain fallback（pending >10 分钟自动走 API） |
| 单次 drain 题 >50 | 你的 CC 订阅 5h 限额会顶到，分批 |
| Anthropic ToS 审查 | 立即切走 DeepSeek / Qwen / Azure |
| 你考试周 / 出行 | 给 drain 接第二人（co-founder）或启用 fallback |

## 7. 常见问题排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `curl: (6) Could not resolve host` | Server 地址错 | 检查 `$NETCLASS_SERVER` |
| `401 admin_required` | Admin Key 错 | 重新从 wrangler secret get 拿 |
| `Read 图片失败` | R2 URL 403 | R2 bucket 未设 public；wrangler r2 bucket update --public |
| `CC 说"我不确定"` | 图片糊 / 题目描述不清 | 打 confidence < 0.7 标记，submit 后 Admin 页面单独复审 |
| `drain 半天只处理 3 道` | CC 被其他任务占着 | 开专门的 CC 会话窗口（不要和你写代码的 CC 同一会话） |

## 8. 安全边界

- Admin Key 绝对不进 git（只在 `~/.netclass-drain.env`）
- `wrangler.toml` 里 secret bindings 走 `wrangler secret put ADMIN_KEY`
- drain 的日志（答了什么题）不包含用户标识（pending_q 只记 submitted_by 的 user_id 哈希，不记其他 PII）
- 如果 drain 发现"这道题的答案特别敏感"（比如涉及政治）→ 不提交 submit，在 `note` 字段写明，留给 Admin 页面人工审

## 9. 未来：/drain-autonomously？

**不做**。让 CC 完全自动跑（比如 cron `/drain-netclass 100`）有两个风险：
1. 无人监督 → 出现低质量答案会快速污染题库
2. CC 订阅额度可能被一夜跑完

**永远保持人工触发**。这也是 Founder 对题库质量最重要的一层控制。
