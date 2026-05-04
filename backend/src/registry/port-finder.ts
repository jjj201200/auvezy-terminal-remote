/**
 * port-finder：从 preferred 起递增，找一个可监听的端口
 *
 * 设计：
 *  - 用 net.createServer().listen(port) 探测；监听成功立即关闭就视为可用
 *  - 探测仅绑 host（不是 0.0.0.0），与实际服务监听 host 一致
 *  - TOCTOU 兜底：找到空闲端口与实际服务 listen 之间可能被别的进程抢，
 *    上层（startServer）的 httpServer.on('error', EADDRINUSE) 会兜底
 *  - 不并行探测：避免大量并发 listen 触发 OS 短时间限制
 *
 * 命名约定：
 *  - findAvailablePort 是公开 API，单元入口
 *  - probePort 是内部探测函数，仅供测试可注入替换
 */

import { createServer } from 'node:net';
import { ErrorCode } from '@ocr/shared';
import { InstanceError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { PORT_FINDER_MAX_ATTEMPTS } from '../constants.js';

export interface FindAvailablePortOptions {
  /** 起始端口（preferred） */
  preferred: number;
  /** 监听 host；默认 '127.0.0.1' 仅本机探测足够准确 */
  host?: string;
  /** 最多尝试次数；默认 PORT_FINDER_MAX_ATTEMPTS */
  maxAttempts?: number;
  /** 单端口探测函数（注入便于单测） */
  probe?: (port: number, host: string) => Promise<boolean>;
}

/**
 * 找可监听的端口
 *
 * @returns 第一个可用端口
 * @throws InstanceError(PORT_UNAVAILABLE) 全部尝试都失败
 */
export async function findAvailablePort(opts: FindAvailablePortOptions): Promise<number> {
  const { preferred } = opts;
  const host = opts.host ?? '127.0.0.1';
  const maxAttempts = opts.maxAttempts ?? PORT_FINDER_MAX_ATTEMPTS;
  const probe = opts.probe ?? probePort;

  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    if (port > 65535) break;
    if (await probe(port, host)) {
      if (port !== preferred) {
        logger.info({ preferred, picked: port }, '首选端口被占，已选下一个可用端口');
      }
      return port;
    }
  }

  throw new InstanceError(
    ErrorCode.PORT_UNAVAILABLE,
    `从端口 ${preferred} 开始探测 ${maxAttempts} 个均不可用`,
    503,
  );
}

/**
 * 探测一个端口能否监听
 *
 * @returns true=可监听；false=被占或权限不足
 */
export function probePort(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const srv = createServer();
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      srv.close(() => resolve(ok));
    };
    srv.once('error', () => done(false));
    srv.listen(port, host, () => done(true));
  });
}
