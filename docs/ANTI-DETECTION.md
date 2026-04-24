# 反作弊对抗笔记（Anti-Detection）

> 超星 / U 校园平台对"自动化刷课/答题"有一定检测。完全绕开不现实，目标是**把被发现的概率压到比单个用户手动刷低**，而且被发现时**不主动引起特定点名**。

## 1. 威胁模型

| 威胁 | 可能性 | 影响 |
|---|---|---|
| 平台检测脚本 tamper 行为 → 封账号 | 中 | 单用户被封，影响口碑 |
| 平台爬虫扫 Greasyfork / GitHub 发现我们 → 向学校发函 | 低-中 | 波及所有用户 |
| 学校抓到学生 GPA 异常 → 约谈 | 中 | 个别用户后果承担 |
| 同行（其他刷课工具）举报 / 钓鱼卡密 | 中 | 卡密泄漏或服务被针对 |
| 超星发 DMCA / 诉讼（针对 founder） | 低（Phase 0-1），中（Phase 2+） | 商业化核心受影响 |

## 2. 客户端反检测

### 2.1 行为层

- **随机化点击时序**：选项 click 之间延迟 `400-1500ms random`，不要整齐 500ms
- **鼠标轨迹模拟**：每次点击前 `setTimeout` 触发 `mousemove` 到目标附近，再 click（防仅 `synthetic click` 检测）
- **播放速度不卡极限**：超星允许 2x，用 `1.75x + 随机抖动`；U 校园禁用加速（检测）
- **页面切到后台不暂停**：`visibilitychange` 事件下仍保持 video.currentTime 推进（原生 HTMLVideoElement 在 tab 隐藏时会 throttle timer，需 `requestAnimationFrame` 自维护 tick）
- **不拖进度条**：任何跳过行为都会进可疑记录。自动化只做"从 0 到 end 顺序播放"
- **不并发刷多门课**：每用户同时只开 1 门。多门并发是机器人明显特征

### 2.2 运行时隐身

- 不在 `window` 上暴露全局对象（避开 `window.$NetclassSidekick` 这种签名）
- 所有脚本代码闭包包裹
- `GM_xmlhttpRequest` 的 `headers.referer` 严格伪装为当前页面
- 请求间隔加 jitter，不要整齐 300ms poll

### 2.3 DOM mutation 不要太激进

超星近年加了 `MutationObserver` 可能监听：
- 短时间内 hidden input value 被写入次数
- option li 的 class 切换频率

应对：**写入答案的同时 dispatch `input`/`change` 事件**（原 `app.js` 就这么做）。并且每次 mutation 间隔 >300ms。

### 2.4 浏览器指纹稳定

- 不 override UA
- 不 override canvas/webgl fingerprint
- **device_fingerprint 存本地**，只用来服务端 auth，**不**上传到平台
- 同一 Chrome profile 下脚本保持 device fingerprint 稳定（不要每次会话重算）

## 3. 服务端反检测

### 3.1 域名隔离

- **不用国内注册商 / 国内主机 / 不备案**
- Cloudflare Workers 默认 `*.workers.dev`（CF 自有 CDN，IP 分散，难封 IP）
- Phase 2 买个 `.xyz` / `.top` / `.click` 国外注册商域名指 CF
- 域名 WHOIS 启用 privacy，注册邮箱用 ProtonMail 不是 QQ/Gmail 实名

### 3.2 请求特征散开

- `/answer` 支持用户自定义 User-Agent（默认伪装最新 Chrome）
- 不要从统一 IP 调 `/admin/*`（drain 从你家 IP，CF 自带 Anycast 用户访问 IP）
- 卡密在前端解析时加 `sleep(random 200-500ms)` 避免 timing 指纹

### 3.3 审计

- `/auth` 每次登录记 `auth_events`：IP、UA、device fingerprint。发现短时间 >5 次 / 多地 IP 同卡密 → 自动 ban
- 盗版监控：对卡密分别在脚本里注入**独一无二的无害 dummy 题目**（水印，比如 `question_hash: dummy-XXXXX` 返回 answer `这是水印题不会出现在真题里`）。如果服务器收到这个 hash 的 /answer 请求 → 该卡密已泄漏

## 4. 开源 repo 对抗

### 4.1 Greasyfork 发布

- **必加** `@antifeature cheating` 声明：按 Greasyfork 规则对作弊功能披露
- 不在 description 写"刷课 / 过关 / 100%"这种直接口号，描述偏向"任务点导航辅助、无答案题目手动标记、复习整理"这种中性语义
- 截图放在 README 而非 Greasyfork 主页（方便后期删改）

### 4.2 GitHub repo

- `server/` 和 `cc-worker/` **放在同一 repo**，但服务端部署相关 `wrangler.toml` secret 不 commit
- README **不提**"超星付费题库绕过""代答"字样
- 标签写"education-tools, userscript, browser-automation"而非"cheat, anti-chaoxing"
- 商业卡密相关 repo（付费卡密生成 / 签发）**放在独立 private repo**，**不出现**在开源 repo 的任何 import 链路里

### 4.3 Founder 身份隔离

- GitHub 注册用 `netclass-sidekick@proton.me` 这种工具邮箱
- Greasyfork 作者名不要和 GitHub / 学校用的 handle 重复
- 本人实名简历 / 微信 / 朋友圈 **不提** 这个项目
- 舍友 / 同班知情，要求他们也别公开传，"用就用别发朋友圈"

## 5. U 校园特殊点

- U 校园是 SPA React，**无 iframe**，注入时机是 `DOMContentLoaded + setTimeout 500ms` 等 React hydrate
- U 校园有**活跃度检测**：鼠标/键盘 5min 无操作 → 视频暂停。脚本必须定时 `dispatchEvent(new MouseEvent('mousemove'))`（每 3min 一次，jitter ±30s）
- U 校园提交答案走 `POST https://ucontent.unipus.cn/...` XHR，**不是 form**。Hook 需要 monkey-patch `fetch` 或 `XMLHttpRequest.prototype.send`
- U 校园听力题前端会校验"音频是否播完"。脚本必须完整播放再答题（或 patch `audioelement.ended`）

## 6. 应急预案

当以下任一发生，立即**全停**并写 incident 报告：

1. 用户报告账号被封 → 暂停公开发卡密，分析 log 找共性
2. Greasyfork 下架 → 切 GitHub Releases 分发，OTA 提示用户手动安装
3. 超星/U 校园发律师函（邮件 / 站内信到 founder） → 关站、删 repo、恢复 app.js 原始代码保留用作参考、写公开声明"项目终止"
4. 学校处分通知 → 停止所有 founder 个人的推广，项目转入"仅自用"模式
5. 出现大批量用户 IP 被平台限流 → 暂停 OTA，评估是否需要加 IP 代理层

每个 incident 都在 `docs/recon/decisions/incident-YYYY-MM-DD.md` 留档。

## 7. 需要进一步侦察的盲区（Phase 0 补做）

- [ ] 超星是否**已经在后端记录**脚本触发的 timing 特征？抓一次真实 `/log` 心跳 POST vs 脚本发起的 `/log`，对比 body 差异
- [ ] U 校园**成绩同步接口**有没有"异常完成"字段？
- [ ] 连续 50 次自动化刷课 7 天后，测试账号有没有收到平台站内信
- [ ] Chrome Extension vs Tampermonkey 在超星后端日志里看着一不一样（hash 不同 UA？）

这四点在 Phase 0 Week 3 结束前必须有数据。未知状态下进 Phase 1 属于盲目推进。
