/**
 * AuthModule 单测
 *
 * 用真实 Express + supertest-like 模拟（手写 mock req/res），覆盖：
 * - verifyToken：长度差异 / 时序安全比较
 * - createSession / validateSession 基础正确性 + TTL 过期惰性清理
 * - getSessionFromRequest / getSessionFromCookieHeader cookie 解析
 * - requireAuth 中间件：缺 cookie / 过期 / 有效三态
 * - handleAuth：限流 / 错 token / 成功签发 cookie
 * - createSessionCookieName 端口绑定
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AuthModule, createSessionCookieName } from './auth-middleware.js';

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

describe('createSessionCookieName', () => {
  it('生成端口绑定的 cookie 名', () => {
    expect(createSessionCookieName(3000)).toBe('session_id_p3000');
    expect(createSessionCookieName(8080)).toBe('session_id_p8080');
  });
});

describe('AuthModule.verifyToken', () => {
  let auth: AuthModule;
  beforeEach(() => {
    auth = new AuthModule({
      token: 'a'.repeat(64),
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      cookieName: 'session_id_p3000',
    });
  });
  afterEach(() => auth.destroy());

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
  let auth: AuthModule;
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    auth = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      cookieName: 'session_id_p3000',
    });
  });
  afterEach(() => {
    auth.destroy();
    vi.useRealTimers();
  });

  it('createSession 返回 64 字符 hex', () => {
    const sid = auth.createSession('1.1.1.1');
    expect(sid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validateSession 有效→true', () => {
    const sid = auth.createSession('1.1.1.1');
    expect(auth.validateSession(sid)).toBe(true);
  });

  it('未知 sid→false', () => {
    expect(auth.validateSession('unknown')).toBe(false);
  });

  it('TTL 过期惰性清理', () => {
    const sid = auth.createSession('1.1.1.1');
    expect(auth.sessionCount).toBe(1);
    vi.advanceTimersByTime(60_001);
    expect(auth.validateSession(sid)).toBe(false);
    expect(auth.sessionCount).toBe(0); // 取出时已删
  });
});

describe('AuthModule.cookie 解析', () => {
  let auth: AuthModule;
  beforeEach(() => {
    auth = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      cookieName: 'session_id_p3000',
    });
  });
  afterEach(() => auth.destroy());

  it('从 Request 取 sid', () => {
    const req = makeReq({ cookie: 'session_id_p3000=abc; other=x' });
    expect(auth.getSessionFromRequest(req)).toBe('abc');
  });

  it('cookie 缺失→null', () => {
    expect(auth.getSessionFromRequest(makeReq())).toBeNull();
  });

  it('从 raw header 取 sid（WS upgrade 路径）', () => {
    expect(
      auth.getSessionFromCookieHeader('session_id_p3000=xyz; foo=bar'),
    ).toBe('xyz');
  });

  it('不同端口的 cookie 不会被取到', () => {
    const req = makeReq({ cookie: 'session_id_p9999=abc' });
    expect(auth.getSessionFromRequest(req)).toBeNull();
  });
});

describe('AuthModule.requireAuth 中间件', () => {
  let auth: AuthModule;
  beforeEach(() => {
    auth = new AuthModule({
      token: 'tok',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 5,
      cookieName: 'session_id_p3000',
    });
  });
  afterEach(() => auth.destroy());

  it('无 cookie → 401', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    auth.requireAuth(req, res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('有效 session → next()', () => {
    const sid = auth.createSession('1.1.1.1');
    const req = makeReq({ cookie: `session_id_p3000=${sid}` });
    const res = makeRes();
    const next = vi.fn();
    auth.requireAuth(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('过期 session → 401', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const sid = auth.createSession('1.1.1.1');
    vi.advanceTimersByTime(60_001);
    const req = makeReq({ cookie: `session_id_p3000=${sid}` });
    const res = makeRes();
    const next = vi.fn();
    auth.requireAuth(req, res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('AuthModule.handleAuth', () => {
  let auth: AuthModule;
  beforeEach(() => {
    auth = new AuthModule({
      token: 'correct-token',
      sessionTtlMs: 60_000,
      rateLimitPerMinute: 3,
      cookieName: 'session_id_p3000',
    });
  });
  afterEach(() => auth.destroy());

  it('正确 token → 200 + Set-Cookie', () => {
    const req = makeReq({ body: { token: 'correct-token' } });
    const res = makeRes();
    auth.handleAuth(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('session_id_p3000=');
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Lax');
  });

  it('错误 token → 401 + 错误码 AUTH_INVALID_TOKEN', () => {
    const req = makeReq({ body: { token: 'wrong' } });
    const res = makeRes();
    auth.handleAuth(req, res);
    expect(res.statusCode).toBe(401);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe(
      'AUTH_INVALID_TOKEN',
    );
  });

  it('缺 token 字段 → 401', () => {
    const req = makeReq({ body: {} });
    const res = makeRes();
    auth.handleAuth(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('限流：超过 max → 429', () => {
    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      auth.handleAuth(makeReq({ body: { token: 'wrong' } }), res);
      expect(res.statusCode).toBe(401); // 错 token 但不超限
    }
    const res = makeRes();
    auth.handleAuth(makeReq({ body: { token: 'wrong' } }), res);
    expect(res.statusCode).toBe(429);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe(
      'AUTH_RATE_LIMITED',
    );
  });

  it('成功认证后限流计数清零（防止误输历史阻塞合法用户）', () => {
    // 先错 2 次
    for (let i = 0; i < 2; i++) {
      auth.handleAuth(makeReq({ body: { token: 'wrong' } }), makeRes());
    }
    // 第 3 次：用正确 token 成功
    const okRes = makeRes();
    auth.handleAuth(makeReq({ body: { token: 'correct-token' } }), okRes);
    expect(okRes.statusCode).toBe(200);

    // 之后再错 3 次仍未超限（说明已清零）
    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      auth.handleAuth(makeReq({ body: { token: 'wrong' } }), res);
      expect(res.statusCode).toBe(401);
    }
  });

  it('https 请求时 secure=true', () => {
    const req = makeReq({ body: { token: 'correct-token' }, protocol: 'https' });
    const res = makeRes();
    auth.handleAuth(req, res);
    expect(res.headers['Set-Cookie']).toContain('Secure');
  });
});
