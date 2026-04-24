# Netclass Sidekick

> 自动托管中国高校必修网课 dirtywork 的工具。Tampermonkey 脚本 + Cloudflare Workers 服务端 + 本地 Claude Code worker。

## 项目状态

**Phase 0 — 脚手架搭建中**。还不能装不能用。

## 架构一句话

```
Tampermonkey 客户端 (Vue+EP) — DOM 提取 & 自动刷时长
       ↓
Cloudflare Workers 服务端 (Hono+D1+R2) — 题库 + 鉴权 + 队列
       ↓
你本地 Claude Code (drain-netclass.md) — 免费消化 pending 题
```

完整设计：见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 目录

```
.
├── app.js              原始开源脚本参考（Tampermonkey 6040 行，不动）
├── client/             （Phase 0）Tampermonkey 脚本源码
├── server/             （Phase 0）Cloudflare Workers 服务端源码
├── cc-worker/          drain-netclass slash command + 安装脚本
├── docs/               架构、协议、反混淆、反作弊、路线图
│   └── recon/          Phase 0 之前的实地侦察报告 + DOM fixtures
├── test/               顶层 E2E（Playwright + vitest）
└── .claude/plans/      决策沉淀（.claude 目录外的 plan 文件夹）
```

## 阅读顺序

1. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 总览 + ASCII 图
2. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — Phase 0-4 时间线 + 硬门槛
3. [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) — 三方 API + D1 schema
4. [`docs/CXSECRET.md`](./docs/CXSECRET.md) — 超星字体反混淆手册
5. [`docs/VISION-COMPOSE.md`](./docs/VISION-COMPOSE.md) — 数学题合图规范
6. [`docs/DRAIN-WORKFLOW.md`](./docs/DRAIN-WORKFLOW.md) — CC 作 worker 完整手册
7. [`docs/ANTI-DETECTION.md`](./docs/ANTI-DETECTION.md) — 反作弊对抗笔记
8. [`docs/recon/reconnaissance-2026-04-24.md`](./docs/recon/reconnaissance-2026-04-24.md) — 原始侦察报告

## 合规 & 责任

本项目是个人学习工具。商业化相关内容在**私有** repo，不在此处。使用本项目产生的任何后果由使用者本人承担。不鼓励抄袭、不鼓励考试作弊。不提供开放题（作文、演讲）自动化。
