/**
 * useDragReorder
 *
 * 给"分组列表"通用的跨分组拖拽 reorder 能力。
 *
 * 设计点：
 *  1. 用 pointer events 统一处理鼠标 / 触摸 / 触控笔
 *  2. 仅在行首"手柄"上 down 才触发拖拽，避免与列表纵向滚动冲突（不需要长按）
 *  3. 落点检测：遍历已注册的 row 矩形，光标 y 落在 row 上半部 → 插在该 row 之前；
 *     落在下半部 → 插在该 row 之后。空组时落到组容器中即视为该组末尾。
 *  4. 跨组：写回时同步把被拖项的 group 字段改成目标组
 *  5. 浮层用调用方拿到 dragState 自行渲染（避免 hook 与样式耦合）
 *
 * 实现取舍：window 级 listener 在 pointerdown 时即挂上，pointerup/cancel 时清理。
 * 用 ref 而非 state 驱动监听，避免 React 重渲染时机带来的"按下立即抬起会丢监听"问题。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface DragRegister {
  row: (idx: number, el: HTMLElement | null) => void;
  group: (gid: string, el: HTMLElement | null) => void;
}

export interface DragState {
  sourceIdx: number;
  /** 浮层位置（视口坐标） */
  ghostX: number;
  ghostY: number;
  /** 浮层相对光标的偏移（保持光标按下时在按钮上的相对位置） */
  offsetX: number;
  offsetY: number;
}

/** drop 落点 */
export type DropIndicator =
  | { kind: 'row'; groupId: string; idx: number; position: 'before' | 'after' }
  | { kind: 'group-empty'; groupId: string };

export interface UseDragReorderOptions<T> {
  value: T[];
  onChange: (next: T[]) => void;
  /** 取一项的所属分组 id（缺省视为 'custom'） */
  groupOf: (item: T) => string;
  /** 把一项的 group 字段改成 gid（不修改入参） */
  withGroup: (item: T, gid: string) => T;
}

export interface UseDragReorderReturn {
  register: DragRegister;
  /** 给行首手柄绑的 props */
  getHandleProps: (idx: number) => {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    style?: CSSProperties;
  };
  dragState: DragState | null;
  dropIndicator: DropIndicator | null;
  isDragging: boolean;
}

const DRAG_START_THRESHOLD = 4;

export function useDragReorder<T>({
  value,
  onChange,
  groupOf,
  withGroup,
}: UseDragReorderOptions<T>): UseDragReorderReturn {
  const rowEls = useRef<Map<number, HTMLElement>>(new Map());
  const groupEls = useRef<Map<string, HTMLElement>>(new Map());

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  // 用 ref 保存最新值，避免闭包过期
  const valueRef = useRef(value);
  valueRef.current = value;
  const dropRef = useRef<DropIndicator | null>(null);
  dropRef.current = dropIndicator;
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = dragState;
  const groupOfRef = useRef(groupOf);
  groupOfRef.current = groupOf;
  const withGroupRef = useRef(withGroup);
  withGroupRef.current = withGroup;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** 保存当前正在跟踪的 pointer 与初始信息 */
  const trackRef = useRef<{
    pointerId: number;
    sourceIdx: number;
    startX: number;
    startY: number;
    rect: DOMRect;
    cleanup: () => void;
  } | null>(null);

  const register: DragRegister = {
    row: useCallback((idx, el) => {
      const map = rowEls.current;
      if (el === null) map.delete(idx);
      else map.set(idx, el);
    }, []),
    group: useCallback((gid, el) => {
      const map = groupEls.current;
      if (el === null) map.delete(gid);
      else map.set(gid, el);
    }, []),
  };

  /** 命中检测 */
  const hitTest = useCallback((x: number, y: number): DropIndicator | null => {
    for (const [idx, el] of rowEls.current) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
        const item = valueRef.current[idx];
        if (!item) continue;
        const groupId = groupOfRef.current(item);
        const position: 'before' | 'after' = y < r.top + r.height / 2 ? 'before' : 'after';
        return { kind: 'row', groupId, idx, position };
      }
    }
    for (const [gid, el] of groupEls.current) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) {
        return { kind: 'group-empty', groupId: gid };
      }
    }
    return null;
  }, []);

  /** 应用 reorder */
  const applyDrop = useCallback((sourceIdx: number, drop: DropIndicator | null) => {
    if (!drop) return;
    const arr = valueRef.current.slice();
    const moving = arr[sourceIdx];
    if (!moving) return;

    arr.splice(sourceIdx, 1);

    let insertAt: number;
    let targetGroup: string;

    if (drop.kind === 'row') {
      targetGroup = drop.groupId;
      let baseIdx = drop.idx;
      if (sourceIdx < drop.idx) baseIdx -= 1;
      insertAt = drop.position === 'before' ? baseIdx : baseIdx + 1;
    } else {
      targetGroup = drop.groupId;
      insertAt = arr.length;
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (groupOfRef.current(arr[i] as T) === targetGroup) {
          insertAt = i + 1;
          break;
        }
      }
    }

    const fixed = withGroupRef.current(moving, targetGroup);
    arr.splice(insertAt, 0, fixed);
    onChangeRef.current(arr);
  }, []);

  const startTracking = useCallback((args: {
    pointerId: number;
    sourceIdx: number;
    startX: number;
    startY: number;
    rect: DOMRect;
  }): void => {
    let started = false;

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== args.pointerId) return;
      if (!started) {
        const dx = e.clientX - args.startX;
        const dy = e.clientY - args.startY;
        if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) return;
        started = true;
        // 真正进入拖拽：禁掉全局文字选择，避免拖动时把页面其它文字"刷蓝"
        document.body.classList.add('drag-reorder-active');
        // 清掉按下到 startTracking 期间已经形成的选区（如手指在 grip 上短暂滑动）
        window.getSelection()?.removeAllRanges();
        setDragState({
          sourceIdx: args.sourceIdx,
          ghostX: e.clientX,
          ghostY: e.clientY,
          offsetX: e.clientX - args.rect.left,
          offsetY: e.clientY - args.rect.top,
        });
      }
      e.preventDefault();
      setDragState((prev) =>
        prev
          ? { ...prev, ghostX: e.clientX, ghostY: e.clientY }
          : prev,
      );
      const next = hitTest(e.clientX, e.clientY);
      if (!shallowEqDrop(next, dropRef.current)) {
        setDropIndicator(next);
      }
    };

    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== args.pointerId) return;
      if (started) applyDrop(args.sourceIdx, dropRef.current);
      cleanup();
    };

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('drag-reorder-active');
      trackRef.current = null;
      setDragState(null);
      setDropIndicator(null);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    trackRef.current = { ...args, cleanup };
  }, [applyDrop, hitTest]);

  // 卸载兜底
  useEffect(() => () => trackRef.current?.cleanup(), []);

  const getHandleProps = useCallback(
    (idx: number) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>): void => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (trackRef.current !== null) return;
        const rect = e.currentTarget.getBoundingClientRect();
        startTracking({
          pointerId: e.pointerId,
          sourceIdx: idx,
          startX: e.clientX,
          startY: e.clientY,
          rect,
        });
      },
      style: { touchAction: 'none' as CSSProperties['touchAction'] },
    }),
    [startTracking],
  );

  return {
    register,
    getHandleProps,
    dragState,
    dropIndicator,
    isDragging: dragState !== null,
  };
}

function shallowEqDrop(a: DropIndicator | null, b: DropIndicator | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'row' && b.kind === 'row') {
    return a.idx === b.idx && a.position === b.position && a.groupId === b.groupId;
  }
  if (a.kind === 'group-empty' && b.kind === 'group-empty') {
    return a.groupId === b.groupId;
  }
  return false;
}
