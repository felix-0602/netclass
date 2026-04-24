# Netclass Sidekick — Client (Tampermonkey userscript)

## Dev

```bash
npm install           # 一次性
npm run dev           # Vite 热重载 dev server
# 把 http://localhost:5173/ 打开，vite-plugin-monkey 会在首页显示"点这里安装 dev 脚本"
npm run build         # 产出 dist/netclass-sidekick.user.js
npm run test          # vitest 跑单元测试
npm run typecheck     # vue-tsc 类型检查
```

## 入口 & 结构

- `src/main.ts` — 入口，识别平台后派给对应 adapter
- `src/adapters/{chaoxing,unipus}.ts` — DOM 提取器
- `src/decode/cxsecret.ts` — 超星字体反混淆
- `src/vision/compose.ts` — 数学题 N 图合 1 PNG
- `src/answer/{cache,client}.ts` — 本地缓存 + 服务端通信
- `src/time-padder/` — 视频自动播放 + 活跃度模拟
- `src/ui/Panel.vue` — 浮窗 UI

## 文档

详细架构 / 协议 / 反混淆手册全在 `../docs/` 下。

## Phase 0 实装状态

目前是骨架，adapter 和 time-padder 是 placeholder，待按 `docs/ROADMAP.md` § Phase 0 Week 1 实装。
