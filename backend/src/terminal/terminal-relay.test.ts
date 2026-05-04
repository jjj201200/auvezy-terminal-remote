/**
 * TerminalRelay 单测
 *
 * 因为 process.stdin / process.stdout 是单例难以 mock，
 * 这里采用"提取关键算法做纯函数测试"的方式，
 * 把双 Ctrl+C 检测和 Kitty 协议匹配作为可验证单元。
 *
 * raw mode 与 SIGWINCH 的真实行为留到端到端 smoke 验证。
 */

import { describe, it, expect } from 'vitest';

// 把私有判定逻辑作为可测的局部副本（保持与生产实现同步）
// 原实现在 terminal-relay.ts，这里复制以便单测——不引入循环导出复杂度

const KITTY_CTRL_C_RE = /\x1b\[99;5(?::(?:[12]))?(?:;\d+)*u/;
const CTRL_C_BYTE = 0x03;

function isCtrlC(s: string): boolean {
  if (s.length === 1 && s.charCodeAt(0) === CTRL_C_BYTE) return true;
  return KITTY_CTRL_C_RE.test(s);
}

describe('Ctrl+C 识别', () => {
  it('识别单字节 \\x03', () => {
    expect(isCtrlC('\x03')).toBe(true);
  });

  it('识别 Kitty 基础形式 \\x1b[99;5u', () => {
    expect(isCtrlC('\x1b[99;5u')).toBe(true);
  });

  it('识别 Kitty press 事件 \\x1b[99;5:1u', () => {
    expect(isCtrlC('\x1b[99;5:1u')).toBe(true);
  });

  it('识别 Kitty repeat 事件 \\x1b[99;5:2u', () => {
    expect(isCtrlC('\x1b[99;5:2u')).toBe(true);
  });

  it('不识别 Kitty release 事件 \\x1b[99;5:3u', () => {
    expect(isCtrlC('\x1b[99;5:3u')).toBe(false);
  });

  it('识别带文本占位 \\x1b[99;5;99u', () => {
    expect(isCtrlC('\x1b[99;5;99u')).toBe(true);
  });

  it('不识别普通字符', () => {
    expect(isCtrlC('a')).toBe(false);
    expect(isCtrlC('hello')).toBe(false);
    expect(isCtrlC('\x04')).toBe(false); // Ctrl+D
    expect(isCtrlC('\x1b')).toBe(false); // 单 ESC
  });

  it('不识别其它修饰符的 Kitty 序列', () => {
    expect(isCtrlC('\x1b[99;1u')).toBe(false); // 无修饰
    expect(isCtrlC('\x1b[99;3u')).toBe(false); // Alt
    expect(isCtrlC('\x1b[100;5u')).toBe(false); // 不是 c 键
  });
});

describe('双 Ctrl+C 时间窗判定', () => {
  // 模拟 handleStdin 里的判定逻辑
  function checkDouble(prev: number, now: number, windowMs = 500): boolean {
    return prev > 0 && now - prev <= windowMs;
  }

  it('窗口内的第二次 Ctrl+C 判定为双击', () => {
    expect(checkDouble(1000, 1499)).toBe(true);
    expect(checkDouble(1000, 1000)).toBe(true); // 边界
    expect(checkDouble(1000, 1500)).toBe(true); // 边界等于
  });

  it('窗口外的第二次不是双击', () => {
    expect(checkDouble(1000, 1501)).toBe(false);
    expect(checkDouble(1000, 5000)).toBe(false);
  });

  it('首次 Ctrl+C（prev=0）不算双击', () => {
    expect(checkDouble(0, 1000)).toBe(false);
  });
});

describe('TerminalRelay 集成（mock IPtyManager）', () => {
  it('start/stop 在非 TTY 环境下不抛错', async () => {
    const { TerminalRelay } = await import('./terminal-relay.js');
    const fakePty = {
      cols: 80,
      rows: 24,
      write: () => {},
      resize: () => {},
    };
    const relay = new TerminalRelay(fakePty);
    expect(() => {
      relay.start();
      relay.stop();
    }).not.toThrow();
  });

  it('stop 幂等', async () => {
    const { TerminalRelay } = await import('./terminal-relay.js');
    const fakePty = {
      cols: 80,
      rows: 24,
      write: () => {},
      resize: () => {},
    };
    const relay = new TerminalRelay(fakePty);
    relay.start();
    expect(() => {
      relay.stop();
      relay.stop();
      relay.stop();
    }).not.toThrow();
  });

  it('pauseResize / resumeResize 状态切换', async () => {
    const { TerminalRelay } = await import('./terminal-relay.js');
    const fakePty = {
      cols: 80,
      rows: 24,
      write: () => {},
      resize: () => {},
    };
    const relay = new TerminalRelay(fakePty);
    expect(() => {
      relay.pauseResize();
      relay.pauseResize(); // 幂等
      relay.resumeResize();
      relay.resumeResize(); // 幂等
    }).not.toThrow();
  });
});
