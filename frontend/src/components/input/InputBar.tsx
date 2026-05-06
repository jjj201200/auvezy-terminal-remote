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
  forwardRef,
  useCallback,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { IconSend, IconSettings, IconX } from '@tabler/icons-react';
import { IconButton } from '../ui/IconButton.js';
import { ConfirmModal } from '../ui/ConfirmModal.js';
import { useT } from '../../i18n/i18n-context.js';
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

/**
 * forwardRef 暴露内部 input —— 让父级（ConsolePage）能在用户点终端区时
 * 主动 focus()，把软键盘弹出后的焦点接到这里
 */
export const InputBar = forwardRef<HTMLInputElement, InputBarProps>(function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  onOpenSettings,
}, ref) {
  const t = useT();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const send = useCallback((): void => {
    if (disabled) return;
    const data = value + '\r';
    if (value.length === 0) return;
    if (onSubmit(data)) onChange('');
  }, [value, disabled, onSubmit, onChange]);

  // 阈值：少于 N 字符直接清，避免每次都打断；多了才二次确认
  const CLEAR_CONFIRM_THRESHOLD = 10;
  const handleClear = useCallback((): void => {
    if (value.length === 0) return;
    if (value.length < CLEAR_CONFIRM_THRESHOLD) {
      onChange('');
      return;
    }
    setConfirmClearOpen(true);
  }, [value, onChange]);

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
    <>
      <form id="input-bar" onSubmit={onFormSubmit} className={s.form}>
        <div className={s.inputWrap}>
          <input
            ref={ref}
            type="text"
            placeholder={disabled ? t('input.placeholderDisabled') : t('input.placeholder')}
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
          {!disabled && value.length > 0 && (
            <button
              type="button"
              // 阻止默认避免按下时 input 失焦闪烁
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
          disabled={disabled || value.length === 0}
          aria-label={t('input.sendTooltip')}
        >
          <IconSend size={14} stroke={1.5} />
        </IconButton>
        {onOpenSettings && (
          <IconButton onClick={onOpenSettings} aria-label={t('topBar.settings')} title={t('topBar.settingsTooltip')}>
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
            onChange('');
            setConfirmClearOpen(false);
          }}
          onClose={() => setConfirmClearOpen(false)}
        />
      )}
    </>
  );
});
