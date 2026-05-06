/**
 * DirectInputCapture
 *
 * 直接输入模式（useInputBar=false）下的 iOS 兼容输入捕获层。
 *
 * 背景：xterm 自带的 helper-textarea 在 iOS WebKit 下会出现：
 *  1. 1×1px + 偏屏外的 textarea，input 事件不可靠（部分字符 / IME 静默丢失）
 *  2. 即使能弹起键盘，普通字符 onData 不触发（仅退格走 keydown 路径有效）
 *  3. 强行给 helper-textarea 真实尺寸又会被 iOS scrollIntoView 扯走 fixed 容器
 *
 * 方案：用我们自己的真实 textarea 接管输入，绕过 xterm 的 helper-textarea。
 *  - 视觉透明（opacity:0）但有真实 1px 高度 + 100% 宽度，iOS 会派发完整事件
 *  - 每次 input → 立刻把 value 发 PTY 然后清空，textarea 始终保持空字符串
 *  - keydown 拦截 Enter / 退格 / 方向键等控制键，转成对应转义序列发送
 *  - IME composition 期间不发，compositionend 时整段中文一次发
 *
 * 挂在 terminalWrap 内，跟 helper-textarea 共存但 z-index 更高 + 拦截焦点。
 */

import {
  forwardRef,
  useCallback,
  useRef,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import s from './DirectInputCapture.module.scss';

export interface DirectInputCaptureProps {
  onSend: (data: string) => void;
}

/** 控制键 → PTY 转义序列映射 */
function keyToSequence(e: KeyboardEvent<HTMLTextAreaElement>): string | null {
  // 修饰键：Ctrl+A..Z → \x01..\x1a；其它修饰组合放给浏览器默认 / 不处理
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    const k = e.key.toLowerCase();
    if (k.length === 1 && k >= 'a' && k <= 'z') {
      return String.fromCharCode(k.charCodeAt(0) - 96);
    }
  }
  switch (e.key) {
    case 'Enter':
      return '\r';
    case 'Backspace':
      return '\x7f';
    case 'Tab':
      return '\t';
    case 'Escape':
      return '\x1b';
    case 'ArrowUp':
      return '\x1b[A';
    case 'ArrowDown':
      return '\x1b[B';
    case 'ArrowRight':
      return '\x1b[C';
    case 'ArrowLeft':
      return '\x1b[D';
    case 'Home':
      return '\x1b[H';
    case 'End':
      return '\x1b[F';
    case 'PageUp':
      return '\x1b[5~';
    case 'PageDown':
      return '\x1b[6~';
    case 'Delete':
      return '\x1b[3~';
    default:
      return null;
  }
}

export const DirectInputCapture = forwardRef<HTMLTextAreaElement, DirectInputCaptureProps>(
  function DirectInputCapture({ onSend }, ref) {
    // IME 合成中：input 事件不发，等 compositionend 一次性发整段
    const composingRef = useRef(false);

    const flushAndClear = useCallback(
      (el: HTMLTextAreaElement): void => {
        if (el.value.length === 0) return;
        onSend(el.value);
        el.value = '';
      },
      [onSend],
    );

    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // IME 期间所有 keydown 交给输入法
        if (composingRef.current || e.nativeEvent.isComposing) return;
        const seq = keyToSequence(e);
        if (seq !== null) {
          e.preventDefault();
          // 控制键之前可能有未发送的字符（罕见，但保险）
          flushAndClear(e.currentTarget);
          onSend(seq);
        }
      },
      [onSend, flushAndClear],
    );

    const onChange = useCallback(
      (e: ChangeEvent<HTMLTextAreaElement>) => {
        // IME 期间 input 事件可能多次触发（候选词更新），不发；等 compositionend
        if (composingRef.current) return;
        flushAndClear(e.currentTarget);
      },
      [flushAndClear],
    );

    return (
      <textarea
        ref={ref}
        className={s.capture}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        rows={1}
        aria-label="terminal input"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          flushAndClear(e.currentTarget);
        }}
      />
    );
  },
);
