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
import { PtyManager, stripParentSessionEnv } from './pty-manager.js';

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

    // 80 → 100 = 变宽 → double-pulse（先 cols-1 后 cols，间隔 50ms）
    // 等 200ms 让两个脉冲都跑完
    mgr.resize(100, 30);
    await new Promise((r) => setTimeout(r, 200));
    expect(resizeCount).toBe(1); // double-pulse 只在最终态 emit 一次
    expect(mgr.cols).toBe(100);
    expect(mgr.rows).toBe(30);

    mgr.resize(100, 30); // 又同尺寸——再跳过
    await new Promise((r) => setTimeout(r, 50));
    expect(resizeCount).toBe(1);
  });

  it('resize 缩窄不走 double-pulse（单次 resize）', async () => {
    mgr.spawn({ command: 'cat', cols: 100, rows: 30 });

    let resizeCount = 0;
    mgr.on('resize', () => {
      resizeCount++;
    });

    // 100 → 80 = 变窄 → 单次 resize（Ink 已经会自己整屏重画）
    mgr.resize(80, 24);
    // 应该立即更新，不需要 50ms 延迟
    await new Promise((r) => setTimeout(r, 30));
    expect(resizeCount).toBe(1);
    expect(mgr.cols).toBe(80);
    expect(mgr.rows).toBe(24);
  });

  it('alt-screen 扫描：onData 收到 1049h/l / 1047h/l / 47h/l 维护 inAltScreen', () => {
    // 直接调私有方法（test 范围用 any 强转访问）
    const internal = mgr as unknown as {
      scanAltScreenToggle: (data: string) => void;
    };
    expect(mgr.inAltScreen).toBe(false);

    internal.scanAltScreenToggle('\x1b[?1049h');
    expect(mgr.inAltScreen).toBe(true);

    internal.scanAltScreenToggle('\x1b[?1049l');
    expect(mgr.inAltScreen).toBe(false);

    // 老序列也能识别
    internal.scanAltScreenToggle('\x1b[?47h');
    expect(mgr.inAltScreen).toBe(true);

    internal.scanAltScreenToggle('\x1b[?1047l');
    expect(mgr.inAltScreen).toBe(false);

    // 同 chunk 内多次切换：按出现顺序更新，最后状态生效
    internal.scanAltScreenToggle('\x1b[?1049h some output \x1b[?1049l end');
    expect(mgr.inAltScreen).toBe(false);

    // 不含切换序列的普通输出不影响状态
    internal.scanAltScreenToggle('\x1b[?1049h'); // 进入
    internal.scanAltScreenToggle('hello world\r\n');
    expect(mgr.inAltScreen).toBe(true);
  });

  it('alt-screen 内 resize 不走 double-pulse（vim/htop 自己会整屏重画）', async () => {
    mgr.spawn({ command: 'cat', cols: 80, rows: 24 });

    // 直接置 alt-screen 标志（绕过 PTY echo 的不确定性）
    const internal = mgr as unknown as { _inAltScreen: boolean };
    internal._inAltScreen = true;
    expect(mgr.inAltScreen).toBe(true);

    let resizeCount = 0;
    mgr.on('resize', () => {
      resizeCount++;
    });

    // alt-screen 内变宽：应该立即单次 resize，不延迟
    mgr.resize(100, 30);
    await new Promise((r) => setTimeout(r, 30));
    expect(resizeCount).toBe(1);
    expect(mgr.cols).toBe(100);
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

describe('stripParentSessionEnv（父会话标记剥离）', () => {
  it('剥掉 Claude Code 父会话运行时标记', () => {
    const out = stripParentSessionEnv({
      PATH: '/usr/bin',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'parent-id',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
      CLAUDE_CODE_MESSAGING_SOCKET: '/run/x.sock',
      CLAUDE_CODE_SSE_PORT: '64048',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/opt/claude',
    });
    expect(out['PATH']).toBe('/usr/bin');
    expect('CLAUDE_CODE_CHILD_SESSION' in out).toBe(false);
    expect('CLAUDE_CODE_SESSION_ID' in out).toBe(false);
    expect('CLAUDE_CODE_MESSAGING_TOKEN' in out).toBe(false);
    expect('CLAUDE_CODE_MESSAGING_SOCKET' in out).toBe(false);
    expect('CLAUDE_CODE_SSE_PORT' in out).toBe(false);
    expect('CLAUDE_CODE_ENTRYPOINT' in out).toBe(false);
    expect('CLAUDE_CODE_EXECPATH' in out).toBe(false);
  });

  it('保留用户显式配置类变量', () => {
    const out = stripParentSessionEnv({
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      CLAUDE_CODE_NO_FLICKER: '1',
    });
    expect(out['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE']).toBe('1');
    expect(out['CLAUDE_CODE_NO_FLICKER']).toBe('1');
  });
});
