/**
 * port-finder 单测
 */

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { bindAvailablePort, findAvailablePort, probePort } from './port-finder.js';
import { InstanceError } from '../errors.js';
import { ErrorCode } from '@auvezy/terminal-remote-shared';

describe('probePort', () => {
  it('未占用端口 → true', async () => {
    // 用 0 让 OS 分配后立即 close 拿一个高位端口号，再探测
    // 注意：close 后 OS 不会立即释放绑定，所以我们用一个大概率空闲的高位端口
    expect(await probePort(45123, '127.0.0.1')).toBe(true);
  });

  it('被占用端口 → false', async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const addr = srv.address();
    if (typeof addr !== 'object' || !addr) {
      srv.close();
      throw new Error('no address');
    }
    const taken = addr.port;
    expect(await probePort(taken, '127.0.0.1')).toBe(false);
    await new Promise<void>((r) => srv.close(() => r()));
  });
});

describe('findAvailablePort', () => {
  it('preferred 可用 → 直接返回', async () => {
    const r = await findAvailablePort({
      preferred: 7000,
      probe: async (p) => p === 7000,
    });
    expect(r).toBe(7000);
  });

  it('preferred 被占 → 递增到 +2', async () => {
    const r = await findAvailablePort({
      preferred: 8000,
      probe: async (p) => p === 8002,
    });
    expect(r).toBe(8002);
  });

  it('全部失败 → InstanceError(PORT_UNAVAILABLE)', async () => {
    await expect(
      findAvailablePort({
        preferred: 9000,
        maxAttempts: 3,
        probe: async () => false,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PORT_UNAVAILABLE });
  });

  it('递增到 65535 上限即停止', async () => {
    await expect(
      findAvailablePort({
        preferred: 65534,
        maxAttempts: 10,
        probe: async () => false,
      }),
    ).rejects.toBeInstanceOf(InstanceError);
  });
});

describe('bindAvailablePort（注入 probe + listen）', () => {
  // 测试用占位 server（不会被真实 listen，listen 函数被注入 mock）
  const fakeServer = createHttpServer();

  it('preferred 可用 → 一次成功', async () => {
    const calls: number[] = [];
    const r = await bindAvailablePort({
      preferred: 7000,
      host: '0.0.0.0',
      server: fakeServer,
      probe: async (p) => p === 7000,
      listen: async (_s, p) => {
        calls.push(p);
      },
    });
    expect(r.port).toBe(7000);
    expect(calls).toEqual([7000]);
  });

  it('probe 失败递增 → 选下一个', async () => {
    const r = await bindAvailablePort({
      preferred: 8000,
      host: '0.0.0.0',
      server: fakeServer,
      probe: async (p) => p === 8002,
      listen: async () => {},
    });
    expect(r.port).toBe(8002);
  });

  it('TOCTOU：probe 通过但 listen 撞 EADDRINUSE → 自动跳下一个', async () => {
    const listenCalls: number[] = [];
    const r = await bindAvailablePort({
      preferred: 8500,
      host: '0.0.0.0',
      server: fakeServer,
      probe: async () => true, // probe 全部通过
      listen: async (_s, p) => {
        listenCalls.push(p);
        if (p === 8500) {
          // 模拟 OS 抛 EADDRINUSE
          const err = new Error('listen EADDRINUSE') as NodeJS.ErrnoException;
          err.code = 'EADDRINUSE';
          throw err;
        }
        // 8501 成功
      },
    });
    expect(r.port).toBe(8501);
    expect(listenCalls).toEqual([8500, 8501]);
  });

  it('listen 抛非 EADDRINUSE 错误 → 直接外抛，不递增', async () => {
    const eacces = new Error('EACCES root only') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';
    await expect(
      bindAvailablePort({
        preferred: 80,
        host: '0.0.0.0',
        server: fakeServer,
        probe: async () => true,
        listen: async () => {
          throw eacces;
        },
      }),
    ).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('strict 模式：preferred probe 失败 → 立即抛 PORT_UNAVAILABLE，不递增', async () => {
    const probed: number[] = [];
    await expect(
      bindAvailablePort({
        preferred: 9000,
        host: '0.0.0.0',
        server: fakeServer,
        strict: true,
        probe: async (p) => {
          probed.push(p);
          return false;
        },
        listen: async () => {},
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PORT_UNAVAILABLE });
    expect(probed).toEqual([9000]); // 只试一次
  });

  it('strict 模式：probe 通过但 listen 撞 EADDRINUSE → 立即抛，不跳', async () => {
    const listened: number[] = [];
    await expect(
      bindAvailablePort({
        preferred: 9100,
        host: '0.0.0.0',
        server: fakeServer,
        strict: true,
        probe: async () => true,
        listen: async (_s, p) => {
          listened.push(p);
          const err = new Error('busy') as NodeJS.ErrnoException;
          err.code = 'EADDRINUSE';
          throw err;
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PORT_UNAVAILABLE });
    expect(listened).toEqual([9100]);
  });

  it('全部 maxAttempts 都失败 → 抛 PORT_UNAVAILABLE 并提示最后端口', async () => {
    await expect(
      bindAvailablePort({
        preferred: 9500,
        host: '0.0.0.0',
        server: fakeServer,
        maxAttempts: 3,
        probe: async () => false,
        listen: async () => {},
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PORT_UNAVAILABLE });
  });

  it('递增到 65535 上限即停止', async () => {
    await expect(
      bindAvailablePort({
        preferred: 65534,
        host: '0.0.0.0',
        server: fakeServer,
        maxAttempts: 10,
        probe: async () => false,
        listen: async () => {},
      }),
    ).rejects.toBeInstanceOf(InstanceError);
  });
});
