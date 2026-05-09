/**
 * ensureBroker（0.7.0 阶段 2A）
 *
 * worker 启动前调用：保证 broker 进程已经在跑，否则 fork 一个。
 *
 * 算法（详见 ADR-002 §决策）：
 *  1. `withFileLock(~/.atr/broker.lock)`：避免多 worker 同时 fork
 *  2. 锁内 read broker.json + isBrokerAlive
 *     - 活着 → 直接返回当前 state
 *     - 不存在 / pid 死了 / 文件损坏 → 进入 fork 分支
 *  3. fork 分支：
 *     a. spawn detached + unref（broker 永驻不被 worker 退出连带）
 *     b. **轮询 ~/.atr/broker.json 出现** —— 子进程自己写，最简单的"启动完成"信号
 *     c. 拿到 state 后再 HTTP probe `/api/health`，确保真的在 listen
 *     d. 任一步超时（默认 5s）→ 抛 LockError + kill 已 fork 子进程兜底
 *  4. 锁释放
 *
 * 故意不做：
 *  - **不做"降级"**：broker 起不来 = 整个系统起不来。worker 单跑没意义（loopback
 *    无人能访问）。明确报错让用户排查比偷偷继续好。
 *  - **不传 token**：broker 自己生成 / 共享 token；worker 这一侧不该决定 broker 的 auth
 *  - **不传 worker 自己的 instance id**：broker 的 instances.json watcher（阶段 3+）
 *    会自己发现 worker
 *
 * 子进程入口：复用 instance-spawner 的 resolveEntry 思路（cli.js / cli.ts）。
 * 这里**不直接复用 resolveEntry 函数**——instance-spawner 的逻辑是"派生 worker"，
 * broker 派生有自己的 args（`broker start`），但解析入口路径的方式是同一份代码，
 * 抽成本文件内部 `resolveBrokerEntry`，等阶段 6 service-installer 也要用时再上提。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  ATR_DATA_DIR,
  ErrorCode,
} from 'auvezy-terminal-remote-shared';
import { withFileLock } from '../utils/file-lock.js';
import { AppError } from '../errors.js';
import { logger } from '../logger/logger.js';
import {
  isBrokerAlive,
  readBrokerState,
  defaultBrokerStatePath,
  type BrokerState,
} from './broker-state.js';

/** 默认 broker 锁目录 */
function defaultBrokerLockDir(): string {
  return resolve(homedir(), ATR_DATA_DIR, '.broker.lock');
}

export interface EnsureBrokerOptions {
  /**
   * cli.js 路径（同 instance-spawner 的 cliJsPath）。
   *
   * 生产 = `dist/cli.js`；dev = `src/cli.js`（不存在 → 落到 cli.ts + tsx）
   */
  cliJsPath: string;
  /** broker.json 路径；默认 `~/.atr/broker.json` */
  statePath?: string;
  /** broker 锁目录；默认 `~/.atr/.broker.lock` */
  lockDir?: string;
  /** 等 broker.json 出现的总超时（ms）；默认 5000 */
  startupTimeoutMs?: number;
  /** broker.json 出现后再 HTTP probe 的超时（ms）；默认 2000 */
  probeTimeoutMs?: number;
  /**
   * fork 时透传给子进程的环境变量。
   *
   * **不要**带 secrets——broker 子进程会继承父 process.env，再叠加这里的 override。
   */
  env?: Record<string, string>;
  /**
   * 注入 spawn（仅测试用）；签名同 child_process.spawn 但只用第三参数 cwd/env/detached/stdio
   */
  spawnFn?: typeof spawn;
  /**
   * 注入 fetch（仅测试用）；默认用全局 fetch
   */
  fetchFn?: typeof fetch;
  /** 注入"now"（仅测试用） */
  now?: () => number;
}

export interface EnsureBrokerResult {
  /** 当前 broker 状态（要么本来就活着，要么本次 fork 拉起来的） */
  state: BrokerState;
  /** 是否本次新 fork 出来 */
  forked: boolean;
}

/**
 * 保证 broker 在跑；不在跑就 fork 一个并等其就绪
 *
 * @throws LockError 拿不到 broker.lock
 * @throws AppError(ErrorCode.INTERNAL_ERROR) fork 后超时未就绪 / probe 失败
 */
export async function ensureBroker(opts: EnsureBrokerOptions): Promise<EnsureBrokerResult> {
  const statePath = opts.statePath ?? defaultBrokerStatePath();
  const lockDir = opts.lockDir ?? defaultBrokerLockDir();
  const startupTimeoutMs = opts.startupTimeoutMs ?? 5_000;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 2_000;
  const spawnImpl = opts.spawnFn ?? spawn;
  const fetchImpl = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const now = opts.now ?? Date.now;

  // 锁目录的父目录必须先存在（首次启动时 ~/.atr 可能尚未创建）
  ensureParentDir(lockDir);

  return withFileLock(lockDir, async () => {
    // —— 锁内 double-check ——
    const existing = readBrokerState(statePath);
    if (isBrokerAlive(existing)) {
      // 进一步 HTTP probe，避免"pid 还在但已僵死/在退出"——pid 有但端口不通比"明确没起"更糟
      if (existing && (await probeHealth(existing, fetchImpl, probeTimeoutMs))) {
        return { state: existing, forked: false };
      }
      logger.info(
        { pid: existing?.pid, port: existing?.port },
        'broker.json 中 PID 仍存活但 /api/health 不通，重新 fork',
      );
    }

    // —— fork 分支 ——
    const child = forkBroker({
      cliJsPath: opts.cliJsPath,
      env: opts.env,
      spawnImpl,
    });
    if (typeof child.pid !== 'number') {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        'broker 子进程 spawn 失败：无 pid',
      );
    }

    // 轮询 broker.json 出现
    const t0 = now();
    let ready: BrokerState | null = null;
    while (now() - t0 < startupTimeoutMs) {
      const st = readBrokerState(statePath);
      if (st && isBrokerAlive(st) && st.pid === child.pid) {
        ready = st;
        break;
      }
      await sleep(100);
    }
    if (!ready) {
      tryKillChild(child.pid);
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `broker fork 后 ${startupTimeoutMs}ms 未就绪（broker.json 未出现）。`
          + `开 ATR_DEBUG_SPAWN=1 看 /tmp/atr-broker-*.log 排查`,
      );
    }

    // HTTP probe
    if (!(await probeHealth(ready, fetchImpl, probeTimeoutMs))) {
      tryKillChild(child.pid);
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `broker fork 后 /api/health 探针失败（${ready.host}:${ready.port}）`,
      );
    }

    logger.info({ pid: ready.pid, port: ready.port, host: ready.host }, 'broker 已 fork 并就绪');
    return { state: ready, forked: true };
  });
}

// ──────────────── 内部 ────────────────

interface ForkBrokerOpts {
  cliJsPath: string;
  env?: Record<string, string>;
  spawnImpl: typeof spawn;
}

function forkBroker(o: ForkBrokerOpts): { pid: number | undefined } {
  const entry = resolveBrokerEntry(o.cliJsPath);

  // 默认 ignore；ATR_DEBUG_SPAWN=1 时落到 /tmp 便于排查
  const logFd = process.env['ATR_DEBUG_SPAWN']
    ? openSync(`/tmp/atr-broker-${Date.now()}.log`, 'a')
    : 'ignore';

  const child = o.spawnImpl(
    entry.execPath,
    [...entry.args, 'broker', 'start'],
    {
      env: { ...process.env, ...(o.env ?? {}) },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  // 父退出不连带杀 broker
  child.unref();
  return { pid: child.pid };
}

/**
 * 解析 broker 子进程入口
 *
 * 与 instance-spawner.resolveEntry 同思路；这里独立一份避免循环依赖。
 * 阶段 6 service-installer 也需要解析入口，届时上提到 utils。
 *
 * **路径不存在不抛错**：留给 spawn 真正失败时报错（mock spawn 测试场景下
 * 路径无意义；生产路径 dist/cli.js 一定存在）。fallback 到 cliJsPath 原值，
 * 让 spawn 自己抱怨找不到文件，错误信息更直接。
 */
function resolveBrokerEntry(cliJsPath: string): { execPath: string; args: string[] } {
  if (existsSync(cliJsPath)) {
    return { execPath: process.execPath, args: [cliJsPath] };
  }
  const tsPath = cliJsPath.replace(/\.js$/, '.ts');
  if (existsSync(tsPath)) {
    // dev：用 node --import tsx（要求 node >= 20.6 + 已装 tsx）
    return { execPath: process.execPath, args: ['--import', 'tsx', tsPath] };
  }
  // fallback：让 spawn 自己 ENOENT，错误信息更具体
  return { execPath: process.execPath, args: [cliJsPath] };
}

/** 创建锁目录的父目录（递归），存在则跳过 */
function ensureParentDir(lockDir: string): void {
  const parent = dirname(lockDir);
  if (existsSync(parent)) return;
  try {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger.warn({ parent, err }, '创建 broker 锁父目录失败（继续尝试持锁）');
  }
}

/**
 * 安全杀子进程
 *
 * 故意不杀自身（child.pid === process.pid 时跳过）：mock 测试场景下
 * spawn 返回的可能是当前进程 pid；生产场景 fork 出来的子进程一定有
 * 不同的 pid（POSIX/Win32 都不会复用父进程 pid）。
 */
function tryKillChild(pid: number | undefined): void {
  if (typeof pid !== 'number' || pid <= 0) return;
  if (pid === process.pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* 已死最好 */
  }
}

async function probeHealth(
  state: BrokerState,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const url = `http://${probeHost(state.host)}:${state.port}/api/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal });
    if (!r.ok) return false;
    const body = (await r.json()) as { ok?: unknown; role?: unknown };
    return body.ok === true && body.role === 'broker';
  } catch (err) {
    logger.debug({ url, err }, 'broker health probe 失败');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** broker 监听 0.0.0.0 时探针走 127.0.0.1（同机最稳） */
function probeHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 默认 broker 锁目录（导出供测试 / 诊断） */
export { defaultBrokerLockDir };
