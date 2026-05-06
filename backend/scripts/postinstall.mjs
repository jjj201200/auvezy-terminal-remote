#!/usr/bin/env node
/**
 * postinstall：精确修复 node-pty/spawn-helper 在 npm 解压时丢失的执行权限
 *
 * 背景：
 * `npm pack` / `npm install` 把文件写入 tar 时会把 mode normalize 成 0o644，
 * 失去 +x 位。对绝大多数 .js / .json 没影响，但 node-pty 在 macOS / Linux 上
 * 依赖 `prebuilds/<plat>-<arch>/spawn-helper` 这个**可执行**辅助二进制来 fork PTY
 * （绕过 macOS "父进程无法直接给子进程绑 PTY" 的限制）。
 *
 * 现象：执行位丢失 → posix_spawnp 调到一个不可执行的文件 → "posix_spawnp failed"
 * （macOS arm64 复现率 100%；Linux 因为走 forkpty 不需要 spawn-helper 不影响）。
 *
 * 上游 node-pty 的 post-install 只处理 Windows 的 conpty.dll，对 spawn-helper
 * 视而不见，所以我们在自己的 postinstall 里兜底。
 *
 * 安全考量：
 * - 仅处理已知白名单：node-pty 的 spawn-helper。**不**触碰其它包，**不**触碰 .node 文件
 *   （.node 是 dlopen 加载的共享库，不需要 +x，给它加 +x 反而扩攻击面）
 * - spawn-helper 本身的能力 = "调用用户传给 node-pty 的命令"，不会扩权
 * - 真正的风险模型是 supply-chain：如果攻击者能写入 node_modules/node-pty/，
 *   他不需要靠这个脚本就能植入恶意；本脚本不会因此让事情变更糟
 * - 失败仅警告，不阻塞 install
 *
 * 未来引入新原生包（如 better-sqlite3 / sharp）需要类似处理时，
 * 在 NATIVE_HELPERS 数组追加白名单。
 */

import { promises as fs } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/postinstall.mjs → 本包根目录
const packageRoot = join(__dirname, '..');
const nodeModulesRoot = join(packageRoot, 'node_modules');

/**
 * 白名单：(包名, 二进制名)
 *
 * 包名严格匹配 node_modules/<pkg>/ 下；嵌套 node_modules 也支持。
 * 二进制名严格匹配 prebuilds/<任意子目录>/<binaryName>。
 */
const NATIVE_HELPERS = [{ pkg: 'node-pty', binary: 'spawn-helper' }];

/** 在 root 下递归找出所有 node_modules/<targetPkg> 路径 */
async function* findPackageInstances(root, targetPkg, depth = 0) {
  if (depth > 6) return; // 防意外深度
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(root, e.name);
    // 命中目标包
    if (e.name === targetPkg && basename(root) === 'node_modules') {
      yield p;
    }
    // 继续往下找：仅穿透 node_modules / scope（@xxx）目录
    if (
      e.name === 'node_modules' ||
      e.name.startsWith('@') ||
      basename(root) === 'node_modules'
    ) {
      yield* findPackageInstances(p, targetPkg, depth + 1);
    }
  }
}

/** 在 pkgDir/prebuilds 下查找各平台目录里的 binary 文件 */
async function findBinaries(pkgDir, binaryName) {
  const prebuildsDir = join(pkgDir, 'prebuilds');
  let platforms;
  try {
    platforms = await fs.readdir(prebuildsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const plat of platforms) {
    if (!plat.isDirectory()) continue;
    const candidate = join(prebuildsDir, plat.name, binaryName);
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) out.push(candidate);
    } catch {
      // 平台无对应二进制：跳过
    }
  }
  return out;
}

async function main() {
  let fixed = 0;
  let failed = 0;
  const fixedPaths = [];
  try {
    for (const { pkg, binary } of NATIVE_HELPERS) {
      for await (const pkgDir of findPackageInstances(nodeModulesRoot, pkg)) {
        const binaries = await findBinaries(pkgDir, binary);
        for (const file of binaries) {
          try {
            await fs.chmod(file, 0o755);
            fixed++;
            fixedPaths.push(file);
          } catch (err) {
            failed++;
            process.stderr.write(
              `[atr postinstall] chmod 失败：${file} (${err && err.message ? err.message : err})\n`,
            );
          }
        }
      }
    }
  } catch (err) {
    // 全局兜底：任何意外都不应该让 install 失败
    process.stderr.write(
      `[atr postinstall] 扫描出错（已忽略）：${err && err.message ? err.message : err}\n`,
    );
    return;
  }
  if (fixed > 0) {
    process.stderr.write(
      `[atr postinstall] 修复 ${fixed} 个 native helper 执行权限${
        failed > 0 ? `（${failed} 个失败）` : ''
      }\n`,
    );
  }
}

void main();
