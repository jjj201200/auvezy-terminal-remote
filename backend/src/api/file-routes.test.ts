/**
 * file-routes 单测
 *
 * 真实 Express server + AuthModule + 临时实例 registry。
 * 覆盖:鉴权、参数缺失、list/stat/read/raw 各路径正反例、deny 命中、/raw header。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { AuthModule } from '../auth/auth-middleware.js';
import { createTmpSessionsStore } from '../sessions/test-helpers.js';
import type { InstanceRegistryManager } from '../registry/instance-registry.js';
import type { InstanceInfo } from 'auvezy-terminal-remote-shared';
import { createFileRoutes } from './file-routes.js';

const FAKE_INSTANCE_ID = 'inst-1';

interface Env {
  server: Server;
  port: number;
  cleanupSessions: () => void;
  auth: AuthModule;
  cleanupTmp: () => void;
  cwd: string;
  cwdReal: string;
}

async function makeEnv(allow: string[] = [], deny: string[] = []): Promise<Env> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'fb-routes-'));
  const cwd = join(tmpRoot, 'work');
  mkdirSync(cwd);
  mkdirSync(join(cwd, 'sub'));
  writeFileSync(join(cwd, 'README.md'), '# hi');
  const cwdReal = realpathSync(cwd);

  const app = express();
  app.use(express.json({ strict: false }));
  const { store: sessionsStore, cleanup } = createTmpSessionsStore(60_000);
  const auth = new AuthModule({
    token: 'a'.repeat(64),
    sessionTtlMs: 60_000,
    rateLimitPerMinute: 100,
    sessions: sessionsStore,
  });

  const registry = {
    async list(): Promise<InstanceInfo[]> {
      return [{
        instanceId: FAKE_INSTANCE_ID, name: 'fake',
        host: '127.0.0.1', port: 0, pid: process.pid,
        cwd: cwdReal, startedAt: new Date().toISOString(),
      }];
    },
  } as unknown as InstanceRegistryManager;

  app.use('/api', createFileRoutes({
    authModule: auth,
    registry,
    workdirPolicy: () => ({ allow, deny }),
  }));
  app.post('/api/auth', auth.handleAuth);

  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  return {
    server, port, cleanupSessions: cleanup, auth,
    cleanupTmp: () => rmSync(tmpRoot, { recursive: true, force: true }),
    cwd, cwdReal,
  };
}

async function teardown(env: Env): Promise<void> {
  env.auth.destroy();
  env.cleanupSessions();
  await new Promise<void>((r) => env.server.close(() => r()));
  env.cleanupTmp();
}

async function login(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'a'.repeat(64) }),
  });
  const sc = res.headers.get('set-cookie');
  if (!sc) throw new Error('no Set-Cookie');
  return sc.split(';')[0]!;
}

describe('file-routes', () => {
  let env: Env;

  afterEach(async () => { await teardown(env); });

  it('GET /api/files/list 未鉴权 → 401', async () => {
    env = await makeEnv();
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=${FAKE_INSTANCE_ID}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/files/list 缺 instanceId → 400 BAD_REQUEST', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /api/files/list 实例不存在 → 404 INSTANCE_NOT_FOUND', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=missing`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INSTANCE_NOT_FOUND');
  });

  it('GET /api/files/list cwd 列出 README.md + sub', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=${FAKE_INSTANCE_ID}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { cwd: string; path: string; entries: Array<{ name: string }> };
    expect(body.cwd).toBe(env.cwdReal);
    expect(body.path).toBe(env.cwdReal);
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toEqual(['README.md', 'sub']);
  });

  it('GET /api/files/read 文本文件返回内容', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/read?instanceId=${FAKE_INSTANCE_ID}&path=README.md`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; lang: string };
    expect(body.content).toBe('# hi');
    expect(body.lang).toBe('markdown');
  });

  it('GET /api/files/read deny 命中 → 403 PATH_FORBIDDEN', async () => {
    env = await makeEnv([], []);
    // 配 deny 命中 cwd 真路径
    await teardown(env);
    const tmpRoot = mkdtempSync(join(tmpdir(), 'fb-routes-deny-'));
    const cwd = join(tmpRoot, 'work');
    mkdirSync(cwd);
    writeFileSync(join(cwd, 'README.md'), '# hi');
    const cwdReal = realpathSync(cwd);
    env = await makeEnvWithCwd(cwdReal, [], [`${cwdReal}/**`, cwdReal]);
    // 清理 deny 用临时目录
    const tearOrig = env.cleanupTmp;
    env.cleanupTmp = () => { tearOrig(); rmSync(tmpRoot, { recursive: true, force: true }); };

    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/read?instanceId=${FAKE_INSTANCE_ID}&path=README.md`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PATH_FORBIDDEN');
  });

  it('GET /api/files/raw 不存在 → X-ATR-Error header(不返 JSON)', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/raw?instanceId=${FAKE_INSTANCE_ID}&path=nope.png`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get('x-atr-error')).toBe('PATH_NOT_FOUND');
    const text = await res.text();
    expect(text).toBe('');
  });

  it('GET /api/files/stat 目录返回 kind=dir', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/stat?instanceId=${FAKE_INSTANCE_ID}&path=sub`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string };
    expect(body.kind).toBe('dir');
  });

  it('GET /api/files/search 鉴权后 q 缺失 → 400', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/search?instanceId=${FAKE_INSTANCE_ID}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  it('GET /api/files/search name 模式命中流式返回', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    const res = await fetch(`http://127.0.0.1:${env.port}/api/files/search?instanceId=${FAKE_INSTANCE_ID}&q=README&mode=name`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/event-stream/);
    const text = await res.text();
    expect(text).toContain('"kind":"name"');
    expect(text).toContain('README.md');
    expect(text).toContain('event: done');
  });

  it('GET /api/files/list 超 120/min 返 429', async () => {
    env = await makeEnv();
    const cookie = await login(env.port);
    let last = 0;
    let lastBody: { error?: { code: string } } | undefined;
    // 连发 130 次,期待最后被 429
    for (let i = 0; i < 130; i++) {
      const res = await fetch(`http://127.0.0.1:${env.port}/api/files/list?instanceId=${FAKE_INSTANCE_ID}`, { headers: { Cookie: cookie } });
      last = res.status;
      if (res.status === 429) {
        lastBody = await res.json() as { error: { code: string } };
        break;
      }
    }
    expect(last).toBe(429);
    expect(lastBody?.error?.code).toBe('AUTH_RATE_LIMITED');
  }, 30_000);
});

/** 复用 makeEnv 逻辑但用指定 cwd 与 policy(给 deny 测试用) */
async function makeEnvWithCwd(cwd: string, allow: string[], deny: string[]): Promise<Env> {
  const cwdReal = realpathSync(cwd);
  const app = express();
  app.use(express.json({ strict: false }));
  const { store: sessionsStore, cleanup } = createTmpSessionsStore(60_000);
  const auth = new AuthModule({
    token: 'a'.repeat(64), sessionTtlMs: 60_000,
    rateLimitPerMinute: 100, sessions: sessionsStore,
  });
  const registry = {
    async list(): Promise<InstanceInfo[]> {
      return [{
        instanceId: FAKE_INSTANCE_ID, name: 'fake',
        host: '127.0.0.1', port: 0, pid: process.pid,
        cwd: cwdReal, startedAt: new Date().toISOString(),
      }];
    },
  } as unknown as InstanceRegistryManager;
  app.use('/api', createFileRoutes({
    authModule: auth, registry, workdirPolicy: () => ({ allow, deny }),
  }));
  app.post('/api/auth', auth.handleAuth);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { server, port, cleanupSessions: cleanup, auth, cleanupTmp: () => {}, cwd, cwdReal };
}
