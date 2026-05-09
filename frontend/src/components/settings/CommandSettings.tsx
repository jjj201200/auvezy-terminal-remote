/**
 * CommandSettings（嵌套树形态，0.6 起）
 *
 * 与 ShortcutSettings 设计同源，差异：
 *  - item 字段是 command（不是 data） + autoSend 开关 + 编辑时可改 desc
 *  - 行内显示 "自动" / "编辑" 标签
 */

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import {
  IconTrash,
  IconPlus,
  IconChevronRight,
  IconPencil,
  IconCheck,
  IconX,
  IconGripVertical,
  IconRefresh,
} from '@tabler/icons-react';
import {
  type CommandGroup,
  type CommandItem,
  lookupBuiltinCommand,
  makeActionId,
} from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { Toggle } from '../ui/Toggle.js';
import { useDragReorder, type DropIndicator } from '../../hooks/useDragReorder.js';
import { useT } from '../../i18n/i18n-context.js';
import { useConfirm } from '../ui/ConfirmProvider.js';
import s from './ShortcutSettings.module.scss';
import sc from './CommandSettings.module.scss';

export interface CommandSettingsProps {
  groups: CommandGroup[];
  onChange: (next: CommandGroup[]) => void;
}

interface FlatRow {
  groupId: string;
  itemIdx: number;
  item: CommandItem;
}

interface EditingItemState {
  flatIdx: number;
  label: string;
  command: string;
  desc: string;
  autoSend: boolean;
}

interface EditingGroupState {
  groupId: string;
  title: string;
  error: string | null;
}

export function CommandSettings({ groups, onChange }: CommandSettingsProps): JSX.Element {
  const t = useT();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editingItem, setEditingItem] = useState<EditingItemState | null>(null);
  const [editingGroup, setEditingGroup] = useState<EditingGroupState | null>(null);

  const flat = useMemo<FlatRow[]>(
    () =>
      groups.flatMap((g) =>
        g.items.map((item, itemIdx) => ({ groupId: g.id, itemIdx, item })),
      ),
    [groups],
  );

  const { register, getHandleProps, dragState, dropIndicator, isDragging } =
    useDragReorder<FlatRow>({
      value: flat,
      onChange: (nextFlat) => {
        const byGroup = new Map<string, CommandItem[]>();
        for (const g of groups) byGroup.set(g.id, []);
        for (const row of nextFlat) {
          let bucket = byGroup.get(row.groupId);
          if (!bucket) {
            bucket = [];
            byGroup.set(row.groupId, bucket);
          }
          bucket.push(row.item);
        }
        onChange(groups.map((g) => ({ ...g, items: byGroup.get(g.id) ?? [] })));
      },
      groupOf: (r) => r.groupId,
      withGroup: (r, gid) => ({ ...r, groupId: gid }),
    });

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── group 级 ───

  const updateGroup = (groupId: string, patch: Partial<CommandGroup>): void => {
    onChange(groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
  };

  const deleteGroup = async (g: CommandGroup): Promise<void> => {
    const ok = await confirm({
      title: t('commands.groupDeleteConfirmTitle'),
      messageTemplate: t('commands.groupDeleteConfirm'),
      messageVars: { title: g.title, count: String(g.items.length) },
      tone: 'danger',
    });
    if (!ok) return;
    onChange(groups.filter((x) => x.id !== g.id));
  };

  const addGroup = (): void => {
    const id = makeActionId('g');
    const newGroup: CommandGroup = {
      id,
      title: t('commands.addGroupTitle'),
      items: [],
    };
    onChange([...groups, newGroup]);
    setExpanded((prev) => new Set(prev).add(id));
    setEditingGroup({ groupId: id, title: newGroup.title, error: null });
  };

  const startEditGroup = (g: CommandGroup): void => {
    setEditingGroup({ groupId: g.id, title: g.title, error: null });
  };

  const commitEditGroup = (): void => {
    if (!editingGroup) return;
    const trimmed = editingGroup.title.trim();
    if (trimmed.length === 0) {
      setEditingGroup({ ...editingGroup, error: t('commands.groupTitleEmptyError') });
      return;
    }
    updateGroup(editingGroup.groupId, { title: trimmed });
    setEditingGroup(null);
  };

  const cancelEditGroup = (): void => setEditingGroup(null);

  // ─── item 级 ───

  const updateItem = (groupId: string, itemIdx: number, patch: Partial<CommandItem>): void => {
    onChange(
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.map((it, i) => (i === itemIdx ? { ...it, ...patch } : it)),
            }
          : g,
      ),
    );
  };

  const removeItem = (groupId: string, itemIdx: number): void => {
    onChange(
      groups.map((g) =>
        g.id === groupId ? { ...g, items: g.items.filter((_, i) => i !== itemIdx) } : g,
      ),
    );
    setEditingItem(null);
  };

  const setGroupAllEnabled = (groupId: string, enabled: boolean): void => {
    onChange(
      groups.map((g) =>
        g.id === groupId ? { ...g, items: g.items.map((it) => ({ ...it, enabled })) } : g,
      ),
    );
  };

  const addItemToGroup = (groupId: string): void => {
    const newItem: CommandItem = {
      id: makeActionId('i'),
      label: '',
      command: '',
      enabled: true,
      autoSend: true,
    };
    onChange(
      groups.map((g) =>
        g.id === groupId ? { ...g, items: [...g.items, newItem] } : g,
      ),
    );
    setExpanded((prev) => new Set(prev).add(groupId));
    const baseFlatIdx = groups
      .slice(0, groups.findIndex((g) => g.id === groupId))
      .reduce((acc, g) => acc + g.items.length, 0);
    const targetGroup = groups.find((g) => g.id === groupId);
    const newFlatIdx = baseFlatIdx + (targetGroup?.items.length ?? 0);
    setEditingItem({
      flatIdx: newFlatIdx,
      label: '',
      command: '',
      desc: '',
      autoSend: true,
    });
  };

  const startEditItem = (flatIdx: number, item: CommandItem): void => {
    setEditingItem({
      flatIdx,
      label: item.label,
      command: item.command,
      desc: item.desc ?? '',
      autoSend: item.autoSend ?? true,
    });
  };

  const commitEditItem = (): void => {
    if (!editingItem) return;
    const row = flat[editingItem.flatIdx];
    if (!row) {
      setEditingItem(null);
      return;
    }
    updateItem(row.groupId, row.itemIdx, {
      label: editingItem.label,
      command: editingItem.command,
      desc: editingItem.desc.trim() || undefined,
      autoSend: editingItem.autoSend,
    });
    setEditingItem(null);
  };

  const cancelEditItem = (): void => setEditingItem(null);

  const resetItemToDefault = async (
    groupId: string,
    itemIdx: number,
    item: CommandItem,
  ): Promise<void> => {
    if (!item.builtinKey) return;
    const builtin = lookupBuiltinCommand(item.builtinKey);
    if (!builtin) return;
    const ok = await confirm({
      title: t('commands.resetItemConfirmTitle'),
      messageTemplate: t('commands.resetItemConfirm'),
      messageVars: { label: item.label || builtin.label },
      tone: 'danger',
    });
    if (!ok) return;
    updateItem(groupId, itemIdx, {
      label: builtin.label,
      command: builtin.command,
      desc: builtin.desc,
      autoSend: builtin.autoSend,
    });
  };

  const ghostRow = dragState ? flat[dragState.sourceIdx] : null;

  return (
    <div id="command-settings" className={clsx(s.root, isDragging && s.rootDragging)}>
      {groups.map((g) => (
        <GroupBlock
          key={g.id}
          group={g}
          isOpen={expanded.has(g.id)}
          isEditingTitle={editingGroup?.groupId === g.id}
          editingGroupState={editingGroup?.groupId === g.id ? editingGroup : null}
          isDropTarget={
            dropIndicator?.kind === 'group-empty' &&
            dropIndicator.groupId === g.id &&
            g.items.length === 0
          }
          registerListEl={(el) => register.group(g.id, el)}
          onToggle={() => toggleExpanded(g.id)}
          onEnableAll={() => setGroupAllEnabled(g.id, true)}
          onDisableAll={() => setGroupAllEnabled(g.id, false)}
          onStartEditTitle={() => startEditGroup(g)}
          onChangeEditingTitle={(title) =>
            setEditingGroup((prev) => (prev ? { ...prev, title, error: null } : prev))
          }
          onCommitEditTitle={commitEditGroup}
          onCancelEditTitle={cancelEditGroup}
          onDeleteGroup={() => void deleteGroup(g)}
          onAddItem={() => addItemToGroup(g.id)}
        >
          {g.items.map((item, itemIdx) => {
            const flatIdx = flat.findIndex(
              (r) => r.groupId === g.id && r.itemIdx === itemIdx,
            );
            return (
              <RowWithIndicator
                key={item.id}
                flatIdx={flatIdx}
                item={item}
                editing={editingItem?.flatIdx === flatIdx ? editingItem : null}
                registerRowEl={(el) => register.row(flatIdx, el)}
                handleProps={getHandleProps(flatIdx)}
                dragSourceIdx={dragState?.sourceIdx ?? null}
                indicator={dropIndicator}
                onToggleEnabled={(checked) =>
                  updateItem(g.id, itemIdx, { enabled: checked })
                }
                onStartEdit={() => startEditItem(flatIdx, item)}
                onChangeField={(patch) =>
                  setEditingItem((prev) => (prev ? { ...prev, ...patch } : prev))
                }
                onCommit={commitEditItem}
                onCancel={cancelEditItem}
                onDelete={() => removeItem(g.id, itemIdx)}
                onResetToDefault={
                  item.builtinKey
                    ? () => void resetItemToDefault(g.id, itemIdx, item)
                    : undefined
                }
              />
            );
          })}
        </GroupBlock>
      ))}

      <button type="button" onClick={addGroup} className={s.addGroupBtn}>
        <IconPlus size={12} stroke={1.5} />
        {t('commands.addGroupBtn')}
      </button>

      {dragState && ghostRow && (
        <div
          className={s.dragGhost}
          style={{
            left: dragState.ghostX - dragState.offsetX,
            top: dragState.ghostY - dragState.offsetY,
          }}
        >
          <IconGripVertical size={12} stroke={1.5} />
          <span className={s.dragGhostLabel}>{ghostRow.item.label || t('commands.unnamed')}</span>
          <span className={s.dragGhostData}>{ghostRow.item.command}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

interface GroupBlockProps {
  group: CommandGroup;
  isOpen: boolean;
  isEditingTitle: boolean;
  editingGroupState: EditingGroupState | null;
  isDropTarget: boolean;
  registerListEl: (el: HTMLElement | null) => void;
  onToggle: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onStartEditTitle: () => void;
  onChangeEditingTitle: (title: string) => void;
  onCommitEditTitle: () => void;
  onCancelEditTitle: () => void;
  onDeleteGroup: () => void;
  onAddItem: () => void;
  children: ReactNode;
}

function GroupBlock(props: GroupBlockProps): JSX.Element {
  const {
    group,
    isOpen,
    isEditingTitle,
    editingGroupState,
    isDropTarget,
    registerListEl,
    onToggle,
    onEnableAll,
    onDisableAll,
    onStartEditTitle,
    onChangeEditingTitle,
    onCommitEditTitle,
    onCancelEditTitle,
    onDeleteGroup,
    onAddItem,
    children,
  } = props;
  const t = useT();
  const total = group.items.length;
  const enabledCount = group.items.filter((it) => it.enabled).length;
  const allOn = total > 0 && enabledCount === total;

  return (
    <section
      className={clsx(s.group, isDropTarget && s.groupDropTarget)}
      data-group-id={group.id}
    >
      <div className={s.head}>
        {isEditingTitle && editingGroupState ? (
          <div className={s.groupTitleEdit}>
            <input
              type="text"
              value={editingGroupState.title}
              onChange={(e) => onChangeEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitEditTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelEditTitle();
                }
              }}
              onBlur={(e) => {
                if (e.relatedTarget instanceof Node) {
                  const headEl = (e.currentTarget as HTMLElement).closest(`.${s.head}`);
                  if (headEl?.contains(e.relatedTarget)) return;
                }
                onCancelEditTitle();
              }}
              autoFocus
              placeholder={t('commands.addGroupPlaceholder')}
              className={s.groupTitleInput}
            />
            <button
              type="button"
              onClick={onCommitEditTitle}
              aria-label={t('commands.saveTooltip')}
              title={t('commands.saveTooltip')}
              className={s.commitBtn}
            >
              <IconCheck size={12} stroke={2} />
            </button>
            <button
              type="button"
              onClick={onCancelEditTitle}
              aria-label={t('commands.cancelTooltip')}
              title={t('commands.cancelTooltip')}
              className={s.cancelBtn}
            >
              <IconX size={12} stroke={1.5} />
            </button>
            {editingGroupState.error && (
              <span className={s.groupErrorText}>{editingGroupState.error}</span>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              className={s.headBtn}
              aria-expanded={isOpen}
            >
              <IconChevronRight
                size={12}
                stroke={1.5}
                className={clsx(s.chev, isOpen && s.chevOpen)}
              />
              <span>{group.title}</span>
              <span className={s.count}>
                {enabledCount}/{total}
              </span>
            </button>
            {total > 0 && (
              <button
                type="button"
                onClick={allOn ? onDisableAll : onEnableAll}
                className={s.bulkBtn}
              >
                {allOn ? t('list.disableAll') : t('list.enableAll')}
              </button>
            )}
            <button
              type="button"
              onClick={onStartEditTitle}
              aria-label={t('commands.groupEditTooltip')}
              title={t('commands.groupEditTooltip')}
              className={s.groupAction}
            >
              <IconPencil size={12} stroke={1.5} />
            </button>
            <button
              type="button"
              onClick={onDeleteGroup}
              aria-label={t('commands.groupDeleteTooltip')}
              title={t('commands.groupDeleteTooltip')}
              className={clsx(s.groupAction, s.groupActionDanger)}
            >
              <IconTrash size={12} stroke={1.5} />
            </button>
          </>
        )}
      </div>

      {isOpen && (
        <div className={s.body}>
          {group.desc && <p className={s.desc}>{group.desc}</p>}
          {total === 0 && <p className={s.empty}>{t('commands.emptyList')}</p>}
          <div className={s.list} ref={registerListEl}>
            {children}
          </div>
          <div className={s.footer}>
            <button type="button" onClick={onAddItem} className={s.addBtn}>
              <IconPlus size={12} stroke={1.5} />
              {t('list.add')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

interface RowWithIndicatorProps {
  flatIdx: number;
  item: CommandItem;
  editing: EditingItemState | null;
  registerRowEl: (el: HTMLElement | null) => void;
  handleProps: ReturnType<ReturnType<typeof useDragReorder<FlatRow>>['getHandleProps']>;
  dragSourceIdx: number | null;
  indicator: DropIndicator | null;
  onToggleEnabled: (checked: boolean) => void;
  onStartEdit: () => void;
  onChangeField: (patch: Partial<EditingItemState>) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onResetToDefault?: () => void;
}

function RowWithIndicator(props: RowWithIndicatorProps): JSX.Element {
  const t = useT();
  const {
    flatIdx,
    item,
    editing,
    registerRowEl,
    handleProps,
    dragSourceIdx,
    indicator,
    onToggleEnabled,
    onStartEdit,
    onChangeField,
    onCommit,
    onCancel,
    onDelete,
    onResetToDefault,
  } = props;
  const inEdit = editing !== null;
  const auto = item.autoSend ?? true;
  const isDragSource = dragSourceIdx === flatIdx;
  const showIndicatorBefore =
    indicator?.kind === 'row' && indicator.idx === flatIdx && indicator.position === 'before';
  const showIndicatorAfter =
    indicator?.kind === 'row' && indicator.idx === flatIdx && indicator.position === 'after';

  if (inEdit) {
    return (
      <div className={s.editRow} ref={registerRowEl}>
        {showIndicatorBefore && <div className={s.dropIndicatorTop} />}
        <div className={sc.editFields}>
          <input
            type="text"
            value={editing.label}
            placeholder={t('commands.namePlaceholder')}
            onChange={(e) => onChangeField({ label: e.target.value })}
            autoFocus
            className={sc.editLabel}
          />
          <input
            type="text"
            value={editing.command}
            placeholder={t('commands.commandPlaceholder')}
            onChange={(e) => onChangeField({ command: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            className={sc.editCommand}
          />
          <button
            type="button"
            onClick={onCommit}
            aria-label={t('commands.saveTooltip')}
            title={t('commands.saveTooltip')}
            className={s.commitBtn}
          >
            <IconCheck size={12} stroke={2} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('commands.cancelTooltip')}
            title={t('commands.cancelTooltip')}
            className={s.cancelBtn}
          >
            <IconX size={12} stroke={1.5} />
          </button>
        </div>
        <div className={sc.editMeta}>
          <input
            type="text"
            value={editing.desc}
            placeholder={t('commands.descPlaceholder')}
            onChange={(e) => onChangeField({ desc: e.target.value })}
            className={sc.editDesc}
          />
          <label className={sc.autoSendInline}>
            <Toggle
              checked={editing.autoSend}
              onCheckedChange={(checked) => onChangeField({ autoSend: checked })}
            />
            <span>{t('commands.autoSendLabel')}</span>
          </label>
        </div>
        {showIndicatorAfter && <div className={s.dropIndicatorBot} />}
      </div>
    );
  }

  return (
    <div
      ref={registerRowEl}
      className={clsx(s.row, !item.enabled && s.rowDisabled, isDragSource && s.rowDragSource)}
    >
      {showIndicatorBefore && <div className={s.dropIndicatorTop} />}
      <Toggle checked={item.enabled} onCheckedChange={onToggleEnabled} />
      <span className={clsx(s.rowLabel, !item.label && s.rowLabelEmpty)}>
        {item.label || t('commands.unnamed')}
      </span>
      <span className={clsx(s.rowData, !item.command && s.rowDataEmpty)}>
        {item.command || t('commands.empty')}
      </span>
      <span className={clsx(sc.autoSendTag, !auto && sc.autoSendTagDraft)}>
        {auto ? '自动' : '编辑'}
      </span>
      {item.desc && (
        <span className={s.rowDesc} title={item.desc}>
          {item.desc}
        </span>
      )}
      <button
        type="button"
        onClick={onStartEdit}
        aria-label={t('commands.editTooltip')}
        title={t('commands.editTooltip')}
        className={s.iconBtn}
      >
        <IconPencil size={12} stroke={1.5} />
      </button>
      {onResetToDefault && (
        <button
          type="button"
          onClick={onResetToDefault}
          aria-label={t('commands.resetItemTooltip')}
          title={t('commands.resetItemTooltip')}
          className={clsx(s.iconBtn, s.resetItemBtn)}
        >
          <IconRefresh size={12} stroke={1.5} />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={t('commands.deleteTooltip')}
        title={t('commands.deleteTooltip')}
        className={clsx(s.iconBtn, s.deleteBtn)}
      >
        <IconTrash size={12} stroke={1.5} />
      </button>
      <button
        type="button"
        aria-label={t('commands.dragHandleTooltip')}
        className={s.gripBtn}
        {...handleProps}
      >
        <IconGripVertical size={12} stroke={1.5} />
      </button>
      {showIndicatorAfter && <div className={s.dropIndicatorBot} />}
    </div>
  );
}
