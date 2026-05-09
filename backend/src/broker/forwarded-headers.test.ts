/**
 * forwarded-headers 单测
 *
 * 关键点：
 *  - getInstanceFromHeaders：识别小写头、array 头取首项、缺失返 null
 *  - getPublicUrl：broker 反代场景拼出 /i/<id>/...；直连兜底用 req
 *  - isFromBroker：根据 instance 头判断
 *  - subPath 规范化：'foo' / '/foo' 都接受
 */

import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  getInstanceFromHeaders,
  getPublicUrl,
  isFromBroker,
} from './forwarded-headers.js';

/** 构造最小化 Express Request mock */
function mockReq(headers: Record<string, string | string[]>, opts?: { protocol?: string; host?: string }): Request {
  const h: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  return {
    headers: h,
    protocol: opts?.protocol ?? 'http',
    get(name: string): string | undefined {
      if (name.toLowerCase() === 'host') return opts?.host;
      const v = h[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
  } as unknown as Request;
}

describe('getInstanceFromHeaders', () => {
  it('有头 → 返回 id', () => {
    expect(getInstanceFromHeaders({ 'x-atr-forwarded-instance': 'abc' })).toBe('abc');
  });

  it('array 头取首项', () => {
    expect(getInstanceFromHeaders({ 'x-atr-forwarded-instance': ['a', 'b'] })).toBe('a');
  });

  it('缺失 → null', () => {
    expect(getInstanceFromHeaders({})).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(getInstanceFromHeaders({ 'x-atr-forwarded-instance': '' })).toBeNull();
  });
});

describe('getPublicUrl — broker 反代场景', () => {
  it('完整头 + 子路径', () => {
    const req = mockReq({
      'x-atr-forwarded-instance': 'abc-123',
      'x-forwarded-host': 'wsl.tail3e456b.ts.net',
      'x-forwarded-proto': 'https',
    });
    expect(getPublicUrl(req, '/api/push/sub')).toBe(
      'https://wsl.tail3e456b.ts.net/i/abc-123/api/push/sub',
    );
  });

  it('subPath 不带前导斜杠也能拼对', () => {
    const req = mockReq({
      'x-atr-forwarded-instance': 'abc',
      'x-forwarded-host': 'h.example',
      'x-forwarded-proto': 'https',
    });
    expect(getPublicUrl(req, 'api/foo')).toBe('https://h.example/i/abc/api/foo');
  });

  it('subPath 为空 → 返回 base', () => {
    const req = mockReq({
      'x-atr-forwarded-instance': 'abc',
      'x-forwarded-host': 'h.example',
      'x-forwarded-proto': 'https',
    });
    expect(getPublicUrl(req)).toBe('https://h.example/i/abc');
  });

  it('proto 缺失 → 默认 http', () => {
    const req = mockReq({
      'x-atr-forwarded-instance': 'abc',
      'x-forwarded-host': 'h.example',
    });
    expect(getPublicUrl(req, '/x')).toBe('http://h.example/i/abc/x');
  });

  it('host 是数组 → 取首项', () => {
    const req = mockReq({
      'x-atr-forwarded-instance': 'abc',
      'x-forwarded-host': ['first.example', 'second.example'],
      'x-forwarded-proto': 'https',
    });
    expect(getPublicUrl(req, '/x')).toBe('https://first.example/i/abc/x');
  });
});

describe('getPublicUrl — 直连兜底', () => {
  it('无 instance 头 → 用 req.host + req.protocol', () => {
    const req = mockReq({}, { protocol: 'http', host: '127.0.0.1:43210' });
    expect(getPublicUrl(req, '/api/foo')).toBe('http://127.0.0.1:43210/api/foo');
  });

  it('无 instance 即使有 host 头也不当反代', () => {
    const req = mockReq({ 'x-forwarded-host': 'spoof.example' }, {
      protocol: 'http',
      host: '127.0.0.1:43210',
    });
    expect(getPublicUrl(req, '/api/foo')).toBe('http://127.0.0.1:43210/api/foo');
  });

  it('host 完全缺失 → 兜底 127.0.0.1', () => {
    const req = mockReq({}, { protocol: 'http' });
    expect(getPublicUrl(req, '/x')).toBe('http://127.0.0.1/x');
  });
});

describe('isFromBroker', () => {
  it('有 instance 头 → true', () => {
    expect(isFromBroker(mockReq({ 'x-atr-forwarded-instance': 'abc' }))).toBe(true);
  });

  it('无 → false', () => {
    expect(isFromBroker(mockReq({}))).toBe(false);
  });
});
