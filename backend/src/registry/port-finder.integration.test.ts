/**
 * port-finder 集成测试：真实 socket + 真实 listen
 *
 * 与单元测试的区别：单测注入 mock 的 probe / listen，验证逻辑分支；
 * 集成测试用真 net.Server / http.Server，验证 OS 层面的端口占用真的能被
 * bindAvailablePort 正确跳过。
 *
 * 复测前提：所有用例在 `127.0.0.1` 上做（不绑公网网卡），CI 上不会冲突。
 *
 * 用例覆盖：
 *  1. base / base+1 被占 → 拿到 base+2
 *  2. 两个 bindAvailablePort 并发抢同一 base → 互不踩踏（多实例并发场景）
 *  3. strict 模式下端口已占 → 立即抛 PORT_UNAVAILABLE
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { bindAvailablePort } from './port-finder.js';
import { ErrorCode } from '@otr/shared';

const HOST = '127.0.0.1';

/** 启一个 net 占位 server 占住指定端口，返回 close 函数 */
function occupy(port: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(port, HOST, () => {
      resolve(
        () =>
          new Promise<void>((r) => {
            srv.close(() => r());
          }),
      );
    });
  });
}

/** 让 OS 分配一个空闲端口；用于挑选互不冲突的"基准端口" */
function pickFreeBase(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (typeof addr !== 'object' || !addr) {
        srv.close();
        reject(new Error('no address'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

describe('bindAvailablePort（真实 socket）', () => {
  const cleanup: Array<() => Promise<void>> = [];
  const servers: HttpServer[] = [];

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (servers.length) {
      const s = servers.pop();
      if (s && s.listening) {
        await new Promise<void>((r) => s.close(() => r()));
      }
    }
  });

  it('base / base+1 被占 → 拿到 base+2', async () => {
    const base = await pickFreeBase();
    cleanup.push(await occupy(base));
    cleanup.push(await occupy(base + 1));

    const httpSrv = createHttpServer();
    servers.push(httpSrv);

    const r = await bindAvailablePort({
      preferred: base,
      host: HOST,
      server: httpSrv,
    });
    expect(r.port).toBe(base + 2);
    expect(httpSrv.listening).toBe(true);
  });

  it('两个并发 bindAvailablePort → 拿到不同端口（多实例并发抢端口场景）', async () => {
    const base = await pickFreeBase();

    const a = createHttpServer();
    const b = createHttpServer();
    servers.push(a, b);

    const [ra, rb] = await Promise.all([
      bindAvailablePort({ preferred: base, host: HOST, server: a }),
      bindAvailablePort({ preferred: base, host: HOST, server: b }),
    ]);

    // 两次都成功，且端口不重复
    expect(ra.port).not.toBe(rb.port);
    // 都监听上了
    expect(a.listening).toBe(true);
    expect(b.listening).toBe(true);
  });

  it('strict 模式 + 端口已占 → 抛 PORT_UNAVAILABLE，httpServer 不在 listening', async () => {
    const base = await pickFreeBase();
    cleanup.push(await occupy(base));

    const httpSrv = createHttpServer();
    servers.push(httpSrv);

    await expect(
      bindAvailablePort({
        preferred: base,
        host: HOST,
        server: httpSrv,
        strict: true,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PORT_UNAVAILABLE });

    expect(httpSrv.listening).toBe(false);
  });
});
