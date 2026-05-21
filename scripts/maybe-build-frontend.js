#!/usr/bin/env node
/**
 * maybe-build-frontend
 *
 * 若 frontend/dist 比所有 source 新 → 跳过 vite build。
 * 否则跑 `pnpm --filter auvezy-terminal-remote-frontend build`。
 *
 * Why:发版多数场景只动 backend / shared / docs,frontend 源码未变。vite build
 * 主要时间在 transform 7140 modules + 写 ~300 chunks 到 /mnt/d(WSL2 9P I/O 慢),
 * 单次 ~2 分钟。跳过未变 build 让"只动 backend"的发版从 2:40 → 30 秒。
 *
 * 检测覆盖:
 *  - frontend/src/** + frontend/index.html + frontend/vite.config.ts +
 *    frontend/tsconfig*.json + frontend/package.json
 *  - shared/src/** + shared/package.json(shared 是 frontend 的 workspace dep)
 *
 * 标志:
 *  - `--force` / 环境变量 FORCE_FRONTEND_BUILD=1:无视 mtime 强制 build
 *  - 缺 frontend/dist/index.html → 必 build
 *
 * Why 看 dist/index.html 而非递归 dist mtime:递归 ~300 文件 stat 占 IO,
 * vite emptyOutDir + emit 时 index.html 总是最后写入,代表完整产物时间戳。
 */

import { execSync } from 'node:child_process';
import { statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const FORCE =
  process.argv.includes('--force') || process.env.FORCE_FRONTEND_BUILD === '1';

/** 递归取目录下最新 mtime;skipNames 跳过节点(node_modules / dist 等) */
function latestMtime(dir, skipNames = new Set()) {
  let max = 0;
  try {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (skipNames.has(ent.name)) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        max = Math.max(max, latestMtime(p, skipNames));
      } else if (ent.isFile()) {
        const m = statSync(p).mtimeMs;
        if (m > max) max = m;
      }
    }
  } catch {
    // 目录不存在 / 权限失败 → 视作 0(触发重 build)
  }
  return max;
}

const distIndex = resolve(repoRoot, 'frontend/dist/index.html');
const distExists = existsSync(distIndex);

if (FORCE) {
  console.log('[maybe-build-frontend] --force / FORCE_FRONTEND_BUILD=1 → rebuild');
  runBuild();
} else if (!distExists) {
  console.log('[maybe-build-frontend] frontend/dist/index.html 不存在 → rebuild');
  runBuild();
} else {
  const distMtime = statSync(distIndex).mtimeMs;

  // 跟踪源:frontend src + 配置文件 + shared(workspace dep)
  const skipDir = new Set(['node_modules', 'dist', 'dist-types', '.vite']);
  const watchDirs = [
    resolve(repoRoot, 'frontend/src'),
    resolve(repoRoot, 'shared/src'),
  ];
  const watchFiles = [
    resolve(repoRoot, 'frontend/index.html'),
    resolve(repoRoot, 'frontend/vite.config.ts'),
    resolve(repoRoot, 'frontend/package.json'),
    resolve(repoRoot, 'shared/package.json'),
    // tsconfig 集合
    resolve(repoRoot, 'frontend/tsconfig.json'),
    resolve(repoRoot, 'frontend/tsconfig.node.json'),
    resolve(repoRoot, 'shared/tsconfig.json'),
    resolve(repoRoot, 'tsconfig.base.json'),
  ];

  let srcMtime = 0;
  for (const d of watchDirs) srcMtime = Math.max(srcMtime, latestMtime(d, skipDir));
  for (const f of watchFiles) {
    try {
      srcMtime = Math.max(srcMtime, statSync(f).mtimeMs);
    } catch {
      // 文件不存在 → 忽略(tsconfig.node.json 可能不存在)
    }
  }

  if (srcMtime > distMtime) {
    const ageSec = Math.round((srcMtime - distMtime) / 1000);
    console.log(`[maybe-build-frontend] sources newer by ${ageSec}s → rebuild`);
    runBuild();
  } else {
    const lagSec = Math.round((distMtime - srcMtime) / 1000);
    console.log(`[maybe-build-frontend] dist up-to-date (${lagSec}s newer than sources) → skip vite build`);
  }
}

function runBuild() {
  execSync('pnpm --filter auvezy-terminal-remote-frontend build', {
    stdio: 'inherit',
    cwd: repoRoot,
  });
}
