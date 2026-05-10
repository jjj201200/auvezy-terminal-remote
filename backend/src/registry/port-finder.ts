/**
 * port-finder：端口选择 + 真实绑定
 *
 * 提供两层 API：
 *
 *  - `probePort(port, host)`：底层探测函数。仅供 `findAvailablePort` 与单测使用
 *  - `findAvailablePort(opts)`：纯探测层 —— 探测一个可用端口并返回端口号
 *    （遗留 API，保留是因为旧调用方/测试还在用，新代码请用 `bindAvailablePort`）
 *  - `bindAvailablePort(opts)`：探测 + 真实 listen 一体循环。**推荐入口。**
 *    成功返回 `{ server, port }`；失败抛 `InstanceError(PORT_UNAVAILABLE)`
 *
 * 为什么需要 `bindAvailablePort`：
 *  纯探测 + 上层 listen 两步走存在两个坑：
 *  (1) probe host 与 listen host 不一致 → macOS 上 0.0.0.0 占用、127.0.0.1 探测可能误判通过
 *  (2) probe ok → 真 listen 之间被别的进程抢端口（TOCTOU）→ 没有重试就直接 EADDRINUSE 退出
 *  把 listen 也包进选择循环，两个问题一并修：
 *  - probe 与 listen 用同一个 host
 *  - listen 失败（EADDRINUSE）自动跳到下一个候选端口
 *
 * strict 模式：
 *  调用方传 `strict: true` → maxAttempts 强制为 1，不递增。
 *  适合用户显式 `--port N --strict-port` 的"必须这个端口"场景。
 */

import { createServer, type Server as NetServer } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
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

/**
 * 找可监听的端口（仅探测，不真实占用）
 *
 * 遗留 API：保留是为了向后兼容，新代码请用 `bindAvailablePort`。
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

/** 给 bindAvailablePort 用的最小 server 接口，兼容 net.Server / http.Server */
export type BindableServer = Pick<NetServer, 'listen' | 'once' | 'removeListener'>;

export interface BindAvailablePortOptions {
  /** 起始端口（preferred） */
  preferred: number;
  /** listen host；与 probe host 始终保持一致，避免 macOS 上 0.0.0.0/127.0.0.1 误判 */
  host: string;
  /** 待 listen 的 server（如 http.Server） */
  server: HttpServer;
  /**
   * 严格模式：true 时不自适应，preferred 失败立即抛错（maxAttempts 强制 1）
   */
  strict?: boolean;
  /** 最多尝试次数；默认 PORT_FINDER_MAX_ATTEMPTS。strict=true 时被强制为 1 */
  maxAttempts?: number;
  /** 单端口探测函数（注入便于单测） */
  probe?: (port: number, host: string) => Promise<boolean>;
  /** 单端口 listen 函数（注入便于单测）；默认调用真实 server.listen */
  listen?: (server: HttpServer, port: number, host: string) => Promise<void>;
}

export interface BindAvailablePortResult {
  /** 最终成功 listen 的端口 */
  port: number;
}

/**
 * 探测 + 真实 listen 一体循环
 *
 * 流程：
 *  1. 从 preferred 起递增；每次：probe → 不通过则跳下一个
 *  2. probe 通过即真实 listen 在同一 host
 *  3. listen 触发 EADDRINUSE（TOCTOU 兜底）→ 跳下一个
 *  4. listen 触发非 EADDRINUSE → 直接外抛
 *  5. strict 模式 → maxAttempts=1，preferred 失败即抛
 *
 * @returns 最终 listen 成功的端口号
 * @throws InstanceError(PORT_UNAVAILABLE) 全部候选都失败 / strict 命中
 */
export async function bindAvailablePort(
  opts: BindAvailablePortOptions,
): Promise<BindAvailablePortResult> {
  const { preferred, host, server, strict = false } = opts;
  const maxAttempts = strict ? 1 : (opts.maxAttempts ?? PORT_FINDER_MAX_ATTEMPTS);
  const probe = opts.probe ?? probePort;
  const listen = opts.listen ?? defaultListen;

  let lastEaddrPort: number | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    if (port > 65535) break;

    if (!(await probe(port, host))) {
      lastEaddrPort = port;
      continue;
    }

    try {
      await listen(server, port, host);
    } catch (err) {
      if (isEaddrInUse(err)) {
        lastEaddrPort = port;
        continue; // TOCTOU：probe 通过但 listen 撞车，跳下一个候选
      }
      throw err; // EACCES / 其他真实错误：外抛
    }

    // preferred=0 时 OS 自动分配高端口；从 server.address() 取真实端口。
    // 单测注入 listen 时不会真实 listen，address() 可能为 null —— 此时 fallback
    // 到候选 port 本身（仍能保留 preferred=0 之外路径的旧语义）。
    const actualPort = readListenedPort(server) ?? port;

    if (actualPort !== preferred && preferred !== 0) {
      logger.info(
        { preferred, picked: actualPort },
        '首选端口被占，已选下一个可用端口',
      );
    }
    return { port: actualPort };
  }

  // 全部失败
  if (strict) {
    throw new InstanceError(
      ErrorCode.PORT_UNAVAILABLE,
      `端口 ${preferred} 已被占用（--strict-port 启用，未尝试自适应）`,
      503,
    );
  }
  throw new InstanceError(
    ErrorCode.PORT_UNAVAILABLE,
    `从端口 ${preferred} 起探测 ${maxAttempts} 个均不可用（最后 EADDRINUSE 端口：${lastEaddrPort ?? preferred}）`,
    503,
  );
}

/**
 * 从 listen 成功的 server 上读真实监听端口
 *
 * server.address() 返回：
 *  - AddressInfo（{port:number, address, family}）—— TCP listen，正常路径
 *  - string —— Unix domain socket（atr 用不到）
 *  - null —— 还没 listen / 已关闭（注入式 listen 单测会返这个）
 */
function readListenedPort(server: HttpServer): number | null {
  try {
    const addr = server.address();
    if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
      return addr.port;
    }
  } catch {
    /* 极端情况下 address() 在某些状态会抛 */
  }
  return null;
}

/** 判断 unknown 错误是不是 EADDRINUSE */
function isEaddrInUse(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EADDRINUSE'
  );
}

/**
 * 默认的真实 listen 包装：把 net 的事件接口转成 Promise
 *
 * 关键点：listening 与 error 互斥兜底，确保 listener 不重复触发。
 */
function defaultListen(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const onListening = (): void => {
      if (settled) return;
      settled = true;
      server.removeListener('error', onError);
      resolve();
    };

    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      server.removeListener('listening', onListening);
      reject(err);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, host);
  });
}
