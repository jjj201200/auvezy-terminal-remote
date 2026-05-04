/**
 * port-finder 单测
 */

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { findAvailablePort, probePort } from './port-finder.js';
import { InstanceError } from '../errors.js';
import { ErrorCode } from '@ocr/shared';

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
