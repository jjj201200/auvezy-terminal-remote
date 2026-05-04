/**
 * ShortcutSettings
 *
 * 编辑快捷键列表的子页：
 *  - 每行一个 shortcut：label / data / 启用复选框 / 删除按钮
 *  - 「+ 新增」追加空行
 *  - 不做拖拽排序（阶段 4 之后再补）
 *
 * data 字段允许直接输入 ESC（\x1b）等转义？暂只支持原文输入。
 * 用户如果要 ESC 可以填 （JSON 标准写法），保存时不做转义解析。
 */

import { type JSX } from 'react';
import type { ConfigurableShortcut } from '@ocr/shared';

export interface ShortcutSettingsProps {
  value: ConfigurableShortcut[];
  onChange: (next: ConfigurableShortcut[]) => void;
}

export function ShortcutSettings({ value, onChange }: ShortcutSettingsProps): JSX.Element {
  const update = (idx: number, patch: Partial<ConfigurableShortcut>): void => {
    const next = value.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  };
  const remove = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    onChange([...value, { label: '', data: '', enabled: true }]);
  };

  return (
    <div className="settings-list">
      {value.length === 0 && (
        <p className="settings-list__empty">暂无快捷键，点击下方「新增」添加</p>
      )}

      {value.map((s, idx) => (
        <div className="settings-row" key={idx}>
          <input
            className="settings-row__input settings-row__input--label"
            type="text"
            value={s.label}
            placeholder="显示名"
            onChange={(e) => update(idx, { label: e.target.value })}
          />
          <input
            className="settings-row__input settings-row__input--data"
            type="text"
            value={s.data}
            placeholder="发送数据（如  表示 ESC）"
            onChange={(e) => update(idx, { data: e.target.value })}
          />
          <label className="settings-row__toggle">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => update(idx, { enabled: e.target.checked })}
            />
            启用
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
        + 新增快捷键
      </button>
    </div>
  );
}
