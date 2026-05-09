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
import { createBrokerApp, startBrokerServer } from './broker-server.js';
import { readBrokerState } from './broker-state.js';

/** 临时 listen createBrokerApp 在随机端口，返回 url + 关闭函数 */
async function listenApp(
  app: ReturnType<typeof createBrokerApp>,
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

describe('createBrokerApp', () => {
  it('/api/health 返回 ok + 必要字段', async () => {
    const app = createBrokerApp({ brokerVersion: '0.7.0', startedAt: 1000 });
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
});
