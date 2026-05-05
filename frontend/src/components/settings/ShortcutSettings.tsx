/**
 * ShortcutSettings
 *
 * 编辑快捷键列表。data 字段在 input 层走 escape codec：
 *  - 显示：encodeForInput(s.data)，把 \x1b 等控制字节变成可读 \e \r \xHH
 *  - 写回：decodeFromInput(rawString)，warning 时标红
 *
 * 布局：
 *  - 桌面：单行（label / data / 启用 / 删除）
 *  - 移动：两行（label+data；启用+删除）
 */

import { useMemo, useState, type JSX } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { ConfigurableShortcut } from '@ocr/shared';
import { encodeForInput, decodeFromInput } from '../../utils/escape-codec.js';
import { TextField } from '../ui/TextField.js';
import { Toggle } from '../ui/Toggle.js';
import { IconButton } from '../ui/IconButton.js';

export interface ShortcutSettingsProps {
  value: ConfigurableShortcut[];
  onChange: (next: ConfigurableShortcut[]) => void;
}

interface RowState {
  /** raw input 字符串（编辑层视图） */
  dataRaw: string;
  /** 当前 raw 解析的 warning */
  warning: string | null;
}

export function ShortcutSettings({ value, onChange }: ShortcutSettingsProps): JSX.Element {
  // 每行的 raw 编辑状态独立维护，保证用户输入 \\e 中途不会被反向编码刷回
  const initialRaws = useMemo<RowState[]>(
    () => value.map((s) => ({ dataRaw: encodeForInput(s.data), warning: null })),
    // 仅初始化一次；后续 value 变化由用户内部驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [raws, setRaws] = useState<RowState[]>(initialRaws);

  const update = (idx: number, patch: Partial<ConfigurableShortcut>): void => {
    onChange(value.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const updateRaw = (idx: number, raw: string): void => {
    const r = decodeFromInput(raw);
    setRaws((prev) =>
      prev.map((p, i) => (i === idx ? { dataRaw: raw, warning: r.warning } : p)),
    );
    if (r.warning === null) update(idx, { data: r.value });
  };
  const remove = (idx: number): void => {
    setRaws((prev) => prev.filter((_, i) => i !== idx));
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    setRaws((prev) => [...prev, { dataRaw: '', warning: null }]);
    onChange([...value, { label: '', data: '', enabled: true }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="py-4 text-center text-sm text-[var(--color-fg-muted)]">
          暂无快捷键，点击下方「新增」添加
        </p>
      )}

      {value.map((s, idx) => {
        const row = raws[idx] ?? { dataRaw: '', warning: null };
        return (
          <div
            key={idx}
            className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 md:flex-row md:items-start"
          >
            <TextField
              type="text"
              value={s.label}
              placeholder="显示名"
              mono
              className="md:max-w-[120px]"
              onChange={(e) => update(idx, { label: e.target.value })}
            />
            <TextField
              type="text"
              value={row.dataRaw}
              placeholder="\\e 表示 ESC，\\r 表示回车"
              mono
              error={row.warning}
              helper={row.warning ? undefined : '支持 \\e \\r \\n \\t \\xHH'}
              onChange={(e) => updateRaw(idx, e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Toggle
                checked={s.enabled}
                onCheckedChange={(checked) => update(idx, { enabled: checked })}
                label="启用"
              />
              <IconButton aria-label="删除" onClick={() => remove(idx)}>
                <Trash2 size={14} strokeWidth={1.5} />
              </IconButton>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-accent)] hover:border-[var(--color-accent)]"
      >
        <Plus size={12} strokeWidth={1.5} />
        新增快捷键
      </button>
    </div>
  );
}
