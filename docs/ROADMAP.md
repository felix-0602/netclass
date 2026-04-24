# Netclass Sidekick — Roadmap

> 阶段性开发计划 + 退出门槛。任一 Phase 未达门槛不得进入下一 Phase。
> Phase 0 启动日期：待定（取决于用户 Phase 0 约舍友的时间）。

## Phase 0 — 自用 + 3 舍友内测（3 周）

### 目标
证明"自建题库 + 服务端 drain 架构"在真实同学账号上可行，**且题目跨学生复用率足够高**。

### 任务（按周）

#### Week 1 — 客户端骨架
- `client/` Vite + vite-plugin-monkey 脚手架出 hello-world
- `adapters/chaoxing.ts` 从 `app.js:5032 getAnswer` 区迁移 TiMu 提取
- `decode/cxsecret.ts` 从 `app.js` `@resource ttf` 逻辑抽离，单元测试
- `time-padder/chaoxing-video.ts` 复用 `app.js` 视频自动播放 + 心跳
- Playwright `extract-chaoxing.spec.ts` 用 `test/fixtures/` 跑 regression

#### Week 2 — 服务端骨架 + 复用率探针
- `server/` Workers + Hono + D1 出 `/healthz` + schema 建表
- `/answer` happy path：miss → 写 pending → 返回 pending 状态
- `/auth` 卡密换 JWT（5 张硬编码种子卡密）
- `cc-worker/drain-netclass.md` 最小版：curl pending → 打印（未答题）
- **复用率探针**（关键）：3 舍友同门课跑 1 周（或手工模拟 200 题），统计题目 hash 跨账户命中率

#### Week 3 — Vision 合图 + 门槛验证
- `client/src/vision/compose.ts` — Canvas N 图合 1 PNG，base64 上传
- `drain-netclass.md` 完整版：Read 合成图 → 答题 → 批量 submit
- 手动跑一次完整 round-trip（client 遇新题 → 进 pending → drain → 下次命中）
- 验证三门槛（见下）

### Phase 0 退出门槛（**全部**达成才进 Phase 1）

| # | 指标 | 目标 | 测量方式 |
|---|---|---|---|
| 1 | 3 舍友独立用完 1 节课 | 3/3 | 观察：不许你在旁边帮他们 |
| 2 | 同门课跨舍友题目复用率 | ≥50% | 同一 courseId + knowledgeId 的题目 hash 在不同 userId 间的交集率 |
| 3 | 泄漏半衰期 | ≥72h | 给 1 舍友一份 seed 题库，监控这份题库 hash 有没有 72h 内扩散到其他 QQ 群 |
| 4 | 首道数学题端到端可答 | 可答 | 见上 round-trip 手动测试 |

**任一未达**：停下来写 Phase 0 复盘到 `docs/recon/decisions/phase-0-retro.md`，用 `/office-hours` 或 `/plan-ceo-review` 重新对齐方向。**不得硬推**。

---

## Phase 1 — Closed Beta 10-20 人（4 周）

### 目标
从"朋友能用"升级到"陌生同学愿意掏 10 元试一个月"。

### 任务

#### Week 1 — 鉴权 + 设备绑定
- `/auth` device_fingerprint 存表、上限 3、超限拒绝
- JWT 7d 过期 + 自动刷新
- Client 卡密输入 UI（EP Dialog）
- Rate limit：单用户 `/answer` 每分钟 ≤10

#### Week 2 — U 校园 Adapter
- `client/src/adapters/unipus.ts` — `.question-common-abs-question-container` 提取
- `client/src/time-padder/unipus-video.ts` — React state hook + 活跃度模拟
- 抓 U 校园"必修学习时长"数值（成绩明细页 DOM）做前后对比
- 听力题抓 `<audio>` src，Whisper 留 TODO 到 Phase 2

#### Week 3 — OTA + 用户贡献
- `/ota/version` + `/ota/script` R2 分发 + ed25519 签名
- 客户端 `@updateURL` 指向自托管 OTA
- `/contribute` 接收用户回传，`/admin/review` 小页面批审

#### Week 4 — 壮大测试 + 指标收集
- Admin 后台小页面：pending 列表 + 一键 copy 到剪贴板、web submit
- 舍友 + 同班扩到 10-20 人
- 每日 dashboard：准确率、drain 延迟、curation 时间、盗版监控

### Phase 1 退出门槛（**全部**达成才进 Phase 2）

| # | 指标 | 目标 |
|---|---|---|
| 1 | 答案准确率 | ≥90%（抽样人工对） |
| 2 | 单 drain 批次耗时（10 题） | ≤5 分钟 |
| 3 | 新课入库可用时间（curation） | ≤2 小时 |
| 4 | Beta 用户转付费意向 | ≥30% 明确"现在付 10 元" |
| 5 | 盗版半衰期 | ≥14 天 |
| 6 | 售后陪装 | <5 分钟/人 |

---

## Phase 2 — 公测 + 商业化（6 周）

### 触发条件
Phase 1 门槛全部达成。

### 任务要点（细化到临入场时再补）
- 开源客户端 GitHub repo（Greasyfork 发布带 `@antifeature`）
- 题库付费卡密生成流程（爱发电 / 微信收款码手动发）
- 数学课分级限流（视 drain 延迟调整）
- 便携 Chromium zip 包 POC（若非技术用户 >30%）
- 开放题汇报仪表盘 MVP（`premise #5` 差异化）

### 退出门槛（示意，Phase 2 末尾细化）
- 首月付费 ≥50
- 推理成本 ≤月收入的 15%
- 退款率 ≤10%

---

## Phase 3 — 多平台（4 周）

### 触发条件
Phase 2 全达成 + 首月 MRR ≥¥500。

### 任务要点
- 知到智慧树 adapter（原 app.js 已有部分支持）
- U 校园听力题 Whisper STT 集成（目前 OpenAI Whisper 在大陆不稳，评估阿里 STT / 火山）
- 便携 Chromium 正式版发布

---

## Phase 4 — 数据护城河（6+ 周）

### 触发条件
Phase 3 全达成 + 题库 >5000 题。

### 任务要点
- 跨校匿名聚合题库 + 课程元数据
- 题库搜索 API 给其他工具用（B2B2C 埋点）
- 评估是否申请 YC / 开始找 co-founder

---

## 全局刹车条件（任何 Phase 都适用）

立即停止 + 走评估：
- 超星 / U 校园官方书面警告或起诉
- 学校处分通知（你个人或舍友）
- 用户数据泄漏事件
- 月流失率 >40%
- 推理成本超过月收入 50%

每次刹车后写一份 `docs/recon/decisions/incident-YYYY-MM-DD.md`。
