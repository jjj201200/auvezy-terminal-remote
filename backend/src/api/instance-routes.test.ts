/**
 * instance-routes 单测（broker 端 / 0.7.0 v2）
 *
 * 与 v1 不同：
 *  - 使用 createBrokerInstanceRoutes（无 currentInstanceId / selfShutdown）
 *  - POST 返回 202 + { status: 'pending', instance: { instanceId, pid, cwd, name } }
 *  - DELETE 不再走 HTTP self-shutdown，直接 process.kill
 *  - isCurrent 字段永远 false（broker 不属于任何 instance）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { AuthModule } from '../auth/auth-middleware.js';
import { createTmpSessionsStore } from '../sessions/test-helpers.js';
import { createBrokerInstanceRoutes } from './instance-routes.js';
import { InstanceRegistryManager } from '../registry/instance-registry.js';
import type {
  InstanceSpawner,
  SpawnInstanceInput,
  SpawnInstanceResult,
} from '../registry/instance-spawner.js';
import type { InstanceInfo, InstanceListItem } from 'auvezy-terminal-remote-shared';

class FakeSpawner implements InstanceSpawner {
  public calls: SpawnInstanceInput[] = [];
  async spawn(input: SpawnInstanceInput): Promise<SpawnInstanceResult> {
    this.calls.push(input);
    return {
      pid: 12345,
      cwd: input.cwd,
      name: input.name ?? 'unnamed',
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    };
  }
}

describe('broker instance-routes', () => {
  let server: Server;
  let port: number;
  let auth: AuthModule;
  let registry: InstanceRegistryManager;
  let baseDir: string;
  let spawner: FakeSpawner;
  let cleanupSessions: () => void;

  beforeEach(async () => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-iroute-'));
    const app = express();
    app.use(express.json({ strict: false }));
    const { store: sessionsStore, cleanup } = createTmpSessionsStore(60_000);
    cleanupSessions = cleanup;
    auth = new AuthModule({
      token: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 100,
      sessions: sessionsStore,
    });
    registry = new InstanceRegistryManager({ baseDir });
    spawner = new FakeSpawner();
    app.post('/api/auth', auth.handleAuth);
    app.use(
      '/api',
      createBrokerInstanceRoutes({
        authModule: auth,
        registry,
        spawner,
      }),
    );
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    auth.destroy();
    cleanupSessions();
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

  it('GET /instances → isCurrent 永远 false（broker 不属于任何 instance）', async () => {
    const cookie = await login();
    const fake: InstanceInfo = {
      instanceId: 'inst-A',
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
    expect(body.instances[0]?.isCurrent).toBe(false);
  });

  it('POST /instances → 202 + status:pending + spawner 收到 instanceId', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cwd: '/tmp', name: 'project-x' }),
    });
    expect(r.status).toBe(202);
    const body = (await r.json()) as {
      ok: boolean;
      status: string;
      instance: { instanceId: string; pid: number; cwd: string; name: string };
    };
    expect(body.status).toBe('pending');
    expect(body.instance.pid).toBe(12345);
    expect(body.instance.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(spawner.calls).toHaveLength(1);
    expect(spawner.calls[0]?.cwd).toBe('/tmp');
    expect(spawner.calls[0]?.name).toBe('project-x');
    // broker 透传给 spawner 的 instanceId 必须等于 webapp 看到的那个
    expect(spawner.calls[0]?.instanceId).toBe(body.instance.instanceId);
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

  // ──────────────── 显式名重名 409 两段式 ────────────────

  it('POST 显式名撞活实例且未确认 → 409 + suggestion + existing，不 spawn', async () => {
    const cookie = await login();
    await registry.register({
      instanceId: 'inst-occupied',
      name: 'myproj',
      host: '127.0.0.1',
      port: 3000,
      pid: process.pid, // 自身 pid 保活
      cwd: '/home/me/code/myproj',
      startedAt: new Date().toISOString(),
    });

    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cwd: '/tmp', name: 'myproj' }),
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as {
      error: {
        code: string;
        details?: { suggestion?: string; existing?: { pid?: number; cwd?: string } };
      };
    };
    expect(body.error.code).toBe('INSTANCE_NAME_CONFLICT');
    expect(body.error.details?.suggestion).toBe('myproj-2');
    expect(body.error.details?.existing?.pid).toBe(process.pid);
    expect(body.error.details?.existing?.cwd).toBe('/home/me/code/myproj');
    // 未确认 → spawner 不得被调用
    expect(spawner.calls).toHaveLength(0);
  });

  it('POST 显式名撞活实例 + confirmDuplicate:true → 202 放行（用户已确认）', async () => {
    const cookie = await login();
    await registry.register({
      instanceId: 'inst-occupied2',
      name: 'myproj',
      host: '127.0.0.1',
      port: 3001,
      pid: process.pid,
      cwd: '/tmp',
      startedAt: new Date().toISOString(),
    });

    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cwd: '/tmp', name: 'myproj', confirmDuplicate: true }),
    });
    expect(r.status).toBe(202);
    expect(spawner.calls).toHaveLength(1);
    expect(spawner.calls[0]?.name).toBe('myproj');
  });

  it('POST 不带 name → 不做重名检查直接 202（worker 侧自动避让）', async () => {
    const cookie = await login();
    await registry.register({
      instanceId: 'inst-occupied3',
      name: 'tmp',
      host: '127.0.0.1',
      port: 3002,
      pid: process.pid,
      cwd: '/tmp',
      startedAt: new Date().toISOString(),
    });

    const r = await fetch(`http://127.0.0.1:${port}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cwd: '/tmp' }),
    });
    expect(r.status).toBe(202);
    expect(spawner.calls[0]?.name).toBeUndefined();
  });

  it('DELETE /instances/:id → 不存在 404', async () => {
    const cookie = await login();
    const r = await fetch(
      `http://127.0.0.1:${port}/api/instances/non-existent-id`,
      { method: 'DELETE', headers: { Cookie: cookie } },
    );
    expect(r.status).toBe(404);
  });

  it('DELETE /instances/:id → 发送 SIGTERM 并 unregister', async () => {
    const cookie = await login();
    // 用本进程 pid（一定存活），但 instanceId 是假的——broker 仍会发 SIGTERM
    // 给本进程，但本测试进程已经注册了 SIGTERM handler（vitest 自带），不会
    // 真退出。我们关心的是：路由响应 200 + 调用后 registry 已清掉条目。
    //
    // 为避免误杀本测试进程，改用 process.kill 0（仅探活不发信号）的语义不
    // 适用——broker 路由直接 SIGTERM。改造测试：拦 process.kill。
    const originalKill = process.kill;
    let killed: { pid: number; signal: NodeJS.Signals | number } | null = null;
    (process as { kill: typeof process.kill }).kill = ((
      pid: number,
      signal?: NodeJS.Signals | number,
    ): true => {
      killed = { pid, signal: signal ?? 'SIGTERM' };
      return true;
    }) as typeof process.kill;
    try {
      const fake: InstanceInfo = {
        instanceId: 'inst-Z',
        name: 'fake',
        host: '127.0.0.1',
        port: 9999,
        pid: process.pid, // list() 探活通过
        cwd: '/tmp',
        startedAt: new Date().toISOString(),
      };
      await registry.register(fake);

      const r = await fetch(
        `http://127.0.0.1:${port}/api/instances/inst-Z`,
        { method: 'DELETE', headers: { Cookie: cookie } },
      );
      expect(r.status).toBe(200);
      const body = (await r.json()) as { ok: boolean; outcome: string };
      expect(body.ok).toBe(true);
      expect(body.outcome).toBe('sigterm');
      expect(killed).not.toBeNull();
      expect(killed!.pid).toBe(process.pid);
      expect(killed!.signal).toBe('SIGTERM');
      const after = await registry.list();
      expect(after.find((i) => i.instanceId === 'inst-Z')).toBeUndefined();
    } finally {
      process.kill = originalKill;
    }
  });
});
