/**
 * dev-proxy
 *
 * 仅本地调试场景：把"非 /api、非 /ws"的 HTTP/WS 请求转发到 vite dev server，
 * 让手机扫码访问真后端端口（如 :3000）也能拿到带 HMR 的实时前端。
 *
 * 工作模型：
 *  - HTTP：Express 中间件位置在 SPA fallback 之前；仅处理 GET/HEAD（其它直接 next()）
 *  - WebSocket：附加一个 'upgrade' 监听器；ws-server 只接 /ws，剩余路径（如
 *               vite HMR 的 /、/@vite/client）由这里转发
 *  - 端口未开放（vite 没启动）→ 502 + JSON 错误，便于排错
 *
 * 退出 dev：调用 dispose() 即可
 *  - removeListener('upgrade', ...)
 *  - 销毁所有进行中的 socket（sockets Set 跟踪）
 *  - 后续真请求重新走 SPA fallback / static
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';
import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { Logger } from 'pino';

export interface DevProxyOptions {
  /** vite dev 监听的目标端口（http://127.0.0.1:<targetPort>） */
  targetPort: number;
  /** 后端的 httpServer，用来挂 'upgrade' 监听 */
  httpServer: HttpServer;
  /** 不应被反代的路径前缀；这些请求让 next() 走原 Express 链 */
  passthroughPrefixes?: string[];
  logger?: Logger;
}

export interface DevProxyHandle {
  /** 挂在 Express 上的 HTTP 反代中间件（放在 SPA fallback 之前） */
  middleware: RequestHandler;
  /** 关闭反代：摘 upgrade 监听 + 销毁所有进行中的代理 socket */
  dispose: () => void;
}

const DEFAULT_PASSTHROUGH = ['/api', '/ws'];

export function createDevProxy(opts: DevProxyOptions): DevProxyHandle {
  const targetPort = opts.targetPort;
  const targetHost = '127.0.0.1';
  const passthrough = opts.passthroughPrefixes ?? DEFAULT_PASSTHROUGH;
  const log = opts.logger;

  // 跟踪所有进行中的 socket（含 HTTP/WS），dispose 时统一销毁；避免反代关掉后旧链接仍把响应吐回
  // 用 Set 自动去重；keep-alive 复用 socket 时只挂一次 close（防 MaxListenersExceededWarning）
  const sockets = new Set<Socket>();
  const trackSocket = (sock: Socket): void => {
    if (sockets.has(sock)) return;
    sockets.add(sock);
    sock.once('close', () => sockets.delete(sock));
  };

  const isPassthrough = (path: string): boolean =>
    passthrough.some((p) => path === p || path.startsWith(p + '/'));

  // ──────────── HTTP 反代 ────────────
  const middleware: RequestHandler = (req, res, next): void => {
    if (isPassthrough(req.path)) return next();

    const proxyReq = http.request(
      {
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: req.originalUrl,
        // 透传 header；删 host 让目标自己重写
        headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
      },
      (proxyRes: IncomingMessage) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('socket', trackSocket);
    proxyReq.on('error', (err: NodeJS.ErrnoException) => {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      const code = err.code === 'ECONNREFUSED' ? 502 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'dev-proxy 转发失败',
          target: `http://${targetHost}:${targetPort}`,
          reason: err.code ?? err.message,
        }),
      );
      log?.warn({ err: err.message, code: err.code }, 'dev-proxy HTTP 转发失败');
    });

    req.pipe(proxyReq);
  };

  // ──────────── WebSocket 反代（vite HMR / @vite/client） ────────────
  const upgradeHandler = (req: IncomingMessage, clientSock: Socket, head: Buffer): void => {
    // /ws 是 PTY，让 ws-server 自己处理
    if (req.url && (req.url === '/ws' || req.url.startsWith('/ws?'))) return;

    trackSocket(clientSock);

    const proxyReq = http.request({
      host: targetHost,
      port: targetPort,
      method: 'GET',
      path: req.url,
      headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
    });

    proxyReq.on('upgrade', (proxyRes, upstreamSock, upstreamHead) => {
      trackSocket(upstreamSock);

      // 拼回 101 响应行 + headers，写到客户端
      const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`];
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) lines.push(`${k}: ${item}`);
        } else if (v !== undefined) {
          lines.push(`${k}: ${v}`);
        }
      }
      clientSock.write(lines.join('\r\n') + '\r\n\r\n');
      if (upstreamHead.length > 0) clientSock.write(upstreamHead);

      // 双向 pipe
      upstreamSock.pipe(clientSock);
      clientSock.pipe(upstreamSock);

      const closeBoth = (): void => {
        upstreamSock.destroy();
        clientSock.destroy();
      };
      upstreamSock.on('error', closeBoth);
      clientSock.on('error', closeBoth);
    });

    proxyReq.on('error', (err) => {
      log?.warn({ err: (err as Error).message }, 'dev-proxy WS upgrade 转发失败');
      clientSock.destroy();
    });

    proxyReq.end(head);
  };

  opts.httpServer.on('upgrade', upgradeHandler);

  // ──────────── dispose ────────────
  const dispose = (): void => {
    opts.httpServer.removeListener('upgrade', upgradeHandler);
    for (const sock of sockets) {
      try { sock.destroy(); } catch { /* swallow */ }
    }
    sockets.clear();
    log?.warn({ targetPort }, 'dev-proxy 已释放');
  };

  // CLI 模式默认 warn 起记录，dev-proxy 启停属于一次性显眼事件用 warn 级
  log?.warn({ targetPort }, 'dev-proxy 已启用');
  return { middleware, dispose };
}
