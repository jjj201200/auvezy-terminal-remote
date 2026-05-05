/**
 * ShortcutSettings
 *
 * 按内置分组（common/editing/readline/vim/tmux/signals）+ custom 组展示。
 *
 * 紧凑设计：
 *  - 行高 28px，行间用 1px 分隔；不再每行套卡片
 *  - 一行 = [Toggle] label · data(灰单色) · [Edit] [Trash]
 *  - 默认折叠（除常用），点击组标题展开；展开时显示组描述（极小灰字）
 *  - 组标题右侧：N/Total 计数 + [全部启用/全部禁用] 文本按钮
 *  - 自定义组（custom）保留新增按钮；内置组不允许新增/删除（避免误删，要恢复就 toggle 回 enabled）
 *  - 编辑（label/data）通过点 ✎ 进入行内编辑态；保存或失焦提交
 *
 * 兼容旧配置：用户老 config.json 里的快捷键无 group 字段 → 全部归到「自定义」组，
 * 不强行回填 group，避免覆盖用户在新版里有意调整的归属。
 */

import { useMemo, useState, type JSX } from 'react';
import { Trash2, Plus, ChevronRight, Pencil, Check, X as XIcon } from 'lucide-react';
import {
  type ConfigurableShortcut,
  type ShortcutGroupId,
  SHORTCUT_GROUPS,
} from '@ocr/shared';
import { encodeForInput, decodeFromInput } from '../../utils/escape-codec.js';
import { Toggle } from '../ui/Toggle.js';
import { cn } from '../../utils/cn.js';

export interface ShortcutSettingsProps {
  value: ConfigurableShortcut[];
  onChange: (next: ConfigurableShortcut[]) => void;
}

interface EditingState {
  /** 全局 idx（在 value 数组里的下标） */
  idx: number;
  label: string;
  /** 编辑层是 encodeForInput 后的可读字符串 */
  dataRaw: string;
  warning: string | null;
}

const CUSTOM_GROUP_ID: ShortcutGroupId = 'custom';
const CUSTOM_GROUP_TITLE = '自定义';
const CUSTOM_GROUP_DESC = '你新增的快捷键，或来自旧版本配置但未指定分组的项。可自由编辑、删除。';

export function ShortcutSettings({ value, onChange }: ShortcutSettingsProps): JSX.Element {
  // 组展开状态：常用默认展开，其他默认折叠
  const [expanded, setExpanded] = useState<Set<ShortcutGroupId>>(new Set(['common']));
  const [editing, setEditing] = useState<EditingState | null>(null);

  // 把全局数组按 group 分桶；保留每项原始 idx 方便回写
  const buckets = useMemo(() => {
    const map = new Map<ShortcutGroupId, Array<{ s: ConfigurableShortcut; idx: number }>>();
    for (const g of SHORTCUT_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_GROUP_ID, []);
    value.forEach((s, idx) => {
      const gid =
        s.group && map.has(s.group as ShortcutGroupId)
          ? (s.group as ShortcutGroupId)
          : CUSTOM_GROUP_ID;
      map.get(gid)!.push({ s, idx });
    });
    return map;
  }, [value]);

  const toggleExpanded = (id: ShortcutGroupId): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateAt = (idx: number, patch: Partial<ConfigurableShortcut>): void => {
    onChange(value.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeAt = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
    if (editing?.idx === idx) setEditing(null);
  };

  const setGroupEnabled = (gid: ShortcutGroupId, enabled: boolean): void => {
    onChange(
      value.map((s) => {
        const owns =
          (s.group ?? CUSTOM_GROUP_ID) === gid ||
          // 旧配置无 group，归到 custom
          (gid === CUSTOM_GROUP_ID && !s.group);
        return owns ? { ...s, enabled } : s;
      }),
    );
  };

  const addCustom = (): void => {
    setExpanded((prev) => new Set(prev).add(CUSTOM_GROUP_ID));
    const newItem: ConfigurableShortcut = {
      label: '',
      data: '',
      enabled: true,
      group: CUSTOM_GROUP_ID,
    };
    onChange([...value, newItem]);
    setEditing({
      idx: value.length,
      label: '',
      dataRaw: '',
      warning: null,
    });
  };

  const startEdit = (idx: number, s: ConfigurableShortcut): void => {
    setEditing({
      idx,
      label: s.label,
      dataRaw: encodeForInput(s.data),
      warning: null,
    });
  };

  const commitEdit = (): void => {
    if (!editing) return;
    const dec = decodeFromInput(editing.dataRaw);
    if (dec.warning !== null) {
      setEditing({ ...editing, warning: dec.warning });
      return;
    }
    updateAt(editing.idx, { label: editing.label, data: dec.value });
    setEditing(null);
  };

  const cancelEdit = (): void => setEditing(null);

  return (
    <div className="flex flex-col gap-1">
      {SHORTCUT_GROUPS.map((g) => {
        const items = buckets.get(g.id) ?? [];
        const enabledCount = items.filter((it) => it.s.enabled).length;
        const isOpen = expanded.has(g.id);
        return (
          <GroupBlock
            key={g.id}
            id={g.id}
            title={g.title}
            desc={g.desc}
            isOpen={isOpen}
            enabledCount={enabledCount}
            totalCount={items.length}
            onToggle={() => toggleExpanded(g.id)}
            onEnableAll={() => setGroupEnabled(g.id, true)}
            onDisableAll={() => setGroupEnabled(g.id, false)}
          >
            {items.map(({ s, idx }) => (
              <Row
                key={idx}
                shortcut={s}
                editing={editing?.idx === idx ? editing : null}
                onToggleEnabled={(checked) => updateAt(idx, { enabled: checked })}
                onStartEdit={() => startEdit(idx, s)}
                onChangeLabel={(label) =>
                  setEditing((prev) => (prev ? { ...prev, label } : prev))
                }
                onChangeDataRaw={(raw) => {
                  const dec = decodeFromInput(raw);
                  setEditing((prev) =>
                    prev ? { ...prev, dataRaw: raw, warning: dec.warning } : prev,
                  );
                }}
                onCommit={commitEdit}
                onCancel={cancelEdit}
                allowDelete={false}
              />
            ))}
          </GroupBlock>
        );
      })}

      {/* 自定义组：始终展示，可新增和删除 */}
      <GroupBlock
        id={CUSTOM_GROUP_ID}
        title={CUSTOM_GROUP_TITLE}
        desc={CUSTOM_GROUP_DESC}
        isOpen={expanded.has(CUSTOM_GROUP_ID)}
        enabledCount={(buckets.get(CUSTOM_GROUP_ID) ?? []).filter((it) => it.s.enabled).length}
        totalCount={(buckets.get(CUSTOM_GROUP_ID) ?? []).length}
        onToggle={() => toggleExpanded(CUSTOM_GROUP_ID)}
        onEnableAll={() => setGroupEnabled(CUSTOM_GROUP_ID, true)}
        onDisableAll={() => setGroupEnabled(CUSTOM_GROUP_ID, false)}
        footer={
          <button
            type="button"
            onClick={addCustom}
            className="inline-flex items-center gap-1 self-start px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-bg)] rounded"
          >
            <Plus size={12} strokeWidth={1.5} />
            新增
          </button>
        }
      >
        {(buckets.get(CUSTOM_GROUP_ID) ?? []).map(({ s, idx }) => (
          <Row
            key={idx}
            shortcut={s}
            editing={editing?.idx === idx ? editing : null}
            onToggleEnabled={(checked) => updateAt(idx, { enabled: checked })}
            onStartEdit={() => startEdit(idx, s)}
            onChangeLabel={(label) => setEditing((prev) => (prev ? { ...prev, label } : prev))}
            onChangeDataRaw={(raw) => {
              const dec = decodeFromInput(raw);
              setEditing((prev) =>
                prev ? { ...prev, dataRaw: raw, warning: dec.warning } : prev,
              );
            }}
            onCommit={commitEdit}
            onCancel={cancelEdit}
            onDelete={() => removeAt(idx)}
            allowDelete
          />
        ))}
      </GroupBlock>
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

interface GroupBlockProps {
  id: ShortcutGroupId;
  title: string;
  desc: string;
  isOpen: boolean;
  enabledCount: number;
  totalCount: number;
  onToggle: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function GroupBlock({
  title,
  desc,
  isOpen,
  enabledCount,
  totalCount,
  onToggle,
  onEnableAll,
  onDisableAll,
  children,
  footer,
}: GroupBlockProps): JSX.Element {
  const allOn = totalCount > 0 && enabledCount === totalCount;
  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* 组标题行 */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5 text-left text-sm text-[var(--color-fg)] hover:text-[var(--color-accent)]"
          aria-expanded={isOpen}
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={cn('transition-transform', isOpen && 'rotate-90')}
          />
          <span>{title}</span>
          <span className="text-xs text-[var(--color-fg-muted)]">
            {enabledCount}/{totalCount}
          </span>
        </button>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={allOn ? onDisableAll : onEnableAll}
            className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] px-1.5 py-0.5 rounded"
          >
            {allOn ? '全部禁用' : '全部启用'}
          </button>
        )}
      </div>

      {/* 折叠内容 */}
      {isOpen && (
        <div className="border-t border-[var(--color-border)]">
          {desc && (
            <p className="px-2 py-1.5 text-xs leading-relaxed text-[var(--color-fg-muted)] border-b border-[var(--color-border)]">
              {desc}
            </p>
          )}
          {totalCount === 0 && !footer && (
            <p className="px-2 py-3 text-center text-xs text-[var(--color-fg-muted)]">
              暂无快捷键
            </p>
          )}
          <div className="flex flex-col">{children}</div>
          {footer && <div className="px-2 py-1.5 border-t border-[var(--color-border)]">{footer}</div>}
        </div>
      )}
    </section>
  );
}

interface RowProps {
  shortcut: ConfigurableShortcut;
  editing: EditingState | null;
  onToggleEnabled: (checked: boolean) => void;
  onStartEdit: () => void;
  onChangeLabel: (label: string) => void;
  onChangeDataRaw: (raw: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  allowDelete: boolean;
}

function Row({
  shortcut,
  editing,
  onToggleEnabled,
  onStartEdit,
  onChangeLabel,
  onChangeDataRaw,
  onCommit,
  onCancel,
  onDelete,
  allowDelete,
}: RowProps): JSX.Element {
  const inEdit = editing !== null;
  const dataDisplay = encodeForInput(shortcut.data);

  if (inEdit) {
    return (
      <div className="flex flex-col gap-1 border-t border-[var(--color-border)] first:border-t-0 px-2 py-1.5 bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={editing.label}
            placeholder="名称"
            onChange={(e) => onChangeLabel(e.target.value)}
            autoFocus
            className="w-[80px] shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          />
          <input
            type="text"
            value={editing.dataRaw}
            placeholder="\\e \\r \\xHH …"
            onChange={(e) => onChangeDataRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            className={cn(
              'flex-1 min-w-0 rounded border bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-fg)] outline-none',
              editing.warning
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-accent)]',
            )}
          />
          <button
            type="button"
            onClick={onCommit}
            aria-label="保存"
            title="保存"
            className="p-1 rounded text-[var(--color-accent)] hover:bg-[var(--color-bg)]"
          >
            <Check size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消"
            title="取消"
            className="p-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)]"
          >
            <XIcon size={12} strokeWidth={1.5} />
          </button>
        </div>
        {editing.warning && (
          <span className="text-xs text-[var(--color-error)]">{editing.warning}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-[var(--color-border)] first:border-t-0 px-2 py-1',
        !shortcut.enabled && 'opacity-60',
      )}
    >
      <Toggle checked={shortcut.enabled} onCheckedChange={onToggleEnabled} />
      <span className="font-mono text-xs text-[var(--color-fg)] min-w-[64px] truncate">
        {shortcut.label || <span className="text-[var(--color-fg-muted)]">未命名</span>}
      </span>
      <span className="flex-1 min-w-0 truncate font-mono text-xs text-[var(--color-fg-muted)]">
        {dataDisplay || <span className="italic">空</span>}
      </span>
      {shortcut.desc && (
        <span
          className="hidden md:inline truncate font-sans text-xs text-[var(--color-fg-muted)] max-w-[200px]"
          title={shortcut.desc}
        >
          {shortcut.desc}
        </span>
      )}
      <button
        type="button"
        onClick={onStartEdit}
        aria-label="编辑"
        title="编辑"
        className="p-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elevated)]"
      >
        <Pencil size={12} strokeWidth={1.5} />
      </button>
      {allowDelete && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="删除"
          title="删除"
          className="p-1 rounded text-[var(--color-fg-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-elevated)]"
        >
          <Trash2 size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
