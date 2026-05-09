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
 * 当前 modal 在栈中的下标。Sheet / 其它"被 push 的 modal 内容"读取此 ctx
 * 决定 z-index、overlay 加深程度。
 *
 * 为什么要单独的 ctx：Radix Dialog.Portal / vaul Drawer.Portal 把 DOM 渲染
 * 到 body 末尾，CSS var --modal-layer-z 不能通过 DOM 继承传过去。改为 React
 * ctx 传递（React tree 不受 portal 影响），由 Sheet 自己 inline-style 写到
 * Radix Portal 内的 overlay/content 元素上。
 */
const ModalLayerCtx = createContext<{ index: number; isTop: boolean }>({
  index: 0,
  isTop: true,
});

export function useModalLayer(): { index: number; isTop: boolean } {
  return useContext(ModalLayerCtx);
}

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
  // 通过 React ctx 把 layer 信息透传给 Sheet —— Radix/vaul 的 Portal 会把 DOM
  // 提到 body 末尾，CSS var 不能继承过去；用 ctx 不受 portal 影响
  const layerValue = useMemo(() => ({ index: idx, isTop }), [idx, isTop]);
  return (
    <ModalLayerCtx.Provider value={layerValue}>
      <div
        data-modal-layer={idx}
        data-modal-top={isTop ? 'true' : 'false'}
        style={{ ['--modal-layer-z' as string]: String(idx) }}
        // React 19 支持 inert={true|false}；下层 modal 不响应交互 / 不抢焦点
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
