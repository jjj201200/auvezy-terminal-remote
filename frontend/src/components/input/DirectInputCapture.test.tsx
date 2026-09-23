/**
 * DirectInputCapture 退格链路测试
 *
 * 手机退格修复(0.18)的两个组件侧要点:
 *  1. keydown Backspace → '\x7f' 兜底映射(发 keydown 的平台:Android/
 *     桌面硬件键盘;preventDefault 防 beforeinput 双发)
 *  2. 退格发送经 60ms 限速器:连按合并、单按即时、插入文本前保序 flush
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DirectInputCapture, controlKeyToSequence } from './DirectInputCapture.js';

describe('controlKeyToSequence - Backspace 兜底', () => {
  it('Backspace → \\x7f', () => {
    expect(controlKeyToSequence('Backspace', false, false, false)).toBe('\x7f');
  });

  it('既有映射回归:Delete/Enter/方向键不变', () => {
    expect(controlKeyToSequence('Delete', false, false, false)).toBe('\x1b[3~');
    expect(controlKeyToSequence('Enter', false, false, false)).toBe('\r');
    expect(controlKeyToSequence('ArrowUp', false, false, false)).toBe('\x1b[A');
    expect(controlKeyToSequence('a', true, false, false)).toBe('\x01');
    expect(controlKeyToSequence('a', false, false, false)).toBe(null);
  });
});

describe('DirectInputCapture - 退格限速与保序', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sent: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sent = [];
    flushSync(() =>
      root.render(
        createElement(DirectInputCapture, { onSend: (d: string) => sent.push(d) }),
      ),
    );
  });
  afterEach(() => {
    root.unmount();
    container.remove();
    vi.useRealTimers();
  });

  function keyDown(key: string): void {
    container
      .querySelector('textarea')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  it('单次 Backspace keydown 立即发一个 \\x7f', () => {
    keyDown('Backspace');
    expect(sent).toEqual(['\x7f']);
  });

  it('快速连按退格:限速到 60ms 窗口合并,数量守恒', async () => {
    keyDown('Backspace');
    keyDown('Backspace');
    keyDown('Backspace');
    expect(sent).toEqual(['\x7f']); // 首键立即,其余进 pending
    await vi.advanceTimersByTimeAsync(60 + 5);
    expect(sent).toEqual(['\x7f', '\x7f\x7f']); // 合并一条
  });

  it('退格后立刻输入文本:挂起的退格先于文本发出(保序)', async () => {
    keyDown('Backspace');
    keyDown('Backspace'); // pending
    // 模拟输入路径 commit insert(guard 80ms 防抖后的 onCommit)
    // 直接经由 beforeinput insertText → input 事件 → 防抖 commit
    const ta = container.querySelector('textarea')!;
    ta.value = ta.value + 'a';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80 + 5);
    // 顺序:\x7f(立即) → \x7f(flush 出的 pending) → 'a'
    expect(sent).toEqual(['\x7f', '\x7f', 'a']);
  });
});
