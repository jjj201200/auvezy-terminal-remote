/**
 * broker → worker 反代路由（0.7.0 阶段 3B）
 *
 * 提供两块能力：
 *  - HTTP 反代中间件：`/i/<instanceId>/*` → 对应 worker 的 `/*`
 *  - WS upgrade 处理函数：`/i/<instanceId>/ws` → 对应 worker 的 `/ws`
 *
 * 解析 instanceId：
 *  - 从 URL 中按 `/i/<id>/` 前缀提取（id 用 UUID v4 字符集，但本路由只用
 *    "下一个 `/` 之前"做截取，对 id 字符集不强制——instances.json 才是真理）
 *  - instanceId 找不到对应 worker → 404 INSTANCE_NOT_FOUND
 *  - 找到但 worker pid 已死 → 502 BROKER_UPSTREAM_UNREACHABLE
 *
 * 路径剥离：
 *  - 收到 `/i/abc/api/health` → 转发 `/api/health`（worker 不知道前缀，base
 *    href 才在阶段 4 注入）
 *  - 收到 `/i/abc/` → 转发 `/`
 *  - 收到 `/i/abc` （不带尾斜杠）→ 302 → `/i/abc/`（保证 base href 解析正确）
 *
 * X-ATR-Forwarded-* 注入：见 proxy.ts injectForwardedHeaders。
 *
 * 头清洗：每次反代前剥 client 自塞的 forwarded-* 头（ADR-008 安全前提）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Request, Response, NextFunction } from 'express';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import { isPidAlive } from '../registry/instance-registry.js';
import { logger } from '../logger/logger.js';
import {
  createProxyServer,
  stripUnsafeForwardedHeaders,
  type ProxyLike,
} from './proxy.js';

/**
 * `/i/<id>/...` 路径正则
 *
 * - group 1：instanceId（不含斜杠的任意非 `/` 字符）
 * - group 2：worker-side 路径（含前导 `/`；空时表示 `/i/<id>` 不带尾斜杠）
 */
const INSTANCE_PATH_RE = /^\/i\/([^/]+)(\/.*)?$/;

export interface InstanceRouterOptions {
  /** broker 持有的 InstanceRegistry（与 worker 共用 instances.json） */
  registry: InstanceRegistryManager;
  /**
   * broker 自己的协议（'http' | 'https'）。
   *
   * 0.7.0 broker 默认 http；将来若 broker 自身上 TLS（service install 配 cert）
   * 改 'https'。X-ATR-Forwarded-Proto 注入用。
   */
  proto?: 'http' | 'https';
  /** 注入测试用 ProxyLike；默认 createProxyServer() */
  proxy?: ProxyLike;
}

export interface InstanceRouterHandle {
  /** Express 中间件：挂在 `app.use(handle.middleware)` */
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** WS upgrade 处理：挂在 `httpServer.on('upgrade', handle.handleUpgrade)` */
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  /** 关闭底层 proxy（broker shutdown 时调） */
  close(): void;
}

/**
 * 创建 broker 反代路由
 *
 * 分两块：
 *  - middleware：Express 中间件，识别 `/i/<id>/...` 路径才反代，否则 next()
 *  - handleUpgrade：WS upgrade 处理；命中 `/i/<id>/ws` 即反代，**否则不处理**
 *    （让上游 upgrade listener 决定是 destroy 还是别的逻辑——但 broker 进程里
 *    暂时没别的 upgrade 来源，最终 destroy 就行；此处行为是"不动这个 upgrade"
 *    让 caller 自己 destroy）
 */
export function createInstanceRouter(opts: InstanceRouterOptions): InstanceRouterHandle {
  const proto = opts.proto ?? 'http';
  // selfHandleResponse: true 让我们能在 proxyRes 监听里 buffer HTML 并注入
  // <base href>。非 HTML 响应同样要自己 pipe，否则浏览器看到空响应
  const proxy = opts.proxy ?? createProxyServer({ selfHandleResponse: true });

  // 全局 proxyRes 监听：每个 web() 调用都会触发；用 req.url 推不出 instanceId
  // （已被改写），所以从私有头读出来用作 `<base href>` 的 path
  proxy.on('proxyRes', (...args: unknown[]) => {
    const proxyRes = args[0] as IncomingMessage;
    const req = args[1] as IncomingMessage;
    const res = args[2] as ServerResponse;
    handleProxyResponse(proxyRes, req, res);
  });

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const url = req.url ?? '/';
    const m = url.match(INSTANCE_PATH_RE);
    if (!m) {
      next();
      return;
    }
    const instanceId = m[1]!;
    const tail = m[2]; // 可能 undefined

    // `/i/<id>` 不带尾斜杠 → 302 重定向到 `/i/<id>/`，保证浏览器 base href 解析
    // 与 SW scope 都在 `/i/<id>/` 下
    if (tail === undefined) {
      res.statusCode = 302;
      res.setHeader('Location', `/i/${instanceId}/`);
      res.end();
      return;
    }

    const target = lookupWorker(opts.registry, instanceId);
    if (target.kind === 'not-found') {
      writeJson(res, 404, {
        error: { code: 'INSTANCE_NOT_FOUND', message: `instanceId=${instanceId} 不存在` },
      });
      return;
    }
    if (target.kind === 'dead') {
      writeJson(res, 502, {
        error: { code: 'BROKER_UPSTREAM_UNREACHABLE', message: `instance pid=${target.pid} 已死` },
      });
      return;
    }

    // 头清洗 + 直接在 req.headers 上注入 X-ATR-Forwarded-* —— http-proxy 默认
    // 行为会把 req.headers 整体透传到 worker（这是它的设计契约），所以无需
    // 额外用 proxyReq 监听
    stripUnsafeForwardedHeaders(req.headers);
    const hostHeader = (req.headers['host'] as string | undefined) ?? '';
    const clientIp = req.socket.remoteAddress ?? '';
    req.headers['x-atr-forwarded-instance'] = instanceId;
    req.headers['x-atr-forwarded-host'] = hostHeader;
    req.headers['x-atr-forwarded-proto'] = proto;
    req.headers['x-atr-forwarded-path'] = url;
    req.headers['x-forwarded-host'] = hostHeader;
    req.headers['x-forwarded-proto'] = proto;
    req.headers['x-forwarded-for'] = clientIp;

    // 路径改写：`/i/<id>/api/foo` → `/api/foo`；`/i/<id>/` → `/`
    const subPath = tail.length > 0 ? tail : '/';

    // 0.7.0 v2：worker 仅持 /api/*（health / hook）+ /ws；其它（HTML / 静态
    // 资源）由 broker 自己服务——把 req.url 改写成"broker 根级路径"丢给 next()，
    // 让外层 static middleware 接走；HTML 入口（subPath = '/' 或无扩展名）需
    // 注入 base href，由 broker static 之前的 SPA fallback handler 处理时统一
    // 走 injectBaseHref（见 broker-server.ts SPA fallback）
    const isWorkerPath =
      subPath === '/api' ||
      subPath.startsWith('/api/') ||
      subPath === '/ws' ||
      subPath.startsWith('/ws/');

    if (!isWorkerPath) {
      // 让 broker 端 static + SPA fallback 处理；记录 instanceId 让 SPA fallback
      // 注入 base href 为 `/i/<id>/`
      req.url = subPath;
      (req as IncomingMessage & { __atrInstanceId?: string }).__atrInstanceId = instanceId;
      next();
      return;
    }

    req.url = subPath;
    // 暂存 instanceId 给全局 proxyRes 监听用（base href 注入要 `/i/<id>/`）
    (req as IncomingMessage & { __atrInstanceId?: string }).__atrInstanceId = instanceId;

    proxy.web(req, res, {
      target: `http://${target.host}:${target.port}`,
    });
  };

  const handleUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = req.url ?? '/';
    const m = url.match(INSTANCE_PATH_RE);
    if (!m) {
      // 不是 /i/<id>/... 的 WS upgrade —— 不处理，让 caller 决定（destroy）
      return;
    }
    const instanceId = m[1]!;
    const tail = m[2] ?? '/';

    const target = lookupWorker(opts.registry, instanceId);
    if (target.kind !== 'ok') {
      // upgrade 期不能写 HTTP 响应体；直接 destroy
      logger.debug({ instanceId, kind: target.kind }, 'WS upgrade 拒绝（worker 不可达）');
      socket.destroy();
      return;
    }

    stripUnsafeForwardedHeaders(req.headers);
    const hostHeader = (req.headers['host'] as string | undefined) ?? '';
    const clientIp = req.socket.remoteAddress ?? '';
    req.headers['x-atr-forwarded-instance'] = instanceId;
    req.headers['x-atr-forwarded-host'] = hostHeader;
    req.headers['x-atr-forwarded-proto'] = proto;
    req.headers['x-atr-forwarded-path'] = url;
    req.headers['x-forwarded-host'] = hostHeader;
    req.headers['x-forwarded-proto'] = proto;
    req.headers['x-forwarded-for'] = clientIp;
    req.url = tail;
    proxy.ws(req, socket, head, {
      target: `http://${target.host}:${target.port}`,
    });
  };

  return {
    middleware,
    handleUpgrade,
    close() {
      proxy.close();
    },
  };
}

interface WorkerTarget {
  kind: 'ok';
  host: string;
  port: number;
  pid: number;
}
interface NotFound {
  kind: 'not-found';
}
interface DeadInstance {
  kind: 'dead';
  pid: number;
}

function lookupWorker(
  registry: InstanceRegistryManager,
  instanceId: string,
): WorkerTarget | NotFound | DeadInstance {
  const all = registry.readSync();
  const found = all.find((i) => i.instanceId === instanceId);
  if (!found) return { kind: 'not-found' };
  if (!isPidAlive(found.pid)) return { kind: 'dead', pid: found.pid };
  return { kind: 'ok', host: found.host, port: found.port, pid: found.pid };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * 处理 worker 响应：HTML 注入 `<base href>`，其它原样透传
 *
 * selfHandleResponse: true 模式下 http-proxy 不会自动 pipe，必须我们自己写
 * 头 + body。非 HTML 走 stream.pipe，HTML 走 buffer + 修改 + 一次性写。
 *
 * 大响应取舍：worker 出 HTML 体积 < 5KB（atr index.html 约 2KB），buffer 不
 * 是问题；asset / SSE / 大下载等非 HTML 仍走流式。
 */
function handleProxyResponse(
  proxyRes: IncomingMessage,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  // 透写状态码
  res.statusCode = proxyRes.statusCode ?? 200;
  // 透写头（content-length 之后可能要改写）
  for (const [name, value] of Object.entries(proxyRes.headers)) {
    if (value === undefined) continue;
    res.setHeader(name, value);
  }

  const contentType = proxyRes.headers['content-type'];
  const isHtml =
    typeof contentType === 'string' && /text\/html/i.test(contentType);

  if (!isHtml) {
    // 非 HTML：直接 pipe 透传
    proxyRes.pipe(res);
    return;
  }

  // HTML：buffer body 注入 `<base href>`
  const instanceId = (req as IncomingMessage & { __atrInstanceId?: string })
    .__atrInstanceId;
  const chunks: Buffer[] = [];
  proxyRes.on('data', (c: Buffer) => chunks.push(c));
  proxyRes.on('end', () => {
    let html = Buffer.concat(chunks).toString('utf-8');
    if (instanceId) {
      html = injectBaseHref(html, `/i/${instanceId}/`);
    }
    const out = Buffer.from(html, 'utf-8');
    // content-length 必须重写（注入后 body 变长）
    res.setHeader('content-length', out.byteLength);
    res.end(out);
  });
  proxyRes.on('error', (err) => {
    logger.warn({ err }, 'broker 反代 HTML 读取失败');
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end();
    } else {
      res.destroy();
    }
  });
}

/**
 * 把 `<base href="${baseHref}">` 注入到 `</head>` 前；找不到 `</head>` 则
 * 注入到首个 `<html>` 后；都找不到（极端非 HTML 内容）按字符串前缀塞，
 * 但保证不会让 body 变成空。
 *
 * 重复注入保护：如果 HTML 已经含 `<base href`，**不再**注入（worker 端
 * vite 默认不会写 base 标签，但用户自定义模板可能有）。
 */
export function injectBaseHref(html: string, baseHref: string): string {
  if (/<base\s+href=/i.test(html)) return html;

  const tag = `<base href="${baseHref}">`;
  const headEndIdx = html.search(/<\/head\s*>/i);
  if (headEndIdx >= 0) {
    return html.slice(0, headEndIdx) + tag + html.slice(headEndIdx);
  }
  const htmlOpenMatch = html.match(/<html[^>]*>/i);
  if (htmlOpenMatch && htmlOpenMatch.index !== undefined) {
    const insertAt = htmlOpenMatch.index + htmlOpenMatch[0].length;
    return (
      html.slice(0, insertAt) + `<head>${tag}</head>` + html.slice(insertAt)
    );
  }
  // 无 html 结构：原样返回（避免破坏非常规响应）
  return html;
}
