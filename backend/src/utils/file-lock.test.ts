/**
 * file-lock 单测
 *
 * 关键点：
 *  - 单进程下两次 tryAcquireLock 必须有一个失败
 *  - withFileLock 的 fn 抛错时仍释放锁
 *  - 僵尸锁（pid 不存活）会被强制清理
 *  - 重试次数用尽抛 LockError(LOCK_TIMEOUT)
 *  - 真实并发：用 Promise.all 起 5 个 withFileLock，结果应该串行（共享计数器无竞争）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  withFileLock,
  tryAcquireLock,
  releaseLock,
} from './file-lock.js';
import { LockError } from '../errors.js';
import { ErrorCode } from '@ocr/shared';

describe('file-lock', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-flock-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('tryAcquireLock 第一次成功，第二次失败', () => {
    const lock = resolve(baseDir, 'L');
    expect(tryAcquireLock(lock)).toBe(true);
    expect(tryAcquireLock(lock)).toBe(false);
    releaseLock(lock);
    expect(tryAcquireLock(lock)).toBe(true);
    releaseLock(lock);
  });

  it('withFileLock 正常执行 fn 并释放', async () => {
    const lock = resolve(baseDir, 'L');
    const r = await withFileLock(lock, () => 42);
    expect(r).toBe(42);
    expect(existsSync(lock)).toBe(false);
  });

  it('withFileLock fn 抛错也会释放', async () => {
    const lock = resolve(baseDir, 'L');
    await expect(
      withFileLock(lock, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('重试用尽抛 LockError(LOCK_TIMEOUT)', async () => {
    const lock = resolve(baseDir, 'L');
    // 手动占住锁不放，pid 写一个我们能确定"还活着"且不是自己的 pid。
    // init (pid=1) 在 Linux/WSL 上总是存活；用它即可让 stale 检查返回 false。
    mkdirSync(lock, { recursive: false, mode: 0o700 });
    writeFileSync(resolve(lock, 'pid.txt'), `1\n${Date.now()}\n`);

    await expect(
      withFileLock(lock, () => 1, {
        retries: 2,
        retryIntervalMs: 5,
        staleMs: 60_000,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.LOCK_TIMEOUT,
    });

    // 清理
    rmSync(lock, { recursive: true, force: true });
  });

  it('僵尸锁（pid 不存活）立即被回收，无需等 mtime', async () => {
    const lock = resolve(baseDir, 'L');
    mkdirSync(lock, { recursive: false, mode: 0o700 });
    // pid 是不存在的高位 pid，mtime 仍然是新的
    writeFileSync(resolve(lock, 'pid.txt'), `2147483640\n${Date.now()}\n`);

    expect(tryAcquireLock(lock)).toBe(true);
    releaseLock(lock);
  });

  it('并发 5 路 withFileLock：fn 内 race-free 累加', async () => {
    const lock = resolve(baseDir, 'L');
    let counter = 0;
    const inc = (): Promise<void> =>
      withFileLock(
        lock,
        async () => {
          // 模拟 read-modify-write：如果两路同时进来会丢更新
          const before = counter;
          await new Promise((r) => setTimeout(r, 10));
          counter = before + 1;
        },
        { retries: 100, retryIntervalMs: 5 },
      );

    await Promise.all([inc(), inc(), inc(), inc(), inc()]);
    expect(counter).toBe(5);
  });

  it('LockError 具有正确的 code 与默认 503', () => {
    const err = new LockError(ErrorCode.LOCK_TIMEOUT, 'x');
    expect(err.code).toBe(ErrorCode.LOCK_TIMEOUT);
    expect(err.httpStatus).toBe(503);
  });
});
