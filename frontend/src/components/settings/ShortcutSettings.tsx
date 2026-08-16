/**
 * ShortcutSettings（嵌套树形态，0.6 起）
 *
 * 接收 ShortcutGroup[]，做：
 *  - 分组级 CRUD：标题 inline 编辑、删除分组（带二次确认）、新建分组
 *  - 项级 CRUD：行内编辑 label/data、删除项、还原内置默认（builtinKey 命中时）
 *  - 拖拽：跨组移动 / 组内重排 —— 内部仍 flatten 后用 useDragReorder
 *  - 全部启用 / 禁用、enabledCount / totalCount
 *
 * 默认折叠所有分组，让用户主动展开要编辑的分组。
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
  type ShortcutGroup,
  type ShortcutItem,
  lookupBuiltinShortcut,
  makeActionId,
} from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { encodeForInput, decodeFromInput } from '../../utils/escape-codec.js';
import { Toggle } from '../ui/Toggle.js';
import { useDragReorder, type DropIndicator } from '../../hooks/useDragReorder.js';
import { useT } from '../../i18n/i18n-context.js';
import { useConfirm } from '../ui/ConfirmProvider.js';
import s from './ShortcutSettings.module.scss';

export interface ShortcutSettingsProps {
  groups: ShortcutGroup[];
  onChange: (next: ShortcutGroup[]) => void;
}

interface FlatRow {
  groupId: string;
  itemIdx: number; // 该项在所属分组里的 idx
  item: ShortcutItem;
}

interface EditingItemState {
  flatIdx: number;
  label: string;
  dataRaw: string;
  warning: string | null;
}

interface EditingGroupState {
  groupId: string;
  title: string;
  desc: string;
  error: string | null;
}

export function ShortcutSettings({ groups, onChange }: ShortcutSettingsProps): JSX.Element {
  const t = useT();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editingItem, setEditingItem] = useState<EditingItemState | null>(null);
  const [editingGroup, setEditingGroup] = useState<EditingGroupState | null>(null);

  // 把所有分组所有项 flatten 给 useDragReorder 用（保留组归属用 groupId）
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
        // 把 flat 拆回 groups：每组按出现顺序收集 items
        const byGroup = new Map<string, ShortcutItem[]>();
        // 先用现有 groups 顺序为骨架，保证空组也保留
        for (const g of groups) byGroup.set(g.id, []);
        for (const row of nextFlat) {
          let bucket = byGroup.get(row.groupId);
          if (!bucket) {
            bucket = [];
            byGroup.set(row.groupId, bucket);
          }
          bucket.push(row.item);
        }
        const next = groups.map((g) => ({
          ...g,
          items: byGroup.get(g.id) ?? [],
        }));
        onChange(next);
      },
      groupOf: (r) => r.groupId,
      withGroup: (r, gid) => ({ ...r, groupId: gid }),
    });

  // 分组级拖拽：让用户能调整分组顺序。所有 group 视为同一虚拟"groups"列表
  const groupDrag = useDragReorder<ShortcutGroup>({
    value: groups,
    onChange,
    groupOf: () => 'groups',
    withGroup: (g) => g, // groups 列表内拖拽，不需要修改 group 字段
  });

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── group 级操作 ───

  const updateGroup = (groupId: string, patch: Partial<ShortcutGroup>): void => {
    onChange(groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
  };

  const deleteGroup = async (g: ShortcutGroup): Promise<void> => {
    const ok = await confirm({
      title: t('shortcuts.groupDeleteConfirmTitle'),
      messageTemplate: t('shortcuts.groupDeleteConfirm'),
      messageVars: { title: g.title, count: String(g.items.length) },
      tone: 'danger',
    });
    if (!ok) return;
    onChange(groups.filter((x) => x.id !== g.id));
  };

  const addGroup = (): void => {
    const id = makeActionId('g');
    const newGroup: ShortcutGroup = {
      id,
      title: t('shortcuts.addGroupTitle'),
      items: [],
    };
    onChange([...groups, newGroup]);
    setExpanded((prev) => new Set(prev).add(id));
    // 立刻进入标题编辑
    setEditingGroup({ groupId: id, title: newGroup.title, desc: '', error: null });
  };

  const startEditGroup = (g: ShortcutGroup): void => {
    setEditingGroup({ groupId: g.id, title: g.title, desc: g.desc ?? '', error: null });
  };

  const commitEditGroup = (): void => {
    if (!editingGroup) return;
    const trimmed = editingGroup.title.trim();
    if (trimmed.length === 0) {
      setEditingGroup({ ...editingGroup, error: t('shortcuts.groupTitleEmptyError') });
      return;
    }
    updateGroup(editingGroup.groupId, {
      title: trimmed,
      desc: editingGroup.desc.trim() || undefined,
    });
    setEditingGroup(null);
  };

  const cancelEditGroup = (): void => setEditingGroup(null);

  // ─── item 级操作 ───

  const updateItem = (groupId: string, itemIdx: number, patch: Partial<ShortcutItem>): void => {
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
    const newItem: ShortcutItem = {
      id: makeActionId('i'),
      label: '',
      data: '',
      enabled: true,
    };
    onChange(
      groups.map((g) =>
        g.id === groupId ? { ...g, items: [...g.items, newItem] } : g,
      ),
    );
    setExpanded((prev) => new Set(prev).add(groupId));
    // 进入新项的编辑态：找到该项在 flat 里的下标
    const baseFlatIdx =
      groups.findIndex((g) => g.id === groupId) >= 0
        ? groups
            .slice(0, groups.findIndex((g) => g.id === groupId))
            .reduce((acc, g) => acc + g.items.length, 0)
        : 0;
    const targetGroup = groups.find((g) => g.id === groupId);
    const newFlatIdx = baseFlatIdx + (targetGroup?.items.length ?? 0);
    setEditingItem({ flatIdx: newFlatIdx, label: '', dataRaw: '', warning: null });
  };

  const startEditItem = (flatIdx: number, item: ShortcutItem): void => {
    setEditingItem({
      flatIdx,
      label: item.label,
      dataRaw: encodeForInput(item.data),
      warning: null,
    });
  };

  const commitEditItem = (): void => {
    if (!editingItem) return;
    const dec = decodeFromInput(editingItem.dataRaw);
    if (dec.warning !== null) {
      setEditingItem({ ...editingItem, warning: dec.warning });
      return;
    }
    const row = flat[editingItem.flatIdx];
    if (!row) {
      setEditingItem(null);
      return;
    }
    updateItem(row.groupId, row.itemIdx, { label: editingItem.label, data: dec.value });
    setEditingItem(null);
  };

  const cancelEditItem = (): void => setEditingItem(null);

  const resetItemToDefault = async (
    groupId: string,
    itemIdx: number,
    item: ShortcutItem,
  ): Promise<void> => {
    if (!item.builtinKey) return;
    const builtin = lookupBuiltinShortcut(item.builtinKey);
    if (!builtin) return;
    const ok = await confirm({
      title: t('shortcuts.resetItemConfirmTitle'),
      messageTemplate: t('shortcuts.resetItemConfirm'),
      messageVars: { label: item.label || builtin.label },
      tone: 'danger',
    });
    if (!ok) return;
    updateItem(groupId, itemIdx, {
      label: builtin.label,
      data: builtin.data,
      desc: builtin.desc,
      // enabled 保留用户当前态（重置数据但不动启用状态，体验更轻）
    });
  };

  // 拖拽时的浮层内容
  const ghostRow = dragState ? flat[dragState.sourceIdx] : null;

  return (
    <div id="shortcut-settings" className={clsx(s.root, isDragging && s.rootDragging)}>
      {groups.map((g, gIdx) => (
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
          // 分组级拖拽
          registerGroupSectionEl={(el) => groupDrag.register.row(gIdx, el)}
          groupDragHandleProps={groupDrag.getHandleProps(gIdx)}
          groupDragSourceIdx={groupDrag.dragState?.sourceIdx ?? null}
          groupIdx={gIdx}
          groupIndicator={groupDrag.dropIndicator}
          registerListEl={(el) => register.group(g.id, el)}
          onToggle={() => toggleExpanded(g.id)}
          onEnableAll={() => setGroupAllEnabled(g.id, true)}
          onDisableAll={() => setGroupAllEnabled(g.id, false)}
          onStartEditTitle={() => startEditGroup(g)}
          onChangeEditingTitle={(title) =>
            setEditingGroup((prev) => (prev ? { ...prev, title, error: null } : prev))
          }
          onChangeEditingDesc={(desc) =>
            setEditingGroup((prev) => (prev ? { ...prev, desc } : prev))
          }
          onCommitEditTitle={commitEditGroup}
          onCancelEditTitle={cancelEditGroup}
          onDeleteGroup={() => void deleteGroup(g)}
          onAddItem={() => addItemToGroup(g.id)}
        >
          {g.items.map((item, itemIdx) => {
            // 找该项在 flat 里的下标
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
                onChangeLabel={(label) =>
                  setEditingItem((prev) => (prev ? { ...prev, label } : prev))
                }
                onChangeDataRaw={(raw) => {
                  const dec = decodeFromInput(raw);
                  setEditingItem((prev) =>
                    prev ? { ...prev, dataRaw: raw, warning: dec.warning } : prev,
                  );
                }}
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
        {t('shortcuts.addGroupBtn')}
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
          <span className={s.dragGhostLabel}>{ghostRow.item.label || t('shortcuts.unnamed')}</span>
          <span className={s.dragGhostData}>{encodeForInput(ghostRow.item.data)}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

interface GroupBlockProps {
  group: ShortcutGroup;
  isOpen: boolean;
  isEditingTitle: boolean;
  editingGroupState: EditingGroupState | null;
  isDropTarget: boolean;
  registerListEl: (el: HTMLElement | null) => void;
  // 分组级拖拽
  registerGroupSectionEl: (el: HTMLElement | null) => void;
  groupDragHandleProps: ReturnType<ReturnType<typeof useDragReorder<ShortcutGroup>>['getHandleProps']>;
  groupDragSourceIdx: number | null;
  groupIdx: number;
  groupIndicator: DropIndicator | null;
  onToggle: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onStartEditTitle: () => void;
  onChangeEditingTitle: (title: string) => void;
  onChangeEditingDesc: (desc: string) => void;
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
    registerGroupSectionEl,
    groupDragHandleProps,
    groupDragSourceIdx,
    groupIdx,
    groupIndicator,
    onToggle,
    onEnableAll,
    onDisableAll,
    onStartEditTitle,
    onChangeEditingTitle,
    onChangeEditingDesc,
    onCommitEditTitle,
    onCancelEditTitle,
    onDeleteGroup,
    onAddItem,
    children,
  } = props;
  const isGroupDragSource = groupDragSourceIdx === groupIdx;
  const showGroupIndicatorBefore =
    groupIndicator?.kind === 'row' && groupIndicator.idx === groupIdx && groupIndicator.position === 'before';
  const showGroupIndicatorAfter =
    groupIndicator?.kind === 'row' && groupIndicator.idx === groupIdx && groupIndicator.position === 'after';
  const t = useT();
  const total = group.items.length;
  const enabledCount = group.items.filter((it) => it.enabled).length;
  const allOn = total > 0 && enabledCount === total;

  return (
    <section
      ref={registerGroupSectionEl}
      className={clsx(
        s.group,
        isDropTarget && s.groupDropTarget,
        isGroupDragSource && s.rowDragSource,
      )}
      data-group-id={group.id}
      style={{ position: 'relative' }}
    >
      {showGroupIndicatorBefore && <div className={s.dropIndicatorTop} />}
      <div className={s.head}>
        {isEditingTitle && editingGroupState ? (
          <div className={s.groupTitleEdit}>
            <div className={s.groupTitleRow}>
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
                  // 点本行内按钮 → 不退出，让 click 跑完
                  if (e.relatedTarget instanceof Node) {
                    const headEl = (e.currentTarget as HTMLElement).closest(`.${s.head}`);
                    if (headEl?.contains(e.relatedTarget)) return;
                  }
                  onCancelEditTitle();
                }}
                autoFocus
                placeholder={t('shortcuts.addGroupPlaceholder')}
                className={s.groupTitleInput}
              />
              <button
                type="button"
                onClick={onCommitEditTitle}
                aria-label={t('shortcuts.saveTooltip')}
                title={t('shortcuts.saveTooltip')}
                className={s.commitBtn}
              >
                <IconCheck size={12} stroke={2} />
              </button>
              <button
                type="button"
                onClick={onCancelEditTitle}
                aria-label={t('shortcuts.cancelTooltip')}
                title={t('shortcuts.cancelTooltip')}
                className={s.cancelBtn}
              >
                <IconX size={12} stroke={1.5} />
              </button>
            </div>
            <input
              type="text"
              value={editingGroupState.desc}
              onChange={(e) => onChangeEditingDesc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitEditTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelEditTitle();
                }
              }}
              placeholder={t('shortcuts.groupDescPlaceholder')}
              className={s.groupDescInput}
            />
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
              aria-label={t('shortcuts.groupEditTooltip')}
              title={t('shortcuts.groupEditTooltip')}
              className={s.groupAction}
            >
              <IconPencil size={12} stroke={1.5} />
            </button>
            <button
              type="button"
              onClick={onDeleteGroup}
              aria-label={t('shortcuts.groupDeleteTooltip')}
              title={t('shortcuts.groupDeleteTooltip')}
              className={clsx(s.groupAction, s.groupActionDanger)}
            >
              <IconTrash size={12} stroke={1.5} />
            </button>
            <button
              type="button"
              aria-label={t('shortcuts.dragHandleTooltip')}
              title={t('shortcuts.dragHandleTooltip')}
              className={s.groupGripBtn}
              {...groupDragHandleProps}
            >
              <IconGripVertical size={12} stroke={1.5} />
            </button>
          </>
        )}
      </div>

      {isOpen && (
        <div className={s.body}>
          {group.desc && <p className={s.desc}>{group.desc}</p>}
          {total === 0 && <p className={s.empty}>{t('shortcuts.emptyList')}</p>}
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
      {showGroupIndicatorAfter && <div className={s.dropIndicatorBot} />}
    </section>
  );
}

interface RowWithIndicatorProps {
  flatIdx: number;
  item: ShortcutItem;
  editing: EditingItemState | null;
  registerRowEl: (el: HTMLElement | null) => void;
  handleProps: ReturnType<ReturnType<typeof useDragReorder<FlatRow>>['getHandleProps']>;
  dragSourceIdx: number | null;
  indicator: DropIndicator | null;
  onToggleEnabled: (checked: boolean) => void;
  onStartEdit: () => void;
  onChangeLabel: (label: string) => void;
  onChangeDataRaw: (raw: string) => void;
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
    onChangeLabel,
    onChangeDataRaw,
    onCommit,
    onCancel,
    onDelete,
    onResetToDefault,
  } = props;
  const inEdit = editing !== null;
  const dataDisplay = encodeForInput(item.data);
  const isDragSource = dragSourceIdx === flatIdx;
  const showIndicatorBefore =
    indicator?.kind === 'row' && indicator.idx === flatIdx && indicator.position === 'before';
  const showIndicatorAfter =
    indicator?.kind === 'row' && indicator.idx === flatIdx && indicator.position === 'after';

  if (inEdit) {
    return (
      <div className={s.editRow} ref={registerRowEl}>
        {showIndicatorBefore && <div className={s.dropIndicatorTop} />}
        <div className={s.editFields}>
          <input
            type="text"
            value={editing.label}
            placeholder={t('shortcuts.namePlaceholder')}
            onChange={(e) => onChangeLabel(e.target.value)}
            autoFocus
            className={s.editLabelInput}
          />
          <input
            type="text"
            value={editing.dataRaw}
            placeholder={t('shortcuts.dataPlaceholder')}
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
            className={clsx(s.editDataInput, editing.warning && s.editDataInputError)}
          />
          <button
            type="button"
            onClick={onCommit}
            aria-label={t('shortcuts.saveTooltip')}
            title={t('shortcuts.saveTooltip')}
            className={s.commitBtn}
          >
            <IconCheck size={12} stroke={2} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('shortcuts.cancelTooltip')}
            title={t('shortcuts.cancelTooltip')}
            className={s.cancelBtn}
          >
            <IconX size={12} stroke={1.5} />
          </button>
        </div>
        {editing.warning && <span className={s.editWarning}>{editing.warning}</span>}
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
        {item.label || t('shortcuts.unnamed')}
      </span>
      <span className={clsx(s.rowData, !dataDisplay && s.rowDataEmpty)}>
        {dataDisplay || t('shortcuts.empty')}
      </span>
      {item.desc && (
        <span className={s.rowDesc} title={item.desc}>
          {item.desc}
        </span>
      )}
      <button
        type="button"
        onClick={onStartEdit}
        aria-label={t('shortcuts.editTooltip')}
        title={t('shortcuts.editTooltip')}
        className={s.iconBtn}
      >
        <IconPencil size={12} stroke={1.5} />
      </button>
      {onResetToDefault && (
        <button
          type="button"
          onClick={onResetToDefault}
          aria-label={t('shortcuts.resetItemTooltip')}
          title={t('shortcuts.resetItemTooltip')}
          className={clsx(s.iconBtn, s.resetItemBtn)}
        >
          <IconRefresh size={12} stroke={1.5} />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={t('shortcuts.deleteTooltip')}
        title={t('shortcuts.deleteTooltip')}
        className={clsx(s.iconBtn, s.deleteBtn)}
      >
        <IconTrash size={12} stroke={1.5} />
      </button>
      <button
        type="button"
        aria-label={t('shortcuts.dragHandleTooltip')}
        className={s.gripBtn}
        {...handleProps}
      >
        <IconGripVertical size={12} stroke={1.5} />
      </button>
      {showIndicatorAfter && <div className={s.dropIndicatorBot} />}
    </div>
  );
}
