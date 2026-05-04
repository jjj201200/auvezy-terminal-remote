/**
 * PtyManager 单测
 *
 * 用 'cat' 命令（POSIX 上几乎一定存在）作为真实 PTY 子进程，
 * 验证 spawn / write / resize / destroy 的行为。
 *
 * cat 默认从 stdin 读、写到 stdout，是测试 PTY 透传的理想替代品。
 *
 * 不在 Windows 上跑（cat 不普及）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PtyManager } from './pty-manager.js';

describe('PtyManager', () => {
  let mgr: PtyManager;

  beforeEach(() => {
    mgr = new PtyManager();
  });

  afterEach(() => {
    mgr.destroy();
  });

  it('初始 cols/rows 是默认值', () => {
    expect(mgr.cols).toBe(80);
    expect(mgr.rows).toBe(24);
    expect(mgr.exited).toBe(false);
  });

  it('spawn 后 cols/rows 更新为传入值', () => {
    mgr.spawn({ command: 'cat', cols: 120, rows: 40 });
    expect(mgr.cols).toBe(120);
    expect(mgr.rows).toBe(40);
  });

  it('spawn 后能收到 data 事件', async () => {
    mgr.spawn({ command: 'cat' });

    const received = await new Promise<string>((resolve) => {
      mgr.once('data', (data: string) => resolve(data));
      // cat 在 PTY 模式下会 echo 输入
      mgr.write('hello\n');
    });

    expect(received).toContain('hello');
  });

  it('重复 spawn 抛出 PtyError', () => {
    mgr.spawn({ command: 'cat' });
    expect(() => mgr.spawn({ command: 'cat' })).toThrow();
  });

  it('resize 同尺寸跳过（不 emit resize 事件）', async () => {
    mgr.spawn({ command: 'cat', cols: 80, rows: 24 });

    let resizeCount = 0;
    mgr.on('resize', () => {
      resizeCount++;
    });

    mgr.resize(80, 24); // 同尺寸——应该跳过
    await new Promise((r) => setTimeout(r, 50));
    expect(resizeCount).toBe(0);

    mgr.resize(100, 30); // 不同尺寸——应该触发
    await new Promise((r) => setTimeout(r, 50));
    expect(resizeCount).toBe(1);
    expect(mgr.cols).toBe(100);
    expect(mgr.rows).toBe(30);

    mgr.resize(100, 30); // 又同尺寸——再跳过
    await new Promise((r) => setTimeout(r, 50));
    expect(resizeCount).toBe(1);
  });

  it('未 spawn 直接 write 不抛错（静默丢弃）', () => {
    expect(() => mgr.write('foo')).not.toThrow();
  });

  it('未 spawn 直接 resize 不抛错', () => {
    expect(() => mgr.resize(100, 30)).not.toThrow();
  });

  it('destroy 后 exited=true 且后续操作安全', async () => {
    mgr.spawn({ command: 'cat' });

    const exitPromise = new Promise<number>((resolve) => {
      mgr.once('exit', (code: number) => resolve(code));
    });

    mgr.destroy();
    await exitPromise;

    expect(mgr.exited).toBe(true);
    expect(() => mgr.write('foo')).not.toThrow();
    expect(() => mgr.resize(100, 30)).not.toThrow();
  });

  it('destroy 幂等', () => {
    mgr.spawn({ command: 'cat' });
    expect(() => {
      mgr.destroy();
      mgr.destroy();
      mgr.destroy();
    }).not.toThrow();
  });

  it('spawn 不存在的命令时进程会非 0 退出', async () => {
    // node-pty 不会因找不到命令而 emit error；
    // 它会成功创建 PTY，但子进程立即异常退出
    const exitPromise = new Promise<number>((resolve) => {
      mgr.once('exit', (code: number) => resolve(code));
    });

    mgr.spawn({ command: '/nonexistent/binary/xyz' });
    const code = await exitPromise;
    expect(code).not.toBe(0);
  }, 10_000);
});
