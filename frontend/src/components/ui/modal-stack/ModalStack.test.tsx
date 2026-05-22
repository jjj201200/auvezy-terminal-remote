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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// 全局 fake timers：pop 现在是延迟移除（等退场动画），测试需要推进时间
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 推进 pop 的退场延迟（CLOSING_ANIMATION_MS=280） */
function flushClose(): void {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}
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
    flushClose();
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
    flushClose();
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
    flushClose();
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
    flushClose();
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

describe('ModalStack bringToTop / find / popGroup', () => {
  it('bringToTop:底层 entry 不动数组位置,但 data-modal-top 转向它', () => {
    const { handle, container } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
      handle.push({ render: dummyRender('c') });
    });
    // 现状:c 在 top
    let layers = container.querySelectorAll<HTMLElement>('[data-modal-layer]');
    expect(layers[2]?.getAttribute('data-modal-top')).toBe('true');
    expect(layers[0]?.getAttribute('data-modal-top')).toBe('false');

    act(() => handle.bringToTop(idA));

    // 数组位置不动:layer-0/1/2 仍按 push 顺序 a/b/c,但 data-modal-top 现在落在
    // a 那层(layer-0),且只一个 top
    layers = container.querySelectorAll<HTMLElement>('[data-modal-layer]');
    expect(layers.length).toBe(3);
    expect(layers[0]?.getAttribute('data-modal-layer')).toBe('0');
    expect(layers[1]?.getAttribute('data-modal-layer')).toBe('1');
    expect(layers[2]?.getAttribute('data-modal-layer')).toBe('2');
    expect(layers[0]?.getAttribute('data-modal-top')).toBe('true');
    expect(layers[1]?.getAttribute('data-modal-top')).toBe('false');
    expect(layers[2]?.getAttribute('data-modal-top')).toBe('false');
    // 所有层仍存在(没有被卸载)
    expect(container.querySelector('[data-testid="modal-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="modal-b"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="modal-c"]')).toBeTruthy();
  });

  it('bringToTop:z-index 反映新顺序', () => {
    const { handle, container } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
    });
    const layers = container.querySelectorAll<HTMLElement>('[data-modal-layer]');
    const zABefore = Number(layers[0]?.style.zIndex);
    const zBBefore = Number(layers[1]?.style.zIndex);
    expect(zABefore).toBeLessThan(zBBefore);

    act(() => handle.bringToTop(idA));

    const after = container.querySelectorAll<HTMLElement>('[data-modal-layer]');
    const zAAfter = Number(after[0]?.style.zIndex);
    const zBAfter = Number(after[1]?.style.zIndex);
    expect(zAAfter).toBeGreaterThan(zBAfter);
  });

  it('bringToTop 已在顶 → 无副作用', () => {
    const { handle } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({ render: dummyRender('a') });
    });
    // 不应抛 / 不应改变 depth
    act(() => handle.bringToTop(idA));
    expect(handle.depth()).toBe(1);
  });

  it('bringToTop:esc 关栈顶按 topRank 算,不是数组末尾', () => {
    const { handle, container } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
    });
    act(() => handle.bringToTop(idA));
    // 现在 A 在视觉顶。模拟 esc → 应关 A,留 B
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    flushClose();
    expect(handle.depth()).toBe(1);
    expect(container.querySelector('[data-testid="modal-a"]')).toBeNull();
    expect(container.querySelector('[data-testid="modal-b"]')).toBeTruthy();
  });

  it('find:按 meta 谓词命中,closing 的 entry 不算', () => {
    const { handle } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({
        meta: { kind: 'file', path: '/a.md' },
        render: dummyRender('a'),
      });
      handle.push({
        meta: { kind: 'file', path: '/b.md' },
        render: dummyRender('b'),
      });
    });
    expect(
      handle.find((m) => m?.['path'] === '/a.md'),
    ).toBe(idA);
    expect(handle.find((m) => m?.['path'] === '/missing.md')).toBeUndefined();
    expect(handle.find((m) => !m)).toBeUndefined(); // 都有 meta
  });

  it('popGroup:只关同 group 的 entry,其它保留', () => {
    const { handle, container } = setup();
    act(() => {
      handle.push({ render: dummyRender('keeper') }); // 无 group
      handle.push({ group: 'preview', render: dummyRender('p1') });
      handle.push({ group: 'preview', render: dummyRender('p2') });
    });
    expect(handle.depth()).toBe(3);
    act(() => handle.popGroup('preview'));
    flushClose();
    expect(handle.depth()).toBe(1);
    expect(container.querySelector('[data-testid="modal-keeper"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="modal-p1"]')).toBeNull();
    expect(container.querySelector('[data-testid="modal-p2"]')).toBeNull();
  });

  it('ctx.activatedSeq:bringToTop 后透传给 render 的值会变大', () => {
    let seqA1 = 0;
    let seqA2 = 0;
    let renderCount = 0;
    const renderA = (ctx: { activatedSeq: number }) => {
      const c = ++renderCount;
      if (c === 1) seqA1 = ctx.activatedSeq;
      seqA2 = ctx.activatedSeq;
      return <div data-testid="modal-a">a:{ctx.activatedSeq}</div>;
    };
    const { handle } = setup();
    let idA = '';
    act(() => {
      idA = handle.push({ render: renderA });
      handle.push({ render: dummyRender('b') });
    });
    act(() => handle.bringToTop(idA));
    expect(seqA2).toBeGreaterThan(seqA1);
  });

  it('ctx.groupSize:同 group 计数,自己无 group → 0', () => {
    let groupSizeKeeper = -1;
    let groupSizeP1 = -1;
    let groupSizeP2 = -1;
    const renderKeeper = (ctx: { groupSize: number }) => {
      groupSizeKeeper = ctx.groupSize;
      return <div data-testid="modal-keeper" />;
    };
    const renderP1 = (ctx: { groupSize: number }) => {
      groupSizeP1 = ctx.groupSize;
      return <div data-testid="modal-p1" />;
    };
    const renderP2 = (ctx: { groupSize: number }) => {
      groupSizeP2 = ctx.groupSize;
      return <div data-testid="modal-p2" />;
    };
    const { handle } = setup();
    act(() => {
      handle.push({ render: renderKeeper });
      handle.push({ group: 'preview', render: renderP1 });
      handle.push({ group: 'preview', render: renderP2 });
    });
    expect(groupSizeKeeper).toBe(0);
    expect(groupSizeP1).toBe(2);
    expect(groupSizeP2).toBe(2);
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

  it('layer 按 push 顺序在 DOM 中依次出现（保证后入的天然盖住前一个）', () => {
    const { handle, container } = setup();
    act(() => {
      handle.push({ render: dummyRender('a') });
      handle.push({ render: dummyRender('b') });
      handle.push({ render: dummyRender('c') });
    });
    const layers = container.querySelectorAll<HTMLElement>('[data-modal-layer]');
    expect(layers[0]?.getAttribute('data-modal-layer')).toBe('0');
    expect(layers[1]?.getAttribute('data-modal-layer')).toBe('1');
    expect(layers[2]?.getAttribute('data-modal-layer')).toBe('2');
    // DOM 顺序就是 push 顺序：后一个 layer 出现在前一个之后 → 文档流末端天然叠上去
    expect(layers[0]?.compareDocumentPosition(layers[1] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(layers[1]?.compareDocumentPosition(layers[2] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
