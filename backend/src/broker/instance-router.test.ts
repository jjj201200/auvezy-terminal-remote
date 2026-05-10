/**
 * instance-router 集成测试（v2 / API 归属重划分后）
 *
 * 起一个真实"假 worker"（express 在随机端口 listen），broker app 挂上
 * instance-router 指向假 worker，然后 fetch 经 broker 命中。
 *
 * v2 行为：
 *  - 仅 `/i/<id>/api/*` 与 `/i/<id>/ws` 反代到 worker
 *  - 其它（HTML / 静态资源 / SPA 入口）next() 给外层 broker 自己服务
 *    （HTML 入口由 broker SPA fallback 注入 base href，单测不在这层验证；
 *     完整 base-href 注入由 broker-server 上的 SPA fallback handler 负责，
 *     在 broker-server.test.ts 里覆盖）
 *
 * 覆盖：
 *  - 反代路径：GET / POST 反代成功，body 透传
 *  - X-ATR-Forwarded-* 头注入 + 客户端伪造头被剥
 *  - `/i/<id>` 不带尾斜杠 → 302 → `/i/<id>/`
 *  - 不存在 instanceId → 404
 *  - worker pid 已死 → 502
 *  - **非 worker 路径**：HTML / 静态资源 next() 给 broker（不反代）
 *  - 非 `/i/<id>/` 路径 → next() 不动
 *  - injectBaseHref 工具函数
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { InstanceRegistryManager } from '../registry/instance-registry.js';
import { createInstanceRouter, injectBaseHref } from './instance-router.js';

interface FakeWorker {
  port: number;
  capturedHeaders: Record<string, string | string[] | undefined>[];
  capturedBodies: string[];
  capturedPaths: string[];
  close(): Promise<void>;
}

/** 起一个 echo 假 worker：把 headers 和 body 都记录下来，并按预期回 200 */
async function startFakeWorker(): Promise<FakeWorker> {
  const captured: FakeWorker = {
    port: 0,
    capturedHeaders: [],
    capturedBodies: [],
    capturedPaths: [],
    close: async () => {},
  };

  const app = express();
  app.use(express.text({ type: '*/*' }));
  app.get('/index.html', (_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><head><title>atr</title></head><body><script src="./assets/x.js"></script></body></html>');
  });
  app.get('/assets/x.js', (_req, res) => {
    res.setHeader('content-type', 'application/javascript');
    res.end('console.log("hello");');
  });
  app.all('*', (req, res) => {
    captured.capturedHeaders.push(req.headers);
    captured.capturedBodies.push(typeof req.body === 'string' ? req.body : '');
    captured.capturedPaths.push(req.url);
    res.json({ ok: true, path: req.url, method: req.method });
  });

  const httpServer: HttpServer = createServer(app);
  await new Promise<void>((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(0, '127.0.0.1', res);
  });
  captured.port = (httpServer.address() as AddressInfo).port;
  captured.close = () => new Promise<void>((res) => httpServer.close(() => res()));
  return captured;
}

/** 起一个挂上 instance-router 的 broker app，返回 url + 关闭函数
 *
 * 0.7.0 v2：在 instance-router 之后挂一个"伪 broker static"——把任何
 * 落到这里的请求（即非 worker 路径，instance-router next() 过来的）原样
 * echo 一份带 `__atrInstanceId` 的 marker，让测试能确认 next() 路径触发。
 */
async function startBroker(registry: InstanceRegistryManager): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  const router = createInstanceRouter({ registry });
  app.use(router.middleware);
  app.get('/_unrelated', (_req, res) => res.json({ ok: true, where: 'broker' }));
  // 伪 broker static fallback：模拟外层 SPA / static 处理 next() 过来的请求
  app.use((req, res) => {
    const instanceId = (req as { __atrInstanceId?: string }).__atrInstanceId;
    res.json({
      where: 'broker-fallback',
      path: req.url,
      instanceId: instanceId ?? null,
    });
  });

  const httpServer = createServer(app);
  await new Promise<void>((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(0, '127.0.0.1', res);
  });
  const port = (httpServer.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      router.close();
      await new Promise<void>((res) => httpServer.close(() => res()));
    },
  };
}

describe('injectBaseHref', () => {
  it('注入到 </head> 之前', () => {
    const r = injectBaseHref('<html><head><title>x</title></head><body></body></html>', '/i/abc/');
    expect(r).toBe('<html><head><title>x</title><base href="/i/abc/"></head><body></body></html>');
  });

  it('已有 <base href 不重复注入', () => {
    const html = '<html><head><base href="/x/"><title>x</title></head></html>';
    expect(injectBaseHref(html, '/i/abc/')).toBe(html);
  });

  it('无 </head>，但有 <html> → 在 <html> 后塞 <head>', () => {
    const r = injectBaseHref('<html><body>x</body></html>', '/i/abc/');
    expect(r).toContain('<head><base href="/i/abc/"></head>');
  });

  it('完全无 html 结构 → 原样返回', () => {
    const r = injectBaseHref('not html', '/i/abc/');
    expect(r).toBe('not html');
  });

  it('大小写不敏感', () => {
    const r = injectBaseHref('<HTML><HEAD></HEAD></HTML>', '/i/abc/');
    expect(r).toContain('<base href="/i/abc/">');
  });
});

describe('instance-router', () => {
  let baseDir: string;
  let registry: InstanceRegistryManager;
  let worker: FakeWorker;
  let broker: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-irt-'));
    registry = new InstanceRegistryManager({ baseDir });
    worker = await startFakeWorker();

    // 写一份 instances.json：当前进程 PID 作为 worker pid 让 isPidAlive=true
    await registry.register({
      instanceId: 'inst-A',
      name: 'A',
      host: '127.0.0.1',
      port: worker.port,
      pid: process.pid,
      cwd: '/tmp',
      startedAt: new Date().toISOString(),
    });

    broker = await startBroker(registry);
  });

  afterEach(async () => {
    await broker.close();
    await worker.close();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('GET /i/<id>/api/foo → 200，路径剥前缀，到达 worker /api/foo', async () => {
    const res = await fetch(`${broker.url}/i/inst-A/api/foo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; path: string; method: string };
    expect(body.ok).toBe(true);
    expect(body.path).toBe('/api/foo');
    expect(body.method).toBe('GET');
  });

  it('POST /i/<id>/api/auth body 透传', async () => {
    const res = await fetch(`${broker.url}/i/inst-A/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"token":"xyz"}',
    });
    expect(res.status).toBe(200);
    expect(worker.capturedBodies.at(-1)).toBe('{"token":"xyz"}');
  });

  it('X-ATR-Forwarded-* 头被注入到 worker', async () => {
    await fetch(`${broker.url}/i/inst-A/api/foo`, {
      headers: { host: 'unused' }, // node fetch 会用 broker.url 的 host
    });
    const headers = worker.capturedHeaders.at(-1)!;
    expect(headers['x-atr-forwarded-instance']).toBe('inst-A');
    expect(headers['x-atr-forwarded-path']).toBe('/i/inst-A/api/foo');
    expect(headers['x-forwarded-host']).toBeDefined();
    expect(headers['x-forwarded-proto']).toBe('http');
    expect(headers['x-forwarded-for']).toBeDefined();
    // 私有桥接头不能漏到 worker
    expect(headers['x-atr-broker-pending-instance']).toBeUndefined();
  });

  it('client 伪造的 X-ATR-Forwarded-Instance 被剥（worker 看到的是 broker 注入的真值）', async () => {
    await fetch(`${broker.url}/i/inst-A/api/foo`, {
      headers: {
        'x-atr-forwarded-instance': 'spoof',
        'x-forwarded-host': 'attacker.example',
      },
    });
    const headers = worker.capturedHeaders.at(-1)!;
    expect(headers['x-atr-forwarded-instance']).toBe('inst-A'); // 真值
    expect(headers['x-forwarded-host']).not.toBe('attacker.example');
  });

  it('GET /i/<id> 不带尾斜杠 → 302 → /i/<id>/', async () => {
    const res = await fetch(`${broker.url}/i/inst-A`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/i/inst-A/');
  });

  it('GET /i/<id>/ → next() 给 broker（HTML 入口由 broker SPA fallback 处理）', async () => {
    const res = await fetch(`${broker.url}/i/inst-A/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { where: string; path: string; instanceId: string | null };
    // v2: instance-router 不再反代根路径到 worker，而是 next() 给外层 broker
    expect(body.where).toBe('broker-fallback');
    expect(body.path).toBe('/');
    // 必须挂上 __atrInstanceId 让外层 SPA fallback 能注 base href
    expect(body.instanceId).toBe('inst-A');
  });

  it('不存在 instanceId → 404 INSTANCE_NOT_FOUND', async () => {
    const res = await fetch(`${broker.url}/i/inst-NONE/api/foo`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INSTANCE_NOT_FOUND');
  });

  it('worker pid 已死 → 502 BROKER_UPSTREAM_UNREACHABLE', async () => {
    // 写一个 PID 几乎不可能存活的实例
    const ghostPath = resolve(baseDir, 'instances.json');
    writeFileSync(
      ghostPath,
      JSON.stringify({
        version: 1,
        instances: [
          {
            instanceId: 'inst-DEAD',
            name: 'dead',
            host: '127.0.0.1',
            port: 1,
            pid: 4_000_000, // 极大概率不存在
            cwd: '/tmp',
            startedAt: new Date().toISOString(),
          },
          {
            // 保留 inst-A
            instanceId: 'inst-A',
            name: 'A',
            host: '127.0.0.1',
            port: worker.port,
            pid: process.pid,
            cwd: '/tmp',
            startedAt: new Date().toISOString(),
          },
        ],
      }),
      'utf-8',
    );

    const res = await fetch(`${broker.url}/i/inst-DEAD/api/foo`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BROKER_UPSTREAM_UNREACHABLE');
  });

  it('HTML 入口 /i/<id>/index.html → next() 给 broker（不反代到 worker）', async () => {
    // v2 行为：worker 不再服务静态资源；instance-router 只反代 /api 和 /ws
    // 所以 /index.html 应被转给外层 broker static + SPA fallback 处理
    const res = await fetch(`${broker.url}/i/inst-A/index.html`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { where: string; path: string; instanceId: string | null };
    expect(body.where).toBe('broker-fallback');
    expect(body.path).toBe('/index.html');
    expect(body.instanceId).toBe('inst-A');
    // worker 那边没收到这个请求
    expect(worker.capturedPaths.includes('/index.html')).toBe(false);
  });

  it('静态资源 /i/<id>/assets/x.js → next() 给 broker（不反代到 worker）', async () => {
    const res = await fetch(`${broker.url}/i/inst-A/assets/x.js`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { where: string; path: string; instanceId: string | null };
    expect(body.where).toBe('broker-fallback');
    expect(body.path).toBe('/assets/x.js');
    expect(body.instanceId).toBe('inst-A');
    expect(worker.capturedPaths.includes('/assets/x.js')).toBe(false);
  });

  it('/api/* 仍反代到 worker（不会误去 broker fallback）', async () => {
    const res = await fetch(`${broker.url}/i/inst-A/api/foo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; path?: string; where?: string };
    // worker echo 出 ok:true + path
    expect(body.ok).toBe(true);
    expect(body.path).toBe('/api/foo');
    expect(body.where).toBeUndefined(); // 不是 broker fallback
  });

  it('非 /i/<id>/ 路径不被反代（next() 给 broker 自身路由）', async () => {
    const res = await fetch(`${broker.url}/_unrelated`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { where: string };
    expect(body.where).toBe('broker');
  });
});
