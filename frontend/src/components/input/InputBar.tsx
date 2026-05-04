/**
 * InputBar
 *
 * 简易输入栏：用户在此输入命令，回车后发送 user_input 到服务端。
 * 阶段 1 仅最小功能；阶段 4 会扩展 shortcuts/commands 选择器。
 *
 * 设计：
 * - 受控 input + send 函数注入
 * - 回车（Enter）发送当前内容 + 自动追加 \r 模拟终端回车
 * - Enter 后清空输入框（与终端"按下回车后内容到 Claude"语义一致）
 */

import { useState, useCallback, type JSX, type FormEvent, type KeyboardEvent } from 'react';

export interface InputBarProps {
  /** 发送一条用户输入到服务端，返回是否成功（false 一般是 WS 离线） */
  onSend: (data: string) => boolean;
  /** 是否禁用（如未连接） */
  disabled?: boolean;
}

export function InputBar({ onSend, disabled }: InputBarProps): JSX.Element {
  const [value, setValue] = useState('');

  const send = useCallback((withReturn: boolean): void => {
    if (disabled) return;
    const data = withReturn ? value + '\r' : value;
    if (data.length === 0) return;
    if (onSend(data)) {
      setValue('');
    }
  }, [onSend, disabled, value]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send(true);
    }
  }, [send]);

  const onFormSubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(true);
  }, [send]);

  return (
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
  );
}
