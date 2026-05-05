/**
 * InputBar
 *
 * 输入栏：受控的输入框 + 发送 + 设置按钮。
 *
 * 受控原因：上方的 Toolbar 需要把"非自动发送"的命令文本灌进来，
 * 让用户手动编辑后再回车 → 父级（ConsolePage）持有 value 状态，
 * 同时 prefill 与 send 都集中在父级管理。
 */

import {
  useCallback,
  type JSX,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { IconSend, IconSettings } from '@tabler/icons-react';
import { IconButton } from '../ui/IconButton.js';
import s from './InputBar.module.scss';

export interface InputBarProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * 提交（回车或点击发送）。
   * 返回 true 表示已成功发送 → InputBar 自动清空 value。
   */
  onSubmit: (data: string) => boolean;
  disabled?: boolean;
  onOpenSettings?: () => void;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  onOpenSettings,
}: InputBarProps): JSX.Element {
  const send = useCallback((): void => {
    if (disabled) return;
    const data = value + '\r';
    if (value.length === 0) return;
    if (onSubmit(data)) onChange('');
  }, [value, disabled, onSubmit, onChange]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
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
    <form id="input-bar" onSubmit={onFormSubmit} className={s.form}>
      <input
        type="text"
        placeholder={disabled ? '未连接…' : '输入命令，回车发送'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={s.input}
      />
      <IconButton
        type="submit"
        variant="accent"
        disabled={disabled || value.length === 0}
        aria-label="发送"
      >
        <IconSend size={14} stroke={1.5} />
      </IconButton>
      {onOpenSettings && (
        <IconButton onClick={onOpenSettings} aria-label="设置" title="设置">
          <IconSettings size={14} stroke={1.5} />
        </IconButton>
      )}
    </form>
  );
}
