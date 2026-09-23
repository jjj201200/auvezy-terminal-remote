/**
 * useTextareaInputGuard 哨兵语义测试
 *
 * 0.18 起(手机退格修复):stream 模式 textarea 恒含 1 个 ZWSP 哨兵——
 * 空 textarea 上 WebKit/第三方输入法的退格不派发 beforeinput(无可删
 * 内容),哨兵让"每次退格都有内容可删",beforeinput 必触发 → \x7f 必发。
 *
 * 集成层用 jsdom + createRoot 挂真实 textarea,dispatch 原生事件;
 * hook 无 setState,不需 act。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  useTextareaInputGuard,
  STREAM_SENTINEL,
  stripSentinel,
  type InputGuardMode,
  type InputIntent,
} from './useTextareaInputGuard.js';

describe('stripSentinel(纯函数)', () => {
  it('剥离哨兵,其余不动', () => {
    expect(stripSentinel(STREAM_SENTINEL)).toBe('');
    expect(stripSentinel('a' + STREAM_SENTINEL)).toBe('a');
    expect(stripSentinel(STREAM_SENTINEL + 'bc')).toBe('bc');
    expect(stripSentinel('x' + STREAM_SENTINEL + 'y' + STREAM_SENTINEL)).toBe('xy');
    expect(stripSentinel('plain')).toBe('plain');
    expect(stripSentinel('')).toBe('');
  });
});

/** 挂一个使用 guard 的宿主 textarea,返回控制句柄 */
interface Harness {
  textarea: HTMLTextAreaElement;
  unmount(): void;
  getBuffer(): string;
  clear(): void;
}

function mountGuard(
  mode: InputGuardMode,
  onCommit: (intent: InputIntent) => void,
): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  function Host(): ReactElement {
    const elRef = useRef<HTMLTextAreaElement | null>(null);
    const composingRef = useRef(false);
    const api = useTextareaInputGuard(elRef, { mode, onCommit, composingRef });
    apiRef = api;
    return createElement('textarea', { ref: elRef, defaultValue: '' });
  }
  let apiRef: ReturnType<typeof useTextareaInputGuard>;

  // flushSync:React 18 concurrent 下 render 是异步的,同步拿 DOM 必须 flush
  flushSync(() => root.render(createElement(Host)));
  const textarea = container.querySelector('textarea')!;
  return {
    textarea,
    unmount: () => {
      root.unmount();
      container.remove();
    },
    getBuffer: () => apiRef.getBuffer(),
    clear: () => apiRef.clear(),
  };
}

/** dispatch beforeinput(InputEvent);jsdom 无 InputEvent 时退回 Event + 手挂属性 */
function dispatchBeforeInput(el: HTMLTextAreaElement, inputType: string, data?: string): void {
  const Ev = typeof InputEvent !== 'undefined' ? InputEvent : Event;
  const e = new Ev('beforeinput', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'inputType', { value: inputType });
  if (data !== undefined) Object.defineProperty(e, 'data', { value: data });
  el.dispatchEvent(e);
}

describe('useTextareaInputGuard - stream 哨兵语义', () => {
  let h: Harness;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    h?.unmount();
    vi.useRealTimers();
  });

  it('mount 后 textarea 即含哨兵(退格恒有内容可删)', () => {
    h = mountGuard('stream', () => {});
    expect(h.textarea.value).toBe(STREAM_SENTINEL);
  });

  it('空哨兵上退格:beforeinput(deleteContentBackward) → commit delete(1),哨兵写回', async () => {
    const onCommit = vi.fn();
    h = mountGuard('stream', onCommit);
    dispatchBeforeInput(h.textarea, 'deleteContentBackward');
    expect(onCommit).toHaveBeenCalledWith({ kind: 'delete', count: 1 }, expect.anything());
    // 微任务写回哨兵
    await Promise.resolve();
    expect(h.textarea.value).toBe(STREAM_SENTINEL);
  });

  it('输入路径:input 事件 + 值含哨兵 → 防抖后 commit 剥哨兵的 insert,textarea 重置哨兵', async () => {
    const onCommit = vi.fn();
    h = mountGuard('stream', onCommit);
    // 模拟浏览器插入:哨兵仍在位(光标在哨兵后插入 'a' → 哨兵+a)
    h.textarea.value = STREAM_SENTINEL + 'a';
    h.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80 + 5);
    expect(onCommit).toHaveBeenCalledWith({ kind: 'insert', text: 'a' }, expect.anything());
    expect(h.textarea.value).toBe(STREAM_SENTINEL); // commit 后重置哨兵
    expect(h.getBuffer()).toBe(STREAM_SENTINEL); // buffer truth = 哨兵
  });

  it('哨兵被删后的 diff 路径(防抖 flushDiff)也只 commit 用户语义删除', async () => {
    const onCommit = vi.fn();
    h = mountGuard('stream', onCommit);
    // 模拟退格只走了 input(无 beforeinput)路径:哨兵被浏览器删掉
    h.textarea.value = '';
    h.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80 + 5);
    expect(onCommit).toHaveBeenCalledWith({ kind: 'delete', count: 1 }, expect.anything());
    expect(h.textarea.value).toBe(STREAM_SENTINEL);
  });

  it('clear() 恢复哨兵(而非清空)', () => {
    h = mountGuard('stream', () => {});
    h.clear();
    expect(h.textarea.value).toBe(STREAM_SENTINEL);
    expect(h.getBuffer()).toBe(STREAM_SENTINEL);
  });

  it('字符插入即时通道:beforeinput(insertText) 同步 commit,不等防抖', async () => {
    const onCommit = vi.fn();
    h = mountGuard('stream', onCommit);
    dispatchBeforeInput(h.textarea, 'insertText', 'a');
    // 同步:此刻(未过 80ms 防抖)就应 commit——长按字符即时生效的关键
    expect(onCommit).toHaveBeenCalledWith({ kind: 'insert', text: 'a' }, expect.anything());
    // 微任务写回哨兵:随后 input 事件的防抖 diff 无差异,不双发
    await Promise.resolve();
    expect(h.textarea.value).toBe(STREAM_SENTINEL);
    h.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80 + 5);
    const inserts = onCommit.mock.calls.filter(([i]) => i.kind === 'insert');
    expect(inserts).toHaveLength(1);
  });

  it('长按字符连续插入:每键同步 commit(即时性)', () => {
    const onCommit = vi.fn();
    h = mountGuard('stream', onCommit);
    dispatchBeforeInput(h.textarea, 'insertText', 'a');
    dispatchBeforeInput(h.textarea, 'insertText', 'a');
    dispatchBeforeInput(h.textarea, 'insertText', 'a');
    const inserts = onCommit.mock.calls.filter(([i]) => i.kind === 'insert');
    expect(inserts).toHaveLength(3); // 不再攒到松手
  });
});

describe('useTextareaInputGuard - buffered 模式回归(哨兵不得泄漏)', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  it('buffered:mount 后 textarea 为空,clear() 清空(无哨兵)', () => {
    h = mountGuard('buffered', () => {});
    expect(h.textarea.value).toBe('');
    h.clear();
    expect(h.textarea.value).toBe('');
    expect(h.getBuffer()).toBe('');
  });

  it('buffered:普通输入 diff 不受哨兵函数影响', async () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    h = mountGuard('buffered', onCommit);
    h.textarea.value = 'abc';
    h.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80 + 5);
    expect(onCommit).toHaveBeenCalledWith({ kind: 'insert', text: 'abc' }, expect.anything());
    expect(h.getBuffer()).toBe('abc');
    vi.useRealTimers();
  });
});
