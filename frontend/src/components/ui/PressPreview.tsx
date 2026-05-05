/**
 * PressPreview
 *
 * 为快捷键 / 命令按钮提供"长按看说明、上移确认发送"的交互。仿 iOS 键盘按键预览。
 *
 * 触发链路：
 *  1. pointerdown：setPointerCapture，启动 500ms 定时器；按钮加 pressing 视觉态（磷光发光）
 *  2. 短按（500ms 内 pointerup）→ 走轻击逻辑：onPress() 直接发送
 *  3. 长按（停留 ≥ 500ms 不动）→ 进入预览态：浮层 portal 到 body，结构（从下到上）：
 *       原位置按钮（保持磷光）→ 上方放大版「确认按钮」（label）→ 上方说明气泡（desc）
 *  4. 预览态下 pointermove：用 elementsFromPoint 判断光标是否落在确认按钮上 → armed
 *  5. pointerup：
 *       armed=true（手指在确认按钮上） → 发送
 *       armed=false（手指离开确认按钮 / 留在原按钮）→ 取消
 *
 * 取舍：
 *  - 不依赖 Radix（Radix Tooltip 是悬停模型，对长按 + 滑动确认不友好）
 *  - 浮层用 createPortal 直接挂到 document.body，避免被父 overflow 裁掉
 *  - 浮层背景层不接收事件（pointer-events: none），仅"确认按钮"接收事件
 *  - elementsFromPoint 能绕过 setPointerCapture 让命中检测看到真实 DOM 树
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import s from './PressPreview.module.scss';

export interface PressPreviewProps {
  /** 按下时显示的主标签（短文本，如 Esc / /clear） */
  label: string;
  /** 说明气泡文本；为空时不渲染说明气泡，但仍会出预览按钮 */
  desc?: string;
  /** 触发发送 */
  onPress: () => void;
  /** 全局禁用 */
  disabled?: boolean;
  /** 渲染按钮内容（通常就是 label，但留给调用方控制是否需要装饰） */
  children: ReactNode;
  /** 按钮外层类名 */
  className?: string;
  /** 按下中（pressing）时的附加类名（用于磷光发光） */
  activeClassName?: string;
  /** 长按显示预览的延迟，默认 500ms */
  longPressDelay?: number;
}

const DEFAULT_LONG_PRESS = 500;
/** 进入预览前允许的微小抖动（防止安静放着也算移动） */
const PRESS_MOVE_TOLERANCE = 8;

interface ButtonRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const PressPreview = forwardRef<HTMLButtonElement, PressPreviewProps>(
  function PressPreview(
    {
      label,
      desc,
      onPress,
      disabled,
      children,
      className,
      activeClassName,
      longPressDelay = DEFAULT_LONG_PRESS,
    },
    forwardedRef,
  ): JSX.Element {
    const btnRef = useRef<HTMLButtonElement | null>(null);
    useImperativeHandle(forwardedRef, () => btnRef.current as HTMLButtonElement);

    const [pressing, setPressing] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [armed, setArmed] = useState(false);
    const [rect, setRect] = useState<ButtonRect | null>(null);

    // 镜像 state 让 window 级 handler 拿到最新值（避免闭包过期）
    const previewingRef = useRef(false);
    const armedRef = useRef(false);
    previewingRef.current = previewing;
    armedRef.current = armed;

    // 跟踪当前 pointer 状态，避免闭包过期
    const stateRef = useRef<{
      pointerId: number | null;
      startX: number;
      startY: number;
      timer: number | null;
      released: boolean;
      windowHandlers: (() => void) | null;
    }>({
      pointerId: null,
      startX: 0,
      startY: 0,
      timer: null,
      released: false,
      windowHandlers: null,
    });

    const cleanup = useCallback(() => {
      if (stateRef.current.timer !== null) {
        window.clearTimeout(stateRef.current.timer);
      }
      const btn = btnRef.current;
      const pid = stateRef.current.pointerId;
      if (btn && pid !== null && btn.hasPointerCapture(pid)) {
        try {
          btn.releasePointerCapture(pid);
        } catch {
          /* 已释放 */
        }
      }
      // 解绑 window 兜底监听
      stateRef.current.windowHandlers?.();
      stateRef.current = {
        pointerId: null,
        startX: 0,
        startY: 0,
        timer: null,
        released: false,
        windowHandlers: null,
      };
      setPressing(false);
      setPreviewing(false);
      setArmed(false);
      setRect(null);
    }, []);

    // 用 ref 间接调 onPress，保证 window handler 能拿到最新
    const onPressRef = useRef(onPress);
    onPressRef.current = onPress;
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;

    /**
     * 在 window 上绑兜底 pointerup / pointercancel：
     * 浮层 confirm 按钮 portal 到 body 且 pointer-events:auto，iOS Safari 在
     * 某些时序下 pointer-capture 会被夺走，导致原按钮收不到 pointerup → 卡在按下态
     * 这层兜底确保任何位置释放都能 cleanup
     */
    const attachWindowListeners = useCallback(
      (pointerId: number) => {
        const onUp = (ev: PointerEvent): void => {
          if (ev.pointerId !== pointerId) return;
          const wasPreviewing = previewingRef.current;
          const wasArmed = armedRef.current;
          stateRef.current.released = true;
          // 在 window 上重新做命中检测（不依赖原按钮收 pointermove）
          const hit = document.elementsFromPoint(ev.clientX, ev.clientY);
          const onConfirm = hit.some(
            (el) => el instanceof HTMLElement && el.dataset.pressPreviewConfirm === '1',
          );
          cleanup();
          if (disabledRef.current) return;
          if (!wasPreviewing) {
            // 短按：直接发送
            onPressRef.current();
          } else if (wasArmed || onConfirm) {
            onPressRef.current();
          }
        };
        const onCancel = (ev: PointerEvent): void => {
          if (ev.pointerId !== pointerId) return;
          cleanup();
        };
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        // 浏览器/系统事件兜底：tab 切走、窗口失焦也复位
        const onVis = (): void => {
          if (document.visibilityState !== 'visible') cleanup();
        };
        const onBlur = (): void => cleanup();
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('blur', onBlur);

        stateRef.current.windowHandlers = () => {
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          document.removeEventListener('visibilitychange', onVis);
          window.removeEventListener('blur', onBlur);
        };
      },
      [cleanup],
    );

    useEffect(() => () => cleanup(), [cleanup]);

    const onPointerDown = useCallback(
      (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const btn = btnRef.current;
        if (!btn) return;

        // 同时只允许一个 pointer
        if (stateRef.current.pointerId !== null) return;

        // 阻止按钮默认聚焦行为：保留 InputBar 焦点，避免移动端键盘收起
        e.preventDefault();

        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* 旧浏览器 */
        }

        const r = btn.getBoundingClientRect();
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
        setPressing(true);

        stateRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          released: false,
          timer: window.setTimeout(() => {
            // 进入预览：仅当未释放
            if (stateRef.current.released) return;
            setPreviewing(true);
          }, longPressDelay),
          windowHandlers: null, // 下面 attach 后会填充
        };

        // 兜底监听：进入预览态后浮层 confirm 是 portal 节点 + pointer-events:auto，
        // iOS Safari 在某些时序下 pointer-capture 会被夺走 / pointerup 不再回到原按钮，
        // 卡死在 pressing 状态。
        // 同时绑 window 级 pointerup/cancel，确保任何释放都能被捕获 → cleanup
        attachWindowListeners(e.pointerId);
      },
      [disabled, longPressDelay],
    );

    const onPointerMove = useCallback(
      (e: ReactPointerEvent<HTMLButtonElement>) => {
        const st = stateRef.current;
        if (st.pointerId === null || st.pointerId !== e.pointerId) return;

        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;

        // 还在 pending 阶段（没进入预览）：超过容差就直接当成"取消长按"——
        // 仍保留 click 行为，但不会进入预览态
        if (!previewing) {
          if (Math.hypot(dx, dy) > PRESS_MOVE_TOLERANCE) {
            if (st.timer !== null) {
              window.clearTimeout(st.timer);
              st.timer = null;
            }
          }
          return;
        }

        // 预览态：检测光标是否落在浮层"确认按钮"上
        // elementsFromPoint 能绕过 pointer-capture 看到真实 DOM 命中
        const hit = document.elementsFromPoint(e.clientX, e.clientY);
        const onConfirm = hit.some(
          (el) => el instanceof HTMLElement && el.dataset.pressPreviewConfirm === '1',
        );
        if (onConfirm !== armed) setArmed(onConfirm);
      },
      [previewing, armed],
    );

    const onPointerUp = useCallback(
      (e: ReactPointerEvent<HTMLButtonElement>) => {
        const st = stateRef.current;
        if (st.pointerId === null || st.pointerId !== e.pointerId) return;
        st.released = true;

        const wasPreviewing = previewing;
        const wasArmed = armed;
        cleanup();

        if (disabled) return;

        if (!wasPreviewing) {
          // 短按：直接发送
          onPress();
        } else if (wasArmed) {
          // 长按 + 上移到确认按钮：发送
          onPress();
        }
        // 否则：长按但没上移 → 取消
      },
      [previewing, armed, cleanup, disabled, onPress],
    );

    const onPointerCancel = useCallback((_e: ReactPointerEvent<HTMLButtonElement>) => {
      cleanup();
    }, [cleanup]);

    return (
      <>
        <button
          type="button"
          ref={btnRef}
          disabled={disabled}
          className={clsx(
            s.root,
            className,
            (pressing || previewing) && activeClassName,
            (pressing || previewing) && s.pressing,
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          // 阻止系统级长按菜单（Android 选词、iOS 放大镜）
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none' }}
        >
          {children}
        </button>

        {previewing && rect && (
          <PressPreviewLayer
            label={label}
            desc={desc}
            anchor={rect}
            armed={armed}
          />
        )}
      </>
    );
  },
);

// ─────────────────────────────────────────────────────────────
// 浮层
// ─────────────────────────────────────────────────────────────

interface LayerProps {
  label: string;
  desc?: string;
  anchor: ButtonRect;
  armed: boolean;
}

function PressPreviewLayer({ label, desc, anchor, armed }: LayerProps): JSX.Element {
  // 确认按钮：放大版（width 至少 48px，padding 大），位置在原按钮正上方 12px
  // 说明气泡：再往上 8px，水平居中于确认按钮，最大宽 240px
  // 使用 fixed + 视口坐标
  const confirmW = Math.max(56, anchor.width + 24);
  const confirmH = Math.max(40, anchor.height + 18);
  const confirmX = anchor.left + anchor.width / 2 - confirmW / 2;
  const confirmY = anchor.top - confirmH - 12;

  // 防越界（左右贴边）
  const padding = 8;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const clampedConfirmX = Math.min(
    Math.max(padding, confirmX),
    vw - padding - confirmW,
  );

  // 说明气泡放在确认按钮上方
  const bubbleStyle: CSSProperties = {
    left: clampedConfirmX + confirmW / 2,
    top: confirmY - 8,
    transform: 'translate(-50%, -100%)',
  };

  const confirmStyle: CSSProperties = {
    left: clampedConfirmX,
    top: confirmY,
    width: confirmW,
    height: confirmH,
  };

  return createPortal(
    <div className={s.layer}>
      {desc && (
        <div className={s.bubble} style={bubbleStyle}>
          {desc}
        </div>
      )}
      <div
        className={clsx(s.confirm, armed && s.confirmArmed)}
        style={confirmStyle}
        data-press-preview-confirm="1"
      >
        {label}
      </div>
    </div>,
    document.body,
  );
}
