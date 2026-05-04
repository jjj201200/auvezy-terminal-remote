/**
 * instance-registry 单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InstanceRegistryManager,
  isPidAlive,
} from './instance-registry.js';
import type { InstanceInfo } from '@ocr/shared';

function fakeInfo(over: Partial<InstanceInfo> = {}): InstanceInfo {
  return {
    instanceId: 'id-' + Math.random().toString(36).slice(2, 8),
    name: 'demo',
    host: '127.0.0.1',
    port: 3000,
    pid: process.pid, // 自身 pid 总是 alive
    cwd: '/tmp',
    startedAt: new Date().toISOString(),
    ...over,
  };
}

describe('isPidAlive', () => {
  it('当前进程 pid → alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it('0/负数/非整数 → 否', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(1.5)).toBe(false);
  });
  it('一个不存在的高位 pid → 否', () => {
    expect(isPidAlive(2147483640)).toBe(false);
  });
});

describe('InstanceRegistryManager', () => {
  let baseDir: string;
  let mgr: InstanceRegistryManager;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-reg-'));
    mgr = new InstanceRegistryManager({ baseDir });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('文件不存在 → list 返回空', async () => {
    expect(await mgr.list()).toEqual([]);
  });

  it('register 后 list 含新实例', async () => {
    const info = fakeInfo({ name: 'a', port: 3001 });
    await mgr.register(info);
    const list = await mgr.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.instanceId).toBe(info.instanceId);
  });

  it('register 同 instanceId 替换（upsert）', async () => {
    const id = 'fixed';
    await mgr.register(fakeInfo({ instanceId: id, port: 1 }));
    await mgr.register(fakeInfo({ instanceId: id, port: 2 }));
    const list = await mgr.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.port).toBe(2);
  });

  it('unregister 删除指定 id', async () => {
    const a = fakeInfo({ name: 'a', port: 1 });
    const b = fakeInfo({ name: 'b', port: 2 });
    await mgr.register(a);
    await mgr.register(b);
    await mgr.unregister(a.instanceId);
    const list = await mgr.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('b');
  });

  it('list 自动剔除 pid 已不存活的项', async () => {
    // 先手动写一个含 dead pid 的注册表
    writeFileSync(
      mgr.filePath,
      JSON.stringify({
        version: 1,
        instances: [
          fakeInfo({ name: 'dead', pid: 2147483640 }),
          fakeInfo({ name: 'alive', pid: process.pid }),
        ],
      }),
    );
    const list = await mgr.list();
    expect(list.map((i) => i.name)).toEqual(['alive']);
    // 文件应该也被同步清理
    const onDisk = JSON.parse(readFileSync(mgr.filePath, 'utf-8'));
    expect(onDisk.instances).toHaveLength(1);
  });

  it('schema 不识别 → 视为空，不破坏', async () => {
    writeFileSync(mgr.filePath, JSON.stringify({ version: 99 }));
    expect(await mgr.list()).toEqual([]);
  });

  it('JSON 损坏 → 视为空，不抛错', async () => {
    writeFileSync(mgr.filePath, 'not json');
    expect(await mgr.list()).toEqual([]);
  });

  it('5 路并发 register 不丢失（race-free）', async () => {
    const infos = Array.from({ length: 5 }, (_, i) =>
      fakeInfo({ name: `n${i}`, port: 3000 + i }),
    );
    await Promise.all(infos.map((i) => mgr.register(i)));
    const list = await mgr.list();
    const ports = list.map((i) => i.port).sort((a, b) => a - b);
    expect(ports).toEqual([3000, 3001, 3002, 3003, 3004]);
  });
});
