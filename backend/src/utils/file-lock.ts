/**
 * mkdir-as-lock 文件锁
 *
 * 设计：
 *  - 用 `mkdir(path, { recursive: false })` 的原子性当锁：
 *    - 第一个调用者成功创建目录 → 持有锁
 *    - 后续调用者 EEXIST → 看到锁已存在
 *  - 锁目录里写一个 `pid.txt` 文件记录持有者 PID 与创建时间
 *  - 释放锁 = rmdir + 删 pid 文件
 *  - 僵尸清理：如果发现锁存在但 stale（年龄 > FILE_LOCK_STALE_MS），
 *    且 pid.txt 中记录的进程已不存在，强制清理
 *
 * 为什么选 mkdir 而不是 flock / lockfile 库：
 *  - flock：跨 OS 兼容差（Windows 行为不同），且跨 NFS 不可靠
 *  - 第三方 lockfile 库：依赖额外，行为常含等待 polling 写在用户进程内
 *  - mkdir 是 POSIX + Win32 都原子的，跨平台行为一致
 *  - 单文件系统下行为可预期，对多实例本地协作够用
 *
 * 不保证：
 *  - 跨主机的 NFS 锁（claude-remote 仅本机使用）
 *  - 异步信号安全（持有时进程被 SIGKILL 后留 stale，靠僵尸清理兜底）
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorCode } from '@ocr/shared';
import { LockError } from '../errors.js';
import { logger } from '../logger/logger.js';
import {
  FILE_LOCK_RETRIES,
  FILE_LOCK_RETRY_INTERVAL_MS,
  FILE_LOCK_STALE_MS,
} from '../constants.js';

/** withFileLock 配置 */
export interface FileLockOptions {
  /** 重试次数；默认 FILE_LOCK_RETRIES */
  retries?: number;
  /** 单次重试间隔（ms）；默认 FILE_LOCK_RETRY_INTERVAL_MS */
  retryIntervalMs?: number;
  /** 僵尸阈值（ms）；默认 FILE_LOCK_STALE_MS */
  staleMs?: number;
}

/**
 * 在 lockDir 上获取互斥锁后执行 fn，结束后自动释放
 *
 * @param lockDir 锁目录路径（不存在会被创建作为锁）
 * @param fn      持锁期间执行的逻辑
 * @returns       fn 的返回值
 * @throws LockError(LOCK_TIMEOUT) 重试用尽仍拿不到
 *
 * @example
 * await withFileLock('~/.claude-remote/.shared-token.lock', async () => {
 *   if (!existsSync(tokenPath)) writeToken();
 * });
 */
export async function withFileLock<T>(
  lockDir: string,
  fn: () => T | Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const retries = opts.retries ?? FILE_LOCK_RETRIES;
  const interval = opts.retryIntervalMs ?? FILE_LOCK_RETRY_INTERVAL_MS;
  const staleMs = opts.staleMs ?? FILE_LOCK_STALE_MS;

  let attempt = 0;
  while (true) {
    if (tryAcquireLock(lockDir, staleMs)) {
      try {
        return await fn();
      } finally {
        releaseLock(lockDir);
      }
    }

    attempt++;
    if (attempt > retries) {
      throw new LockError(
        ErrorCode.LOCK_TIMEOUT,
        `锁超时：${lockDir}（重试 ${retries} 次仍未获取）`,
      );
    }
    await sleep(interval);
  }
}

/**
 * 尝试获取锁，立即返回结果（不重试）
 *
 * @returns true=已持锁；false=锁被他人持有
 */
export function tryAcquireLock(lockDir: string, staleMs: number = FILE_LOCK_STALE_MS): boolean {
  // 先看是不是僵尸锁
  if (existsSync(lockDir)) {
    if (isStale(lockDir, staleMs)) {
      logger.warn({ lockDir }, '检测到僵尸锁，强制清理');
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ lockDir, err }, '清理僵尸锁失败（继续尝试）');
      }
    } else {
      return false;
    }
  }

  // mkdir 原子性创建：成功 → 持锁；EEXIST → 别人抢先
  try {
    mkdirSync(lockDir, { recursive: false, mode: 0o700 });
    // 写 pid.txt 记录持有者，僵尸判定时用
    const pidFile = resolve(lockDir, 'pid.txt');
    try {
      writeFileSync(pidFile, `${process.pid}\n${Date.now()}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch (err) {
      // 写 pid 失败不影响持锁性，但僵尸判定会少一道兜底
      logger.warn({ pidFile, err }, '写 pid.txt 失败（锁仍持有）');
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    // 其它错（权限、磁盘满）→ 视为不可获取
    logger.warn({ lockDir, err }, 'mkdir 失败');
    return false;
  }
}

/** 释放锁；不存在不报错 */
export function releaseLock(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ lockDir, err }, '释放锁失败');
  }
}

/**
 * 锁是否过期：
 *  - 目录存在时间 > staleMs，且
 *  - pid.txt 中记录的 pid 已经不在进程表（或 pid.txt 不存在）
 *
 * 注意：pid 检查只能识别"同一台机器、当前用户能 kill -0 的进程"。
 * 跨用户 / 跨容器场景需要更高级方案，但本工具仅服务本机本用户。
 */
function isStale(lockDir: string, staleMs: number): boolean {
  let ageMs: number;
  try {
    const st = statSync(lockDir);
    ageMs = Date.now() - st.mtimeMs;
  } catch {
    return false;
  }
  if (ageMs <= staleMs) return false;

  // 目录够老。再看 pid 是否存活
  const pidFile = resolve(lockDir, 'pid.txt');
  if (!existsSync(pidFile)) {
    // 旧锁没有 pid.txt（可能上次写失败），按 stale 处理
    return true;
  }
  try {
    const txt = readFileSync(pidFile, 'utf-8');
    const pid = parseInt(txt.split('\n')[0] ?? '', 10);
    if (!Number.isInteger(pid) || pid <= 0) return true;
    if (pid === process.pid) return true; // 自身重启留下的旧锁
    try {
      process.kill(pid, 0); // 仅探测，不实际发信号
      return false; // 进程仍活着 → 还不能算 stale
    } catch (err) {
      // ESRCH = 进程不存在 → stale
      return (err as NodeJS.ErrnoException).code === 'ESRCH';
    }
  } catch {
    // 读 pid.txt 失败 → 当 stale
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
