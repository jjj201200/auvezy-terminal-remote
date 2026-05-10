/**
 * broker proxy 工具单测
 *
 * - injectForwardedHeaders：注入 5 个头 + XFF append 链
 * - stripUnsafeForwardedHeaders：删 5 个头
 * - createProxyServer：错误处理写 502 / destroy socket
 */

import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  injectForwardedHeaders,
  stripUnsafeForwardedHeaders,
  createProxyServer,
} from './proxy.js';
import {
  HEADER_FORWARDED_FOR,
  HEADER_FORWARDED_HOST,
  HEADER_FORWARDED_INSTANCE,
  HEADER_FORWARDED_PATH,
  HEADER_FORWARDED_PROTO,
} from './forwarded-headers.js';

function mockProxyReq() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
  };
}

function mockReq(opts: {
  headers?: Record<string, string>;
  remoteAddress?: string;
  url?: string;
} = {}): IncomingMessage {
  const lower: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    lower[k.toLowerCase()] = v;
  }
  return {
    headers: lower,
    socket: { remoteAddress: opts.remoteAddress ?? '10.0.0.1' },
    url: opts.url ?? '/i/abc/api/health',
  } as unknown as IncomingMessage;
}

describe('injectForwardedHeaders', () => {
  it('注入 5 个头 + XFF append 来自 socket 的 client IP', () => {
    const req = mockReq({
      headers: { 'x-forwarded-for': '203.0.113.5' },
      remoteAddress: '10.0.0.1',
      url: '/i/abc/api/foo?bar=1',
    });
    const proxy = mockProxyReq();
    injectForwardedHeaders(proxy as never, req, {
      instanceId: 'abc',
      host: 'wsl.tail3e456b.ts.net',
      proto: 'https',
    });
    expect(proxy.headers.get(HEADER_FORWARDED_INSTANCE)).toBe('abc');
    expect(proxy.headers.get(HEADER_FORWARDED_HOST)).toBe('wsl.tail3e456b.ts.net');
    expect(proxy.headers.get(HEADER_FORWARDED_PROTO)).toBe('https');
    expect(proxy.headers.get(HEADER_FORWARDED_PATH)).toBe('/i/abc/api/foo?bar=1');
    expect(proxy.headers.get(HEADER_FORWARDED_FOR)).toBe('203.0.113.5, 10.0.0.1');
  });

  it('XFF 缺失时只用 socket IP', () => {
    const req = mockReq({ remoteAddress: '10.0.0.2' });
    const proxy = mockProxyReq();
    injectForwardedHeaders(proxy as never, req, {
      instanceId: 'x',
      host: 'h',
      proto: 'http',
    });
    expect(proxy.headers.get(HEADER_FORWARDED_FOR)).toBe('10.0.0.2');
  });
});

describe('stripUnsafeForwardedHeaders', () => {
  it('删掉所有可信头（即便 client 伪造）', () => {
    const headers: IncomingMessage['headers'] = {
      [HEADER_FORWARDED_INSTANCE]: 'spoof',
      [HEADER_FORWARDED_PATH]: '/spoof',
      [HEADER_FORWARDED_HOST]: 'spoof.example',
      [HEADER_FORWARDED_PROTO]: 'https',
      [HEADER_FORWARDED_FOR]: '1.2.3.4',
      'cookie': 'sid=abc',
    };
    stripUnsafeForwardedHeaders(headers);
    expect(headers[HEADER_FORWARDED_INSTANCE]).toBeUndefined();
    expect(headers[HEADER_FORWARDED_PATH]).toBeUndefined();
    expect(headers[HEADER_FORWARDED_HOST]).toBeUndefined();
    expect(headers[HEADER_FORWARDED_PROTO]).toBeUndefined();
    expect(headers[HEADER_FORWARDED_FOR]).toBeUndefined();
    // 其它头保留
    expect(headers['cookie']).toBe('sid=abc');
  });
});

describe('createProxyServer 错误处理', () => {
  it('HTTP 反代失败 → res.writeHead(502)', () => {
    let errorListener: ((...args: unknown[]) => void) | null = null;
    const fakeProxy = {
      web: vi.fn(),
      ws: vi.fn(),
      on(event: string, fn: (...args: unknown[]) => void) {
        if (event === 'error') errorListener = fn;
      },
      close: vi.fn(),
    };
    const fakeImpl = {
      createProxyServer: vi.fn().mockReturnValue(fakeProxy),
    } as never;
    createProxyServer({ httpProxyImpl: fakeImpl });

    const writeHead = vi.fn();
    const end = vi.fn();
    const fakeRes = {
      headersSent: false,
      writeHead,
      end,
    } as unknown as ServerResponse;

    expect(errorListener).not.toBeNull();
    errorListener!(new Error('econnrefused'), mockReq(), fakeRes);

    expect(writeHead).toHaveBeenCalledWith(
      502,
      expect.objectContaining({ 'content-type': expect.stringContaining('json') }),
    );
    expect(end).toHaveBeenCalled();
    const body = JSON.parse((end.mock.calls[0]![0] as string)) as {
      error: { code: string };
    };
    expect(body.error.code).toBe('BROKER_UPSTREAM_UNREACHABLE');
  });

  it('headersSent=true 不再写 502（避免 ERR_HTTP_HEADERS_SENT）', () => {
    let errorListener: ((...args: unknown[]) => void) | null = null;
    const fakeImpl = {
      createProxyServer: vi.fn().mockReturnValue({
        on(event: string, fn: (...args: unknown[]) => void) {
          if (event === 'error') errorListener = fn;
        },
      }),
    } as never;
    createProxyServer({ httpProxyImpl: fakeImpl });

    const writeHead = vi.fn();
    const end = vi.fn();
    errorListener!(new Error('mid-stream'), mockReq(), {
      headersSent: true,
      writeHead,
      end,
    });
    expect(writeHead).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('WS upgrade 失败（resOrSocket 是 socket，不是 ServerResponse）→ destroy', () => {
    let errorListener: ((...args: unknown[]) => void) | null = null;
    const fakeImpl = {
      createProxyServer: vi.fn().mockReturnValue({
        on(event: string, fn: (...args: unknown[]) => void) {
          if (event === 'error') errorListener = fn;
        },
      }),
    } as never;
    createProxyServer({ httpProxyImpl: fakeImpl });

    const destroy = vi.fn();
    const socket = { destroy }; // 没 writeHead，被识别为 socket
    errorListener!(new Error('econnrefused'), mockReq(), socket);
    expect(destroy).toHaveBeenCalled();
  });
});
