/**
 * config-routes 单测
 *
 * 用真实 Express server 验证：
 *  - 未鉴权 → 401
 *  - 鉴权后 GET 返回 ensureDefaultUserConfig 的形态
 *  - PUT 整体覆盖 + 写入 store.set 被调用
 *  - PUT body 不是对象 → 400 CONFIG_VALIDATION_FAIL
 *  - PUT 字段类型错 → 400
 *  - PUT 触发 ConfigError → 透传 httpStatus 与 code
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  AuthModule,
  createSessionCookieName,
} from '../auth/auth-middleware.js';
import { createConfigRoutes, type ConfigStore } from './config-routes.js';
import { DEFAULT_SHORTCUTS, type UserConfig, ErrorCode } from '@ocr/shared';
import { ConfigError } from '../errors.js';

class InMemoryStore implements ConfigStore {
  constructor(public state: UserConfig = {}) {}
  get(): UserConfig {
    return this.state;
  }
  set(value: UserConfig): void {
    this.state = value;
  }
}

class FailingStore implements ConfigStore {
  get(): UserConfig {
    return {};
  }
  set(): void {
    throw new ConfigError(ErrorCode.CONFIG_WRITE_FAILED, '磁盘满', 500);
  }
}

describe('config-routes', () => {
  let server: Server;
  let port: number;
  let auth: AuthModule;
  let store: InMemoryStore;
  let cookieName: string;

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ strict: false }));
    cookieName = createSessionCookieName(0);
    auth = new AuthModule({
      token: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 100,
      cookieName,
    });
    store = new InMemoryStore();
    app.use('/api', createConfigRoutes(auth, store));
    // 也挂 /auth 让我们能拿 cookie
    app.post('/api/auth', auth.handleAuth);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    auth.destroy();
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
    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    expect(res.status).toBe(401);
  });

  it('带 cookie GET → 200 + 默认 shortcuts', async () => {
    const cookie = await login();
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; config: UserConfig };
    expect(body.ok).toBe(true);
    expect(body.config.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it('PUT 整体覆盖 + store.set 被调用', async () => {
    const cookie = await login();
    const newCfg: UserConfig = {
      shortcuts: [{ label: 'X', data: 'x', enabled: true, group: 'custom' }],
      fontScale: 1.5,
    };
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(newCfg),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; config: UserConfig };
    expect(body.config.shortcuts).toEqual(newCfg.shortcuts);
    expect(body.config.fontScale).toBe(1.5);
    expect(store.state).toEqual(newCfg);
  });

  it('PUT body 非对象 → 400 CONFIG_VALIDATION_FAIL', async () => {
    const cookie = await login();
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify('not-an-obj'),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.CONFIG_VALIDATION_FAIL);
  });

  it('PUT shortcuts 非数组 → 400', async () => {
    const cookie = await login();
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ shortcuts: 'oops' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT 写入失败 → 透传 ConfigError httpStatus + code', async () => {
    // 单独构造一个使用 FailingStore 的小 server
    const app = express();
    app.use(express.json({ strict: false }));
    const auth2 = new AuthModule({
      token: 'b'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 100,
      cookieName: createSessionCookieName(0),
    });
    app.post('/api/auth', auth2.handleAuth);
    app.use('/api', createConfigRoutes(auth2, new FailingStore()));
    const srv = createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const p = (srv.address() as AddressInfo).port;
    const loginRes = await fetch(`http://127.0.0.1:${p}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'b'.repeat(64) }),
    });
    const cookie2 = loginRes.headers.get('set-cookie')!.split(';')[0]!;

    const res = await fetch(`http://127.0.0.1:${p}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
      body: JSON.stringify({ fontScale: 1 }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.CONFIG_WRITE_FAILED);

    auth2.destroy();
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
