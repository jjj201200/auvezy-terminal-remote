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
 *  - 嵌套层级靠 DOM 顺序天然叠加：每层用独立的 portal container，layer N 的
 *    DOM 在 layer N-1 之后渲染，不依赖 z-index（z-index 用 token 静态值）
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

/**
 * 内部 ctx：把 stack state 暴露给 <ModalStackOutlet />，让 outlet 能在
 * Provider 树更深处渲染 modal —— 解决"modal portal 与 useConfirm 等子级
 * Provider 的位置冲突"。
 *
 * 即：
 *   <ModalStackProvider>
 *     <ConfirmProvider>          ← 设 ConfirmCtx
 *       <App />
 *       <ModalStackOutlet />     ← 在 ConfirmCtx 内渲染 modal，让 modal 内部
 *                                  能用 useConfirm
 *     </ConfirmProvider>
 *   </ModalStackProvider>
 */
interface OutletCtxValue {
  stack: ModalEntry[];
  handle: ModalStackHandle;
  /** 由 useModalOutletRegister 调用：true = children 内已有 outlet 渲染，兜底跳过 */
  registerExplicit: () => () => void;
}
const ModalStackOutletCtx = createContext<OutletCtxValue | null>(null);

/**
 * 当前 modal 在栈中的位置 + 它的 portal 容器。
 *
 * 关键设计：每层 modal 都有一个独立的 portal target（ModalLayerRoot 自带的
 * 占位 div），Radix Dialog.Portal / vaul Drawer.Portal 用 container prop 指
 * 向它。这样：
 *  - layer 0 的 modal 渲染在 layer-0 div 内
 *  - layer 1 的 modal 渲染在 layer-1 div 内
 *  - layer-1 div 在 React 树里位置在 layer-0 之后 → DOM 顺序保证 layer-1
 *    整体盖住 layer-0，不需要 z-index 战争
 *
 * 不带 isTop 标志（用 idx === total - 1 算）；container 可能是 null（SSR
 * 或还没 mount），调用方 Sheet 在 null 时回退到默认（document.body）。
 */
const ModalLayerCtx = createContext<{
  index: number;
  isTop: boolean;
  container: HTMLElement | null;
}>({
  index: 0,
  isTop: true,
  container: null,
});

export function useModalLayer(): {
  index: number;
  isTop: boolean;
  container: HTMLElement | null;
} {
  return useContext(ModalLayerCtx);
}

let idSeq = 0;
const newId = (): string => `modal-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

/**
 * Modal 退场动画时长（与 SCSS $dur-modal 对齐）。pop 时先 mark closing，
 * 等这么长后真从数组移除，让 Radix/vaul 内部的 open=false 触发的退场动画
 * 能播完
 */
const CLOSING_ANIMATION_MS = 280;

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
   *
   * 实现：先把 entry 标记为 closing=true，让 render 函数把 open=false 传给
   * Sheet → Radix/vaul 播退场动画。动画时长（CLOSING_ANIMATION_MS）后真从
   * 数组移除并触发 onClosed。
   */
  const pop = useCallback((id?: string): void => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const targetId = id ?? prev[prev.length - 1]?.id;
      const idx = prev.findIndex((e) => e.id === targetId);
      if (idx < 0) return prev;
      if (prev[idx]?.closing) return prev; // 已在退场，避免重复
      // 标记 idx 及之后所有 entry 为 closing；记录被关的 id 集合给 timer 用
      const closingIds = new Set(prev.slice(idx).map((e) => e.id));
      const next = prev.map((e) =>
        closingIds.has(e.id) ? { ...e, closing: true } : e,
      );
      window.setTimeout(() => {
        setStack((curr) => {
          // 触发 onClosed + 从数组里删
          const removed = curr.filter((e) => closingIds.has(e.id));
          for (const e of removed) e.onClosed?.();
          return curr.filter((e) => !closingIds.has(e.id));
        });
      }, CLOSING_ANIMATION_MS);
      return next;
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

  // 显式 outlet 计数：>0 时兜底 outlet 不渲染
  const [explicitCount, setExplicitCount] = useState(0);
  const registerExplicit = useCallback(() => {
    setExplicitCount((n) => n + 1);
    return () => setExplicitCount((n) => n - 1);
  }, []);

  const outletValue = useMemo<OutletCtxValue>(
    () => ({ stack, handle, registerExplicit }),
    [stack, handle, registerExplicit],
  );

  return (
    <ModalStackCtx.Provider value={handle}>
      <ModalStackOutletCtx.Provider value={outletValue}>
        {children}
        {/*
          兜底：调用方没在 children 里放 ModalStackOutlet 时，这里渲染。
          测试 / 简单场景下可以直接用 ModalStackProvider 不需手动放 outlet
        */}
        {explicitCount === 0 && (
          <ModalStackPortal stack={stack} handle={handle} />
        )}
      </ModalStackOutletCtx.Provider>
    </ModalStackCtx.Provider>
  );
}

/**
 * Modal 渲染出口。把它放在你希望 modal 出现的 Provider 树位置 —— 一般是 App
 * 树的最深处，让 modal 内部能用所有 Provider 提供的 ctx（如 useConfirm）。
 *
 * 用法：
 *   <ModalStackProvider>
 *     <ConfirmProvider>
 *       <App />
 *       <ModalStackOutlet />     ← modal 在 ConfirmCtx 内渲染
 *     </ConfirmProvider>
 *   </ModalStackProvider>
 *
 * 同一棵 Provider 子树里只放一个。
 */
export function ModalStackOutlet(): JSX.Element | null {
  const ctx = useContext(ModalStackOutletCtx);
  // 注册自己为显式 outlet：让 ModalStackProvider 跳过兜底渲染
  useEffect(() => {
    if (!ctx) return;
    return ctx.registerExplicit();
    // ctx 引用稳定不需 deps（registerExplicit 是 useCallback 的稳定引用）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ctx) return null;
  return <ModalStackPortal stack={ctx.stack} handle={ctx.handle} />;
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
          // closing 标志反映为 isOpen=false：让 render 函数把它传给 Sheet 的 open prop
          // → Radix/vaul 触发退场动画。CLOSING_ANIMATION_MS 后 entry 才真从数组移除
          isOpen: !entry.closing,
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
 * 单个 modal 层的容器。
 *
 * 关键作用：
 *  1. 提供 portal target —— Radix Dialog.Portal / vaul Drawer.Portal 通过
 *     ModalLayerCtx 拿到 container prop，让 layer N 的 DOM 出现在 layer N-1
 *     的容器之后（React map 顺序），DOM 文档流末端天然叠在上层，不依赖 z-index
 *  2. inert={!isTop} —— 下层 modal 不响应交互 / 不抢焦点
 *
 * 容器自身 position:fixed 占满 viewport 但 pointer-events:none，事件由内部
 * Radix overlay/content 处理。
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
  // 用 state 触发 re-render，让 Sheet 在 mount 后能拿到真实 container
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const layerValue = useMemo(
    () => ({ index: idx, isTop, container: containerEl }),
    [idx, isTop, containerEl],
  );
  return (
    <ModalLayerCtx.Provider value={layerValue}>
      <div
        ref={setContainerEl}
        data-modal-layer={idx}
        data-modal-top={isTop ? 'true' : 'false'}
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
        inert={!isTop}
      >
        {children}
      </div>
    </ModalLayerCtx.Provider>
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
