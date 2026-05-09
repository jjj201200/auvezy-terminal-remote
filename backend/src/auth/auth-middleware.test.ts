/**
 * AuthModule 单测（0.7.0：async API + SessionsStore）
 *
 * 用真实 Express + 手写 mock req/res，覆盖：
 * - verifyToken：长度差异 / 时序安全比较
 * - createSession / validateSession 基础正确性 + TTL（store 层管）
 * - getSessionFromRequest / getSessionFromCookieHeader cookie 解析
 *   - 包括 legacyCookieNames 兼容路径
 * - requireAuth 中间件（async）：缺 cookie / 过期 / 有效三态
 * - handleAuth：限流 / 错 token / 成功签发 cookie
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AuthModule,
  createSessionCookieName,
  DEFAULT_SESSION_COOKIE_NAME,
} from './auth-middleware.js';
import { SessionsStore } from '../sessions/sessions-store.js';

function makeReq(opts: {
  cookie?: string;
  ip?: string;
  body?: unknown;
  protocol?: string;
} = {}): Request {
  return {
    headers: { cookie: opts.cookie ?? '' },
    ip: opts.ip ?? '1.2.3.4',
    socket: { remoteAddress: opts.ip ?? '1.2.3.4' },
    body: opts.body,
    protocol: opts.protocol ?? 'http',
    path: '/test',
  } as unknown as Request;
}

function makeRes(): Response & {
  statusCode: number;
  jsonBody: unknown;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const r = {
    statusCode: 200,
    jsonBody: undefined as unknown,
    headers,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(body: unknown) {
      r.jsonBody = body;
      return r;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return r;
    },
  };
  return r as unknown as Response & {
    statusCode: number;
    jsonBody: unknown;
    headers: Record<string, string>;
  };
}

/** 每个测试用独立临时目录，避免共享 sessions.json */
function makeStore(baseDir: string, sessionTtlMs: number): SessionsStore {
  return new SessionsStore({
    path: resolve(baseDir, 'sessions.json'),
    lockDir: resolve(baseDir, '.lock'),
    sessionTtlMs,
  });
}

describe('createSessionCookieName', () => {
  it('生成端口绑定的 cookie 名（0.6.x 兼容用途）', () => {
    expect(createSessionCookieName(3000)).toBe('session_id_p3000');
    expect(createSessionCookieName(8080)).toBe('session_id_p8080');
  });
});

describe('AuthModule.verifyToken', () => {
  let baseDir: string;
  let auth: AuthModule;
  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    auth = new AuthModule({
      token: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      sessions: makeStore(baseDir, 60_000),
    });
  });
  afterEach(() => {
    auth.destroy();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('正确 token 通过', () => {
    expect(auth.verifyToken('a'.repeat(64))).toBe(true);
  });

  it('错误 token 拒绝', () => {
    expect(auth.verifyToken('b'.repeat(64))).toBe(false);
  });

  it('长度不同立即拒绝（不进 timingSafeEqual）', () => {
    expect(auth.verifyToken('a'.repeat(63))).toBe(false);
    expect(auth.verifyToken('a'.repeat(65))).toBe(false);
    expect(auth.verifyToken('')).toBe(false);
  });
});

describe('AuthModule.session 生命周期', () => {
  let baseDir: string;
  let auth: AuthModule;
  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    auth = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      sessions: makeStore(baseDir, 60_000),
    });
  });
  afterEach(() => {
    auth.destroy();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('createSession 返回 64 字符 hex', async () => {
    const sid = await auth.createSession('1.1.1.1');
    expect(sid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validateSession 有效→true', async () => {
    const sid = await auth.createSession('1.1.1.1');
    expect(await auth.validateSession(sid)).toBe(true);
  });

  it('未知 sid→false', async () => {
    expect(await auth.validateSession('unknown')).toBe(false);
  });

  it('TTL 过期由 store 处理（短 TTL 验证）', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    try {
      const a = new AuthModule({
        token: 'tok',
        sessionTtlMs: 5,
        rateLimitPerMinute: 5,
        sessions: makeStore(dir, 5),
      });
      const sid = await a.createSession('1.1.1.1');
      await new Promise((r) => setTimeout(r, 20));
      expect(await a.validateSession(sid)).toBe(false);
      a.destroy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AuthModule.cookie 解析', () => {
  let baseDir: string;
  let auth: AuthModule;
  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    auth = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      legacyCookieNames: ['session_id_p3000'],
      sessions: makeStore(baseDir, 60_000),
    });
  });
  afterEach(() => {
    auth.destroy();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('从 Request 取 sid（新 cookie 名）', () => {
    const req = makeReq({ cookie: `${DEFAULT_SESSION_COOKIE_NAME}=abc; other=x` });
    expect(auth.getSessionFromRequest(req)).toBe('abc');
  });

  it('cookie 缺失→null', () => {
    expect(auth.getSessionFromRequest(makeReq())).toBeNull();
  });

  it('从 raw header 取 sid（WS upgrade 路径）', () => {
    expect(
      auth.getSessionFromCookieHeader(`${DEFAULT_SESSION_COOKIE_NAME}=xyz; foo=bar`),
    ).toBe('xyz');
  });

  it('legacy cookie 名命中（升级期兼容）', () => {
    const req = makeReq({ cookie: 'session_id_p3000=legacy-sid' });
    expect(auth.getSessionFromRequest(req)).toBe('legacy-sid');
  });

  it('新 + 旧同时存在 → 优先取新', () => {
    const req = makeReq({
      cookie: `session_id_p3000=old; ${DEFAULT_SESSION_COOKIE_NAME}=new`,
    });
    expect(auth.getSessionFromRequest(req)).toBe('new');
  });

  it('未配置 legacy 时不会误识旧 cookie', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    const a = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      sessions: makeStore(dir, 60_000),
    });
    expect(
      a.getSessionFromRequest(makeReq({ cookie: 'session_id_p3000=abc' })),
    ).toBeNull();
    a.destroy();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('AuthModule.requireAuth 中间件', () => {
  let baseDir: string;
  let auth: AuthModule;
  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    auth = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      sessions: makeStore(baseDir, 60_000),
    });
  });
  afterEach(() => {
    auth.destroy();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('无 cookie → 401', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await auth.requireAuth(req, res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('有效 session → next()', async () => {
    const sid = await auth.createSession('1.1.1.1');
    const req = makeReq({ cookie: `${DEFAULT_SESSION_COOKIE_NAME}=${sid}` });
    const res = makeRes();
    const next = vi.fn();
    await auth.requireAuth(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('过期 session → 401', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    try {
      const a = new AuthModule({
        token: 'tok',
        sessionTtlMs: 5,
        rateLimitPerMinute: 5,
        sessions: makeStore(dir, 5),
      });
      const sid = await a.createSession('1.1.1.1');
      await new Promise((r) => setTimeout(r, 20));
      const req = makeReq({ cookie: `${DEFAULT_SESSION_COOKIE_NAME}=${sid}` });
      const res = makeRes();
      const next = vi.fn();
      await a.requireAuth(req, res, next as NextFunction);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      a.destroy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AuthModule.handleAuth', () => {
  let baseDir: string;
  let auth: AuthModule;
  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-auth-'));
    auth = new AuthModule({
      token: 'correct-token',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 3,
      sessions: makeStore(baseDir, 60_000),
    });
  });
  afterEach(() => {
    auth.destroy();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('正确 token → 200 + Set-Cookie', async () => {
    const req = makeReq({ body: { token: 'correct-token' } });
    const res = makeRes();
    await auth.handleAuth(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain(`${DEFAULT_SESSION_COOKIE_NAME}=`);
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Lax');
  });

  it('错误 token → 401 + 错误码 AUTH_INVALID_TOKEN', async () => {
    const req = makeReq({ body: { token: 'wrong' } });
    const res = makeRes();
    await auth.handleAuth(req, res);
    expect(res.statusCode).toBe(401);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe(
      'AUTH_INVALID_TOKEN',
    );
  });

  it('缺 token 字段 → 401', async () => {
    const req = makeReq({ body: {} });
    const res = makeRes();
    await auth.handleAuth(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('限流：超过 max → 429', async () => {
    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      await auth.handleAuth(makeReq({ body: { token: 'wrong' } }), res);
      expect(res.statusCode).toBe(401); // 错 token 但不超限
    }
    const res = makeRes();
    await auth.handleAuth(makeReq({ body: { token: 'wrong' } }), res);
    expect(res.statusCode).toBe(429);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe(
      'AUTH_RATE_LIMITED',
    );
  });

  it('成功认证后限流计数清零', async () => {
    for (let i = 0; i < 2; i++) {
      await auth.handleAuth(makeReq({ body: { token: 'wrong' } }), makeRes());
    }
    const okRes = makeRes();
    await auth.handleAuth(makeReq({ body: { token: 'correct-token' } }), okRes);
    expect(okRes.statusCode).toBe(200);

    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      await auth.handleAuth(makeReq({ body: { token: 'wrong' } }), res);
      expect(res.statusCode).toBe(401);
    }
  });

  it('https 请求时 secure=true', async () => {
    const req = makeReq({ body: { token: 'correct-token' }, protocol: 'https' });
    const res = makeRes();
    await auth.handleAuth(req, res);
    expect(res.headers['Set-Cookie']).toContain('Secure');
  });
});
