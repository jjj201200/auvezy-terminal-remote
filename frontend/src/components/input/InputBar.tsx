/**
 * InputBar
 *
 * 输入栏：
 *  - 顶部：快捷键栏（来自 useUserConfig.shortcuts，仅显示 enabled）+ 设置按钮
 *  - 底部：受控 input + 发送按钮
 *
 * 阶段 4 改造：
 *  - 接受 shortcuts 数组并渲染按钮
 *  - 接受 commands 数组（命令选择器留作后续，本阶段先不渲染选择器，
 *    用户可通过手动输入命令文本进入；命令的 autoSend 行为已经在数据模型里）
 *  - 设置按钮触发外部 onOpenSettings
 *
 * Shortcut 点击：直接 send(data)，不附加回车（用户可在 data 里自己写 \r）
 */

import {
  useState,
  useCallback,
  type JSX,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { ConfigurableShortcut } from '@ocr/shared';

export interface InputBarProps {
  /** 发送一条用户输入到服务端，返回是否成功（false 一般是 WS 离线） */
  onSend: (data: string) => boolean;
  /** 是否禁用（如未连接） */
  disabled?: boolean;
  /** 启用的快捷键（来自 useUserConfig） */
  shortcuts?: ConfigurableShortcut[];
  /** 设置按钮回调；不传则不显示按钮 */
  onOpenSettings?: () => void;
}

export function InputBar({
  onSend,
  disabled,
  shortcuts,
  onOpenSettings,
}: InputBarProps): JSX.Element {
  const [value, setValue] = useState('');

  const send = useCallback(
    (withReturn: boolean): void => {
      if (disabled) return;
      const data = withReturn ? value + '\r' : value;
      if (data.length === 0) return;
      if (onSend(data)) {
        setValue('');
      }
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

  const enabledShortcuts = (shortcuts ?? []).filter((s) => s.enabled);

  const handleShortcut = (s: ConfigurableShortcut): void => {
    if (disabled) return;
    onSend(s.data);
  };

  return (
    <div className="input-bar-wrap">
      {(enabledShortcuts.length > 0 || onOpenSettings) && (
        <div className="input-bar__shortcuts">
          {enabledShortcuts.map((s, idx) => (
            <button
              type="button"
              key={`${s.label}-${idx}`}
              className="input-bar__shortcut"
              onClick={() => handleShortcut(s)}
              disabled={disabled}
              title={s.desc ?? s.label}
            >
              {s.label}
            </button>
          ))}
          {onOpenSettings && (
            <button
              type="button"
              className="input-bar__settings"
              onClick={onOpenSettings}
              aria-label="设置"
            >
              ⚙ 设置
            </button>
          )}
        </div>
      )}

      <form className="input-bar" onSubmit={onFormSubmit}>
        <input
          type="text"
          className="input-bar__field"
          placeholder={disabled ? '未连接…' : '输入命令，回车发送'}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="input-bar__send"
          disabled={disabled || value.length === 0}
        >
          发送
        </button>
      </form>
    </div>
  );
}
