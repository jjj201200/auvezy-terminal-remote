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
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const includeDesign = process.env.INCLUDE_DESIGN === '1';

// 注入构建时的版本号；前端 Settings → 关于 tab 用它显示。
// 用 backend 的 version 而不是 frontend 自己的——两者总是对齐发布，
// 但用户安装的是 backend npm 包，"我装的是哪一版"语义上以 backend 为准。
const backendVersion = JSON.parse(
  readFileSync(resolve(__dirname, '../backend/package.json'), 'utf8'),
).version as string;

export default defineConfig({
  // 0.7.0：相对 base，让编译产物的 asset URL 全部相对（如 ./assets/index-abc.js）。
  // broker 反代回 HTML 时会注入 `<base href="/i/<id>/">`，浏览器把所有相对 URL
  // 解析到 broker scope（详见 ADR-007）。dev 模式 base 也是 './'，但 vite serve
  // 默认在根 / 提供 SPA，相对路径解析到 / 一样工作
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(backendVersion),
  },
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
    // 0.7.0 v2 dev 流程：先 `atr start`（daemonized broker on :3737, 0.7.3 默认),
    // 再 vite。vite 只反代到 broker；broker 自己再反代到 worker。生产/开发 origin 一致。
    // 0.7.3 起默认端口从 3000 改为 3737,见 shared/src/constants.ts 注释。
    // 老 dev broker 还在 3000:`atr stop` 后 `atr start` 自动用新默认 3737;若要保持
    // 3000,显式 `atr start --port 3000`,但这里 vite 反代要同步改回 3000。
    proxy: {
      '/api': {
        target: 'http://localhost:3737',
        changeOrigin: true,
      },
      // `/i/<id>/ws` 与 `/i/<id>/api/...`：实例特定路径，broker 接管反代
      '/i/': {
        target: 'http://localhost:3737',
        ws: true,
        changeOrigin: true,
      },
      // 兼容老路径 /ws（attach 客户端 / 旧 webapp）；新前端不再使用
      '/ws': {
        target: 'ws://localhost:3737',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 不生成 source map：移动端流量敏感，sourcemap 会让首屏下载量翻倍。
    // 调试时本地 dev 跑 vite 即可，无需生产 sourcemap。
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
