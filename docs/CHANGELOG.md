# Netclass Sidekick — 变更日志

> 采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式 + 语义化版本。
> 主要面向本项目开发者 / 我未来的自己 / 潜在继任者。

## [Unreleased]

### Phase 0 W3v2 — hash v2（options 排序无关）+ cleanup criteria 修正 (2026-04-25)

> 用户问"题库有去重吗"时发现两个潜在 bug，一起修：

#### 背景

DB 里 60 道 pending 中 53 道含 `<<M>>` 占位但 image_key 为空。一开始判定 compose 没跑，
仔细看 tex_spans 字段才发现：chaoxing 在 `<img.ans-latex-moudle data="%22latex%22">` 的
data 属性里有 URL-encoded LaTeX 源，extractor 正确解析到 tex_spans[i].latex，
**drain 直接读 latex 就能答**，根本不需要 compose 出图。

W3v2 修两件事：
1. cleanup-broken endpoint 之前用 `text 含 <<M>> && !image_key` 过度激进 → 误删带 LaTeX 文本的可答题
2. hash 算法 options 顺序敏感 → chaoxing 偶尔 shuffle 选项 array → 同一道题不同 hash → 题库永远 miss

#### Changed

- `server/src/lib/hash.ts` + `client/src/answer/hash.ts` —— `hashQuestion` 加 options 按 label 字典序排序后再拼接（v2）。**Breaking change** — 跟 v1 hash 不兼容，需跑 migration。
- `server/src/routes/admin/cleanup.ts` —— `missing_image_for_math` 标准加 `tex_spans 全 latex=null` 守护，避免误删带 LaTeX 文本的可答数学题。

#### Added

- `server/scripts/rehash-id.ts` —— 一次性 migration script，重算 `questions` 和 `pending_q` 表所有行的 id（hash）。dry-run 默认，`--commit` 才真改。事务包裹回滚安全。

#### Tests

- `server/test/hash.spec.ts` — +2 用例（v2 选项 array 顺序无关 / 内容变 hash 变）
- `server/test/admin-cleanup.spec.ts` — +1 用例（v2 latex 非 null 不命中 missing_image_for_math） + 现有测试更新（matched 数 / 剩余 row 期待）
- `client/test/hash.spec.ts` — flip "选项顺序有意义" → "v2 选项顺序无关" + 新加"内容变 hash 变"

**测试统计**：client 162 (+1) / e2e 7 / server 43 (+3) = **212 测试全绿**。typecheck 过。bundle 807KB。

#### 部署后必跑

deploy server 后**必须**跑：
```bash
ssh ubuntu@182.254.180.181
cd ~/netclass/server
npx tsx scripts/rehash-id.ts             # dry-run，看会改多少行
npx tsx scripts/rehash-id.ts --commit    # 真重算
```
不跑的话旧 row 用 v1 hash，新 client 用 v2 hash，永远 miss → 全部题重新进 pending。

---

### Phase 0 W3++++ — compose 不上传 + 题库清扫端点 (2026-04-25)

> /admin/pending 队列里 20 题全部 image_key=NULL，数学闭环看似没起作用。
> 用 gstack browse 实测：extractor 输出正常，needsCompose 返 true，但 GM_xmlhttpRequest
> 拒拉 `p.ananas.chaoxing.com` 上的公式图 — **@connect 白名单缺这个域名**。
> 失败被 try/catch 静默吞，所以用户根本不知道。

#### Findings（实测）

| 环节 | 实测 | 结论 |
|---|---|---|
| extract | TiMu 4 选项识别正确，2 公式图 src 提取出 | ✅ |
| needsCompose | tex_spans 含 `latex=null + image_idx`，返 true | ✅ |
| compose fetch | GM_xmlhttpRequest 调 `p.ananas.chaoxing.com/star3/origin/...png` | ❌ Tampermonkey 拒（域名不在 @connect 白名单） |
| /answer body | composite_image_b64=undefined 被传上去 | 服务端没图可存 → image_key=NULL |
| 用户感知 | catch 块 console.warn 后继续，Panel 无任何提示 | silent failure 隐藏问题数周 |

#### Fixed

- **`client/vite.config.ts`** — `connect` 列表加 4 个 chaoxing 域：
  `p.ananas.chaoxing.com` / `mooc1.chaoxing.com` / `mooc1-1.chaoxing.com` / `mooc2-ans.chaoxing.com`
- **`client/src/answer/filler.ts`** — compose 失败时除 console.warn 外**还要**
  `patchRuntimeState({ message: '⚠ 合图失败（{reason}）— 题进 pending 但无图' })`，
  让 Panel 当场看到。Silent catch 是这次 bug 隐藏数周的根因，必须破。

#### Added

- **`server/src/routes/admin/cleanup.ts`** — `POST /admin/cleanup-broken` 批量清坏题。
  4 类标准（`missing_image_for_math` / `empty_options` / `short_text` / `very_old`），
  默认 `dry_run: true` 必须显式 false 才删。鉴权同其他 admin 端点（X-Admin-Key）。

#### Tests

- `server/test/admin-cleanup.spec.ts` — 6 用例（dry_run / 真删 / criteria 过滤 / 鉴权 / 空队列 / days_old 自定义）

**测试统计**：client 161 / e2e 7 / server 40 (+6) = **208 测试全绿**。typecheck 过。bundle 806KB。

#### Operational follow-up

- 用户需 push + 重装 client（@connect 改了 必须重装才生效，热更新不行）
- 用户需 SSH 部署新 server（cleanup endpoint 是新的）
- 之后跑 `curl POST /admin/cleanup-broken {"dry_run":false}` 清掉 18 道无图坏题

---

### Phase 0 W3+++ — 高数课全 chrome 跑 + 3 类新阻碍补丁 (2026-04-25)

> 在 gstack /browse 里直接跑模拟脚本（不依赖用户已装的 userscript）走高数课 1.1 章，
> 通过 inline JS probe 识别真实运行时阻碍。补丁的依据是**实测样本**，不是猜。

#### Findings（实测笔记）

| ID | 现象 | 根因 |
|---|---|---|
| **B1** | 用户脚本在第 1 节后停在 idle，状态 "已过 1 节" 不动 | iframe `id="mindmap"` 用 `modules/video/index.html` 路径被误分类为 video → course-runner 进 `video-pending` 等真视频结束 → mindmap 不是视频，永远不触发 jumpNext |
| **B2** | jumpNext popup 自动确认完全失效 | chaoxing 实际 popup 容器是 `.maskDiv.jobFinishTip` + 兄弟 `.popDiv.wid440.popMove`，不是 W3++ 默认的 `.jb_dialog`。容器先验失败 → 返回 `no-popup` → popup 永远在 → URL 不动 → course-runner 死等 |
| **B3** | 章内点 #prevNextFocusNext 改 cards num= 不改 top URL，jumpNext 误判"被 popup 拦了" | jumpNext 的 popupRetryMs 路径只比对 `ownerWin.location.href`，没考虑 chaoxing SPA 章内 navigation 通过 cards iframe.src 体现 |

#### Changed

- `client/src/runtime/popup-handler.ts` — `DEFAULT_CONTAINER_SELECTORS` 加 `.maskDiv.jobFinishTip`、`#jobFinishTip`、`.popDiv.popMove`（按实测优先级前置）。旧的 `.jb_dialog` / `.layui-layer-dialog` 保留兼容。
- `client/src/runtime/iframe-dispatch.ts` — `classifyIframe` 在 video 分支加 mindmap guard：`iframe.id === 'mindmap'` 或父 class 含 `min_map_iframe` → 归 `ignored`。
- `client/src/time-padder/chaoxing-task.ts` — `jumpNextChaoxingTask` 的 popupRetryMs 路径除比对 top URL 外，**还比对所有 iframe.src 列表快照**。任一变化即视作 navigation 成功 → 不触发 popup detection。

#### Tests

- `client/test/popup-handler.spec.ts` — +3 用例（实测 .maskDiv.jobFinishTip / .popDiv.popMove / #jobFinishTip 命中 + preChapter 不被误点）
- `client/test/runtime.spec.ts` — +3 用例（mindmap id / min_map_iframe parent / 正常 video 不受影响）
- `client/test/chaoxing-task.spec.ts` — +1 用例（cards iframe src 变化跳过 popup detect）

**测试统计**：client 161 (+7) / e2e 7 / server 34 = **202 测试全绿**。typecheck 过。bundle 806KB。

#### 实测验证证据

走 gstack browse 在用户的 chrome 里：
- ✅ chapter 1.1 (chapterId=1056401944) 实测 14 个 iframe，含 mindmap 误分类样本
- ✅ click `#prevNextFocusNext` 实测 cards iframe `num=0 → num=3`，top URL 不变
- ✅ click 触发 popup `.maskDiv.jobFinishTip` + `.popDiv.wid440.popMove` 实测可见，但 W3++ 旧 selector 无法匹配
- ✅ popup 内 `a.jb_btn.jb_btn_92.fr.fs14.nextChapter` 点击实测 `num=3 → num=4`

---

### Phase 0 W3++ — 高数课实测 3 阻碍补丁 (2026-04-25)

> 实测高数课"全课代戉"流程，识别并修 3 个阻碍。代码改动局限于 client/runtime 与 time-padder。

#### Added

- `client/src/runtime/popup-handler.ts` — `detectAndConfirmPopup` 检测 chaoxing
  "未完成任务"等弹窗 + 安全自动点确认。**容器先验** 防止误把页面正常的 `.nextChapter`
  按钮当弹窗按钮点（实测高数课弹窗按钮 selector 是 `a.jb_btn.jb_btn_92.fr.fs14.nextChapter`，
  跟章节页"下一节"撞名）。
- `client/src/runtime/url-watcher.ts` — `watchInnerIframeUrls` 轮询内层 iframe `src`
  变化。chaoxing 部分场景（cards iframe `num=` 切节）只动 iframe src 不动 top URL，
  光监听 `location.href` 会漏。

#### Changed

- `client/src/runtime/task-handlers.ts` — `processPptReader` 改 fallback selector chain：
  优先 `#panView` 内层 iframe，回退 `.ans-attach-ct` insertdoc（新版 .pptx 命中），
  再回退 iframe 自身 doc。每次成功额外 dispatch 一次 `scroll` 事件兼容
  IntersectionObserver 计完成的 .pptx。
- `client/src/time-padder/chaoxing-task.ts` — `jumpNextChaoxingTask` 加
  `popupRetryMs` opt：点击后等 N ms 看 URL 是否变；没变 + 弹窗出现 → 自动点确认。
  默认 0（向后兼容），course-runner 默认传 1500。
- `client/src/runtime/course-runner.ts` — runChapter 跳节时传 `popupRetryMs: 1500`。
- `client/src/main.ts` — 接 `watchInnerIframeUrls`（同 watchUrl 的 dispatch 路径）+
  3s 周期 `detectAndConfirmPopup`（仅在 `automationEnabled=true` 时生效）。

#### Tests

- `client/test/popup-handler.spec.ts` — 7 用例（容器不存在/隐藏/正常确认/防误触/layui/自定义）
- `client/test/task-handlers.spec.ts` — 5 用例（panView/ans-attach-ct/iframe 自身/跨域 fallback）
- `client/test/runtime.spec.ts` — +5 用例（`watchInnerIframeUrls` 不变/变/cleanup/多 iframe/抛错）

**测试统计**：client 154 + e2e 7 + server 34 = **195 测试全绿**（+17 from W3+）。
typecheck 客户端通过。bundle 805KB（+5KB）。

#### Known issues / 未触及

- chaoxing 弹窗目前只覆盖 `jb_dialog` / `layui-layer-dialog`；遇到新弹窗结构 → 加进
  `DEFAULT_CONTAINER_SELECTORS`
- watchInnerIframeUrls 跟 watchUrl 同时触发会导致 scanCurrent 双跑 — 已被
  scheduleAutoScan 的 debounce + course-runner 幂等抵消，但理论上仍有竞态
- bundle 仍 805KB（table.json inline 致），瘤减留 Phase 1

---

### Phase 0 W3+ — 数学闭环 + 全课代戉 (2026-04-25)

> 在 Phase 0 W3 基础上补完两个 Phase 1 TODO：数学题端到端可答 + 全自动走完整门课。

#### Added

**数学题闭环（C 系列）**
- `server/src/lib/disk-storage.ts` — DiskStorage 类，仿 R2Bucket 的 put/get 子集 API。
  R2 未启用时（Phase 0 默认）落本地盘。含 path traversal 防护、自动建多级目录、content-type 推断。
- `server/src/env.ts` — 默认启用 disk storage，`DISK_STORAGE_PATH` env 可改路径，
  `=__disabled__` 显式关掉。
- `server/src/routes/admin/image.ts` — `GET /admin/image/:hash` 端点。drain worker
  通过它从服务端拉合成图（不暴露公共 URL，admin key 鉴权）。
- `client/src/answer/filler.ts` — 串 vision/compose：未命中本地缓存 + 题目含图片公式（`needsCompose(q)`）
  → `composeQuestionImage` 合 N 张图为 1 张 PNG → base64 → `composite_image_b64`
  随 `/answer` 上传。命中本地缓存就跳过 compose 节省 5-15s/题。
- `cc-worker/drain-netclass.md` — drain skill 改走 `/admin/image/<hash>` 拉图（替原 R2 公共 URL）。

**全课代戉（F 系列）**
- `client/src/runtime/task-handlers.ts` — `processPptReader`（滚 #panView 到底）+
  `processBook`（调 `_unsafeWindow.top.onchangepage(end)`）。对齐旧 app.js:5405-5421。
- `client/src/runtime/course-runner.ts` — `runChapter` 编排单章节所有任务点 + 走完后自动跳下一节；
  `startCourseRunner / stopCourseRunner` 全课 mode 入口；`courseProgress` 进度计数（已过 N 节）。
- `client/src/main.ts` — 接线 PPT/eBook handler；automation=true 时走 runChapter
  （含 jumpNext），手动扫描只 dispatch 不 jump。
- `client/src/ui/Panel.vue` — 新增 "🚀 全课代戉" 主按钮 + "已过 N 节" 进度显示；
  pill label 在 course mode 下显 "🚀 N 节"。
- `client/src/runtime/state.ts` — `requestStartCourse / requestStopCourse` actions。

#### Tests

- `server/test/disk-storage.spec.ts` — 9 用例（put/get/has 路径校验/多级建目录/content-type 等）
- `server/test/admin-image.spec.ts` — 5 用例（200/404/400/403/503 全分支）
- `server/test/math-roundtrip.spec.ts` — 2 e2e（**完整数学链路**：
  client 上传图 → 服务端落盘 → drain 拉图 → drain 写答 → 下次命中；以及 STORAGE 关时图片优雅丢失但 pending 仍写）

**测试统计**：server 34 + client 137 + e2e 7 = **178 测试全绿**。
typecheck 客户端 + 服务端均通过。
client bundle 800KB（+12KB for course-runner + task-handlers）。

#### Known issues / deferred to Phase 1

- bundle 800KB（table.json inline 致），改 `@resource` 远程加载可瘤减回 ~135KB
- course-runner 仅在 chaoxing 走通；unipus / 知到 全课 mode 待 Phase 1+
- 听力题 STT pipeline 留 Phase 3
- inference_logs 写入仍未实装（成本/延迟 dashboard 缺数据）

---

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
