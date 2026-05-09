/**
 * ModalStack —— 全局 modal 栈
 *
 * 把"开 modal" 这件事从"组件级 useState + 手工 z-index 协调" 变成"调用 stack.push"。
 *
 * 用法：
 *   const stack = useModalStack();
 *   const id = stack.push({
 *     kind: 'instance-detail',
 *     render: ({ close, pushChild, isTop }) => (
 *       <ModalShell title="..." onClose={close} footer={...}>
 *         <Content />
 *       </ModalShell>
 *     ),
 *   });
 *
 * 核心规则（详见 types.ts 注释）：
 *  - 同 kind 互斥：push 同 kind 自动 replace 栈顶
 *  - 不同 kind / 无 kind：直接叠加（嵌套）
 *  - z-index 自动按栈下标递增
 *  - esc 默认关栈顶；点 backdrop 默认关栈顶
 *  - 中间层关闭：如 [A, B, C] 关 B，会同时关 C（栈是 LIFO 语义，不允许"穿过当前层关下面"）
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type {
  ModalEntry,
  ModalEntryInput,
  ModalRenderContext,
  ModalStackHandle,
} from './types.js';

const ModalStackCtx = createContext<ModalStackHandle | null>(null);

let idSeq = 0;
const newId = (): string => `modal-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

interface ModalStackProviderProps {
  children: ReactNode;
}

export function ModalStackProvider({ children }: ModalStackProviderProps): JSX.Element {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  // 用 ref 镜像最新 stack，让 handle 方法读到最新值（避免 closure stale）
  const stackRef = useRef<ModalEntry[]>(stack);
  stackRef.current = stack;

  /**
   * 入口：push 一个 modal。
   * 若栈顶 entry 与新 entry 同 kind（且 kind 非 undefined）→ replace 栈顶（互斥）
   * 否则 → 追加到栈尾（嵌套 / 叠加）
   */
  const push = useCallback((input: ModalEntryInput): string => {
    const entry = normalizeEntry(input);
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.kind && entry.kind && top.kind === entry.kind && !top.closing) {
        // 同 kind 互斥：替换栈顶（旧 entry 立即卸载，不走退场动画——同 kind 视为同一逻辑 modal 的状态切换）
        top.onClosed?.();
        return [...prev.slice(0, -1), entry];
      }
      return [...prev, entry];
    });
    return entry.id;
  }, []);

  const replace = useCallback((input: ModalEntryInput): string => {
    const entry = normalizeEntry(input);
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top) top.onClosed?.();
      return [...prev.slice(0, -1), entry];
    });
    return entry.id;
  }, []);

  /**
   * 关掉指定 id 的 modal。规则：关掉它和它之上的所有 modal（LIFO）。
   * 不传 id = 关栈顶。
   */
  const pop = useCallback((id?: string): void => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const targetId = id ?? prev[prev.length - 1]?.id;
      const idx = prev.findIndex((e) => e.id === targetId);
      if (idx < 0) return prev;
      // 标记 idx 及之后的所有 entry 为 closing；动画后被 reapStackAfterAnimation 清掉
      // 简化版：直接同步移除（动画由 ModalShell 自己管，移除 = unmount）
      const removed = prev.slice(idx);
      for (const e of removed) e.onClosed?.();
      return prev.slice(0, idx);
    });
  }, []);

  const popTo = useCallback((id: string): void => {
    pop(id);
  }, [pop]);

  const dismiss = useCallback((): void => {
    setStack((prev) => {
      for (const e of prev) e.onClosed?.();
      return [];
    });
  }, []);

  const depth = useCallback((): number => stackRef.current.length, []);

  const handle = useMemo<ModalStackHandle>(
    () => ({ push, replace, pop, popTo, dismiss, depth }),
    [push, replace, pop, popTo, dismiss, depth],
  );

  // 全局 esc：关栈顶
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const top = stackRef.current[stackRef.current.length - 1];
      if (!top) return;
      if (!top.dismissible) return;
      e.preventDefault();
      pop(top.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pop]);

  return (
    <ModalStackCtx.Provider value={handle}>
      {children}
      <ModalStackPortal stack={stack} handle={handle} />
    </ModalStackCtx.Provider>
  );
}

function ModalStackPortal({
  stack,
  handle,
}: {
  stack: ModalEntry[];
  handle: ModalStackHandle;
}): JSX.Element {
  return (
    <>
      {stack.map((entry, idx) => {
        const isTop = idx === stack.length - 1;
        const ctx: ModalRenderContext = {
          id: entry.id,
          close: () => handle.pop(entry.id),
          pushChild: (e) => handle.push(e),
          replaceSelf: (e) => {
            // 当前 entry 自我替换（pop 自己 + push 新 entry）
            handle.pop(entry.id);
            return handle.push(e);
          },
          isTop,
          index: idx,
        };
        return (
          <ModalLayerRoot key={entry.id} idx={idx} isTop={isTop}>
            {entry.render(ctx)}
          </ModalLayerRoot>
        );
      })}
    </>
  );
}

/**
 * 单个 modal 层的容器：注入 z-index CSS 变量，下层 modal 自动添加 inert 阻止交互。
 * 真实的 backdrop / 内容定位由 ModalShell（基于 Sheet）负责。
 */
function ModalLayerRoot({
  idx,
  isTop,
  children,
}: {
  idx: number;
  isTop: boolean;
  children: ReactNode;
}): JSX.Element {
  // CSS var --modal-layer-z 由各 modal 的 SCSS 用 calc(t.$z-modal + var(--modal-layer-z) * 5) 计算
  // inert 让下层 modal 不抢焦点 / 不响应点击
  return (
    <div
      data-modal-layer={idx}
      data-modal-top={isTop ? 'true' : 'false'}
      style={{ ['--modal-layer-z' as string]: String(idx) }}
      // React 19 支持 inert={true|false}；下层 modal 不响应交互 / 不抢焦点
      inert={!isTop}
    >
      {children}
    </div>
  );
}

function normalizeEntry(input: ModalEntryInput): ModalEntry {
  return {
    id: newId(),
    kind: input.kind,
    render: input.render,
    dismissible: input.dismissible ?? true,
    onClosed: input.onClosed,
    debugLabel: input.debugLabel,
    closing: false,
  };
}

/**
 * 取栈 handle。组件树需在 <ModalStackProvider> 内才能用。
 */
export function useModalStack(): ModalStackHandle {
  const handle = useContext(ModalStackCtx);
  if (!handle) {
    throw new Error('useModalStack must be used within <ModalStackProvider>');
  }
  return handle;
}
