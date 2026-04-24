import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// vitest 跟 vite-plugin-monkey 不共存（monkey 期望真实 userscript build 上下文）
// → 单元测试用独立 config，仅保留 Vue 插件 + alias

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
