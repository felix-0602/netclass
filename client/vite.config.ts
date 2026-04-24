import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn } from 'vite-plugin-monkey';
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
          // Phase 2 如果加域名再写进来
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
        // 合规披露（参考原 app.js）
        // vite-plugin-monkey v5 期望对象数组：{ type, description, tag? }
        antifeature: [
          {
            type: 'cheating',
            description:
              '提供超星/知到/U 校园的自动刷课与题库答题辅助。请依学校学术诚信规定使用。',
          },
        ],
      },
      build: {
        fileName: 'netclass-sidekick.user.js',
        externalGlobals: {
          // CDN 加载大依赖，缩小脚本体积
          vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js'),
          'element-plus': cdn.jsdelivr('ElementPlus', 'dist/index.full.min.js'),
          pinia: cdn.jsdelivr('Pinia', 'dist/pinia.iife.prod.js'),
        },
      },
    }),
  ],
});
