/**
 * InputBar
 *
 * 输入栏：**非受控** textarea + 发送 + 设置按钮。
 *
 * ## 为什么非受控
 *
 * 受控 textarea + iOS Smart Punctuation 有一个无解死循环：iOS 智能键盘把
 * textarea.value 改了 → React onChange 触发 → setState → 下次 render 把 props
 * 同步回 textarea → 又触发新一轮事件。useTextareaInputGuard 的 commit 流程
 * 必须无干扰地维护"hook truth"，所以 InputBar 内部 textarea 必须非受控。
 *
 * ## 命令式 API
 *
 * 父组件通过 ref 调用：
 *   - `focus()` 聚焦到 textarea
 *   - `getValue()` 读当前 buffer
 *   - `setValue(text)` 程序化设值（Toolbar prefill 命令按钮 / 历史调出）
 *   - `clear()` 清空
 *
 * IME 兼容：composition 期间 hook 自动放行，compositionend 时 sync。
 * Enter 提交：拦截 keydown.Enter（非 Shift+Enter 且 IME 未 composing 时）调 onSubmit。
 */

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { IconSend, IconSettings, IconX } from '@tabler/icons-react';
import { IconButton } from '../ui/IconButton.js';
import { ConfirmModal } from '../ui/ConfirmModal.js';
import { useT } from '../../i18n/i18n-context.js';
import { useTextareaInputGuard } from '../../hooks/useTextareaInputGuard.js';
import s from './InputBar.module.scss';

/** 父组件能通过 ref 调用的命令式 API */
export interface InputBarHandle {
  focus: (opts?: FocusOptions) => void;
  getValue: () => string;
  setValue: (text: string) => void;
  clear: () => void;
}

export interface InputBarProps {
  /**
   * 提交回调（回车或点击发送）。
   * 返回 true 表示已成功发送 → InputBar 自动清空。
   */
  onSubmit: (data: string) => boolean;
  disabled?: boolean;
  onOpenSettings?: () => void;
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  { onSubmit, disabled, onOpenSettings },
  ref,
) {
  const t = useT();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const composingRef = useRef(false);
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  // CodeMirror 模式的"显示文本"：跟 hook truth (bufferRef) 同步，渲染到 .display
  // div。textarea 视觉透明，所以 iOS 改 textarea 的中间态用户看不到，只看到
  // 这个 displayText 的 React 受控渲染（一帧到位，无闪烁）
  const [displayText, setDisplayText] = useState('');
  // composition 期间的 IME 实时预览（候选词高亮）
  const [composingText, setComposingText] = useState('');

  const isEmpty = displayText.length === 0 && composingText.length === 0;

  const { getBuffer, setBuffer, clear, flushPending } = useTextareaInputGuard(elRef, {
    mode: 'buffered',
    composingRef,
    // 规范化：iOS 智能键盘在某些 layout 下输入"空格"实际是 U+00A0 (NBSP)。zsh
    // 把 NBSP 当普通字符，不是分词符 → "cd .." 被当成单个文件名。
    // 在 intent 落地前把所有 NBSP / narrow NBSP (U+202F) 替换成 ASCII space
    filter: (intent) => {
      const norm = (s: string): string => s.replace(/[  ]/g, ' ');
      switch (intent.kind) {
        case 'insert':   return { kind: 'insert', text: norm(intent.text) };
        case 'replace':  return { kind: 'replace', deleteCount: intent.deleteCount, insert: norm(intent.insert) };
        case 'delete':   return intent;
      }
    },
    onCommit: (_intent, ctx) => {
      // eslint-disable-next-line no-console
      console.log('[IB] setDisplayText', JSON.stringify({
        buffer: ctx.buffer,
        codes: [...ctx.buffer].map((c) => c.charCodeAt(0)),
      }));
      setDisplayText(ctx.buffer);
    },
  });

  useImperativeHandle(
    ref,
    (): InputBarHandle => ({
      focus: (opts) => elRef.current?.focus(opts),
      getValue: () => getBuffer(),
      setValue: (text) => {
        setBuffer(text);
        setDisplayText(text);
      },
      clear: () => {
        clear();
        setDisplayText('');
        setComposingText('');
      },
    }),
    [getBuffer, setBuffer, clear],
  );

  const send = useCallback((): void => {
    if (disabled) return;
    flushPending();
    const value = getBuffer();
    // eslint-disable-next-line no-console
    console.log('[IB] send', JSON.stringify({
      value, codes: [...value].map((c) => c.charCodeAt(0)), len: value.length,
    }));
    if (value.length === 0) return;
    const data = value + '\r';
    if (onSubmit(data)) {
      clear();
      setDisplayText('');
      setComposingText('');
    }
  }, [disabled, flushPending, getBuffer, onSubmit, clear]);

  // 阈值：少于 N 字符直接清，避免每次都打断；多了才二次确认
  const CLEAR_CONFIRM_THRESHOLD = 10;
  const handleClear = useCallback((): void => {
    const value = getBuffer();
    if (value.length === 0) return;
    if (value.length < CLEAR_CONFIRM_THRESHOLD) {
      clear();
      setDisplayText('');
      setComposingText('');
      return;
    }
    setConfirmClearOpen(true);
  }, [getBuffer, clear]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 提交；Shift+Enter 走 textarea 默认换行；IME composing 中不拦
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !composingRef.current &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const onFormSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      send();
    },
    [send],
  );

  return (
    <>
      <form id="input-bar" onSubmit={onFormSubmit} className={s.form}>
        <div className={s.inputWrap}>
          {/*
            CodeMirror 风格的"自管显示层"：textarea 视觉透明（color/caret/selection
            全 transparent），iOS 智能键盘对 textarea 的中间态修改用户看不到。
            用户看到的字符是这个 div 的内容（跟 hook truth 同步）。
            placeholder 也由 div 渲染（textarea 自身的 placeholder 仍存在但
            因为 textarea 本身透明所以看不到）。
          */}
          <div className={s.display} aria-hidden="true">
            {isEmpty ? (
              <>
                <span className={s.caret} />
                <span className={s.placeholder}>
                  {disabled ? t('input.placeholderDisabled') : t('input.placeholder')}
                </span>
              </>
            ) : (
              <>
                <span>{displayText}</span>
                {composingText && <span style={{ textDecoration: 'underline' }}>{composingText}</span>}
                <span className={s.caret} />
              </>
            )}
          </div>
          <textarea
            ref={elRef}
            disabled={disabled}
            // 非受控：value/onChange 都不设，textarea.value 由 useTextareaInputGuard 管理
            defaultValue=""
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
              setComposingText('');
            }}
            onCompositionUpdate={(e) => {
              setComposingText(e.data ?? '');
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false;
              setComposingText('');
              // hook 的 input 路径会 reconcile commit；这里同步 displayText
              // 兜底（如果 hook 异步还没跑）
              const cur = elRef.current?.value ?? '';
              if (cur !== displayText) setDisplayText(cur);
              // 防止未使用警告
              void e;
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // @ts-expect-error: writingsuggestions 是新 HTML 属性，TS DOM 类型未收录
            writingsuggestions="false"
            translate="no"
            rows={1}
            className={s.input}
          />
          {!disabled && !isEmpty && (
            <button
              type="button"
              // 阻止默认避免按下时 textarea 失焦闪烁
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              aria-label={t('common.clear')}
              title={t('common.clear')}
              className={s.clearBtn}
            >
              <IconX size={12} stroke={1.5} />
            </button>
          )}
        </div>
        <IconButton
          type="submit"
          variant="accent"
          disabled={disabled || isEmpty}
          aria-label={t('input.sendTooltip')}
        >
          <IconSend size={14} stroke={1.5} />
        </IconButton>
        {onOpenSettings && (
          <IconButton
            onClick={onOpenSettings}
            aria-label={t('topBar.settings')}
            title={t('topBar.settingsTooltip')}
          >
            <IconSettings size={14} stroke={1.5} />
          </IconButton>
        )}
      </form>
      {confirmClearOpen && (
        <ConfirmModal
          open
          title={t('input.clearConfirmTitle')}
          message={t('input.clearConfirmBody')}
          confirmTone="danger"
          confirmLabel={t('common.clear')}
          onConfirm={() => {
            clear();
            setDisplayText('');
            setComposingText('');
            setConfirmClearOpen(false);
          }}
          onClose={() => setConfirmClearOpen(false)}
        />
      )}
    </>
  );
});
