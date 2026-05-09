/**
 * push-routes 单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { AuthModule } from '../auth/auth-middleware.js';
import { createTmpSessionsStore } from '../sessions/test-helpers.js';
import { createPushRoutes } from './push-routes.js';
import { PushService } from '../push/push-service.js';

function makeMockPush() {
  return {
    setVapidDetails: () => {},
    generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    sendNotification: async () => {},
  };
}

const VALID_P256DH = 'a'.repeat(87);
const VALID_AUTH = 'b'.repeat(22);

describe('push-routes', () => {
  let server: Server;
  let port: number;
  let auth: AuthModule;
  let push: PushService;
  let baseDir: string;
  let cleanupSessions: () => void;

  beforeEach(async () => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-push-r-'));
    push = new PushService({
      baseDir,
      env: {},
      pushImpl: makeMockPush() as never,
    });
    await push.init();
    const { store: sessionsStore, cleanup } = createTmpSessionsStore(60_000);
    cleanupSessions = cleanup;
    auth = new AuthModule({
      token: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 100,
      sessions: sessionsStore,
    });
    const app = express();
    app.use(express.json({ strict: false }));
    app.post('/api/auth', auth.handleAuth);
    app.use('/api', createPushRoutes(auth, push));
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
    const r = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    });
    return r.headers.get('set-cookie')!.split(';')[0]!;
  }

  it('GET /push/vapid 无需鉴权 → 返回 publicKey', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/push/vapid`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; publicKey: string };
    expect(body.publicKey).toBe('pub');
  });

  it('POST /push/subscriptions 未鉴权 → 401', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/push/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  });

  it('POST /push/subscriptions 合法 → 200 + 订阅数 +1', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/push/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        endpoint: 'https://e/1',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      }),
    });
    expect(r.status).toBe(200);
    expect(push.getSubscriptionCount()).toBe(1);
  });

  it('POST /push/subscriptions p256dh 太短 → 400 PUSH_SUBSCRIPTION_INVALID', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/push/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        endpoint: 'https://e/1',
        keys: { p256dh: 'short', auth: VALID_AUTH },
      }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.PUSH_SUBSCRIPTION_INVALID);
  });

  it('DELETE /push/subscriptions 缺 endpoint → 400', async () => {
    const cookie = await login();
    const r = await fetch(`http://127.0.0.1:${port}/api/push/subscriptions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('DELETE 已存在订阅 → removed=true', async () => {
    const cookie = await login();
    push.subscribe({
      endpoint: 'https://e/2',
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    });
    const r = await fetch(`http://127.0.0.1:${port}/api/push/subscriptions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ endpoint: 'https://e/2' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; removed: boolean };
    expect(body.removed).toBe(true);
    expect(push.getSubscriptionCount()).toBe(0);
  });
});
