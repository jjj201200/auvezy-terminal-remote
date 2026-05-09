/**
 * ModalStack 行为测试
 *
 * 不依赖 Sheet 真实渲染（Radix / vaul 在 happy-dom 里不易跑），
 * 用 mock render 函数 + 直接观察 stack 状态变化来验证：
 *  - push / replace / pop / popTo / dismiss 语义
 *  - 同 kind 互斥（push 同 kind 会自动 replace 栈顶）
 *  - onClosed 回调时机
 *  - 嵌套层级 z-index data attr 正确
 */

import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  ModalStackProvider,
  useModalStack,
} from './ModalStack.js';
import type { ModalStackHandle } from './types.js';
import { useEffect, useRef } from 'react';

// ─────────────────────── 测试辅助 ───────────────────────

function HandleProbe({ onReady }: { onReady: (h: ModalStackHandle) => void }) {
  const handle = useModalStack();
  const calledRef = useRef(false);
  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;
    onReady(handle);
  }, [handle, onReady]);
  return null;
}

function setup(): { handle: ModalStackHandle; container: HTMLElement } {
  let captured!: ModalStackHandle;
  const result = render(
    <ModalStackProvider>
      <HandleProbe onReady={(h) => (captured = h)} />
    </ModalStackProvider>,
  );
  return { handle: captured, container: result.container };
}

const dummyRender = (label: string) => () => <div data-testid={`modal-${label}`}>{label}</div>;

// ─────────────────────── 测试 ───────────────────────

describe('ModalStack push/pop', () => {
  it('push 推一层；pop 关闭', () => {
    const { handle, container } = setup();
    let id = '';
    act(() => {
      id = handle.push({ render: dummyRender('a') });
    });
    expect(handle.depth()).toBe(1);
    expect(container.querySelector('[data-testid="modal-a"]')).toBeTruthy();
    act(() => handle.pop(id));
    expect(handle.depth()).toBe(0);
    expect(container.querySelector('[data-testid="modal-a"]')).toBeNull();
  });

  it('多层嵌套：push A → push B → pop B 只关 B', () => {
    const { handle, container } = setup();
    let idA = '';
    let idB = '';
    act(() => {
      idA = handle.push({ render: dummyRender('a') });
      idB = handle.push({ render: dummyRender('b') });
    });
    expect(handle.depth()).toBe(2);
    expect(container.querySelector('[data-testid="modal-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="modal-b"]')).toBeTruthy();
    act(() => handle.pop(idB));
    expect(handle.depth()).toBe(1);
    expect(container.querySelector('[data-testid="modal-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="modal-b"]')).toBeNull();
    // 防止 unused 警告
    void idA;
  });

  it('pop 中间层 → 同时关掉它之上的所有层（LIFO）', () => {
    const { handle, container } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
      handle.push({ render: dummyRender('c') });
    });
    expect(handle.depth()).toBe(3);
    act(() => handle.pop(idA));
    expect(handle.depth()).toBe(0);
    expect(container.querySelector('[data-testid="modal-a"]')).toBeNull();
    expect(container.querySelector('[data-testid="modal-b"]')).toBeNull();
    expect(container.querySelector('[data-testid="modal-c"]')).toBeNull();
  });
});

describe('ModalStack 同 kind 互斥', () => {
  it('push 同 kind → 替换栈顶（深度不增加）', () => {
    const { handle, container } = setup();
    act(() => {
      handle.push({ kind: 'settings', render: dummyRender('s1') });
    });
    expect(handle.depth()).toBe(1);
    act(() => {
      handle.push({ kind: 'settings', render: dummyRender('s2') });
    });
    expect(handle.depth()).toBe(1);
    expect(container.querySelector('[data-testid="modal-s1"]')).toBeNull();
    expect(container.querySelector('[data-testid="modal-s2"]')).toBeTruthy();
  });

  it('push 不同 kind → 嵌套', () => {
    const { handle } = setup();
    act(() => {
      handle.push({ kind: 'settings', render: dummyRender('a') });
      handle.push({ kind: 'create-instance', render: dummyRender('b') });
    });
    expect(handle.depth()).toBe(2);
  });

  it('无 kind → 总是嵌套（用于 confirm 的可叠加场景）', () => {
    const { handle } = setup();
    act(() => {
      handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
      handle.push({ render: dummyRender('c') });
    });
    expect(handle.depth()).toBe(3);
  });
});

describe('ModalStack onClosed 回调', () => {
  it('pop 触发 onClosed', () => {
    const { handle } = setup();
    let closed = false;
    let id = '';
    act(() => {
      id = handle.push({ render: dummyRender('a'), onClosed: () => (closed = true) });
    });
    act(() => handle.pop(id));
    expect(closed).toBe(true);
  });

  it('replace 触发被替换 entry 的 onClosed', () => {
    const { handle } = setup();
    let closed1 = false;
    act(() => {
      handle.push({ render: dummyRender('a'), onClosed: () => (closed1 = true) });
    });
    act(() => {
      handle.replace({ render: dummyRender('b') });
    });
    expect(closed1).toBe(true);
    expect(handle.depth()).toBe(1);
  });

  it('dismiss 触发所有 onClosed', () => {
    const { handle } = setup();
    const closed: string[] = [];
    act(() => {
      handle.push({ render: dummyRender('a'), onClosed: () => closed.push('a') });
      handle.push({ render: dummyRender('b'), onClosed: () => closed.push('b') });
    });
    act(() => handle.dismiss());
    expect(closed.sort()).toEqual(['a', 'b']);
    expect(handle.depth()).toBe(0);
  });

  it('同 kind 互斥替换 → 触发被挤掉 entry 的 onClosed', () => {
    const { handle } = setup();
    let closed = false;
    act(() => {
      handle.push({
        kind: 'settings',
        render: dummyRender('s1'),
        onClosed: () => (closed = true),
      });
    });
    act(() => {
      handle.push({ kind: 'settings', render: dummyRender('s2') });
    });
    expect(closed).toBe(true);
  });
});

describe('ModalStack data attrs', () => {
  it('每层都有 data-modal-layer + data-modal-top；只有最顶层 top=true', () => {
    const { handle, container } = setup();
    act(() => {
      handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
    });
    const layers = container.querySelectorAll('[data-modal-layer]');
    expect(layers.length).toBe(2);
    expect(layers[0]?.getAttribute('data-modal-layer')).toBe('0');
    expect(layers[0]?.getAttribute('data-modal-top')).toBe('false');
    expect(layers[1]?.getAttribute('data-modal-layer')).toBe('1');
    expect(layers[1]?.getAttribute('data-modal-top')).toBe('true');
  });

  it('--modal-layer-z 按下标递增', () => {
    const { handle, container } = setup();
    act(() => {
      handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
      handle.push({ render: dummyRender('c') });
    });
    const layers = container.querySelectorAll<HTMLElement>('[data-modal-layer]');
    expect(layers[0]?.style.getPropertyValue('--modal-layer-z')).toBe('0');
    expect(layers[1]?.style.getPropertyValue('--modal-layer-z')).toBe('1');
    expect(layers[2]?.style.getPropertyValue('--modal-layer-z')).toBe('2');
  });
});
