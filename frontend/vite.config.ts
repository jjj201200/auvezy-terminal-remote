/**
 * Vite 配置
 *
 * 设计点：
 * - dev 模式：前端跑 5173，把 /api 与 /ws 反代到 backend 3000
 *   这样开发时前端有 HMR、后端独立重启，互不干扰
 * - 生产模式：build 输出到 dist/，由 backend Express 静态托管
 *   （根脚本 copy-frontend-dist 把 dist/ 拷到 backend/frontend-dist）
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
