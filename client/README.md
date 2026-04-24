# Netclass Sidekick — 客户端（Tampermonkey 用户脚本）

## 开发

```bash
npm install           # 一次性安装依赖
npm run dev           # Vite 热重载开发服
# 打开 http://localhost:5173/，vite-plugin-monkey 会在首页提示"点这里安装 dev 脚本"
npm run build         # 产出 dist/netclass-sidekick.user.js
npm run test          # vitest 单元测试
npm run typecheck     # vue-tsc 类型检查
```

## 入口 & 结构

- `src/main.ts` — 入口：识别平台后派发给对应 adapter
- `src/adapters/{chaoxing,unipus}.ts` — DOM 提取器
- `src/decode/cxsecret.ts` — 超星字体反混淆（含 `_vendor/typr-font.js`）
- `src/vision/compose.ts` — 数学题 N 图合成 1 张 PNG
- `src/answer/{cache,client}.ts` — 本地缓存 + 服务端通信
- `src/time-padder/` — 视频自动播放 + 活跃度模拟
- `src/ui/Panel.vue` — 浮窗 UI

## 文档

详细架构 / 协议 / 反混淆手册全部在 `../docs/` 下。

## Phase 0 实装状态

目前只是脚手架：adapter 和 time-padder 是占位实现，待按 `../docs/ROADMAP.md` 的 Phase 0 Week 1 任务推进。
decode / 反混淆模块已完整实装 + 8 条单元测试通过。
