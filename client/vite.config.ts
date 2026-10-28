import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';
import { fileURLToPath, URL } from 'node:url';

// 构建产物：client/dist/netclass-sidekick.user.js
// Dev 模式：vite serve + Tampermonkey 开发模式热重载
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Netclass Sidekick (alpha)',
        namespace: 'netclass-sidekick',
        version: '0.7.1',
        description: '网课托管工具：自动刷时长 + 自动答题（Phase 0 alpha）',
        author: 'netclass-sidekick',
        match: [
          '*://*.chaoxing.com/*',
          '*://*.edu.cn/*',
          '*://*.nbdlib.cn/*',
          '*://*.hnsyu.net/*',
          '*://*.gdhkmooc.com/*',
          'https://onlineexamh5new.zhihuishu.com/*',
          'https://uai.unipus.cn/*',
          'https://ucontent.unipus.cn/*',
        ],
        connect: [
          // 本地开发
          'localhost',
          '127.0.0.1',
          // Phase 0 生产：腾讯云轻量 广州节点 裸 IP
          '182.254.180.181',
          // 数学公式 / 题目图托管域 — vision/compose.ts 的 GM_xmlhttpRequest 必须走白名单
          // 实测 W3++++：高数课公式图全在 p.ananas.chaoxing.com/star3/origin/...png
          // 不在白名单里 Tampermonkey 直接拒，compose 抛错被 catch 静默吞掉 → 题入库无图
          'p.ananas.chaoxing.com',
          'mooc1.chaoxing.com',
          'mooc1-1.chaoxing.com',
          'mooc2-ans.chaoxing.com',
          // 知到 / U校园 后续接入再扩
        ],
        grant: [
          'GM_xmlhttpRequest',
          'GM_getValue',
          'GM_setValue',
          'GM_info',
          'GM_addStyle',
          'unsafeWindow',
        ],
        'run-at': 'document-start',
        updateURL: 'http://182.254.180.181:8080/ota/script',
        downloadURL: 'http://182.254.180.181:8080/ota/script',
        // 合规披露（参考原 app.js）
        // vite-plugin-monkey v5 期望对象数组：{ type, description, tag? }
        antifeature: [
          {
            type: 'cheating',
            description:
              '提供超星/智慧树/U 校园的自动刷课与题库答题辅助。请依学校学术诚信规定使用。',
          },
        ],
      },
      build: {
        fileName: 'netclass-sidekick.user.js',
      },
    }),
  ],
});
