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
 * 核心规则(详见 types.ts 注释):
 *  - 同 kind 互斥:push 同 kind 自动 replace 栈顶
 *  - 不同 kind / 无 kind:直接叠加(嵌套)
 *  - 视觉叠序由 entry.topRank 决定:z-index = BASE + topRank,bringToTop 改 topRank
 *    把指定 layer 提到视觉顶(不动数组位置,React key 稳定 → DOM 不重 mount)
 *  - esc 默认关视觉栈顶;点 backdrop 默认关视觉栈顶
 *  - 中间层关闭:LIFO 语义 — 关 X 同时关掉所有 topRank 更高的 layer
 *  - group:批量操作分组(与 kind 互补);popGroup(g) 关掉所有同 group entry
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
  ModalGroupItem,
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
 * 关键设计:每层 modal 都有一个独立的 portal target(ModalLayerRoot 自带的
 * 占位 div),Radix Dialog.Portal / vaul Drawer.Portal 用 container prop 指
 * 向它。layer 之间的视觉叠序由各自外层 ModalLayerRoot 的 z-index(= BASE +
 * topRank) + isolation:isolate 决定 — 与数组顺序 / DOM 文档流位置解耦,bringToTop
 * 改 topRank 即可让任一层"提到视觉顶"(不动 DOM)。
 *
 * isTop:该 layer 是否当前视觉顶(topRank === max(stack.topRank));container
 * 可能是 null(SSR 或还没 mount),调用方 Sheet 在 null 时回退到默认(body)。
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

/** topRank 全局单调递增,push / bringToTop 都从这里取下一个值 */
let topRankSeq = 0;
const nextTopRank = (): number => ++topRankSeq;

/** z-index 基准。每层 modal 用 BASE + topRank。值不重要,只要大于页面其它内容即可 */
const Z_INDEX_BASE = 1000;

/**
 * bringToTop 切换淡入淡出时长(ms)。比 280ms 的 CLOSING_ANIMATION_MS 略长
 * 也无所谓 — fade 只作用于 fadeOnSwap 的同 group layer,与 pop 的退场动画
 * 独立。320ms 更明显,接近 iOS 切换 transition 的体感。
 */
const LAYER_FADE_MS = 320;

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
   * 关掉指定 id 的 modal。规则:关掉它和**视觉层位于它之上**的所有 modal
   * (即 topRank ≥ 目标.topRank 的所有 entry)。这是 LIFO 语义,只是"上"以
   * topRank 而非数组位置定义 — bringToTop 后两者可能不一致,bringToTop 把
   * 一个 entry 提到视觉顶,关它就是关那一个。
   *
   * 不传 id = 关视觉栈顶(topRank 最大的)。
   *
   * 实现:先把 entry 标记为 closing=true,让 render 函数把 open=false 传给
   * Sheet → Radix/vaul 播退场动画。动画时长(CLOSING_ANIMATION_MS)后真从
   * 数组移除并触发 onClosed。
   */
  const pop = useCallback((id?: string): void => {
    setStack((prev) => {
      const live = prev.filter((e) => !e.closing);
      if (live.length === 0) return prev;
      // 默认 = 视觉栈顶(topRank 最大)
      const target =
        id != null
          ? prev.find((e) => e.id === id)
          : live.reduce((a, b) => (a.topRank >= b.topRank ? a : b));
      if (!target || target.closing) return prev;
      // 关 target 以及视觉层比它更靠上的(topRank ≥ target.topRank)
      const cutoff = target.topRank;
      const closingIds = new Set(
        prev.filter((e) => !e.closing && e.topRank >= cutoff).map((e) => e.id),
      );
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

  /**
   * 把指定 id 的 entry 的 topRank 改为新的最大值,数组位置不动。
   * 关键:复用 entry 对象的 id(React key 稳定),只换 topRank 字段 → React
   * 不会卸载该 layer 的 DOM → 子组件 scrollTop / state 全部保留。
   */
  const bringToTop = useCallback((id: string): void => {
    setStack((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx < 0) return prev;
      const target = prev[idx]!;
      if (target.closing) return prev;
      // 已经在顶 → 无操作,避免无意义 re-render
      const maxRank = Math.max(...prev.map((e) => e.topRank));
      if (target.topRank === maxRank) return prev;
      const next = [...prev];
      next[idx] = { ...target, topRank: nextTopRank() };
      return next;
    });
  }, []);

  const find = useCallback(
    (
      predicate: (meta: Readonly<Record<string, unknown>> | undefined) => boolean,
    ): string | undefined => {
      return stackRef.current.find((e) => !e.closing && predicate(e.meta))?.id;
    },
    [],
  );

  /**
   * 关掉所有属于 group 的 entry。复用 pop 的 closing+延迟移除机制,逐个标记
   * (而非一次性把多个 id 塞进同一批 closing 集合)— 行为与"用户依次按 esc 关
   * 这些 entry"等价,onClosed 回调时机一致。
   */
  const popGroup = useCallback(
    (group: string): void => {
      const targets = stackRef.current.filter(
        (e) => e.group === group && !e.closing,
      );
      for (const e of targets) pop(e.id);
    },
    [pop],
  );

  const handle = useMemo<ModalStackHandle>(
    () => ({ push, replace, pop, popTo, dismiss, depth, bringToTop, find, popGroup }),
    [push, replace, pop, popTo, dismiss, depth, bringToTop, find, popGroup],
  );

  // 全局 esc：关栈顶(按 topRank 算,不是数组末尾 — bringToTop 后两者可能不一致)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const live = stackRef.current.filter((x) => !x.closing);
      if (live.length === 0) return;
      const top = live.reduce((a, b) => (a.topRank >= b.topRank ? a : b));
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
  // 按 topRank 决定"哪个 entry 在视觉/交互层最顶"。数组顺序仍按 push 顺序 →
  // React key 稳定 → bringToTop 不重 mount(关键)
  const liveStack = stack.filter((e) => !e.closing);
  const maxTopRank =
    liveStack.length > 0 ? Math.max(...liveStack.map((e) => e.topRank)) : -1;
  // 同 group 计数:供 ctx.groupSize,让 render 决定是否显示"全部关闭"之类批量 UI
  const groupCounts = new Map<string, number>();
  for (const e of liveStack) {
    if (e.group) groupCounts.set(e.group, (groupCounts.get(e.group) ?? 0) + 1);
  }
  return (
    <>
      {stack.map((entry, idx) => {
        const isTop = !entry.closing && entry.topRank === maxTopRank;
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
          activatedSeq: entry.topRank,
          groupSize: entry.group ? (groupCounts.get(entry.group) ?? 0) : 0,
        };
        return (
          <ModalLayerRoot
            key={entry.id}
            idx={idx}
            isTop={isTop}
            zIndex={Z_INDEX_BASE + entry.topRank}
            fadeOnSwap={entry.group === 'file-preview'}
          >
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
 * 关键作用:
 *  1. 提供 portal target — Radix Dialog.Portal / vaul Drawer.Portal 通过
 *     ModalLayerCtx 拿到 container prop,把 Sheet 内容渲染进本容器
 *  2. 视觉叠序:zIndex = BASE + entry.topRank;isolation:isolate 把内部
 *     Radix Content 的固定 z-index 禁锢在层内,bringToTop 改外层 zIndex 就够
 *  3. inert={!isTop}:非顶 layer 不响应键盘 / 焦点;pointer-events:none 兜底
 *  4. 容器自身 position:fixed 占满 viewport;顶层 pointer-events:auto 让内部
 *     Sheet 接事件,非顶 pointer-events:none 穿透
 */
function ModalLayerRoot({
  idx,
  isTop,
  zIndex,
  fadeOnSwap,
  children,
}: {
  idx: number;
  isTop: boolean;
  zIndex: number;
  /**
   * 是否参与"bringToTop 切层时的渐隐渐现"。仅 file-preview 等"全屏覆盖且
   * 互相切换"的 group 开启 — 用 opacity 表达 isTop,旧顶 1→0、新顶 0→1
   * 自然交叉淡入淡出。
   *
   * 默认 false,避免影响 confirm/settings 这种"小窗覆盖大窗"场景 — 那里
   * 下层不能 opacity:0,否则会看见空白。
   */
  fadeOnSwap: boolean;
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
        style={{
          position: 'fixed',
          inset: 0,
          zIndex,
          // 强制独立 stacking context:内部 Sheet 的 overlay/content 用的
          // var(--z-overlay)/var(--z-modal) 固定值会被禁锢在本 layer 内,
          // layer 之间的视觉叠序完全由外层 zIndex 决定。bringToTop 改
          // 外层 zIndex 后,该 layer 的 overlay/content 整体跟着上浮。
          isolation: 'isolate',
          // pointer-events 跟 isTop 联动:
          //  - 顶层 'auto':容器自己可被 hit-test(子元素 Sheet/Content 仍优先抢)
          //  - 非顶层 'none':显式穿透,与 inert(屏蔽 focus/键盘)形成双保险。
          //    fade 过渡期间 layer 仍 inset:0 + opacity:0,显式 none 防止 Radix
          //    portal 子树偶发拦截点击。
          pointerEvents: isTop ? 'auto' : 'none',
          // 仅 fadeOnSwap = true(如 file-preview group)时按 isTop 控 opacity:
          // 旧顶 1→0,新顶 0→1,自然交叉淡入淡出。其它场景(confirm 嵌套在
          // settings 之上)保持 opacity:1 — 下层若被部分覆盖也照常显示。
          opacity: fadeOnSwap && !isTop ? 0 : 1,
          // cubic-bezier(0.4, 0, 0.2, 1) = Material standard easing,前快后慢更自然。
          // will-change 提示浏览器为 opacity 开独立合成层,避免低端机 / 高负载
          // 场景下 transition 被合成器跳帧。
          transition: fadeOnSwap
            ? `opacity ${LAYER_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
            : undefined,
          willChange: fadeOnSwap ? 'opacity' : undefined,
        }}
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
    group: input.group,
    meta: input.meta,
    render: input.render,
    dismissible: input.dismissible ?? true,
    onClosed: input.onClosed,
    debugLabel: input.debugLabel,
    closing: false,
    topRank: nextTopRank(),
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

/**
 * 订阅指定 group 的栈快照。stack 内容变化时组件重渲染 — 用于栈视图组件
 * 实时反映 push / bringToTop / pop 后的卡片列表。
 *
 * 返回数组按 topRank 升序(底 → 顶);最后一项 isTop=true。
 * closing 中的 entry 不出现(避免栈视图里出现"已经在退场"的幽灵卡)。
 */
export function useModalStackGroup(group: string): readonly ModalGroupItem[] {
  const ctx = useContext(ModalStackOutletCtx);
  return useMemo<readonly ModalGroupItem[]>(() => {
    if (!ctx) return [];
    const live = ctx.stack.filter((e) => !e.closing && e.group === group);
    if (live.length === 0) return [];
    const maxTopRank = Math.max(...live.map((e) => e.topRank));
    return live
      .map((e) => ({
        id: e.id,
        meta: e.meta,
        isTop: e.topRank === maxTopRank,
        topRank: e.topRank,
      }))
      .sort((a, b) => a.topRank - b.topRank);
  }, [ctx, group]);
}
