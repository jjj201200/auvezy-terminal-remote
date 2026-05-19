/**
 * broker-server 骨架单测
 *
 * 关键点：
 *  - createBrokerApp /api/health 返回 200 + 必要字段
 *  - startBrokerServer 真 listen 后 fetch /api/health 通；shutdown 后端口释放
 *  - startBrokerServer 写出 broker.json，shutdown 后清干净
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { Express } from 'express';
import { createBrokerApp, startBrokerServer } from './broker-server.js';
import { readBrokerState } from './broker-state.js';

/** 临时 listen 一个 Express app 在随机端口，返回 url + 关闭函数 */
async function listenApp(
  app: Express,
): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer = createServer(app);
  await new Promise<void>((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(0, '127.0.0.1', res);
  });
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((res) => {
        httpServer.close(() => res());
      }),
  };
}

describe('createBrokerApp 静态资源（3C）', () => {
  it('frontendDist 指向有 index.html 的目录 → 根 / 返回 index.html', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'atr-broker-fe-'));
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${dir}/index.html`, '<!doctype html><title>atr</title>');
      writeFileSync(`${dir}/asset.txt`, 'hello');
      const { app } = createBrokerApp({
        brokerVersion: '0.7.0',
        startedAt: 1000,
        frontendDist: dir,
      });
      const { url, close } = await listenApp(app);
      try {
        const root = await fetch(`${url}/`);
        expect(root.status).toBe(200);
        expect((await root.text()).includes('atr')).toBe(true);

        const asset = await fetch(`${url}/asset.txt`);
        expect(asset.status).toBe(200);
        expect((await asset.text())).toBe('hello');

        // SPA fallback：未知路径走 index.html
        const spa = await fetch(`${url}/some/spa/path`);
        expect(spa.status).toBe(200);
        expect((await spa.text()).includes('atr')).toBe(true);

        // /api 路径不走 fallback：health 仍然命中 broker 自己的 /api/health
        const health = await fetch(`${url}/api/health`);
        expect(health.status).toBe(200);
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SPA 入口带 ?token= → index.html 里 manifest link href 也注入 token', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'atr-broker-fe-'));
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        `${dir}/index.html`,
        '<!doctype html><head><link rel="manifest" href="/manifest.webmanifest" /></head>',
      );
      const { app } = createBrokerApp({
        brokerVersion: '0.7.0',
        startedAt: 1000,
        frontendDist: dir,
      });
      const { url, close } = await listenApp(app);
      try {
        const withToken = await fetch(`${url}/?token=abc123`);
        const html = await withToken.text();
        expect(html).toContain('href="/manifest.webmanifest?token=abc123"');

        const noToken = await fetch(`${url}/`);
        const plainHtml = await noToken.text();
        expect(plainHtml).toContain('href="/manifest.webmanifest"');
        expect(plainHtml).not.toContain('token=');
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('/manifest.webmanifest?token=xxx → start_url 注入 token,无 token 时返回原文件', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'atr-broker-fe-'));
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${dir}/index.html`, '<!doctype html><title>atr</title>');
      writeFileSync(
        `${dir}/manifest.webmanifest`,
        JSON.stringify({ name: 'ATR', start_url: '/', display: 'standalone' }),
      );
      const { app } = createBrokerApp({
        brokerVersion: '0.7.0',
        startedAt: 1000,
        frontendDist: dir,
      });
      const { url, close } = await listenApp(app);
      try {
        // 无 token query → 走 static,原文件
        const plain = await fetch(`${url}/manifest.webmanifest`);
        expect(plain.status).toBe(200);
        const plainBody = await plain.json();
        expect(plainBody.start_url).toBe('/');

        // 带 token query → 动态注入
        const withToken = await fetch(`${url}/manifest.webmanifest?token=abc123`);
        expect(withToken.status).toBe(200);
        expect(withToken.headers.get('content-type')).toMatch(/application\/manifest\+json/);
        expect(withToken.headers.get('cache-control')).toBe('no-store');
        const withTokenBody = await withToken.json();
        expect(withTokenBody.start_url).toBe('/?token=abc123');
        expect(withTokenBody.name).toBe('ATR');

        // 特殊字符 token 走 encodeURIComponent
        const special = await fetch(`${url}/manifest.webmanifest?token=a%2Fb%2Bc`);
        const specialBody = await special.json();
        expect(specialBody.start_url).toBe('/?token=a%2Fb%2Bc');
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('frontendDist 不存在 → 不挂静态服务但 broker 仍可启', async () => {
    const { app } = createBrokerApp({
      brokerVersion: '0.7.0',
      startedAt: 1000,
      frontendDist: '/nonexistent/atr-frontend',
    });
    const { url, close } = await listenApp(app);
    try {
      const health = await fetch(`${url}/api/health`);
      expect(health.status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe('createBrokerApp', () => {
  it('/api/health 返回 ok + 必要字段', async () => {
    const { app } = createBrokerApp({ brokerVersion: '0.7.0', startedAt: 1000 });
    const { url, close } = await listenApp(app);
    try {
      const res = await fetch(`${url}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['ok']).toBe(true);
      expect(body['role']).toBe('broker');
      expect(body['brokerVersion']).toBe('0.7.0');
      expect(body['startedAt']).toBe(1000);
      expect(typeof body['pid']).toBe('number');
      expect(typeof body['uptimeMs']).toBe('number');
    } finally {
      await close();
    }
  });
});

describe('startBrokerServer', () => {
  let baseDir: string;
  let statePath: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-broker-srv-'));
    statePath = resolve(baseDir, 'broker.json');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('listen 后 fetch /api/health 通', async () => {
    const handle = await startBrokerServer({
      port: 0, // OS 自动分配
      host: '127.0.0.1',
      brokerVersion: '0.7.0',
      statePath,
    });
    try {
      expect(handle.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${handle.port}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; role: string };
      expect(body.ok).toBe(true);
      expect(body.role).toBe('broker');
    } finally {
      await handle.shutdown();
    }
  });

  it('启动写出 broker.json，shutdown 后清干净', async () => {
    const handle = await startBrokerServer({
      port: 0,
      host: '127.0.0.1',
      brokerVersion: '0.7.0',
      statePath,
    });
    const stateLive = readBrokerState(statePath);
    expect(stateLive).not.toBeNull();
    expect(stateLive?.pid).toBe(process.pid);
    expect(stateLive?.port).toBe(handle.port);
    expect(stateLive?.brokerVersion).toBe('0.7.0');

    await handle.shutdown();
    expect(existsSync(statePath)).toBe(false);
  });

  it('shutdown 后端口可被复用', async () => {
    const h1 = await startBrokerServer({
      port: 0,
      host: '127.0.0.1',
      brokerVersion: '0.7.0',
      statePath,
    });
    const port = h1.port;
    await h1.shutdown();

    const h2 = await startBrokerServer({
      port,
      host: '127.0.0.1',
      brokerVersion: '0.7.0',
      statePath,
    });
    try {
      expect(h2.port).toBe(port);
    } finally {
      await h2.shutdown();
    }
  });

  it('preferred 端口被占且非 strict → 自动跳到下一个可用端口', async () => {
    // 先抢占一个端口
    const blocker = await startBrokerServer({
      port: 0,
      host: '127.0.0.1',
      brokerVersion: '0.7.0',
      statePath: resolve(baseDir, 'blocker.json'),
    });
    const blockedPort = blocker.port;

    try {
      // 让第二个 broker 也想要 blockedPort:strictPort 默认 false → 应该跳过
      const h2 = await startBrokerServer({
        port: blockedPort,
        host: '127.0.0.1',
        brokerVersion: '0.7.0',
        statePath,
      });
      try {
        expect(h2.port).not.toBe(blockedPort);
        expect(h2.port).toBeGreaterThan(0);
      } finally {
        await h2.shutdown();
      }
    } finally {
      await blocker.shutdown();
    }
  });

  it('preferred 端口被占 + strictPort=true → 抛错', async () => {
    const blocker = await startBrokerServer({
      port: 0,
      host: '127.0.0.1',
      brokerVersion: '0.7.0',
      statePath: resolve(baseDir, 'blocker.json'),
    });
    const blockedPort = blocker.port;

    try {
      await expect(
        startBrokerServer({
          port: blockedPort,
          host: '127.0.0.1',
          brokerVersion: '0.7.0',
          statePath,
          strictPort: true,
        }),
      ).rejects.toThrow();
    } finally {
      await blocker.shutdown();
    }
  });
});
