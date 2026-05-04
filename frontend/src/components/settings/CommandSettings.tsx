/**
 * CommandSettings
 *
 * 编辑命令列表（如 /clear、/compact）。
 * autoSend 默认 true：点击后直接发送 + 回车。false 则只填到输入框。
 */

import { type JSX } from 'react';
import type { ConfigurableCommand } from '@ocr/shared';

export interface CommandSettingsProps {
  value: ConfigurableCommand[];
  onChange: (next: ConfigurableCommand[]) => void;
}

export function CommandSettings({ value, onChange }: CommandSettingsProps): JSX.Element {
  const update = (idx: number, patch: Partial<ConfigurableCommand>): void => {
    const next = value.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };
  const remove = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    onChange([...value, { label: '', command: '', enabled: true, autoSend: true }]);
  };

  return (
    <div className="settings-list">
      {value.length === 0 && (
        <p className="settings-list__empty">暂无命令，点击下方「新增」添加</p>
      )}

      {value.map((c, idx) => (
        <div className="settings-row" key={idx}>
          <input
            className="settings-row__input settings-row__input--label"
            type="text"
            value={c.label}
            placeholder="显示名"
            onChange={(e) => update(idx, { label: e.target.value })}
          />
          <input
            className="settings-row__input settings-row__input--data"
            type="text"
            value={c.command}
            placeholder="命令文本（如 /clear）"
            onChange={(e) => update(idx, { command: e.target.value })}
          />
          <label className="settings-row__toggle">
            <input
              type="checkbox"
              checked={c.enabled}
              onChange={(e) => update(idx, { enabled: e.target.checked })}
            />
            启用
          </label>
          <label className="settings-row__toggle">
            <input
              type="checkbox"
              checked={c.autoSend ?? true}
              onChange={(e) => update(idx, { autoSend: e.target.checked })}
            />
            自动发送
          </label>
          <button
            type="button"
            className="settings-row__remove"
            onClick={() => remove(idx)}
            aria-label="删除"
          >
            ×
          </button>
        </div>
      ))}

      <button type="button" className="settings-list__add" onClick={add}>
        + 新增命令
      </button>
    </div>
  );
}
