/**
 * share-routes 单测
 *
 * 真实 Express server，验证：
 *  - 未鉴权 → 401
 *  - 鉴权后 → 200，含 endpoints 数组，至少有 loopback；不含 token 字段
 *  - 默认 displayIp 命中时被标记 isDefault
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { AuthModule } from '../auth/auth-middleware.js';
import { createTmpSessionsStore } from '../sessions/test-helpers.js';
import { createShareRoutes, type ShareEndpoint } from './share-routes.js';

describe('share-routes', () => {
  let server: Server;
  let port: number;
  let auth: AuthModule;
  let cleanupSessions: () => void;

  beforeEach(async () => {
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
    app.use(
      '/api',
      createShareRoutes({ authModule: auth, port: 3000, displayIp: '127.0.0.1' }),
    );
    app.post('/api/auth', auth.handleAuth);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    auth.destroy();
    cleanupSessions();
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function login(): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    });
    const sc = res.headers.get('set-cookie');
    if (!sc) throw new Error('no Set-Cookie');
    return sc.split(';')[0]!;
  }

  it('未带 cookie GET → 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/share/endpoints`);
    expect(res.status).toBe(401);
  });

  it('鉴权后 GET → 200 + endpoints 数组（包含至少 loopback）', async () => {
    const cookie = await login();
    const res = await fetch(`http://127.0.0.1:${port}/api/share/endpoints`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; endpoints: ShareEndpoint[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.endpoints)).toBe(true);
    // 至少有 loopback
    expect(body.endpoints.some((e) => e.kind === 'loopback')).toBe(true);
    // 所有项 port 一致
    for (const e of body.endpoints) {
      expect(e.port).toBe(3000);
      expect(typeof e.host).toBe('string');
    }
  });

  it('返回的 endpoint 不应包含 token 字段', async () => {
    const cookie = await login();
    const res = await fetch(`http://127.0.0.1:${port}/api/share/endpoints`, {
      headers: { Cookie: cookie },
    });
    const body = (await res.json()) as {
      ok: boolean;
      endpoints: Array<Record<string, unknown>>;
    };
    for (const e of body.endpoints) {
      expect(e['token']).toBeUndefined();
    }
  });

  it('与 displayIp 匹配的入口被标记 isDefault', async () => {
    const cookie = await login();
    const res = await fetch(`http://127.0.0.1:${port}/api/share/endpoints`, {
      headers: { Cookie: cookie },
    });
    const body = (await res.json()) as { ok: boolean; endpoints: ShareEndpoint[] };
    const def = body.endpoints.find((e) => e.isDefault);
    expect(def).toBeTruthy();
    // displayIp='127.0.0.1' → 默认应是 loopback
    expect(def?.host).toBe('127.0.0.1');
    expect(def?.kind).toBe('loopback');
  });
});
