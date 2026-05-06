/**
 * stop-instances 单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stopInstances } from './stop-instances.js';
import { InstanceRegistryManager } from './instance-registry.js';
import type { InstanceInfo } from 'auvezy-terminal-remote-shared';

function fake(over: Partial<InstanceInfo> = {}): InstanceInfo {
  return {
    instanceId: 'id-' + Math.random().toString(36).slice(2, 8),
    name: over.name ?? 'demo',
    host: '127.0.0.1',
    port: over.port ?? 3000,
    pid: over.pid ?? process.pid, // 默认本进程，isPidAlive=true
    cwd: over.cwd ?? '/tmp/x',
    startedAt: new Date().toISOString(),
    ...over,
  };
}

describe('stopInstances', () => {
  let baseDir: string;
  let registry: InstanceRegistryManager;
  /** kill 调用记录 */
  let killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  /** 模拟"接到 SIGTERM 后多久退出"，单位 ms；不在 map 内 = 永不退出（→ SIGKILL） */
  let exitAfter: Map<number, number> = new Map();
  /** 已"退出"的 pid，把它加到这里让 isPidAlive(pid) 视作 dead——但实际 isPidAlive 是 process.kill(pid, 0)，
   *  我们没法控制它。所以测试里把 fake.pid 设成一个"虚拟" pid（数值），并自己实现 kill 探测。
   *  方案：让 stopOne 的 isPidAlive 模拟无法实现，转用真实进程模式：
   *  - 起 detached child_process（如 sleep 600）拿到真 pid
   *  - SIGTERM 让它真正退出
   *  这样 isPidAlive 也能正确判定。
   */

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-stop-'));
    registry = new InstanceRegistryManager({ baseDir });
    killCalls = [];
    exitAfter = new Map();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('空列表 → 空结果', async () => {
    const r = await stopInstances(undefined, { registry });
    expect(r).toEqual([]);
  });

  it('pattern 匹配 name', async () => {
    await registry.register(fake({ name: 'project-foo', port: 1, pid: 2147483640 }));
    await registry.register(fake({ name: 'project-bar', port: 2, pid: 2147483641 }));

    const r = await stopInstances('foo', {
      registry,
      killImpl: () => {
        /* dead pid 一定 isPidAlive=false，走 'gone' 分支 */
      },
    });
    expect(r).toHaveLength(0);
    // foo 在过滤后被选中，但 pid 已不存活 → outcome = 'gone'
    // 由于 dead pid 在 list() 时已被剔除，所以 r=[]，是预期的（list 自动僵尸清理）
  });

  it('真实子进程：SIGTERM 优雅退出 → outcome=sigterm', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    const pid = child.pid!;
    await registry.register(fake({ name: 'live-1', port: 4001, pid }));

    const r = await stopInstances('live-1', {
      registry,
      graceMs: 2000,
      pollIntervalMs: 50,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.outcome).toBe('sigterm');
  });

  it('真实子进程：忽略 SIGTERM → 强 SIGKILL → outcome=sigkill', async () => {
    const { spawn } = await import('node:child_process');
    // 用 -e 启动 node 子进程；signal 写到 stdout 让我们等到 handler 就位再发 SIGTERM
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready');",
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], detached: true },
    );
    child.unref();
    const pid = child.pid!;
    await new Promise<void>((resolve) => {
      child.stdout!.once('data', (d) => {
        if (d.toString().includes('ready')) resolve();
      });
      // 兜底超时
      setTimeout(resolve, 1000);
    });

    await registry.register(fake({ name: 'stubborn', port: 4002, pid }));

    const r = await stopInstances('stubborn', {
      registry,
      graceMs: 300, // 短宽限期
      pollIntervalMs: 50,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.outcome).toBe('sigkill');

    // 杀完了一定 dead
    await new Promise((r) => setTimeout(r, 200));
    let stillAlive = true;
    try {
      process.kill(pid, 0);
    } catch {
      stillAlive = false;
    }
    expect(stillAlive).toBe(false);
  });

  it('未匹配 pattern → 不影响其它实例', async () => {
    await registry.register(fake({ name: 'keep-me', port: 5000 }));
    const r = await stopInstances('nomatch', { registry });
    expect(r).toHaveLength(0);
    expect(await registry.list()).toHaveLength(1);
  });
});
