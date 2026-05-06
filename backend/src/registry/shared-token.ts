/**
 * shared-token：跨实例共享的 token 文件
 *
 * 场景：
 *   用户 A 启动 instance 1（端口 3000），生成 token X 写到 ~/.auvezy/terminal-remote/config.json
 *   用户 A 又启动 instance 2（端口 3001）——它应当读到同一个 token X，
 *   而不是另起一个 token Y——否则手机上扫码的二维码会随机失效。
 *
 * 设计：
 *   - token 持久化在 config.json 顶层 token 字段（与用户偏好同盘）
 *   - 多实例并发"读 + 没有则生成"操作必须串行 → 用 file-lock 包住
 *   - 锁内 double-check：拿到锁后再读一次文件，确保没被先到者写入
 *
 * 不做的事：
 *   - 加密：token 本身已经是 256-bit 高熵随机串，写明文 + 文件 0o600 已够
 *   - 跨主机同步：atr 仅本机使用
 *   - token 轮换：用户可手动删 config.json 让下次启动重新生成
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  ATR_DATA_DIR,
  CONFIG_FILENAME,
  type UserConfig,
} from '@auvezy/terminal-remote-shared';
import { withFileLock } from '../utils/file-lock.js';
import { logger } from '../logger/logger.js';

/**
 * 共享 token 解析结果
 *
 * source 标记：
 *  - 'shared'：从已存在的 config.json 读到（其它实例已生成）
 *  - 'generated'：本实例生成并落盘
 *
 * 与 cli/env 来源协调：上层（loadConfig）应在 cli/env 都未指定时
 *   才走 shared 路径。
 */
export interface SharedTokenResult {
  token: string;
  source: 'shared' | 'generated';
  /** token 落盘到的 config.json 完整路径 */
  path: string;
}

/** acquireSharedToken 入参 */
export interface AcquireSharedTokenOptions {
  /** config.json 完整路径；默认 ~/.auvezy/terminal-remote/config.json */
  path?: string;
  /** 锁目录路径；默认 <dir>/.shared-token.lock */
  lockDir?: string;
  /** token 生成函数；注入便于单测 */
  generateToken: () => string;
}

/**
 * 获取共享 token
 *
 * 行为：
 *   1. 拿锁
 *   2. 读 config.json：
 *      - 顶层 .token 字段存在 → 视为已生成，直接返回 'shared'
 *      - 否则：生成新 token，写入文件（合并已有字段），返回 'generated'
 *   3. 释放锁
 *
 * 失败回退：
 *   - 文件读失败 / JSON 解析失败：当作不存在，重新生成（不抛错）
 *   - 写入失败：log 但仍返回内存中的 token；下次启动会再 try 一次
 */
export async function acquireSharedToken(
  opts: AcquireSharedTokenOptions,
): Promise<SharedTokenResult> {
  const path = opts.path ?? defaultPath();
  const lockDir = opts.lockDir ?? `${defaultDir()}/.shared-token.lock`;
  const dir = resolve(path, '..');

  // 锁目录的父目录必须存在
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      logger.warn({ dir, err }, 'shared-token 父目录创建失败（继续）');
    }
  }

  return withFileLock(lockDir, () => {
    // 锁内 double-check：先读一次
    const existing = tryReadToken(path);
    if (existing) {
      logger.info({ path }, '使用已有的共享 token');
      return { token: existing, source: 'shared' as const, path };
    }

    // 不存在：生成 + 与已有 config 字段合并写回
    const token = opts.generateToken();
    let cfg: UserConfig & { token?: string };
    try {
      cfg = existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf-8')) as UserConfig & { token?: string })
        : ({} as UserConfig & { token?: string });
    } catch {
      cfg = {} as UserConfig & { token?: string };
    }
    cfg.token = token;
    try {
      writeFileSync(path, JSON.stringify(cfg, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      logger.info({ path }, '生成新共享 token 并写盘');
    } catch (err) {
      logger.warn({ path, err }, 'token 写盘失败（继续以内存值运行）');
    }
    return { token, source: 'generated' as const, path };
  });
}

/** 不需要锁的"快速读"，仅当字段为合法 hex 字符串时返回 */
function tryReadToken(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const obj = JSON.parse(raw) as { token?: unknown };
    const t = obj.token;
    if (typeof t !== 'string' || t.length === 0) return null;
    return t;
  } catch {
    return null;
  }
}

function defaultDir(): string {
  return resolve(homedir(), ATR_DATA_DIR);
}

function defaultPath(): string {
  return resolve(defaultDir(), CONFIG_FILENAME);
}
