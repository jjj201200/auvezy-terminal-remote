/**
 * smoke 公共工具：spawn backend + waitReady + cleanup
 *
 * 各阶段 smoke 的共性：
 *  - mkdtemp 出隔离 HOME
 *  - 起 cli.js 子进程（--port, --no-terminal, CLAUDE_COMMAND/ARGS env）
 *  - 轮询 /api/health 等就绪
 *  - 末了 SIGTERM + rmSync
 *
 * 业务断言由各阶段自己写——不强行模板化。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 起一个 backend 子进程，返回 { child, tmpHome, cleanup, stderr, stdout }。
 *
 * @param {object} opts
 * @param {number} opts.port 端口
 * @param {string} [opts.label] 临时目录前缀（默认 'ocr-smoke-'）
 * @param {string[]} [opts.extraArgs] 追加给 cli.js 的命令行参数
 * @param {object} [opts.env] 额外环境变量（会和 process.env + HOME 合并）
 * @param {string} [opts.command] CLAUDE_COMMAND，默认 'bash'
 * @param {string[]} [opts.args] CLAUDE_ARGS（数组形式），默认 ['-c', 'tail -f /dev/null', '--']
 */
export function spawnBackend(opts) {
  const {
    port,
    label = 'ocr-smoke-',
    extraArgs = [],
    env = {},
    command = 'bash',
    args = ['-c', 'tail -f /dev/null', '--'],
  } = opts;

  const tmpHome = mkdtempSync(resolve(tmpdir(), label));
  const cliJs = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

  const child = spawn(
    process.execPath,
    [cliJs, '--port', String(port), '--no-terminal', ...extraArgs],
    {
      env: {
        ...process.env,
        HOME: tmpHome,
        CLAUDE_COMMAND: command,
        CLAUDE_ARGS: JSON.stringify(args),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });

  async function cleanup() {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 600));
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(tmpHome, { recursive: true, force: true });
  }

  return {
    child,
    tmpHome,
    cleanup,
    get stderr() {
      return stderr;
    },
    get stdout() {
      return stdout;
    },
  };
}

/**
 * 轮询 /api/health 等待 backend 就绪。
 *
 * @param {number} port
 * @param {number} [timeoutMs] 默认 5000
 */
export async function waitReady(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来，再等 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
