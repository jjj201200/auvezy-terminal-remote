/**
 * ShortcutSettings
 *
 * 按内置分组（common/editing/readline/vim/tmux/signals）+ custom 组展示。
 *
 * 紧凑设计：
 *  - 行高 ~28px，行间用 1px 分隔；不再每行套卡片
 *  - 一行 = [Grip] [Toggle] label · data(灰单色) · [Edit] [Trash]
 *  - 默认折叠（除常用），点击组标题展开；展开时显示组描述（极小灰字）
 *  - 组标题右侧：N/Total 计数 + [全部启用/全部禁用] 文本按钮
 *  - 任何组都允许编辑、删除、新增（custom 组提供新增按钮）；
 *    所有组之间允许通过左侧 grip 手柄拖拽重排，跨组拖动会同步修改 group 字段
 *  - 编辑（label/data）通过点 ✎ 进入行内编辑态；保存或失焦提交
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
} from '@tabler/icons-react';
import {
  type ConfigurableShortcut,
  type ShortcutGroupId,
  SHORTCUT_GROUPS,
} from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { encodeForInput, decodeFromInput } from '../../utils/escape-codec.js';
import { Toggle } from '../ui/Toggle.js';
import { useDragReorder, type DropIndicator } from '../../hooks/useDragReorder.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './ShortcutSettings.module.scss';

export interface ShortcutSettingsProps {
  value: ConfigurableShortcut[];
  onChange: (next: ConfigurableShortcut[]) => void;
}

interface EditingState {
  idx: number;
  label: string;
  dataRaw: string;
  warning: string | null;
}

const CUSTOM_GROUP_ID: ShortcutGroupId = 'custom';

export function ShortcutSettings({ value, onChange }: ShortcutSettingsProps): JSX.Element {
  const t = useT();
  const CUSTOM_GROUP_TITLE = t('toolbar.customGroup');
  const CUSTOM_GROUP_DESC = t('shortcuts.descPlaceholder');
  const [expanded, setExpanded] = useState<Set<ShortcutGroupId>>(new Set(['common']));
  const [editing, setEditing] = useState<EditingState | null>(null);

  const { register, getHandleProps, dragState, dropIndicator, isDragging } =
    useDragReorder<ConfigurableShortcut>({
      value,
      onChange,
      groupOf: (sc) => sc.group ?? CUSTOM_GROUP_ID,
      withGroup: (sc, gid) => ({ ...sc, group: gid as ShortcutGroupId }),
    });

  const buckets = useMemo(() => {
    const map = new Map<ShortcutGroupId, Array<{ s: ConfigurableShortcut; idx: number }>>();
    for (const g of SHORTCUT_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_GROUP_ID, []);
    value.forEach((sc, idx) => {
      const gid =
        sc.group && map.has(sc.group as ShortcutGroupId)
          ? (sc.group as ShortcutGroupId)
          : CUSTOM_GROUP_ID;
      map.get(gid)!.push({ s: sc, idx });
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
    onChange(value.map((sc, i) => (i === idx ? { ...sc, ...patch } : sc)));
  };

  const removeAt = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
    if (editing?.idx === idx) setEditing(null);
  };

  const setGroupEnabled = (gid: ShortcutGroupId, enabled: boolean): void => {
    onChange(
      value.map((sc) => {
        const owns =
          (sc.group ?? CUSTOM_GROUP_ID) === gid ||
          (gid === CUSTOM_GROUP_ID && !sc.group);
        return owns ? { ...sc, enabled } : sc;
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

  const startEdit = (idx: number, sc: ConfigurableShortcut): void => {
    setEditing({
      idx,
      label: sc.label,
      dataRaw: encodeForInput(sc.data),
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

  const renderGroup = (
    gid: ShortcutGroupId,
    title: string,
    desc: string,
    isCustomGroup: boolean,
  ): JSX.Element => {
    const items = buckets.get(gid) ?? [];
    const enabledCount = items.filter((it) => it.s.enabled).length;
    const isOpen = expanded.has(gid);
    const isDropTarget =
      dropIndicator?.kind === 'group-empty' &&
      dropIndicator.groupId === gid &&
      items.length === 0;

    return (
      <GroupBlock
        key={gid}
        groupId={gid}
        title={title}
        desc={desc}
        isOpen={isOpen}
        enabledCount={enabledCount}
        totalCount={items.length}
        isDropTarget={isDropTarget}
        registerListEl={(el) => register.group(gid, el)}
        onToggle={() => toggleExpanded(gid)}
        onEnableAll={() => setGroupEnabled(gid, true)}
        onDisableAll={() => setGroupEnabled(gid, false)}
        footer={
          isCustomGroup ? (
            <button type="button" onClick={addCustom} className={s.addBtn}>
              <IconPlus size={12} stroke={1.5} />
              {t('list.add')}
            </button>
          ) : undefined
        }
      >
        {items.map(({ s: sc, idx }) => (
          <RowWithIndicator
            key={idx}
            idx={idx}
            shortcut={sc}
            editing={editing?.idx === idx ? editing : null}
            registerRowEl={(el) => register.row(idx, el)}
            handleProps={getHandleProps(idx)}
            dragSourceIdx={dragState?.sourceIdx ?? null}
            indicator={dropIndicator}
            onToggleEnabled={(checked) => updateAt(idx, { enabled: checked })}
            onStartEdit={() => startEdit(idx, sc)}
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
            onDelete={() => removeAt(idx)}
          />
        ))}
      </GroupBlock>
    );
  };

  // 拖拽时的浮层内容（被拖项的 label）
  const ghostItem = dragState ? value[dragState.sourceIdx] : null;

  return (
    <div id="shortcut-settings" className={clsx(s.root, isDragging && s.rootDragging)}>
      {SHORTCUT_GROUPS.map((g) => renderGroup(g.id, g.title, g.desc, false))}
      {renderGroup(CUSTOM_GROUP_ID, CUSTOM_GROUP_TITLE, CUSTOM_GROUP_DESC, true)}

      {dragState && ghostItem && (
        <div
          className={s.dragGhost}
          style={{
            left: dragState.ghostX - dragState.offsetX,
            top: dragState.ghostY - dragState.offsetY,
          }}
        >
          <IconGripVertical size={12} stroke={1.5} />
          <span className={s.dragGhostLabel}>{ghostItem.label || t('shortcuts.unnamed')}</span>
          <span className={s.dragGhostData}>{encodeForInput(ghostItem.data)}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

interface GroupBlockProps {
  groupId: string;
  title: string;
  desc: string;
  isOpen: boolean;
  enabledCount: number;
  totalCount: number;
  isDropTarget: boolean;
  registerListEl: (el: HTMLElement | null) => void;
  onToggle: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

function GroupBlock({
  groupId,
  title,
  desc,
  isOpen,
  enabledCount,
  totalCount,
  isDropTarget,
  registerListEl,
  onToggle,
  onEnableAll,
  onDisableAll,
  children,
  footer,
}: GroupBlockProps): JSX.Element {
  const t = useT();
  const allOn = totalCount > 0 && enabledCount === totalCount;
  return (
    <section className={clsx(s.group, isDropTarget && s.groupDropTarget)} data-group-id={groupId}>
      <div className={s.head}>
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
          <span>{title}</span>
          <span className={s.count}>
            {enabledCount}/{totalCount}
          </span>
        </button>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={allOn ? onDisableAll : onEnableAll}
            className={s.bulkBtn}
          >
            {allOn ? t('list.disableAll') : t('list.enableAll')}
          </button>
        )}
      </div>

      {isOpen && (
        <div className={s.body}>
          {desc && <p className={s.desc}>{desc}</p>}
          {totalCount === 0 && !footer && <p className={s.empty}>{t('shortcuts.emptyList')}</p>}
          <div className={s.list} ref={registerListEl}>
            {children}
          </div>
          {footer && <div className={s.footer}>{footer}</div>}
        </div>
      )}
    </section>
  );
}

interface RowWithIndicatorProps {
  idx: number;
  shortcut: ConfigurableShortcut;
  editing: EditingState | null;
  registerRowEl: (el: HTMLElement | null) => void;
  handleProps: ReturnType<ReturnType<typeof useDragReorder<ConfigurableShortcut>>['getHandleProps']>;
  dragSourceIdx: number | null;
  indicator: DropIndicator | null;
  onToggleEnabled: (checked: boolean) => void;
  onStartEdit: () => void;
  onChangeLabel: (label: string) => void;
  onChangeDataRaw: (raw: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function RowWithIndicator({
  idx,
  shortcut,
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
}: RowWithIndicatorProps): JSX.Element {
  const t = useT();
  const inEdit = editing !== null;
  const dataDisplay = encodeForInput(shortcut.data);
  const isDragSource = dragSourceIdx === idx;
  const showIndicatorBefore =
    indicator?.kind === 'row' && indicator.idx === idx && indicator.position === 'before';
  const showIndicatorAfter =
    indicator?.kind === 'row' && indicator.idx === idx && indicator.position === 'after';

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
      className={clsx(
        s.row,
        !shortcut.enabled && s.rowDisabled,
        isDragSource && s.rowDragSource,
      )}
    >
      {showIndicatorBefore && <div className={s.dropIndicatorTop} />}
      <Toggle checked={shortcut.enabled} onCheckedChange={onToggleEnabled} />
      <span className={clsx(s.rowLabel, !shortcut.label && s.rowLabelEmpty)}>
        {shortcut.label || t('shortcuts.unnamed')}
      </span>
      <span className={clsx(s.rowData, !dataDisplay && s.rowDataEmpty)}>
        {dataDisplay || t('shortcuts.empty')}
      </span>
      {shortcut.desc && (
        <span className={s.rowDesc} title={shortcut.desc}>
          {shortcut.desc}
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
