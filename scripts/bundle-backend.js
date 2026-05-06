#!/usr/bin/env node
/**
 * bundle-backend
 *
 * 把 backend ESM 多文件编译产物 bundle 成单文件 dist/cli.js，让 npm 发布时不依赖
 * @auvezy/terminal-remote-shared workspace 包（直接 inline 进 bundle）。
 *
 * 调用时机：
 * - pnpm build 之后（即先 tsc -b 拿到 backend/dist 各 .js）
 * - 在 prepublishOnly 钩子里也会跑一遍
 *
 * 外部 require（不打进 bundle）：
 * - 真实 npm runtime 依赖（cookie / cors / express / pino / ws / web-push / qrcode）
 * - 原生模块（node-pty）→ 必须保留 require()，由用户安装时 npm 编译
 *
 * 输出：backend/dist/cli.js（覆盖原 tsc 产物，仍带 #!/usr/bin/env node shebang）
 */

import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const backendRoot = resolve(projectRoot, 'backend');
const entry = resolve(backendRoot, 'dist', 'cli.js');
const outfile = resolve(backendRoot, 'dist', 'cli.bundle.js');

// 真实运行时依赖，发布时 npm 会装；不要打进 bundle，避免重复 / native 失效
const pkg = JSON.parse(readFileSync(resolve(backendRoot, 'package.json'), 'utf8'));
const externals = Object.keys(pkg.dependencies ?? {})
  // 只保留真实 npm 包，过滤掉 workspace:* 这种本地依赖（@auvezy/terminal-remote-shared 内联）
  .filter((name) => !name.startsWith('@auvezy/'));

// 临时入口：把 entry 的内容去掉 shebang 后写入 entry.tmp.js，bundle 完再 prepend shebang。
// 原因：ESM 模式下 esbuild 把 shebang 当代码处理（不会自动剥），
// 而 ESM 顶部的 import 语句不能放在 shebang 之后，会语法报错。
const entryTmp = resolve(backendRoot, 'dist', '__cli-entry.tmp.js');
const rawEntry = readFileSync(entry, 'utf8');
const stripped = rawEntry.replace(/^#![^\n]*\n/, '');
writeFileSync(entryTmp, stripped, 'utf8');

try {
  await build({
    entryPoints: [entryTmp],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile,
    external: externals,
    sourcemap: false,
    logLevel: 'info',
  });
} finally {
  // 清理临时入口
  try { unlinkSync(entryTmp); } catch {}
}

// bundle 完成：把 bundle 内容读出来；再保险把可能存在的 shebang 全部 strip 掉，
// 由我们手工 prepend 唯一一行。
const distDir = resolve(backendRoot, 'dist');
let bundleContent = readFileSync(outfile, 'utf8');
// 反复 strip 顶部 shebang（防止 esbuild / entry 有重复）
while (bundleContent.startsWith('#!')) {
  const nl = bundleContent.indexOf('\n');
  if (nl === -1) break;
  bundleContent = bundleContent.slice(nl + 1);
}

// 清理所有 .js / .d.ts / .map / 子目录（frontend-dist 在 backend 根，不在 dist 下，不受影响）
function cleanupDist(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      rmSync(full, { recursive: true, force: true });
      continue;
    }
    unlinkSync(full);
  }
}
cleanupDist(distDir);

// 写入带 shebang 的最终 cli.js
const finalPath = resolve(distDir, 'cli.js');
const finalContent = '#!/usr/bin/env node\n' + bundleContent;
writeFileSync(finalPath, finalContent, 'utf8');
chmodSync(finalPath, 0o755);

// 把 postinstall.mjs 复制到 dist 下：npm install 会在用户机器上执行 dist/postinstall.mjs
// 用途：修复 node-pty/prebuilds/<plat>-<arch>/spawn-helper 在 npm tarball 解压后丢失的 +x 权限
const postinstallSrc = resolve(backendRoot, 'scripts', 'postinstall.mjs');
const postinstallDst = resolve(distDir, 'postinstall.mjs');
const postinstallContent = readFileSync(postinstallSrc, 'utf8');
writeFileSync(postinstallDst, postinstallContent, 'utf8');
chmodSync(postinstallDst, 0o755);

console.log(
  `[bundle-backend] 输出：${finalPath}（${(finalContent.length / 1024).toFixed(1)}KB）` +
    ` + ${postinstallDst}`,
);
