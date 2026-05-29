# Netclass Sidekick — Protocol & Data Contracts

> 三方（client / server / cc-worker）通信锁定在此。任何一方改接口，这份文档必须先改 + bump 版本 + 三方都改完才能合并。
> 当前版本：**v1.2.0-alpha** (2026-05-24)

## 1. 通用约定

### 1.1 基础

- 全部 `application/json`（图片走 base64 data URL 在 JSON 里嵌入）
- 所有 timestamp 用 ISO 8601 字符串（UTC）
- 所有 hash 用 SHA-256 hex string（64 字符）
- 所有 id 用 UUIDv4 或派生 hash

### 1.2 鉴权头

| 头 | 用途 | 用在 |
|---|---|---|
| `Authorization: Bearer <JWT>` | 用户鉴权 | client → server `/answer`, `/contribute`, `/ota/*` |
| `X-Admin-Key: <key>` | 管理员鉴权 | cc-worker → server `/admin/*` |
| `X-Client-Version: <semver>` | 客户端版本 | 所有 client → server |
| `X-Device-Fingerprint: <fp>` | 设备标识 | `/auth` 和 `/answer` |

### 1.3 标准错误响应

```json
{
  "error": {
    "code": "string_code",
    "message": "human readable",
    "details": {}
  }
}
```

| `code` | HTTP | 触发 |
|---|---|---|
| `invalid_cardkey` | 401 | /auth 卡密错 |
| `cardkey_expired` | 401 | 试用/月订过期 |
| `device_limit` | 403 | 超 3 设备 |
| `jwt_expired` | 401 | JWT 超时（client 应刷新） |
| `rate_limited` | 429 | /answer 每分钟 >10 |
| `admin_required` | 403 | /admin/* 无 X-Admin-Key |
| `payload_too_large` | 413 | 合成图 >5MB |
| `cost_cap_exceeded` | 402 | 月推理配额用完（Phase 2+） |

---

## 2. 用户侧 API

### 2.1 `POST /auth`

换取 JWT。

**Request**：
```json
{
  "cardkey": "NSK-XXXX-XXXX-XXXX",
  "device_fingerprint": "<fp>"
}
```

`device_fingerprint` 推荐用 `sha256(userAgent + screen.size + hardwareConcurrency + 若干稳定 navigator 属性)` 客户端本地生成，存 `GM_value`。

**Response 200**：
```json
{
  "jwt": "eyJhbGciOiJIUzI1NiIs...",
  "expires_at": "2026-05-01T00:00:00Z",
  "plan": "trial | monthly | lifetime | admin",
  "month_exp": "2026-05-24T00:00:00Z",
  "features": {
    "free": ["time_padder", "task_jumper"],
    "paid": ["answer_bank", "contribute", "dashboard"]
  }
}
```

**Response 401**：`invalid_cardkey` 或 `cardkey_expired`。
**Response 403**：`device_limit`（已绑定 3 个设备）。

### 2.2 `POST /answer`

查询一道题的答案。miss 则进 pending。

**Request**：
```json
{
  "platform": "chaoxing | zhihuishu | unipus",
  "question_id": "405405676",
  "hash": "<sha256 of normalized>",
  "type": "single | multi | judge | fill | essay",
  "text": "已知微分方程 <<M1>> 的通解为 <<M2>>，满足初值条件 <<M3>>，则其特解为",
  "options": [
    {"label": "A", "text": null, "image_ref": "<<M4>>"},
    {"label": "B", "text": null, "image_ref": "<<M5>>"}
  ],
  "tex_spans": [
    {"placeholder": "<<M1>>", "latex": null, "image_idx": 0},
    {"placeholder": "<<M2>>", "latex": null, "image_idx": 1}
  ],
  "composite_image_b64": "<base64 PNG，如题目含图；文本题可省略>",
  "context": {
    "course_id": "256413877",
    "clazz_id": "139319090",
    "knowledge_id": "1056401944",
    "work_id": "50845939"
  }
}
```

**Response 200 (HIT)**：
```json
{
  "status": "hit",
  "answer": {
    "value": "D",
    "raw": ["D"],
    "confidence": 0.98
  },
  "source": "cache | cc_drain | user_verified",
  "updated_at": "2026-04-20T08:00:00Z"
}
```

**Response 202 (PENDING)**：
```json
{
  "status": "pending",
  "queued_at": "2026-04-24T09:40:00Z",
  "hint": "题库暂无此题，已进入审核队列，稍后再试即命中"
}
```

### 2.3 `POST /contribute`

用户回传"我答对了"的题目。

**Request**（同 2.2 但加 answer）：
```json
{
  "hash": "<sha256>",
  "text": "...", "options": [...], "composite_image_b64": "...",
  "answer": {"value": "D", "raw": ["D"]},
  "user_confidence": "high | medium | low",
  "user_note": "这题上次考试考过，老师说 D"
}
```

**Response 202**：
```json
{
  "status": "queued_for_review",
  "contribution_id": "uuid"
}
```

### 2.4 `GET /ota/version`

客户端启动时检查更新。

**Response 200**：
```json
{
  "latest": "1.3.2",
  "min_supported": "1.0.0",
  "download_url": "https://server/ota/script",
  "sha256": "<hex>",
  "signature": "<ed25519 base64>",
  "force_update": false,
  "changelog": "Fixed 超星 iframe 嵌套适配"
}
```

### 2.5 `GET /ota/script`

下载最新 `.user.js` 文件。R2 public URL 直出。返回 `text/javascript`，body 就是脚本内容。

---

## 3. 管理员侧 API（cc-worker 用）

### 3.1 `GET /admin/pending?limit=N&platform=X&type=Y`

拉取 pending 队列，按 priority desc, created_at asc 排序。

**Response 200**：
```json
{
  "items": [
    {
      "id": "<hash>",
      "platform": "chaoxing",
      "type": "single",
      "text": "已知微分方程 <<M1>> 的通解为 <<M2>>...",
      "options": [...],
      "tex_spans": [...],
      "composite_image_url": "https://pub-xxx.r2.dev/stitched/<hash>.png",
      "context": {...},
      "created_at": "2026-04-24T09:40:00Z",
      "priority": 5,
      "attempts": 0
    }
  ],
  "total_pending": 237
}
```

**注意**：`composite_image_url` 是 R2 **public URL**，无 referer 限制，cc-worker 可以直接 curl 下载到本地给 Read 工具看。

### 3.2 `POST /admin/submit`

批量回写答案。

**Request**：
```json
{
  "answers": [
    {
      "id": "<hash>",
      "answer": {"value": "D", "raw": ["D"]},
      "confidence": 0.95,
      "source": "cc_drain",
      "note": "代入初值 y(0)=1 求 C=1，特解 y=x²+1"
    }
  ]
}
```

**Response 200**：
```json
{
  "accepted": 10,
  "rejected": [
    {"id": "<hash>", "reason": "already_answered"}
  ]
}
```

### 3.3 `POST /admin/verify-answer`

客户端提交 chaoxing 后把批改结果回传给服务端。

**鉴权**：`X-Admin-Key`（管理员） 或 `Authorization: Bearer <JWT>`（客户端登录态）

**Request**：
```json
{ "hash": "<sha256>", "correct": true, "source?": "chaoxing_self_check" }
```
或批量：
```json
{ "items": [{ "hash": "<sha256>", "correct": false }, ...] }
```

**行为**：
- `correct=true` → `questions.is_verified = 1`（留题库）
- `correct=false` → `questions.is_verified = 0` + INSERT `wrong_answers` + confidence -0.2
- 下次同一题 `/answer` 命中 `is_verified=0` → 自动调 DeepSeek 重答，旧错题记录入 `wrong_answers`

**Response 200**：
```json
{ "updated": 5, "not_found": ["<hash>..."] }
```

### 3.4 `POST /admin/kill-switch`

紧急关闭（比如被举报）。置全体客户端"维护模式"。

**Request**：
```json
{
  "action": "enable | disable",
  "message": "服务临时维护，预计 2 小时后恢复"
}
```

### 3.5 `GET /admin/metrics`

运营 dashboard 数据（Phase 1+）。

**Response 200**：
```json
{
  "today": {
    "users_active": 12,
    "questions_served": 340,
    "cache_hit_rate": 0.72,
    "pending_queue_depth": 15,
    "avg_pending_age_min": 120
  },
  "all_time": {
    "users_total": 20,
    "questions_bank": 2340,
    "contributions_accepted": 180
  }
}
```

### 3.6 `GET /admin/dashboard`

返回自包含 HTML admin 管理后台页面。直接用浏览器访问。

**鉴权**: 页面内 JS 会提示输入 `X-Admin-Key`，存在 `localStorage` 后续自动带。

### 3.7 `GET /admin/api/stats`

题库 + 用户概览。

**Response 200**:
```json
{
  "questions_total": 1749,
  "questions_verified": 890,
  "questions_wrong": 45,
  "pending_count": 27,
  "users_total": 7,
  "hit_rate_24h": 0.72,
  "confidence_distribution": { "low": 6, "mid": 14, "high": 1729 },
  "platforms": { "chaoxing": 1749, "unipus": 0 },
  "types": { "single": 1615, "judge": 70, "multi": 64 }
}
```

### 3.8 `GET /admin/api/users?page=1&limit=20`

用户列表。

**Response 200**:
```json
{
  "users": [
    {
      "id": "user-seed-0001",
      "plan": "lifetime",
      "device_count": 2,
      "devices": ["<fp1>", "<fp2>"],
      "monthly_exp": null,
      "is_banned": false,
      "created_at": "2026-04-20T08:00:00Z"
    }
  ],
  "total": 7,
  "page": 1,
  "limit": 20
}
```

### 3.9 `POST /admin/api/users/:id/toggle-ban`

封禁/解封用户。

**Response 200**:
```json
{ "id": "user-seed-0001", "is_banned": true }
```

### 3.10 `POST /admin/api/users/:id/unbind-all`

清空某用户所有设备绑定。

**Response 200**:
```json
{ "id": "user-seed-0001", "unbound": true }
```

### 3.11 `GET /admin/api/cardkeys?page=1&limit=20`

卡密列表。

**Response 200**:
```json
{
  "cardkeys": [
    {
      "id": "user-seed-0001",
      "plan": "lifetime",
      "monthly_exp": null,
      "is_banned": false,
      "created_at": "2026-04-20T08:00:00Z"
    }
  ],
  "total": 7
}
```

### 3.12 `POST /admin/api/cardkeys/generate`

生成新卡密。

**Request**:
```json
{ "plan": "trial", "count": 5 }
```

- `plan`: `"trial"` (7天) | `"monthly"` (30天) | `"lifetime"` (永久)
- `count`: 1-50，默认 1

**Response 200**:
```json
{
  "generated": ["NSK-ABCDEFGH", "NSK-JKLMNPQR"],
  "plan": "trial",
  "count": 2
}
```

### 3.13 `POST /admin/api/cardkeys/:id/renew`

续期 +30 天（trial/monthly 有效，lifetime 返回 400）。

**Response 200**:
```json
{ "id": "user-xxx", "new_monthly_exp": "2026-06-23T00:00:00Z" }
```

### 3.14 `POST /admin/api/cardkeys/:id/revoke`

作废卡密（`is_banned = 1`）。

**Response 200**:
```json
{ "id": "user-xxx", "revoked": true }
```

### 3.15 `GET /admin/api/deepseek-usage`

DeepSeek API 最近 30 天用量统计。

**Response 200**:
```json
{
  "this_month_calls": 456,
  "this_month_accepted": 429,
  "this_month_success_rate": 0.94,
  "avg_latency_ms": 1200,
  "daily": [
    { "date": "2026-05-24", "calls": 20, "accepted": 19 }
  ]
}
```

---

## 4. D1 Schema (v1.0.0-alpha)

```sql
-- 题库主表
CREATE TABLE questions (
  id             TEXT PRIMARY KEY,           -- sha256(normalized_text + image_key) OR chaoxing questionId
  platform       TEXT NOT NULL,              -- 'chaoxing' | 'zhihuishu' | 'unipus'
  q_type         TEXT NOT NULL,              -- 'single' | 'multi' | 'judge' | 'fill' | 'essay'
  text           TEXT NOT NULL,              -- 解混淆 + 占位符化后的题干
  options_json   TEXT,                       -- JSON array
  tex_spans_json TEXT,                       -- JSON array
  image_key      TEXT,                       -- R2 key for composite image, nullable
  course_sig     TEXT,                       -- '<courseId>:<knowledgeId>' 聚合用
  answer_json    TEXT NOT NULL,              -- JSON: {"value": "D", "raw": ["D"]}
  confidence     REAL NOT NULL,              -- 0.0 - 1.0
  source         TEXT NOT NULL,              -- 'cc_drain' | 'user_contributed' | 'seed'
  verified_by    TEXT,                       -- 'founder' | 'cross_check' | 'chaoxing_self_check' | NULL
  is_verified    INTEGER,                    -- NULL=未验证, 1=正确(题库), 0=错误(需重答)
  hit_count      INTEGER NOT NULL DEFAULT 0,
  first_seen     INTEGER NOT NULL,           -- unix seconds
  last_hit       INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_q_course_sig ON questions(course_sig);
CREATE INDEX idx_q_last_hit   ON questions(last_hit);
CREATE INDEX idx_q_platform   ON questions(platform);

-- 错题记录表 (v1.1.0-alpha)
CREATE TABLE wrong_answers (
  id             TEXT PRIMARY KEY,           -- UUID
  question_hash  TEXT NOT NULL,              -- FK → questions.id
  platform       TEXT NOT NULL,
  q_type         TEXT NOT NULL,
  text           TEXT NOT NULL,
  options_json   TEXT,
  tex_spans_json TEXT,
  answer_json    TEXT NOT NULL,              -- 被判定为错的答案
  confidence     REAL NOT NULL,
  source         TEXT NOT NULL,              -- 'deepseek-api' | 'cc_drain' | 'user_contributed'
  submitted_by   TEXT,                       -- users.id
  reviewed       INTEGER NOT NULL DEFAULT 0, -- 0=待审, 1=已审
  review_note    TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_wa_question_hash ON wrong_answers(question_hash);
CREATE INDEX idx_wa_reviewed ON wrong_answers(reviewed);

-- 待处理队列
CREATE TABLE pending_q (
  id             TEXT PRIMARY KEY,           -- 同 questions.id
  platform       TEXT NOT NULL,
  q_type         TEXT NOT NULL,
  text           TEXT NOT NULL,
  options_json   TEXT,
  tex_spans_json TEXT,
  image_key      TEXT,                       -- R2 key
  context_json   TEXT,                       -- course/class/knowledge ids
  priority       INTEGER NOT NULL DEFAULT 5, -- 1-10，高优先级先处理
  attempts       INTEGER NOT NULL DEFAULT 0, -- drain 处理次数（失败后 ++）
  submitted_by   TEXT,                       -- users.id，追溯谁触发
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_pq_priority ON pending_q(priority DESC, created_at ASC);

-- 用户表
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  cardkey_hash   TEXT NOT NULL UNIQUE,       -- sha256(cardkey 明文)
  plan           TEXT NOT NULL,              -- 'trial' | 'monthly' | 'lifetime' | 'admin'
  bound_devices  TEXT,                       -- JSON array of fingerprints, max 3
  monthly_exp    INTEGER,                    -- unix seconds; trial/monthly 首次激活时写入，过期后拒绝登录
  month_inference_cost_minutes INTEGER NOT NULL DEFAULT 0,  -- drain 消耗的 CC 分钟数（Phase 1 起用）
  month_reset_at INTEGER,
  is_banned      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_u_cardkey_hash ON users(cardkey_hash);

-- 用户贡献队列
CREATE TABLE contributions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  question_hash     TEXT NOT NULL,
  text              TEXT NOT NULL,
  options_json      TEXT,
  image_key         TEXT,
  submitted_answer  TEXT NOT NULL,
  user_confidence   TEXT NOT NULL,            -- 'high' | 'medium' | 'low'
  user_note         TEXT,
  status            TEXT NOT NULL,            -- 'pending_review' | 'accepted' | 'rejected' | 'superseded'
  reviewed_by       TEXT,                     -- founder
  review_note       TEXT,
  created_at        INTEGER NOT NULL,
  reviewed_at       INTEGER
);
CREATE INDEX idx_c_status ON contributions(status);
CREATE INDEX idx_c_user   ON contributions(user_id);

-- 鉴权事件
CREATE TABLE auth_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  event      TEXT NOT NULL,  -- 'login' | 'device_rejected' | 'jwt_refresh' | 'rate_limited'
  ip         TEXT,
  device_fp  TEXT,
  ua         TEXT,
  ts         INTEGER NOT NULL
);
CREATE INDEX idx_ae_user ON auth_events(user_id);
CREATE INDEX idx_ae_ts   ON auth_events(ts);

-- 推理日志（Phase 1+）
CREATE TABLE inference_logs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,           -- 触发方（若是 drain 则 NULL）
  question_hash  TEXT NOT NULL,
  model          TEXT NOT NULL,  -- 'claude_code_founder' 当前唯一值
  latency_ms     INTEGER,
  accepted       INTEGER NOT NULL DEFAULT 1,
  ts             INTEGER NOT NULL
);
CREATE INDEX idx_il_user ON inference_logs(user_id);
CREATE INDEX idx_il_ts   ON inference_logs(ts);
```

## 5. R2 Bucket 布局

```
netclass-storage/
├── stitched/
│   └── <question_hash>.png      # Canvas 合成图，公共可读（无 referer 校验）
└── ota/
    ├── latest.user.js           # OTA 最新脚本（公共可读）
    ├── latest.user.js.sig       # ed25519 签名
    └── archive/
        └── 1.2.1.user.js        # 旧版本存档
```

## 6. 版本升级规则

- **Minor**（1.0.0 → 1.1.0）：新增可选字段、新端点。旧 client 继续工作。
- **Major**（1.x → 2.0.0）：breaking change。需要 `/ota/version` 把 `min_supported` 提高，强制客户端升级。
- **Patch**（1.0.0 → 1.0.1）：行为修复，schema 不变。

当前版本写入 `server/src/index.ts` 常量 `PROTOCOL_VERSION = "1.0.0-alpha"` 和 client `X-Client-Protocol` header。
