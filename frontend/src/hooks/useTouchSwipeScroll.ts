/**
 * useTouchSwipeScroll
 *
 * alt-screen TUI 的输入接管层。统一处理三种输入源到 SGR mouse byte 的转换：
 *
 *  1. **桌面鼠标滚轮**：每滚一格 = 发 scrollLines 行 SGR wheel byte
 *  2. **移动端触摸滑动**：累积 STEP_PX = 一次"滚动事件" = scrollLines 行
 *  3. **移动端触摸 tap**：发 SGR 左键 press+release（默认 button 0）
 *  4. **桌面鼠标点击**：抢在 xterm 之前发 SGR；同时阻止 helper-textarea 抢焦
 *
 * 仅当 **alt-screen + mouse reporting active** 时接管；否则一切回退给
 * xterm 自己处理（原生 scrollback / 文本选择 / IME 唤起）。
 *
 * 长按（默认 600ms）触发 onLongPress 回调，调用方一般用它 focus InputBar
 * 让 IME 弹起。**回调在 touchend 同步链路里调用**——iOS 要求 user gesture
 * 同步链路里的 .focus() 才能弹软键盘，timer 内的 focus 不行。
 *
 * 输入源识别：维护 lastTouchTs，800ms 内有 touchstart 视为触摸来源。
 * 触摸合成的 mousedown 才走"防 helper-textarea 焦点"路径，PC 真鼠标放过。
 *
 * 关键参考：xterm v5.5.0 Terminal.ts:773 mousedown 无条件 this.focus()，
 * iOS 上让 helper-textarea 获焦 → 弹键盘。我们必须拦下重写。
 */

import { useEffect, useRef, type RefObject } from 'react';
import {
  type XtermLike,
  isMouseReportingActive,
  isAltScreen as termIsAlt,
  clientToCell,
  getCellHeight,
  buildSgrEvent,
  dispatchSelectionMouseDown,
  type SgrButton,
} from '../utils/xterm-internals.js';
import { copyToClipboard } from '../utils/clipboard.js';
import {
  WHEEL_SENSITIVITY_MULTIPLIER,
  type WheelSensitivity,
} from 'auvezy-terminal-remote-shared';

// ──────────────── 阈值常量 ────────────────

/** 触摸滑动每多少像素算一次"滚动事件"（≈ 1 次 wheel notch） */
const SWIPE_STEP_PX = 80;
/** 滑动垂直 vs 水平的最小比例：超过才算垂直 swipe，否则放给系统选择 */
const VERTICAL_RATIO = 1.5;
/** 起步阈值：手指动了这么多像素才判方向 */
const MIN_DELTA_PX = 12;

/** tap 候选的最大位移 */
const TAP_DIST_PX = 10;
/** tap 的最大时长（超出当作长按或拖动） */
const TAP_TIME_MS = 500;
/** 触摸标志保留毫秒数：之后的 mousedown/click 视为"触摸合成"还是"PC 鼠标" */
const TOUCH_MEMORY_MS = 800;
/** 进度条延迟出现：避免短按 / 滑动闪烁 */
const PROGRESS_DELAY_MS = 200;
/** tap 发完 SGR 后的抑制窗口，浏览器合成的 mousedown 不再发第二次 */
const TAP_SUPPRESS_MS = 300;

// ──────────────── 纯函数(便于单测,不依赖 DOM / xterm) ────────────────

/**
 * 把 WheelEvent.deltaY 归一为像素。
 *  - deltaMode 0 (DOM_DELTA_PIXEL):已是 px,直接返回
 *  - deltaMode 1 (DOM_DELTA_LINE):× 16(粗估,后续 drainWheelAccum 用真实 cellHeight)
 *  - deltaMode 2 (DOM_DELTA_PAGE):× viewportHeight × 0.8
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * viewportHeight * 0.8;
  return deltaY;
}

/**
 * 方向反转检测:新 sign 与上一个 nonzero sign 相反时返回 true(累加器应清零)。
 * 0 不算反转(避免抖动)。
 */
export function isWheelDirectionReversed(prevSign: number, newSign: number): boolean {
  return newSign !== 0 && prevSign !== 0 && newSign !== prevSign;
}

/**
 * 把累加器按 threshold 排空。返回剩余的累加值 + 要发的 button 序列。
 *  - |accum| < threshold:remaining = accum,ticks = []
 *  - |accum| ≥ threshold:每扣一份阈值发一次 button(accum > 0 → 65 / down, < 0 → 64 / up)
 *  - threshold ≤ 0:防御性把累计清零、不发(可能 cellHeight 异常)
 */
export function drainWheelAccum(
  accum: number,
  threshold: number,
): { remaining: number; ticks: SgrButton[] } {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { remaining: 0, ticks: [] };
  }
  const ticks: SgrButton[] = [];
  let remaining = accum;
  while (Math.abs(remaining) >= threshold) {
    ticks.push(remaining > 0 ? 65 : 64);
    remaining -= Math.sign(remaining) * threshold;
  }
  return { remaining, ticks };
}

// ──────────────── 类型 ────────────────

export interface UseTouchSwipeScrollOptions {
  containerRef: RefObject<HTMLElement | null>;
  /** alt-screen 状态（来自 backend 推送）。优先用 termRef 实时判定 */
  altScreen: boolean;
  termRef?: RefObject<XtermLike | null>;
  /** 发原始字节给 PTY；调用方包装为 send({type:'user_input',data}) */
  onSendKey: (data: string) => void;
  /** 主开关；用户在设置里关掉 TUI 滚动接管时传 false */
  enabled?: boolean;
  /**
   * 一次"滚动事件"对应的行数。数字 = 固定；'half' = floor(rows/2)；'full' = rows。
   * 默认 3。
   */
  scrollLines?: number | 'half' | 'full';
  /**
   * 鼠标滚轮 / 触摸板敏感度。控制累计多少像素 deltaY 才发一次 scrollLines 行
   * SGR(以 cellHeight 为基准的倍数 — low=2/med=1/high=0.5)。
   * 默认 'med'。
   *
   * Why:macOS Chrome 触摸板每次惯性滚动会发上百个小 deltaY 事件,旧实现
   * 每个事件直发 N 行,一拨手指就飞过几百行 transcript。改成累计触发后,
   * 一拨 = 物理距离对应的合理行数,跟原生 Terminal.app 体验对齐。
   */
  wheelSensitivity?: WheelSensitivity;
  /** 是否启用触摸 tap → SGR 点击。默认 true */
  tuiTapEnabled?: boolean;
  /** 长按触发回调（在 touchend 同步链路调用，确保能在 iOS 弹 IME） */
  onLongPress?: () => void;
  /** 长按阈值毫秒（默认 600） */
  longPressMs?: number;
  /** 长按候选开始视觉反馈：(x, y) 是触摸点 viewport 坐标 */
  onLongPressStart?: (x: number, y: number) => void;
  /** 长按取消：手指移动 / 抬起 / 触发完成都要关闭进度条 */
  onLongPressCancel?: () => void;
}

export function useTouchSwipeScroll(opts: UseTouchSwipeScrollOptions): void {
  const {
    containerRef,
    altScreen,
    onSendKey,
    enabled = true,
    termRef,
    scrollLines = 3,
    wheelSensitivity = 'med',
    tuiTapEnabled = true,
    onLongPress,
    longPressMs = 600,
    onLongPressStart,
    onLongPressCancel,
  } = opts;

  // 全部 prop 走 ref，避免每次 effect 重挂 listener
  const altRef = useRef(altScreen);
  const onSendKeyRef = useRef(onSendKey);
  const termRefRef = useRef(termRef);
  const scrollLinesRef = useRef(scrollLines);
  const wheelSensitivityRef = useRef(wheelSensitivity);
  const tuiTapEnabledRef = useRef(tuiTapEnabled);
  const onLongPressRef = useRef(onLongPress);
  const longPressMsRef = useRef(longPressMs);
  const onLongPressStartRef = useRef(onLongPressStart);
  const onLongPressCancelRef = useRef(onLongPressCancel);
  altRef.current = altScreen;
  onSendKeyRef.current = onSendKey;
  termRefRef.current = termRef;
  scrollLinesRef.current = scrollLines;
  wheelSensitivityRef.current = wheelSensitivity;
  tuiTapEnabledRef.current = tuiTapEnabled;
  onLongPressRef.current = onLongPress;
  longPressMsRef.current = longPressMs;
  onLongPressStartRef.current = onLongPressStart;
  onLongPressCancelRef.current = onLongPressCancel;

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    // ─────────── 工具函数 ───────────

    /** 实时判 alt-screen：优先 xterm buffer，次选 prop */
    const inAlt = (): boolean => {
      const t = termRefRef.current?.current;
      return t ? termIsAlt(t) : altRef.current;
    };

    /** 拿当前 term 实例 + 关键运行时状态 */
    const getCtx = (): { term: XtermLike; elt: HTMLElement } | null => {
      const t = termRefRef.current?.current;
      if (!t || !t.element || !inAlt() || !isMouseReportingActive(t as unknown)) return null;
      return { term: t, elt: t.element };
    };

    /** 解析 scrollLines 配置为运行时具体行数 */
    const resolveLines = (rows: number): number => {
      const v = scrollLinesRef.current;
      if (v === 'half') return Math.max(1, Math.floor(rows / 2));
      if (v === 'full') return Math.max(1, rows);
      return Math.max(1, Math.trunc(v));
    };

    /** 发 N 行 wheel SGR（button 64=up / 65=down） */
    const sendWheel = (button: SgrButton, lines: number, col: number, row: number): void => {
      let payload = '';
      for (let i = 0; i < lines; i++) {
        payload += buildSgrEvent(button, col, row);
      }
      onSendKeyRef.current(payload);
    };

    /** 发一对 press+release（普通点击） */
    const sendClick = (button: SgrButton, col: number, row: number): void => {
      onSendKeyRef.current(buildSgrEvent(button, col, row, { release: true }));
    };

    // ─────────── 跨 handler 共享状态 ───────────

    /** 最近 touchstart 时间戳：判后续 mouse 事件来源 */
    let lastTouchTs = 0;
    /** tap 已发 SGR 时间戳：抑制后续合成 mousedown 双发 */
    let lastTapSgrTs = 0;
    /** 用户主动 blur 标志（tap 收起 IME 时设）：让 focus guard 不要抢回 */
    let userIntentBlurTs = 0;

    // ─────────── Touch handler（移动端 swipe / tap / 长按） ───────────

    let startX = 0;
    let startY = 0;
    let lastEmitY = 0;
    let pendingDelta = 0;
    let active = false;
    let vertical = false;
    let movedBeyondTap = false;
    let tapStartTs = 0;
    let longPressFired = false;
    let longPressTimer = 0;
    let progressShowTimer = 0;
    let progressShown = false;
    let rafId = 0;

    /** swipe 累积消化：每 SWIPE_STEP_PX = 一次 wheel 事件 */
    const flushSwipe = (): void => {
      rafId = 0;
      const ctx = getCtx();
      if (!ctx) return;
      const { term, elt } = ctx;
      const baseSteps = Math.trunc(pendingDelta / SWIPE_STEP_PX);
      if (baseSteps === 0) return;
      pendingDelta -= baseSteps * SWIPE_STEP_PX;

      const linesPerStep = resolveLines(term.rows);
      const totalLines = baseSteps * linesPerStep;
      // 手指下滑（baseSteps>0）= 看上面 = button 64
      const button: SgrButton = totalLines > 0 ? 64 : 65;
      const lines = Math.abs(totalLines);
      // touch swipe 用屏幕中心作为 SGR 坐标（多数 TUI 不在意精确坐标，只看 button）
      const col = Math.max(1, Math.floor(term.cols / 2));
      const row = Math.max(1, Math.floor(term.rows / 2));
      sendWheel(button, lines, col, row);
      void elt; // elt 在此分支未使用，但 ctx 仍校验它存在
    };

    const cancelProgress = (): void => {
      if (progressShowTimer !== 0) {
        clearTimeout(progressShowTimer);
        progressShowTimer = 0;
      }
      if (progressShown) {
        progressShown = false;
        onLongPressCancelRef.current?.();
      }
    };

    const cancelLongPress = (): void => {
      if (longPressTimer !== 0) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
      cancelProgress();
    };

    const onTouchStart = (e: TouchEvent): void => {
      lastTouchTs = performance.now();
      if (!inAlt() || e.touches.length !== 1) {
        tapStartTs = 0;
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      lastEmitY = startY;
      pendingDelta = 0;
      active = true;
      vertical = false;
      movedBeyondTap = false;
      longPressFired = false;
      tapStartTs = performance.now();

      // 进度条延迟显示 + 长按计时（仅 mouse-active 时启动）
      if (!getCtx() || !onLongPressRef.current) return;
      const x = t.clientX;
      const y = t.clientY;
      progressShowTimer = window.setTimeout(() => {
        progressShowTimer = 0;
        if (movedBeyondTap || tapStartTs === 0) return;
        progressShown = true;
        onLongPressStartRef.current?.(x, y);
      }, PROGRESS_DELAY_MS);
      longPressTimer = window.setTimeout(() => {
        longPressTimer = 0;
        if (movedBeyondTap || tapStartTs === 0 || !getCtx()) return;
        longPressFired = true;
        // 关闭进度条 UI；focus 必须留到 touchend（iOS user-gesture）
        cancelProgress();
      }, longPressMsRef.current);
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (!active || !inAlt()) return;
      const t = e.touches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (!movedBeyondTap && Math.hypot(dx, dy) > TAP_DIST_PX) {
        movedBeyondTap = true;
        cancelLongPress();
      }

      // 还没判方向：等位移够大再决定
      if (!vertical) {
        if (ady < MIN_DELTA_PX && adx < MIN_DELTA_PX) return;
        if (ady > adx * VERTICAL_RATIO) {
          vertical = true;
        } else {
          active = false;
          return;
        }
      }

      // 接管垂直 swipe，阻止页面滚动
      if (e.cancelable) e.preventDefault();

      const deltaThisMove = t.clientY - lastEmitY;
      lastEmitY = t.clientY;
      pendingDelta += deltaThisMove;

      if (rafId === 0) rafId = requestAnimationFrame(flushSwipe);
    };

    const onTouchEnd = (e: TouchEvent): void => {
      cancelLongPress();

      // 长按 armed → 同步触发回调（iOS 要求 user-gesture 链路里调 .focus()）
      if (longPressFired) {
        onLongPressRef.current?.();
        // **iOS focus 保活**：长按抬手后 ~300ms 内浏览器（合成 click 默认
        // 焦点转移 / 布局调整 / 不明原因）会把 textarea blur 到 body。
        // 这里短暂监听 focusout，一旦发生就立即 refocus 同一 textarea。
        // 用户主动打字 / 切到别的可 focus 元素时，relatedTarget 非空 → 不抢回。
        const armedAt = performance.now();
        const PROTECT_MS = 400;
        const focusGuard = (fe: FocusEvent): void => {
          if (performance.now() - armedAt > PROTECT_MS) {
            document.removeEventListener('focusout', focusGuard, true);
            return;
          }
          const t = fe.target as HTMLElement | null;
          const related = fe.relatedTarget as HTMLElement | null;
          // 用户主动 blur（短 tap 收起 IME）：尊重，不抢回
          if (performance.now() - userIntentBlurTs < 300) return;
          // 用户切去别的可 focus 元素：尊重
          if (related && related !== document.body) return;
          // 只保护 textarea / input
          if (t?.tagName !== 'TEXTAREA' && t?.tagName !== 'INPUT') return;
          // 立刻 refocus（同步在 focusout 链路内调，user gesture 还活）
          requestAnimationFrame(() => {
            if (document.activeElement === document.body) {
              t.focus({ preventScroll: true });
            }
          });
        };
        document.addEventListener('focusout', focusGuard, true);
        window.setTimeout(() => {
          document.removeEventListener('focusout', focusGuard, true);
        }, PROTECT_MS + 50);
      } else {
        // tap 判定：未移位、未触发长按、时长够短
        const elapsed = tapStartTs > 0 ? performance.now() - tapStartTs : Infinity;
        const isTap =
          tuiTapEnabledRef.current &&
          tapStartTs > 0 &&
          !movedBeyondTap &&
          elapsed < TAP_TIME_MS;
        if (isTap) {
          // **IME 收起优先级**：如果当前焦点在 textarea / input 上（说明长按
          // 已经弹起 IME），这次 tap 改成 blur → 收起 IME，不发 SGR。
          // 这样用户可以"长按弹 IME → 输入完点屏 → 关 IME"。
          const focused = document.activeElement as HTMLElement | null;
          const isTextInputFocused =
            focused?.tagName === 'TEXTAREA' || focused?.tagName === 'INPUT';
          if (isTextInputFocused) {
            userIntentBlurTs = performance.now();
            focused?.blur();
          } else {
            const ctx = getCtx();
            const ct = e.changedTouches[0];
            if (ctx && ct) {
              const { col, row } = clientToCell(ctx.elt, ctx.term, ct.clientX, ct.clientY);
              sendClick(0, col, row);
              lastTapSgrTs = performance.now();
            }
          }
        }
      }

      active = false;
      vertical = false;
      pendingDelta = 0;
      tapStartTs = 0;
      movedBeyondTap = false;
      longPressFired = false;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    // ─────────── Wheel handler（桌面鼠标 + 触摸板） ───────────
    //
    // 设计:不再每个 wheel 事件直发 SGR(老路 = 触摸板惯性流 100+ 事件 →
    // 几百行飞屏),改累计 deltaY 达到阈值才发,且 rAF 节流。
    //
    //  - 阈值 = cellHeight × WHEEL_SENSITIVITY_MULTIPLIER[wheelSensitivity]
    //    low=2(mac 触摸板舒适),med=1(默认),high=0.5(传统鼠标灵敏)
    //  - 方向反向 → 清零累计(避免上下来回有遗留 delta 残留发"反向行")
    //  - rAF 节流:浏览器 burst 期一帧内多次 onWheel 只在帧尾 flush 一次
    //  - 同帧累计可能足够发多行 SGR(如鼠标大 notch deltaY=120,4 个 cell 高)
    //    → 一次 flush 内 while-loop 扣阈值多次发,直到余量不足
    //
    // 坐标:用首次累计开始时的 clientX/Y 作为发 SGR 的 (col,row);后续累计
    // 期间用最新坐标。绝大多数情况位置都在 viewport 中,(col,row) 几乎不影响
    // TUI 行为(它只看 wheel button 值),稳定就够
    let wheelAccum = 0;
    /** 上一次 onWheel 的 deltaY 符号;用于检测方向反转 */
    let wheelLastSign = 0;
    let wheelLastClientX = 0;
    let wheelLastClientY = 0;
    let wheelRafId = 0;

    const flushWheelAccum = (): void => {
      wheelRafId = 0;
      const ctx = getCtx();
      if (!ctx) {
        wheelAccum = 0;
        return;
      }
      const { term, elt } = ctx;
      const cellH = Math.max(8, getCellHeight(elt, term)); // 8 兜底防 0 除
      const mult = WHEEL_SENSITIVITY_MULTIPLIER[wheelSensitivityRef.current];
      const threshold = cellH * mult;
      const linesPerNotch = resolveLines(term.rows);
      const { col, row } = clientToCell(elt, term, wheelLastClientX, wheelLastClientY);

      const { remaining, ticks } = drainWheelAccum(wheelAccum, threshold);
      wheelAccum = remaining;
      for (const button of ticks) {
        sendWheel(button, linesPerNotch, col, row);
      }
    };

    const onWheel = (e: WheelEvent): void => {
      const ctx = getCtx();
      if (!ctx) return;
      e.stopPropagation();
      e.preventDefault();

      const dy = normalizeWheelDelta(e.deltaY, e.deltaMode, window.innerHeight);
      const sign = Math.sign(dy);
      if (isWheelDirectionReversed(wheelLastSign, sign)) {
        // 方向反转清零:防止"刚累计上 30px,反手下 30px → 互抵不响应"
        // 或反向少量 delta 触发反向 SGR 的误触
        wheelAccum = 0;
      }
      wheelLastSign = sign;
      wheelAccum += dy;
      wheelLastClientX = e.clientX;
      wheelLastClientY = e.clientY;

      // rAF 节流:同一帧内多次 onWheel 合并到帧尾 flush 一次
      if (wheelRafId === 0) {
        wheelRafId = requestAnimationFrame(flushWheelAccum);
      }
    };

    // ─────────── Mouse handler（PC 真鼠标点击 + 拦截 helper-textarea 焦点） ───────────

    /**
     * mousedown 在 mouse-active 下统一接管：
     *
     *  - **PC 真鼠标（fromTouch=false）**：自己发 SGR + 手动喂给 SelectionService。
     *    为什么不放过：xterm 主 handler 会调 `getMouseReportCoords` 访问
     *    `_renderService.dimensions`，renderer 异常 dispose（如 WebGL context
     *    丢失）后 dimensions=undefined → 抛错 → SGR 没发出去。
     *    解决：自己拼字节绕过崩溃路径，并用 `dispatchSelectionMouseDown` 单独
     *    把事件转给 SelectionService 启动选择，保留拖选功能。
     *
     *  - **触摸合成（fromTouch=true）**：拦下，避免 helper-textarea 获焦弹 iOS IME。
     *    - 抑制窗口内（tap 已发 SGR）：只 stop，不重复发
     *    - 抑制窗口外（罕见）：自己拼 SGR
     */
    const onMouseDown = (e: MouseEvent): void => {
      const ctx = getCtx();
      if (!ctx) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const fromTouch = performance.now() - lastTouchTs < TOUCH_MEMORY_MS;
      const inSuppressWindow = performance.now() - lastTapSgrTs < TAP_SUPPRESS_MS;

      // 触摸 + tap 抑制窗口：tap 路径已发 SGR，不重复
      if (fromTouch && inSuppressWindow) return;

      // 自己发 SGR（绕过 xterm 主 handler 的潜在崩溃）
      const button: SgrButton = e.button === 1 ? 1 : e.button === 2 ? 2 : 0;
      const { col, row } = clientToCell(ctx.elt, ctx.term, e.clientX, e.clientY);
      sendClick(button, col, row);

      // PC 真鼠标：手动喂 SelectionService 启动文本选择（保留拖选 + 复制能力）
      // 触摸事件不走这条——SelectionService 是为鼠标设计的，touch 由 xterm 自己
      // 内部其他路径处理。
      if (!fromTouch) {
        dispatchSelectionMouseDown(ctx.term, e);
      }
    };

    /**
     * click 拦截：仅触摸合成的 click 拦下，避免浏览器把焦点重置到 click target
     * → 长按后刚 focus 的 InputBar 又被抢走。PC click 放过给 InstanceView 容器
     * onClick 处理 focus 转移。
     */
    const onClick = (e: MouseEvent): void => {
      if (!getCtx()) return;
      const fromTouch = performance.now() - lastTouchTs < TOUCH_MEMORY_MS;
      if (!fromTouch) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    /**
     * mouseup（仅 PC）：mouse-active 模式下 SelectionService 选完文本后，xterm
     * 内部 / 应用回写 PTY 都可能立即清掉选区。这里在 mouseup 抢先把 selection
     * 文本写到剪贴板，让"拖选 = 自动复制"成立。
     *
     * 不监听 touch 端：移动端选区有自己的系统复制菜单。
     */
    /**
     * 拖选完成后自动复制到剪贴板。
     *
     * 必须**同步**在 mouseup 链路里读 selection 并启动复制——execCommand 降级
     * 路径要求 user-gesture，rAF 之后就丢资格。多数情况下 mouseup 触发时
     * SelectionService 已经 finalSelectionEnd（它自己也挂了 mouseup listener）。
     */
    const onMouseUp = (): void => {
      const ctx = getCtx();
      if (!ctx) return;
      const fromTouch = performance.now() - lastTouchTs < TOUCH_MEMORY_MS;
      if (fromTouch) return;
      const text = ctx.term.getSelection?.() ?? '';
      if (!text) return;
      // copyToClipboard 内部同步先尝试现代 API，失败降级 execCommand
      // user-gesture 资格在此调用瞬间还活着
      void copyToClipboard(text);
    };

    // ─────────── 注册 ───────────

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    el.addEventListener('mousedown', onMouseDown, { capture: true });
    el.addEventListener('click', onClick, { capture: true });
    // mouseup 用 document：拖动可能在 element 外抬起（手指 / 鼠标超出 xterm 边界）
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      el.removeEventListener('mousedown', onMouseDown, { capture: true } as EventListenerOptions);
      el.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
      document.removeEventListener('mouseup', onMouseUp);
      if (rafId !== 0) cancelAnimationFrame(rafId);
      if (wheelRafId !== 0) cancelAnimationFrame(wheelRafId);
      if (longPressTimer !== 0) clearTimeout(longPressTimer);
      if (progressShowTimer !== 0) clearTimeout(progressShowTimer);
    };
  }, [containerRef, enabled]);
}
