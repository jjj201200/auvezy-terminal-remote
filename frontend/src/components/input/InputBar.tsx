/**
 * InputBar
 *
 * 输入栏（仅渲染输入框 + 发送按钮 + 设置按钮）。
 * 快捷键栏拆出 ShortcutsBar，由父级 ConsolePage 直接渲染（独立 sticky 行）。
 *
 * Shortcut 点击：直接 send(data)，不附加回车（用户可在 data 里自己写 \r）。
 */

import {
  useState,
  useCallback,
  type JSX,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, Settings } from 'lucide-react';
import type { ConfigurableShortcut } from '@ocr/shared';
import { IconButton } from '../ui/IconButton.js';
import { cn } from '../../utils/cn.js';

export interface InputBarProps {
  /** 发送一条用户输入到服务端，返回是否成功（false 一般是 WS 离线） */
  onSend: (data: string) => boolean;
  /** 是否禁用（如未连接） */
  disabled?: boolean;
  /** 设置按钮回调；不传则不显示按钮 */
  onOpenSettings?: () => void;
}

export function InputBar({
  onSend,
  disabled,
  onOpenSettings,
}: InputBarProps): JSX.Element {
  const [value, setValue] = useState('');

  const send = useCallback(
    (withReturn: boolean): void => {
      if (disabled) return;
      const data = withReturn ? value + '\r' : value;
      if (data.length === 0) return;
      if (onSend(data)) setValue('');
    },
    [onSend, disabled, value],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send(true);
      }
    },
    [send],
  );

  const onFormSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      send(true);
    },
    [send],
  );

  return (
    <form
      onSubmit={onFormSubmit}
      className="flex shrink-0 items-stretch gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"
    >
      <input
        type="text"
        placeholder={disabled ? '未连接…' : '输入命令，回车发送'}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="flex-1 min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-base text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || value.length === 0}
        aria-label="发送"
        className="rounded-md bg-[var(--color-accent)] px-3 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send size={14} strokeWidth={1.5} />
      </button>
      {onOpenSettings && (
        <IconButton onClick={onOpenSettings} aria-label="设置" title="设置">
          <Settings size={14} strokeWidth={1.5} />
        </IconButton>
      )}
    </form>
  );
}

export interface ShortcutsBarProps {
  shortcuts?: ConfigurableShortcut[];
  onShortcut: (data: string) => void;
  disabled?: boolean;
}

/**
 * 快捷键栏：从 InputBar 拆出，独立行渲染。
 * 移动端单行横向滚动（scrollbar-hide）。
 */
export function ShortcutsBar({
  shortcuts,
  onShortcut,
  disabled,
}: ShortcutsBarProps): JSX.Element | null {
  const enabled = (shortcuts ?? []).filter((s) => s.enabled);
  if (enabled.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto scrollbar-hide border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1">
      {enabled.map((s, idx) => (
        <button
          type="button"
          key={`${s.label}-${idx}`}
          onClick={() => !disabled && onShortcut(s.data)}
          disabled={disabled}
          title={s.desc ?? s.label}
          className={cn(
            'whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 font-mono text-xs text-[var(--color-fg)]',
            'min-h-[28px]',
            'active:bg-[var(--color-border)]',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
