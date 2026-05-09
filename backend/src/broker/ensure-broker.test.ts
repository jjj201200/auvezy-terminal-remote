/**
 * ensureBroker 单测
 *
 * 关键点：
 *  - broker.json 已存在且当前进程 PID 活着 + probe 返 ok → 不 fork
 *  - broker.json 不存在 → 调用 spawnFn fork，再轮询到 broker.json 出现就返 ok
 *  - fork 后 startupTimeoutMs 内 broker.json 仍未出现 → 抛错（mock spawn 不写文件）
 *  - probe 失败 → 抛错
 *
 * 不真起子进程：用 spawnFn / fetchFn / now 注入。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureBroker } from './ensure-broker.js';
import { writeBrokerState } from './broker-state.js';

/** 极简 mock fetch 工厂 */
function mockFetch(behavior: 'ok' | 'fail' | 'bad-body'): typeof fetch {
  return (async () => {
    if (behavior === 'fail') throw new Error('econnrefused');
    if (behavior === 'bad-body') {
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ ok: true, role: 'broker', pid: 1, brokerVersion: '0.7.0' }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

/**
 * mock spawn：
 * - 立即返回 { pid }（pid 由 caller 指定）
 * - 可选副作用：**同步**写 broker.json，模拟 broker 子进程瞬间就绪
 *   （不用 setTimeout 异步，否则 vitest worker 退出时 pending timer
 *    会触发 ERR_IPC_CHANNEL_CLOSED）
 */
function makeMockSpawn(opts: {
  pid: number;
  /** 写 broker.json 副作用：undefined=不写；object=用此 state 同步写入 */
  writeStateAt?: string;
  state?: { pid: number; port: number; host: string; brokerVersion: string };
}): typeof import('node:child_process').spawn {
  return (() => {
    if (opts.writeStateAt && opts.state) {
      writeBrokerState({ ...opts.state, startedAt: Date.now() }, opts.writeStateAt);
    }
    return {
      pid: opts.pid,
      unref() {
        /* noop */
      },
    };
  }) as unknown as typeof import('node:child_process').spawn;
}

describe('ensureBroker', () => {
  let baseDir: string;
  let statePath: string;
  let lockDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'atr-ensure-broker-'));
    statePath = resolve(baseDir, 'broker.json');
    lockDir = resolve(baseDir, '.lock');
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('broker 已活着 → 不 fork，返回当前 state', async () => {
    // 用当前进程 PID 写一份 state，让 isBrokerAlive 一定为 true
    writeBrokerState(
      { pid: process.pid, port: 13000, host: '0.0.0.0', startedAt: 0, brokerVersion: '0.7.0' },
      statePath,
    );

    let spawnCalled = false;
    const r = await ensureBroker({
      cliJsPath: '/nonexistent/cli.js', // 不会被用到
      statePath,
      lockDir,
      fetchFn: mockFetch('ok'),
      spawnFn: ((..._args: unknown[]) => {
        spawnCalled = true;
        return { pid: 1, unref() {} } as unknown;
      }) as unknown as typeof import('node:child_process').spawn,
    });

    expect(spawnCalled).toBe(false);
    expect(r.forked).toBe(false);
    expect(r.state.pid).toBe(process.pid);
  });

  it('broker pid 活着但 health 不通 → fork', async () => {
    // 写 state 用 process.pid（活着），但 fetch 第一次失败
    writeBrokerState(
      { pid: process.pid, port: 13000, host: '0.0.0.0', startedAt: 0, brokerVersion: '0.6.x' },
      statePath,
    );

    let probeCount = 0;
    const failFirstThenOk: typeof fetch = (async () => {
      probeCount++;
      if (probeCount === 1) throw new Error('refused');
      return new Response(
        JSON.stringify({ ok: true, role: 'broker', pid: 1, brokerVersion: '0.7.0' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const r = await ensureBroker({
      cliJsPath: '/nonexistent/cli.js',
      statePath,
      lockDir,
      startupTimeoutMs: 2000,
      probeTimeoutMs: 500,
      fetchFn: failFirstThenOk,
      spawnFn: makeMockSpawn({
        pid: process.pid, // 让 isBrokerAlive 通过
        writeStateAt: statePath,
        state: { pid: process.pid, port: 13001, host: '0.0.0.0', brokerVersion: '0.7.0' },
      }),
    });

    expect(r.forked).toBe(true);
    expect(r.state.brokerVersion).toBe('0.7.0');
    expect(r.state.port).toBe(13001);
  });

  it('broker.json 不存在 → fork → 轮询到出现 → 返回', async () => {
    const r = await ensureBroker({
      cliJsPath: '/nonexistent/cli.js',
      statePath,
      lockDir,
      startupTimeoutMs: 3000,
      probeTimeoutMs: 500,
      fetchFn: mockFetch('ok'),
      spawnFn: makeMockSpawn({
        pid: process.pid,
        writeStateAt: statePath,
        state: { pid: process.pid, port: 13002, host: '0.0.0.0', brokerVersion: '0.7.0' },
      }),
    });
    expect(r.forked).toBe(true);
    expect(r.state.port).toBe(13002);
  });

  it('fork 后超时仍无 broker.json → 抛错', async () => {
    await expect(
      ensureBroker({
        cliJsPath: '/nonexistent/cli.js',
        statePath,
        lockDir,
        startupTimeoutMs: 300, // 短超时
        probeTimeoutMs: 100,
        fetchFn: mockFetch('ok'),
        spawnFn: makeMockSpawn({
          pid: process.pid,
          // 不写 broker.json，模拟 broker 一直不就绪
        }),
      }),
    ).rejects.toThrow(/未就绪/);
  });

  it('fork 后 broker.json 出现但 health probe 失败 → 抛错', async () => {
    await expect(
      ensureBroker({
        cliJsPath: '/nonexistent/cli.js',
        statePath,
        lockDir,
        startupTimeoutMs: 2000,
        probeTimeoutMs: 200,
        fetchFn: mockFetch('fail'),
        spawnFn: makeMockSpawn({
          pid: process.pid,
          writeStateAt: statePath,
          state: { pid: process.pid, port: 13003, host: '0.0.0.0', brokerVersion: '0.7.0' },
        }),
      }),
    ).rejects.toThrow(/health/);
  });

  it('fork 后 broker.json 出现但 body.ok=false → 抛错', async () => {
    await expect(
      ensureBroker({
        cliJsPath: '/nonexistent/cli.js',
        statePath,
        lockDir,
        startupTimeoutMs: 2000,
        probeTimeoutMs: 200,
        fetchFn: mockFetch('bad-body'),
        spawnFn: makeMockSpawn({
          pid: process.pid,
          writeStateAt: statePath,
          state: { pid: process.pid, port: 13004, host: '0.0.0.0', brokerVersion: '0.7.0' },
        }),
      }),
    ).rejects.toThrow(/health/);
  });

  it('broker.json 存在但损坏 → 当作不存在处理 → fork', async () => {
    writeFileSync(statePath, 'bad json {{{');
    const r = await ensureBroker({
      cliJsPath: '/nonexistent/cli.js',
      statePath,
      lockDir,
      startupTimeoutMs: 2000,
      probeTimeoutMs: 200,
      fetchFn: mockFetch('ok'),
      spawnFn: makeMockSpawn({
        pid: process.pid,
        writeStateAt: statePath,
        state: { pid: process.pid, port: 13005, host: '0.0.0.0', brokerVersion: '0.7.0' },
      }),
    });
    expect(r.forked).toBe(true);
  });
});
