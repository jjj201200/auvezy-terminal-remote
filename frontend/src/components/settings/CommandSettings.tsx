/**
 * CommandSettings
 *
 * 编辑命令列表（如 /clear、/compact）。
 * autoSend 默认 true：点击后直接发送。false 则只填到输入框等用户编辑。
 */

import { type JSX } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { ConfigurableCommand } from '@ocr/shared';
import { TextField } from '../ui/TextField.js';
import { Toggle } from '../ui/Toggle.js';
import { IconButton } from '../ui/IconButton.js';

export interface CommandSettingsProps {
  value: ConfigurableCommand[];
  onChange: (next: ConfigurableCommand[]) => void;
}

export function CommandSettings({ value, onChange }: CommandSettingsProps): JSX.Element {
  const update = (idx: number, patch: Partial<ConfigurableCommand>): void => {
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const remove = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    onChange([...value, { label: '', command: '', enabled: true, autoSend: true }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="py-4 text-center text-sm text-[var(--color-fg-muted)]">
          暂无命令，点击下方「新增」添加
        </p>
      )}

      {value.map((c, idx) => (
        <div
          key={idx}
          className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 md:flex-row md:items-start"
        >
          <TextField
            type="text"
            value={c.label}
            placeholder="显示名"
            mono
            className="md:max-w-[120px]"
            onChange={(e) => update(idx, { label: e.target.value })}
          />
          <TextField
            type="text"
            value={c.command}
            placeholder="命令文本（如 /clear）"
            mono
            onChange={(e) => update(idx, { command: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              checked={c.enabled}
              onCheckedChange={(checked) => update(idx, { enabled: checked })}
              label="启用"
            />
            <Toggle
              checked={c.autoSend ?? true}
              onCheckedChange={(checked) => update(idx, { autoSend: checked })}
              label="自动发送"
            />
            <IconButton aria-label="删除" onClick={() => remove(idx)}>
              <Trash2 size={14} strokeWidth={1.5} />
            </IconButton>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-accent)] hover:border-[var(--color-accent)]"
      >
        <Plus size={12} strokeWidth={1.5} />
        新增命令
      </button>
    </div>
  );
}
