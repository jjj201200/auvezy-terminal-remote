/**
 * instance-routes 单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import {
  AuthModule,
  createSessionCookieName,
} from '../auth/auth-middleware.js';
import { createInstanceRoutes } from './instance-routes.js';
import { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceSpawner } from '../registry/instance-spawner.js';
import type { InstanceInfo, InstanceListItem } from '@otr/shared';

class FakeSpawner implements InstanceSpawner {
  public calls: Array<{ cwd: string; name?: string }> = [];
  async spawn(input: { cwd: string; name?: string }): Promise<{ pid: number; cwd: string; name: string }> {
    this.calls.push(input);
    return { pid: 12345, cwd: input.cwd, name: input.name ?? 'unnamed' };
  }
}

describe('instance-routes', () => {
  let server: Server;
  let port: number;
  let auth: AuthModule;
  let registry: InstanceRegistryManager;
  let baseDir: string;
  let spawner: FakeSpawner;
  const currentId = 'me-001';

  beforeEach(async () => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-iroute-'));
    const app = express();
    app.use(express.json({ strict: false }));
    auth = new AuthModule({
      token: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 100,
      cookieName: createSessionCookieName(0),
    });
    registry = new InstanceRegistryManager({ baseDir });
    spawner = new FakeSpawner();
    app.post('/api/auth', auth.handleAuth);
    app.use(
      '/api',
      createInstanceRoutes({
        authModule: auth,
        registry,
        currentInstanceId: currentId,
        spawner,
      }),
    );
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    auth.destroy();
    rmSync(baseDir, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function login(): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    });
    return res.headers.get('set-cookie')!.split(';')[0]!;
  }

  it('未鉴权 GET /instances → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/instances`);
    expect(r.status).toBe(401);
  });

  it('GET /instances 标记 isCurrent', async () => {
    const cookie = await login();
    const fake: InstanceInfo = {
      instanceId: currentId,
      name: 'x',
      host: '127.0.0.1',
      port: 3000,
      pid: process.pid,
      cwd: '/tmp',
      startedAt: new Date().toISOString(),
    };
    await registry.register(fake);

    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      headers: { Cookie: cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; instances: InstanceListItem[] };
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]?.isCurrent).toBe(true);
  });

  it('POST /instances 调用 spawner', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cwd: '/tmp', name: 'project-x' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; instance: { pid: number } };
    expect(body.instance.pid).toBe(12345);
    expect(spawner.calls).toEqual([{ cwd: '/tmp', name: 'project-x' }]);
  });

  it('POST /instances body 缺 cwd → 400', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'no cwd' }),
    });
    expect(r.status).toBe(400);
  });

  it('未注入 spawner → POST 返回 501', async () => {
    // 重新构造一个不带 spawner 的服务器
    const app = express();
    app.use(express.json({ strict: false }));
    const auth2 = new AuthModule({
      token: 'b'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 100,
      cookieName: createSessionCookieName(0),
    });
    app.post('/api/auth', auth2.handleAuth);
    app.use(
      '/api',
      createInstanceRoutes({
        authModule: auth2,
        registry,
        currentInstanceId: currentId,
      }),
    );
    const srv = createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const p = (srv.address() as AddressInfo).port;

    const loginRes = await fetch(`http://127.0.0.1:${p}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'b'.repeat(64) }),
    });
    const cookie2 = loginRes.headers.get('set-cookie')!.split(';')[0]!;

    const r = await fetch(`http://127.0.0.1:${p}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
      body: JSON.stringify({ cwd: '/tmp' }),
    });
    expect(r.status).toBe(501);
    auth2.destroy();
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
