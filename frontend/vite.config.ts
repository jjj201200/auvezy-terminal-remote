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
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const includeDesign = process.env.INCLUDE_DESIGN === '1';

export default defineConfig({
  plugins: [
    react(),
    // PWA：injectManifest 模式——我们写自己的 src/sw.ts，让 vite-plugin-pwa
    // 把预缓存清单注入到 self.__WB_MANIFEST。manifest 仍走 public/manifest.webmanifest
    // （我们已有完整文件，禁用 plugin 的 manifest 生成）
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // main.tsx 自己注册，方便加更新提示
      manifest: false, // 用 public/manifest.webmanifest（不让 plugin 重写）
      injectManifest: {
        // xterm 的 unicode 表 + WebGL shader 一个文件就 2MB，放宽预缓存大小限制
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        // dev 模式不启用 SW（HMR 跟 SW 缓存冲突）
        enabled: false,
      },
    }),
  ],
  css: {
    modules: {
      // CSS Modules 类名生成：开发期可读 + 生产期短哈希
      generateScopedName:
        process.env.NODE_ENV === 'production'
          ? '[hash:base64:6]'
          : '[name]__[local]__[hash:base64:4]',
      localsConvention: 'camelCaseOnly',
    },
    preprocessorOptions: {
      scss: {
        // 不在每个 module 里 @use 'tokens'：tokens 仅在用到时显式 @use；
        // 这里只统一 silenceDeprecations（vite 6 的 sass legacy api 警告）。
        silenceDeprecations: ['legacy-js-api', 'import'],
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // WSL2 + Windows 文件系统（/mnt/d/...）的 fs event 经常丢，
    // 改用 polling 让 vite 定时扫 mtime —— HMR 必备
    watch: {
      usePolling: true,
      interval: 300,
    },
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
    // 闭源发布：不生成 source map（避免暴露源码结构 / 文件名）
    sourcemap: false,
    rollupOptions: {
      // 默认仅打 index.html。dev 模式 multi-page 自动启用；
      // 想 build 出 design.html 时，跑 INCLUDE_DESIGN=1 pnpm build
      input: includeDesign
        ? {
            index: resolve(__dirname, 'index.html'),
            design: resolve(__dirname, 'design.html'),
          }
        : resolve(__dirname, 'index.html'),
    },
  },
  optimizeDeps: {
    // 显式预构建 @tabler/icons-react：
    // 不预构建 → 启动快 30s，但首次打开页面要按需编译每个 icon 文件，体验差
    // 预构建   → 启动慢 30s 一次，页面切换秒开
    // 我们选后者；启动后 .vite 缓存复用，下一次 dev 不再重做
    include: ['@tabler/icons-react'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
