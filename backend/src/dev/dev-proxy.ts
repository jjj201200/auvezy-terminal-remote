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
 *  - 目标端口动态发现：传 `targetPort=0` 时自动在 [5173..5183] 范围探活，
 *    第一个开着的端口就是 vite。10s 缓存：vite 重启换端口能跟上。
 *  - 端口未开放（vite 没启动）→ 502 + JSON 错误，便于排错
 *
 * 退出 dev：调用 dispose() 即可
 *  - removeListener('upgrade', ...)
 *  - 销毁所有进行中的 socket（sockets Set 跟踪）
 *  - 后续真请求重新走 SPA fallback / static
 */

import http, { type IncomingMessage } from 'node:http';
import net from 'node:net';
import type { RequestHandler } from 'express';
import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { Logger } from 'pino';

export interface DevProxyOptions {
  /**
   * vite dev 监听的目标端口；传 0（默认）= 在 DISCOVER_PORTS 范围内自动探活
   */
  targetPort: number;
  /** 后端的 httpServer，用来挂 'upgrade' 监听 */
  httpServer: HttpServer;
  /** 不应被反代的路径前缀；这些请求让 next() 走原 Express 链 */
  passthroughPrefixes?: string[];
  logger?: Logger;
}

/** 自动发现 vite 端口时扫描的范围（vite 默认 5173，被占会顺延 5174、5175...） */
const DISCOVER_PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];
/** 探测出来的端口缓存多久（vite 重启换端口需要重新发现） */
const DISCOVER_CACHE_MS = 10_000;
/** 单次端口探活的 connect 超时 */
const PROBE_TIMEOUT_MS = 200;

/** 探活：尝试 TCP 连一下，连得通就认为开着 */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* swallow */ }
      resolve(ok);
    };
    sock.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

export interface DevProxyHandle {
  /** 挂在 Express 上的 HTTP 反代中间件（放在 SPA fallback 之前） */
  middleware: RequestHandler;
  /** 关闭反代：摘 upgrade 监听 + 销毁所有进行中的代理 socket */
  dispose: () => void;
}

const DEFAULT_PASSTHROUGH = ['/api', '/ws'];

export function createDevProxy(opts: DevProxyOptions): DevProxyHandle {
  const targetHost = '127.0.0.1';
  const passthrough = opts.passthroughPrefixes ?? DEFAULT_PASSTHROUGH;
  const log = opts.logger;
  const fixedPort = opts.targetPort > 0 ? opts.targetPort : 0;

  // 动态发现的端口缓存：每 DISCOVER_CACHE_MS 重新探一次
  let cachedPort = 0;
  let cachedAt = 0;

  /**
   * 取当前要转发到的端口：固定模式直接返回 opts.targetPort；
   * 自动模式按 DISCOVER_PORTS 顺序探活，第一个能连的就用，缓存一段时间。
   * 一个都连不上时返回最后已知端口（仍会 ECONNREFUSED → 502）；
   * 从未发现过则返回 5173（让错误信息看着合理）。
   */
  const resolvePort = async (): Promise<number> => {
    if (fixedPort > 0) return fixedPort;
    const now = Date.now();
    if (cachedPort > 0 && now - cachedAt < DISCOVER_CACHE_MS) return cachedPort;
    for (const p of DISCOVER_PORTS) {
      // eslint-disable-next-line no-await-in-loop
      if (await probePort(p)) {
        if (p !== cachedPort) {
          log?.warn({ port: p }, 'dev-proxy 自动发现 vite 端口');
        }
        cachedPort = p;
        cachedAt = now;
        return p;
      }
    }
    cachedAt = now; // 即便没找到也更新时间戳，避免每个请求都全扫
    return cachedPort > 0 ? cachedPort : DISCOVER_PORTS[0]!;
  };

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

    void resolvePort().then((targetPort) => {
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
            hint: fixedPort === 0
              ? `自动发现失败：vite 似乎不在 ${DISCOVER_PORTS.join('/')} 任何一个端口上`
              : undefined,
          }),
        );
        log?.warn({ err: err.message, code: err.code, targetPort }, 'dev-proxy HTTP 转发失败');
      });

      req.pipe(proxyReq);
    });
  };

  // ──────────── WebSocket 反代（vite HMR / @vite/client） ────────────
  const upgradeHandler = (req: IncomingMessage, clientSock: Socket, head: Buffer): void => {
    // /ws 是 PTY，让 ws-server 自己处理
    if (req.url && (req.url === '/ws' || req.url.startsWith('/ws?'))) return;

    trackSocket(clientSock);

    void resolvePort().then((targetPort) => {
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
        log?.warn({ err: (err as Error).message, targetPort }, 'dev-proxy WS upgrade 转发失败');
        clientSock.destroy();
      });

      proxyReq.end(head);
    });
  };

  opts.httpServer.on('upgrade', upgradeHandler);

  // ──────────── dispose ────────────
  const dispose = (): void => {
    opts.httpServer.removeListener('upgrade', upgradeHandler);
    for (const sock of sockets) {
      try { sock.destroy(); } catch { /* swallow */ }
    }
    sockets.clear();
    log?.warn({ targetPort: fixedPort || 'auto' }, 'dev-proxy 已释放');
  };

  // CLI 模式默认 warn 起记录，dev-proxy 启停属于一次性显眼事件用 warn 级
  const targetDesc = fixedPort > 0 ? String(fixedPort) : `auto[${DISCOVER_PORTS.join(',')}]`;
  log?.warn({ target: targetDesc }, 'dev-proxy 已启用');
  return { middleware, dispose };
}
