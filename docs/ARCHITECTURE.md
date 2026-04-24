# Netclass Sidekick — Architecture

> 本文件是单一真实来源（Single Source of Truth），所有架构决策以此为准。
> 决策锁定日期：2026-04-24。如要改动，请在 `docs/recon/decisions/` 下写一份 ADR 然后更新本文。

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│ CLIENT — Tampermonkey 用户脚本（Phase 0-1）                          │
│                                                                     │
│  运行在：超星 / 知到 / U 校园 三大域名白名单下的任何页面               │
│  载荷：  Vue 3 + Element Plus + Pinia + 自研适配器                   │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐        │
│  │ adapters/   │  │ decode/      │  │ vision/             │        │
│  │  chaoxing   │  │  cxsecret    │  │  compose (Canvas)   │        │
│  │  unipus     │  │  字体反混淆   │  │  N 图 → 1 PNG       │        │
│  └──────┬──────┘  └───────┬──────┘  └──────────┬──────────┘        │
│         │                 │                    │                    │
│         └───────────┬─────┴────────────────────┘                    │
│                     ▼                                               │
│  ┌──────────────────────────────────┐  ┌──────────────────────┐    │
│  │ answer/                          │  │ time-padder/         │    │
│  │  cache.ts  (LRU 5MB, GM_value)   │  │  chaoxing-video      │    │
│  │  client.ts (/answer + retry)     │  │  chaoxing-task       │    │
│  └──────────────┬───────────────────┘  │  unipus-video        │    │
│                 │                      └──────────────────────┘    │
│                 │                        免费层：零服务端依赖         │
└─────────────────┼───────────────────────────────────────────────────┘
                  │  HTTPS, Authorization: Bearer <JWT>
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SERVER — Cloudflare Workers + Hono（不调任何 AI API）                │
│                                                                     │
│  ┌─────────────────────────┬─────────────────────────────────────┐ │
│  │ 用户侧                   │ 管理员/Worker 侧（需 Admin Key）      │ │
│  ├─────────────────────────┼─────────────────────────────────────┤ │
│  │ POST /auth              │ GET  /admin/pending?limit=N         │ │
│  │ POST /answer            │ POST /admin/submit                  │ │
│  │ POST /contribute        │ POST /admin/kill-switch             │ │
│  │ GET  /ota/version       │ GET  /admin/metrics                 │ │
│  │ GET  /ota/script        │                                     │ │
│  └─────────────────────────┴─────────────────────────────────────┘ │
│                                                                     │
│  D1 tables：users / questions / pending_q / contributions /        │
│            auth_events / inference_logs                             │
│  R2 buckets：stitched（合成图）/ ota（脚本文件）                      │
└───────────────────┬─────────────────────────────────────────────────┘
                    │  HTTPS, X-Admin-Key: <key>
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CC WORKER — 你本地 Claude Code 订阅                                  │
│                                                                     │
│  运行在：你的 VSCode（或任一 CC 会话窗口）                            │
│  触发：  你输入 /drain-netclass [count]                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │ ~/.claude/commands/drain-netclass.md                      │     │
│  │   1. Bash: curl GET /admin/pending?limit=N                │     │
│  │   2. Read: 每道题 JSON + 合成图（如有）                    │     │
│  │   3. 生成 {answer, confidence, note}                      │     │
│  │   4. Bash: curl POST /admin/submit（批量）                │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  授权：CC OAuth 订阅 token（~/.claude/.credentials.json）            │
│  成本：0（走 Max 订阅配额，不计 API 费）                               │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 核心数据流

### 2.1 用户遇到已收录题目（Happy Path）

```
用户打开章节测试
  ↓ Tampermonkey @match 触发
client/adapters/chaoxing.ts 提取 TiMu → Question[]
  ↓ 对每道题：
decode/cxsecret.ts 解字体混淆
  ↓
answer/cache.ts 查本地 LRU（5MB, GM_value）
  ├─ HIT → 立即返回 answer，client 填入
  └─ MISS → 继续
  ↓
answer/client.ts POST /answer { hash, text, options, images? }
  ↓ 服务端：
server/routes/answer.ts 查 D1.questions where id = hash
  ├─ HIT → 返回 {answer, source: 'cache'}  [≤ 50ms]
  └─ MISS → 见 2.2
  ↓
client 收到 answer → 填入 DOM input → 延迟 N 秒模拟人类 → 下一题
```

### 2.2 用户遇到未收录题目（Pending Path）

```
/answer miss
  ↓ 服务端：
若题目含图片：先让 client 在 vision/compose.ts 把 N 图合成 1 张 PNG，base64 上传
  ↓
server/routes/answer.ts 把图片 bytes 存到 R2://stitched/{hash}.png
  ↓
INSERT INTO pending_q (id=hash, text, options, image_key, priority, created_at)
  ↓
返回 client: {status: "pending", eta_hint: "审核中，下次访问即命中"}
  ↓
client UI：在题目旁显示"⏳ 已提交审核"，不阻塞，跳过该题或让用户手填
  ↓
(时间流逝，几分钟到几小时)
  ↓
Founder 在 VSCode 里开 CC，敲 /drain-netclass 10
  ↓
cc-worker/drain-netclass.md 执行：
  1. curl GET /admin/pending?limit=10 → 拿 10 条 pending
  2. 对每条：
     - 若 image_key 存在：curl 下载 R2 image 到 /tmp/q_{hash}.png
     - Read 图片 + Read 题目 JSON
     - CC 思考 → 输出 {answer, confidence}
  3. 批量 curl POST /admin/submit [{id, answer, confidence}, ...]
  ↓
server/routes/admin/submit.ts：
  - INSERT INTO questions (id, text, options, answer, confidence, source='cc_drain', verified_by='founder')
  - DELETE FROM pending_q WHERE id IN (...)
  ↓
下一个访问该题的用户 → 走 2.1 Happy Path，0 延迟命中
```

### 2.3 用户回传答案（Contribute Path）

```
用户答了一道题库里没有的题，自己知道答对了（比如小测试过批改）
  ↓ client UI 按钮"这题我答对了，回传题库"
  ↓
POST /contribute {hash, text, options, image?, answer, user_confidence}
  ↓
server/routes/contribute.ts：
  - INSERT INTO contributions (status='pending_review')
  ↓
Founder drain 时一并处理（或单独 /admin/review）
  ↓
AI 复审（CC 独立答一遍）+ 人工决定 → accept / reject
```

## 3. 模块边界

| 模块 | 语言 | 位置 | 职责 | 不做 |
|---|---|---|---|---|
| **client** | TypeScript | `client/src/` | DOM 提取、解码、合图、本地缓存、UI、刷时长、答题填入 | 调 AI、存敏感数据、处理付款 |
| **server** | TypeScript | `server/src/` | 鉴权、队列、hash 查询、OTA 分发、admin API | 调 AI、渲染 UI、存长期会话 |
| **cc-worker** | Markdown + bash in CC | `cc-worker/` | 消化 pending 队列、批量生成答案 | 直接面向最终用户 |
| **docs** | Markdown | `docs/` | 架构、协议、反混淆手册、路线图 | 跑代码 |
| **test** | TypeScript | `test/` | E2E 回归、fixture 重放 | 碰真账号 |

## 4. 跨模块契约

三方通过 HTTPS JSON 通信，schema 锁定在 [PROTOCOL.md](./PROTOCOL.md)。**任何一方更改接口必须同时更新 PROTOCOL.md 并 bump 版本号**，否则 CI 拒绝合并。

## 5. 关键设计决策（不再讨论）

| # | 决策 | 原因 | 推翻条件 |
|---|---|---|---|
| 1 | 客户端分发走 Tampermonkey `.user.js`（Phase 0-1） | 工时低 10 倍；开源 + `@antifeature` 合规披露 | Phase 2：≥50 付费，非技术用户 >30% |
| 2 | 服务端用 CF Workers + D1 + R2 | 零备案、免费额度够 Phase 0-2 | 同一主机商故障影响 >24h |
| 3 | AI 推理不走付费 API，走本地 CC | 零金钱成本、用户本人拥有订阅 | Phase 2：DAU > 30 或 Anthropic ToS 明确禁止 |
| 4 | 数学题用 Canvas 合图 + Vision | [实测 100% 准确率](./recon/reconnaissance-2026-04-24.md#更新-1vision-识别探针结果2026-04-24-同日完成) | 识别率 <85% |
| 5 | 题目主键 = questionId（若超星暴露）+ hash(normalized_text + image_key) 备用 | questionId 稳定、hash 防碰撞 | 超星改接口不暴露 questionId |
| 6 | 卡密 + JWT + device fingerprint 鉴权 | Phase 0-1 够用；Phase 2+ 若被破解再重设计 | 月流失率 >30% 疑似盗版 |
| 7 | 支付走微信/支付宝个人收款码（Phase 0-2） | 用户熟悉、零集成；Phase 3 触发器切商户 | 日流水 >¥1000 连续 3 天 |

## 6. 已知风险（全部在 [CEO plan](./recon/decisions/2026-04-24-netclass-sidekick.md#关键风险--缓解) 跟踪）

- **[Existential]** 题目跨同学复用率可能 <50% → Phase 0 硬验证
- **[Existential]** 题库盗版扩散 → 服务端 auth-gated 架构 + 水印
- **[Existential]** 平台降维（超星自己上 AI 助教）→ 时间窗 6-12 个月
- **[High]** 数学题推理延迟：依赖 Founder drain 频率（小时级）
- **[High]** 售后陪装：Phase 0 实测后决定是否需便携 Chromium
- **[Medium]** 答题准确率 → client 上报机制 + eval golden set

## 7. Phase 0 → Phase 2 演进锚点

详见 [ROADMAP.md](./ROADMAP.md)。每个 Phase 的退出门槛均为硬指标。任一未达不得进下阶段。
