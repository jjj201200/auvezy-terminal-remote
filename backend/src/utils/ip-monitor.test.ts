/**
 * IpMonitor 单测
 */

import { describe, it, expect } from 'vitest';
import { IpMonitor, type IpChangeEvent } from './ip-monitor.js';

describe('IpMonitor', () => {
  it('IP 不变时不触发', () => {
    const mon = new IpMonitor({
      initialIp: '192.168.1.10',
      detect: () => '192.168.1.10',
      stabilityThreshold: 2,
    });
    let fired = 0;
    mon.onChange(() => fired++);
    mon.tick();
    mon.tick();
    expect(fired).toBe(0);
  });

  it('单次新 IP 不触发（未到 stability）', () => {
    const mon = new IpMonitor({
      initialIp: '192.168.1.10',
      detect: () => '192.168.1.20',
      stabilityThreshold: 3,
    });
    let fired = 0;
    mon.onChange(() => fired++);
    mon.tick();
    expect(fired).toBe(0);
  });

  it('连续 N 次同一新 IP → 触发', () => {
    let mock = '192.168.1.20';
    const mon = new IpMonitor({
      initialIp: '192.168.1.10',
      detect: () => mock,
      stabilityThreshold: 3,
    });
    const events: IpChangeEvent[] = [];
    mon.onChange((e) => events.push(e));

    mon.tick(); // count=1
    mon.tick(); // count=2
    expect(events).toHaveLength(0);
    mon.tick(); // count=3 → 触发
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ oldIp: '192.168.1.10', newIp: '192.168.1.20' });
    expect(mon.current).toBe('192.168.1.20');
  });

  it('抖动（A B A）不触发', () => {
    const sequence = ['192.168.1.20', '192.168.1.30', '192.168.1.20'];
    let i = 0;
    const mon = new IpMonitor({
      initialIp: '192.168.1.10',
      detect: () => sequence[i++]!,
      stabilityThreshold: 2,
    });
    let fired = 0;
    mon.onChange(() => fired++);

    mon.tick(); // candidate=20, count=1
    mon.tick(); // candidate=30, count=1（重置）
    mon.tick(); // candidate=20, count=1（再重置）
    expect(fired).toBe(0);
  });

  it('稳定后再变化又触发', () => {
    const sequence = ['B', 'B', 'C', 'C', 'C'];
    let i = 0;
    const mon = new IpMonitor({
      initialIp: 'A',
      detect: () => sequence[i++]!,
      stabilityThreshold: 2,
    });
    const events: IpChangeEvent[] = [];
    mon.onChange((e) => events.push(e));

    mon.tick(); // B count=1
    mon.tick(); // B count=2 → A→B 触发
    mon.tick(); // C count=1
    mon.tick(); // C count=2 → B→C 触发
    mon.tick(); // C 已 current，不触发
    expect(events).toEqual([
      { oldIp: 'A', newIp: 'B' },
      { oldIp: 'B', newIp: 'C' },
    ]);
  });

  it('detect 抛错 → 静默忽略不触发', () => {
    const mon = new IpMonitor({
      initialIp: 'A',
      detect: () => {
        throw new Error('boom');
      },
      stabilityThreshold: 1,
    });
    let fired = 0;
    mon.onChange(() => fired++);
    expect(() => mon.tick()).not.toThrow();
    expect(fired).toBe(0);
  });

  it('start/stop 不会泄漏 timer（手动 stop 后 tick 不再被自动调）', async () => {
    let calls = 0;
    const mon = new IpMonitor({
      initialIp: 'A',
      detect: () => {
        calls++;
        return 'A';
      },
      intervalMs: 50,
      stabilityThreshold: 2,
    });
    mon.start();
    await new Promise((r) => setTimeout(r, 130));
    mon.stop();
    const stopped = calls;
    await new Promise((r) => setTimeout(r, 100));
    // stop 后不再增加
    expect(calls).toBe(stopped);
    expect(stopped).toBeGreaterThanOrEqual(2);
  });
});
