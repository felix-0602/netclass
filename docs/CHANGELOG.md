# Netclass Sidekick — 变更日志

> 采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式 + 语义化版本。
> 主要面向本项目开发者 / 我未来的自己 / 潜在继任者。

## [Unreleased]

### Phase 0 Week 3 — 自动答题闭环 + 舍友可用 (2026-04-24)

**这一阶段的核心变化**：把旧版 app.js 的"发现即答题"闭环完整移植到模块化 TypeScript。
Panel 从"登录壳"升级为"看得见的托管代理人" —— 打开课程页后：视频自动 1.5x 静音播完、播完跳下一节、
作业/测验题目被自动提取 + 查答案 + 回填。服务端无变化，客户端重心。

#### Added

**答题闭环主链路**
- `client/src/answer/filler.ts` — 主编排：extract → getAnswer → fill → 统计正确率
- `client/src/answer/similarity.ts` — Levenshtein 编辑距离 + findBestMatch（默认阈值 50，移植自 `app.js:5041-5088`）
- `client/src/answer/hash.ts` — 客户端 SHA-256 题目哈希，行为对齐 `server/src/lib/hash.ts`
- `client/src/answer/fill/choice.ts` — 单选/多选回填（精确匹配 + Set 去重 + 相似度兜底）
- `client/src/answer/fill/blank.ts` — 填空回填（UEditor `setContent` 优先 + textarea fallback）
- `client/src/answer/fill/judge.ts` — 判断回填（正则识别 是/对/√/true，aria-label 或 span[data] 定位）
- `client/src/answer/fill/essay.ts` — 简答/论述回填
- `client/src/answer/fill/types.ts` — FillContext / FillResult / FillHandler 统一契约

**运行时基础设施**
- `client/src/runtime/state.ts`（由 Codex 起骨架）— 响应式 RuntimeState + actions 注册 + Panel 订阅
- `client/src/runtime/router.ts` — URL 模式到 PageKind 纯函数路由
- `client/src/runtime/url-watcher.ts` — `setInterval` 轮询 URL 变化（对齐 `app.js:5309-5316`，防超星 SPA 切章不刷页）
- `client/src/runtime/iframe-dispatch.ts` — 按 iframe.src 分类（work/video/audio/document-reader/ebook/finished/ignored），对齐 `app.js:5434-5469`
- `client/src/runtime/anti-background.ts` — 反后台检测三连防线：
  - A. 重写 `document.hidden` / `visibilityState` 永久为 visible
  - B. 拦截 `visibilitychange` / `blur` / `pagehide` 的 addEventListener 注册
  - C. 周期（30s）在视频容器上合成 `mousemove`
  - 调研证据：实测 chaoxing AIGC 课视频 dispatch visibilitychange+blur 不停播，popFocus 机制被硬编码 `if("0"!="1") return` 关闭 —— 3 连防线是给别的课程留的冗余

**UI 改造**
- `client/src/ui/Panel.vue` — 订阅 `runtimeState`，显示 phase/message/已发现/已答/待/错/自动托管开关/扫描按钮；删除误导的"开启刷时长"按钮（padder 本来就自动）；默认折叠为左下角蓝色药丸
- `client/src/ui/mount.ts` — Open Shadow DOM 隔离：挂到 body 下的 host div，attach shadow，扫 document.head 里含 `.ns-pill` / `.ns-panel` / `.ns-modal` 签名的 `<style>` 平移进 shadow root（避宿主页 `!important` CSS 影响）

**服务端探针脚本**
- `server/scripts/reuse-rate.ts` — Phase 0 门槛 #2 复用率探针（proxy 口径：`hit_count >= 2` 题数 / 总题数）。Phase 1 W2 任务 1.16 接入 inference_logs 后改真口径
- `server/scripts/leak-watch.ts` — Phase 0 门槛 #3 泄漏半衰期监控的地基：自建 `canary_questions` 表 + list/add/remove 子命令。外部搜索（Firecrawl/Exa 扫 QQ 群）留 Phase 1 接

**测试**
- `client/test/anti-background.spec.ts` — 9 用例
- `client/test/similarity.spec.ts` — 21 用例（levenshtein / similarityScore / findBestMatch）
- `client/test/fill.spec.ts` — 21 用例（4 种题型 fill handler）
- `client/test/hash.spec.ts` — 9 用例（含已知 fixture 锁定客户端-服务端一致性）
- `client/test/runtime.spec.ts` — 23 用例（router / url-watcher / iframe-dispatch）
- `client/test/e2e/answer-loop.spec.ts` — 4 e2e（单选/判断/多选回填）
- `client/test/e2e/iframe-dedup.spec.ts` — 3 e2e（回归"5 浮窗"bug）
- `client/playwright.config.ts` — workers=1 避 Windows spawn EBUSY

**文档**
- `docs/INSTALL-ROOMMATE.md` — 5 分钟装机指南给舍友

#### Changed

- `client/src/main.ts` — 接入 url-watcher + iframe-dispatch：boot 后自动扫 + URL 变化重扫 + work iframe → `runFiller`；注册 runtime actions 让 Panel 扫描按钮能触发
- `client/src/adapters/chaoxing.ts` — 每个同源 doc 额外跑一次 `applyAntiBackground`
- `client/vite.config.ts` — `antifeature` 元组改对象形（vite-plugin-monkey v5 要求 `{type, description, tag?}`，修预存 build bug）
- `cc-worker/drain-netclass.md` / `cc-worker/install.sh` — 从 Cloudflare Workers 标注迁到 Node 服务端（`http://182.254.180.181:8080`、`journalctl -u netclass`、systemd 重启流）

#### Fixed

- **5 浮窗 bug** — iframe 嵌套层都挂了 Panel，改为 `window.self === window.top` 守卫 + 全局 BOOT_FLAG；现在整个 frame 树最多 1 个 `#netclass-sidekick-host`
- **statusText 渲染成 JSON** — `computed()` 漏 `[props.status]` 索引，拆成 `STATUS_TEXT[runtimeState.status]` 映射

#### Known issues / deferred

- **Bundle 788KB** — `decode/table.json` 355KB 被 filler 链路 reach，Rollup 不 tree-shake。Phase 1 TODO：改 `@resource` 远程加载瘤减回 ~135KB
- **数学题 E2E 未通** — 服务端 R2 可选禁用状态下 `composite_image_b64` 被丢弃，drain 无图可看。Phase 1 TODO：filler 串 compose + 服务端本地盘 fallback + drain 读取
- **Phase 0 门槛 #4（首道数学题 E2E）** — 推迟到用户找到数学课 + 上述 TODO 完成后再验证
- **`auth_events` / `inference_logs` 写入未实现** — Phase 1 W1/W2 补

#### Test coverage summary

| 测试套件 | 用例数 |
|---|---|
| client vitest | **137** |
| client playwright e2e | **7** |
| server vitest | **9** |
| **合计** | **153** |

全部通过，typecheck 全部通过，客户端 build 788KB 成功。

---

## [0.1.0-alpha] — Phase 0 Week 1-2 (2026-04-10 ~ 2026-04-24)

先于本 CHANGELOG 落地。仅摘要：
- Client 骨架（Vite + vite-plugin-monkey）、超星 adapter、字体反混淆、视频/任务 padder
- Server 从 Cloudflare Workers 迁到 Node + better-sqlite3
- 部署到腾讯云轻量 `http://182.254.180.181:8080` 带 systemd
- Panel UI + 卡密激活 `/auth` 端到端
- 细节参照 `git log`（commit a6a2595 至 2dfbc33）

---

本 CHANGELOG 的维护规则：每 Phase / 每 sprint 结束写一次，不细到每 commit；细节看 git。
