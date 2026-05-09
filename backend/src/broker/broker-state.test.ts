/**
 * broker-state 单测
 *
 * 关键点：
 *  - readBrokerState：不存在 / 损坏 / schema 版本不对 → null（不抛）
 *  - writeBrokerState：写完能读回来；权限 0o600
 *  - clearBrokerState：幂等
 *  - isBrokerAlive：当前进程 PID → 活；不存在 PID → 死
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readBrokerState,
  writeBrokerState,
  clearBrokerState,
  isBrokerAlive,
  type BrokerState,
} from './broker-state.js';

describe('broker-state', () => {
  let baseDir: string;
  let path: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-broker-state-'));
    path = resolve(baseDir, 'broker.json');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('文件不存在 → null', () => {
    expect(readBrokerState(path)).toBeNull();
  });

  it('write + read 往返一致', () => {
    writeBrokerState(
      {
        pid: 12345,
        port: 3000,
        host: '0.0.0.0',
        startedAt: 1715200000000,
        brokerVersion: '0.7.0',
      },
      path,
    );
    const state = readBrokerState(path);
    expect(state).toEqual({
      version: 1,
      pid: 12345,
      port: 3000,
      host: '0.0.0.0',
      startedAt: 1715200000000,
      brokerVersion: '0.7.0',
    });
  });

  it('persist 后文件权限 0o600', () => {
    writeBrokerState(
      { pid: 1, port: 3000, host: '0.0.0.0', startedAt: 0, brokerVersion: '0.7.0' },
      path,
    );
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('write 时父目录不存在会自动创建', () => {
    const nested = resolve(baseDir, 'a', 'b', 'broker.json');
    writeBrokerState(
      { pid: 1, port: 3000, host: '0.0.0.0', startedAt: 0, brokerVersion: '0.7.0' },
      nested,
    );
    expect(existsSync(nested)).toBe(true);
  });

  it('损坏 JSON → null', () => {
    writeFileSync(path, 'not json {{{', 'utf-8');
    expect(readBrokerState(path)).toBeNull();
  });

  it('schema 版本不匹配 → null', () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 999, pid: 1, port: 3000, host: '0.0.0.0', startedAt: 0, brokerVersion: '0.7.0' }),
      'utf-8',
    );
    expect(readBrokerState(path)).toBeNull();
  });

  it('字段缺失 → null', () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 1, pid: 1, port: 3000 }), // 缺 host / startedAt / brokerVersion
      'utf-8',
    );
    expect(readBrokerState(path)).toBeNull();
  });

  it('clearBrokerState 幂等', () => {
    writeBrokerState(
      { pid: 1, port: 3000, host: '0.0.0.0', startedAt: 0, brokerVersion: '0.7.0' },
      path,
    );
    clearBrokerState(path);
    expect(readBrokerState(path)).toBeNull();
    // 再删一次不抛
    clearBrokerState(path);
  });

  it('isBrokerAlive：null state → false', () => {
    expect(isBrokerAlive(null)).toBe(false);
  });

  it('isBrokerAlive：当前进程 PID → true', () => {
    const state: BrokerState = {
      version: 1,
      pid: process.pid,
      port: 3000,
      host: '0.0.0.0',
      startedAt: 0,
      brokerVersion: '0.7.0',
    };
    expect(isBrokerAlive(state)).toBe(true);
  });

  it('isBrokerAlive：肯定不存在的 PID → false', () => {
    // 选一个范围内但极不可能存在的 pid（系统 max_pid 默认 4194304；
    // 取 4_000_000 通常未被分配过）
    const ghostPid = 4_000_000;
    let probeAlive = true;
    try {
      process.kill(ghostPid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') probeAlive = false;
    }
    if (probeAlive) {
      // 极少数 CI 环境可能真分配到这个 pid，此用例就跳过
      return;
    }
    const state: BrokerState = {
      version: 1,
      pid: ghostPid,
      port: 3000,
      host: '0.0.0.0',
      startedAt: 0,
      brokerVersion: '0.7.0',
    };
    expect(isBrokerAlive(state)).toBe(false);
  });
});
