/**
 * broker → worker 反代封装（0.7.0 阶段 3A）
 *
 * 极简包装 `http-proxy`：
 *  - createProxyServer：一次性配好 changeOrigin + xfwd off（我们自己注入头，
 *    不让 http-proxy 自己塞 x-forwarded-* 防止跟可信头混淆）
 *  - injectForwardedHeaders：在 proxyReq 时注入 X-ATR-Forwarded-* + 标准头；
 *    主动剥掉 client 自己塞的同名头（worker 只信任 broker 注入的）
 *  - 统一错误处理：worker 不可达 → 502；写一行 warn
 *  - 单测可注入 `httpProxyImpl` 替代真实 http-proxy 库
 *
 * 与 ADR-008 的约定：
 *  - X-ATR-Forwarded-Instance：目标 instanceId
 *  - X-ATR-Forwarded-Path：broker 收到的完整 path（含 `/i/<id>/` 前缀）
 *  - X-Forwarded-Host / Proto：业界标准，broker 注入；client 自己塞的会被剥
 *  - X-Forwarded-For：真实 client IP
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import httpProxy, { type ServerOptions } from 'http-proxy';
import {
  HEADER_FORWARDED_FOR,
  HEADER_FORWARDED_HOST,
  HEADER_FORWARDED_INSTANCE,
  HEADER_FORWARDED_PATH,
  HEADER_FORWARDED_PROTO,
} from './forwarded-headers.js';
import { logger } from '../logger/logger.js';

/**
 * `http-proxy.Server` 的最小化接口（用于单测注入）。
 *
 * 我们用到的方法：web（HTTP 反代）/ ws（WS upgrade 反代）/ on（错误监听）。
 */
export interface ProxyLike {
  web(
    req: IncomingMessage,
    res: ServerResponse,
    options?: ServerOptions,
  ): void;
  ws(
    req: IncomingMessage,
    socket: NodeJS.WritableStream,
    head: Buffer,
    options?: ServerOptions,
  ): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  close(cb?: () => void): void;
}

/**
 * 创建 broker 反代实例
 *
 * 选项：
 *  - `httpProxyImpl`：测试可注入；默认用真 http-proxy
 *  - `selfHandleResponse`：true 时禁用 http-proxy 默认 pipe，让 caller 监听
 *    `proxyRes` 自己读 body 写 res（用于注入 `<base href>` 等场景）
 *
 * 返回的实例已挂好统一错误处理；caller 只需调 `web` / `ws`。
 */
export function createProxyServer(opts: {
  httpProxyImpl?: typeof httpProxy;
  selfHandleResponse?: boolean;
} = {}): ProxyLike {
  const impl = opts.httpProxyImpl ?? httpProxy;
  const proxy = impl.createProxyServer({
    // 我们自己写 X-Forwarded-* 头（要剥 client 伪造的），不让 http-proxy 默认行为再塞一遍
    xfwd: false,
    // worker 是 loopback，不需要 SNI / hostname 改写；保留 Host 头让 worker 看见
    // broker 收到的 host（X-Forwarded-Host 单独写）
    changeOrigin: false,
    // 默认 ws=false；ws upgrade 走单独的 .ws() 调用
    ws: false,
    // selfHandleResponse 让我们能在 proxyRes 监听里改写 body（HTML base href 注入）
    selfHandleResponse: opts.selfHandleResponse ?? false,
  }) as unknown as ProxyLike;

  proxy.on('error', (...args: unknown[]) => {
    const err = args[0] as Error;
    const req = args[1] as IncomingMessage | undefined;
    const resOrSocket = args[2] as
      | ServerResponse
      | NodeJS.WritableStream
      | undefined;

    logger.warn(
      { err, url: req?.url, method: req?.method },
      'broker 反代失败（worker 不可达？）',
    );

    // resOrSocket 可能是 ServerResponse（HTTP）或 socket（WS upgrade）
    if (resOrSocket && 'writeHead' in resOrSocket && typeof (resOrSocket as ServerResponse).writeHead === 'function') {
      const res = resOrSocket as ServerResponse;
      if (!res.headersSent) {
        try {
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              error: { code: 'BROKER_UPSTREAM_UNREACHABLE', message: 'worker 暂不可达' },
            }),
          );
        } catch {
          /* socket 已坏 */
        }
      }
    } else if (resOrSocket && 'destroy' in resOrSocket) {
      try {
        (resOrSocket as NodeJS.WritableStream & { destroy: () => void }).destroy();
      } catch {
        /* 已坏 */
      }
    }
  });

  return proxy;
}

/**
 * 在 proxyReq 阶段注入 X-ATR-Forwarded-* + 标准 X-Forwarded-* 头
 *
 * 调用方：proxy.on('proxyReq', (proxyReq, req, _res) => injectForwardedHeaders(...))
 *
 * **必须先调 `stripUnsafeForwardedHeaders(req.headers)`**，否则 client 伪造的
 * x-atr-forwarded-instance 等头会被 worker 当成可信。
 *
 * @param proxyReq  Node http.ClientRequest（http-proxy 已创建好，待发往 worker）
 * @param req       broker 收到的原始请求
 * @param ctx       本次反代上下文：instanceId（从 URL 解出）+ broker 看到的入口 host/proto
 */
export function injectForwardedHeaders(
  proxyReq: { setHeader(name: string, value: string): void },
  req: IncomingMessage,
  ctx: {
    instanceId: string;
    /** 用户访问 broker 时的 hostname（含 port），通常 = req.headers.host */
    host: string;
    /** http / https；通常根据 broker 自己 listen 的协议判定 */
    proto: 'http' | 'https';
    /**
     * broker 收到的**原始**路径（含 `/i/<id>/` 前缀）。
     *
     * 不传则回退用 `req.url`，但 caller 通常已经把 `req.url` 改写成 worker-side
     * path（不含前缀）了，所以推荐显式传 originalPath。
     */
    originalPath?: string;
  },
): void {
  proxyReq.setHeader(HEADER_FORWARDED_INSTANCE, ctx.instanceId);
  proxyReq.setHeader(HEADER_FORWARDED_HOST, ctx.host);
  proxyReq.setHeader(HEADER_FORWARDED_PROTO, ctx.proto);
  proxyReq.setHeader(HEADER_FORWARDED_PATH, ctx.originalPath ?? req.url ?? '');

  // X-Forwarded-For：保留链路（已有则 append，没有则新建）
  const existing = req.headers[HEADER_FORWARDED_FOR];
  const clientIp =
    req.socket.remoteAddress ?? '';
  const xff = Array.isArray(existing) ? existing.join(', ') : existing ?? '';
  // 但 client 端伪造的 X-Forwarded-For 我们不信任 —— stripUnsafeForwardedHeaders 已剥
  // 这里只追加自己看到的 socket.remoteAddress
  proxyReq.setHeader(HEADER_FORWARDED_FOR, xff ? `${xff}, ${clientIp}` : clientIp);
}

/**
 * 剥掉 client 自己塞的 X-(ATR-)Forwarded-* 头
 *
 * 必须在 `proxy.web` / `proxy.ws` 调用之前修改 req.headers。
 * 这是 ADR-008 安全模型的关键：worker 只信任 broker 注入的头，所以 broker
 * 必须先确保 client 没有偷偷塞同名头进来。
 */
export function stripUnsafeForwardedHeaders(
  headers: IncomingMessage['headers'],
): void {
  delete headers[HEADER_FORWARDED_INSTANCE];
  delete headers[HEADER_FORWARDED_PATH];
  delete headers[HEADER_FORWARDED_HOST];
  delete headers[HEADER_FORWARDED_PROTO];
  delete headers[HEADER_FORWARDED_FOR];
}
