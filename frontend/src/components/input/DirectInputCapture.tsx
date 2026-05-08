/**
 * DirectInputCapture
 *
 * 直接输入模式（useInputBar=false）下的 iOS 兼容输入捕获层。
 *
 * 通过 useTextareaInputGuard hook 接收"用户真实意图"（已过滤掉 iOS Smart
 * Punctuation / QuickType / 自动空格删除等智能键盘行为），按终端语义直接转
 * 字节流送 PTY：
 *   - insert text → onSend(text)
 *   - delete N    → onSend('\x7f' × N)
 *   - replace     → onSend('\x7f' × N + text)
 *
 * 模式：'stream' —— hook 内部 commit 后立刻清空 buffer，textarea 始终空。
 *
 * 控制键（Enter / Tab / 方向键 / Ctrl+X 等）走 keydown 直接发转义序列；
 * 调用 hook.flushPending() 把任何挂起的 smart-punct delete 提前发出，
 * 保证字节顺序。
 *
 * IME 中文：composition 期间冻结，compositionend 时把 e.data 整段 send。
 *
 * textarea 是非受控的（无 React value/onChange），由 hook 直接管理。
 */

import {
  forwardRef,
  useCallback,
  useRef,
  type KeyboardEvent,
  type CompositionEvent,
} from 'react';
import { useTextareaInputGuard, type InputIntent } from '../../hooks/useTextareaInputGuard.js';
import s from './DirectInputCapture.module.scss';

export interface DirectInputCaptureProps {
  onSend: (data: string) => void;
}

/** 控制键 → PTY 转义序列映射 */
function controlKeyToSequence(
  key: string,
  ctrl: boolean,
  alt: boolean,
  meta: boolean,
): string | null {
  if (ctrl && !alt && !meta) {
    const k = key.toLowerCase();
    if (k.length === 1 && k >= 'a' && k <= 'z') {
      return String.fromCharCode(k.charCodeAt(0) - 96);
    }
  }
  switch (key) {
    case 'Enter':       return '\r';
    case 'Tab':         return '\t';
    case 'Escape':      return '\x1b';
    case 'ArrowUp':     return '\x1b[A';
    case 'ArrowDown':   return '\x1b[B';
    case 'ArrowRight':  return '\x1b[C';
    case 'ArrowLeft':   return '\x1b[D';
    case 'Home':        return '\x1b[H';
    case 'End':         return '\x1b[F';
    case 'PageUp':      return '\x1b[5~';
    case 'PageDown':    return '\x1b[6~';
    case 'Delete':      return '\x1b[3~';
    default:            return null;
  }
}

export const DirectInputCapture = forwardRef<HTMLTextAreaElement, DirectInputCaptureProps>(
  function DirectInputCapture({ onSend }, ref) {
    const elRef = useRef<HTMLTextAreaElement | null>(null);
    const composingRef = useRef(false);

    const onCommit = useCallback((intent: InputIntent): void => {
      switch (intent.kind) {
        case 'insert':
          onSend(intent.text);
          break;
        case 'delete':
          onSend('\x7f'.repeat(intent.count));
          break;
        case 'replace':
          onSend('\x7f'.repeat(intent.deleteCount) + intent.insert);
          break;
      }
    }, [onSend]);

    const { flushPending, clear } = useTextareaInputGuard(elRef, {
      mode: 'stream',
      onCommit,
      composingRef,
    });

    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (composingRef.current || e.nativeEvent.isComposing) return;
        const ctrlSeq = controlKeyToSequence(e.key, e.ctrlKey, e.altKey, e.metaKey);
        if (ctrlSeq !== null) {
          e.preventDefault();
          flushPending();
          onSend(ctrlSeq);
          if (e.key === 'Enter') {
            // Enter 提交后清空一切（防止 textarea 累积无关文本）
            clear();
          }
        }
      },
      [onSend, flushPending, clear],
    );

    const onCompositionStart = useCallback((): void => {
      composingRef.current = true;
    }, []);

    const onCompositionEnd = useCallback(
      (e: CompositionEvent<HTMLTextAreaElement>): void => {
        composingRef.current = false;
        const data = e.data;
        if (data && data.length > 0) onSend(data);
        clear();
      },
      [onSend, clear],
    );

    const setRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        elRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );

    return (
      <textarea
        ref={setRef}
        className={s.capture}
        // 非受控：无 value/onChange，textarea.value 由 useTextareaInputGuard 管理
        defaultValue=""
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // CodeMirror 6.36.3 (2024-12)：关 Safari 18 Apple Intelligence completion
        // @ts-expect-error: writingsuggestions 是新 HTML 属性，TS DOM 类型未收录
        writingsuggestions="false"
        translate="no"
        inputMode="url"
        rows={1}
        aria-label="terminal input"
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
    );
  },
);
