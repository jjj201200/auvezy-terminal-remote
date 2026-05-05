/**
 * CommandSettings
 *
 * 按内置分组（session/context/agent/workflow/auth/help/tools）+ custom 组展示。
 *
 * 与 ShortcutSettings 设计同源：
 *  - 行高紧凑、组默认折叠（除「会话」）、行内编辑
 *  - 任何组都允许编辑、删除、新增（custom 组提供新增按钮）
 *  - 所有组之间通过左侧 grip 手柄拖拽重排，跨组拖动同步修改 group 字段
 *
 * 命令字段比快捷键多两个：
 *  - command：要发送的命令文本（如 /clear）
 *  - autoSend：true=点击直接发送，false=填到输入框等待编辑
 *  - desc：可选描述（编辑时也可改，按钮 title 与设置面板都展示）
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
  type ConfigurableCommand,
  type CommandGroupId,
  COMMAND_GROUPS,
} from '@otr/shared';
import clsx from 'clsx';
import { Toggle } from '../ui/Toggle.js';
import { useDragReorder, type DropIndicator } from '../../hooks/useDragReorder.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './ShortcutSettings.module.scss';
import sc from './CommandSettings.module.scss';

export interface CommandSettingsProps {
  value: ConfigurableCommand[];
  onChange: (next: ConfigurableCommand[]) => void;
}

interface EditingState {
  idx: number;
  label: string;
  command: string;
  desc: string;
  autoSend: boolean;
}

const CUSTOM_GROUP_ID: CommandGroupId = 'custom';

export function CommandSettings({ value, onChange }: CommandSettingsProps): JSX.Element {
  const t = useT();
  const CUSTOM_GROUP_TITLE = t('toolbar.customGroup');
  const CUSTOM_GROUP_DESC = t('commands.descPlaceholder');
  const [expanded, setExpanded] = useState<Set<CommandGroupId>>(new Set(['session']));
  const [editing, setEditing] = useState<EditingState | null>(null);

  const { register, getHandleProps, dragState, dropIndicator, isDragging } =
    useDragReorder<ConfigurableCommand>({
      value,
      onChange,
      groupOf: (c) => c.group ?? CUSTOM_GROUP_ID,
      withGroup: (c, gid) => ({ ...c, group: gid as CommandGroupId }),
    });

  const buckets = useMemo(() => {
    const map = new Map<CommandGroupId, Array<{ c: ConfigurableCommand; idx: number }>>();
    for (const g of COMMAND_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_GROUP_ID, []);
    value.forEach((c, idx) => {
      const gid =
        c.group && map.has(c.group as CommandGroupId)
          ? (c.group as CommandGroupId)
          : CUSTOM_GROUP_ID;
      map.get(gid)!.push({ c, idx });
    });
    return map;
  }, [value]);

  const toggleExpanded = (id: CommandGroupId): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateAt = (idx: number, patch: Partial<ConfigurableCommand>): void => {
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeAt = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
    if (editing?.idx === idx) setEditing(null);
  };

  const setGroupEnabled = (gid: CommandGroupId, enabled: boolean): void => {
    onChange(
      value.map((c) => {
        const owns =
          (c.group ?? CUSTOM_GROUP_ID) === gid ||
          (gid === CUSTOM_GROUP_ID && !c.group);
        return owns ? { ...c, enabled } : c;
      }),
    );
  };

  const addCustom = (): void => {
    setExpanded((prev) => new Set(prev).add(CUSTOM_GROUP_ID));
    const newItem: ConfigurableCommand = {
      label: '',
      command: '',
      enabled: true,
      autoSend: true,
      group: CUSTOM_GROUP_ID,
    };
    onChange([...value, newItem]);
    setEditing({
      idx: value.length,
      label: '',
      command: '',
      desc: '',
      autoSend: true,
    });
  };

  const startEdit = (idx: number, c: ConfigurableCommand): void => {
    setEditing({
      idx,
      label: c.label,
      command: c.command,
      desc: c.desc ?? '',
      autoSend: c.autoSend ?? true,
    });
  };

  const commitEdit = (): void => {
    if (!editing) return;
    updateAt(editing.idx, {
      label: editing.label,
      command: editing.command,
      desc: editing.desc.length > 0 ? editing.desc : undefined,
      autoSend: editing.autoSend,
    });
    setEditing(null);
  };

  const cancelEdit = (): void => setEditing(null);

  const renderGroup = (
    gid: CommandGroupId,
    title: string,
    desc: string,
    isCustomGroup: boolean,
  ): JSX.Element => {
    const items = buckets.get(gid) ?? [];
    const enabledCount = items.filter((it) => it.c.enabled).length;
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
        {items.map(({ c, idx }) => (
          <RowWithIndicator
            key={idx}
            idx={idx}
            command={c}
            editing={editing?.idx === idx ? editing : null}
            registerRowEl={(el) => register.row(idx, el)}
            handleProps={getHandleProps(idx)}
            dragSourceIdx={dragState?.sourceIdx ?? null}
            indicator={dropIndicator}
            onToggleEnabled={(checked) => updateAt(idx, { enabled: checked })}
            onStartEdit={() => startEdit(idx, c)}
            onChangeField={(patch) =>
              setEditing((prev) => (prev ? { ...prev, ...patch } : prev))
            }
            onCommit={commitEdit}
            onCancel={cancelEdit}
            onDelete={() => removeAt(idx)}
          />
        ))}
      </GroupBlock>
    );
  };

  const ghostItem = dragState ? value[dragState.sourceIdx] : null;

  return (
    <div id="command-settings" className={clsx(s.root, isDragging && s.rootDragging)}>
      {COMMAND_GROUPS.map((g) => renderGroup(g.id, g.title, g.desc, false))}
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
          <span className={s.dragGhostLabel}>{ghostItem.label || t('commands.unnamed')}</span>
          <span className={s.dragGhostData}>{ghostItem.command}</span>
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
          {totalCount === 0 && !footer && <p className={s.empty}>{t('commands.emptyList')}</p>}
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
  command: ConfigurableCommand;
  editing: EditingState | null;
  registerRowEl: (el: HTMLElement | null) => void;
  handleProps: ReturnType<ReturnType<typeof useDragReorder<ConfigurableCommand>>['getHandleProps']>;
  dragSourceIdx: number | null;
  indicator: DropIndicator | null;
  onToggleEnabled: (checked: boolean) => void;
  onStartEdit: () => void;
  onChangeField: (patch: Partial<EditingState>) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function RowWithIndicator({
  idx,
  command,
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
}: RowWithIndicatorProps): JSX.Element {
  const t = useT();
  const inEdit = editing !== null;
  const auto = command.autoSend ?? true;
  const isDragSource = dragSourceIdx === idx;
  const showIndicatorBefore =
    indicator?.kind === 'row' && indicator.idx === idx && indicator.position === 'before';
  const showIndicatorAfter =
    indicator?.kind === 'row' && indicator.idx === idx && indicator.position === 'after';

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
      className={clsx(
        s.row,
        !command.enabled && s.rowDisabled,
        isDragSource && s.rowDragSource,
      )}
    >
      {showIndicatorBefore && <div className={s.dropIndicatorTop} />}
      <Toggle checked={command.enabled} onCheckedChange={onToggleEnabled} />
      <span className={clsx(s.rowLabel, !command.label && s.rowLabelEmpty)}>
        {command.label || t('commands.unnamed')}
      </span>
      <span className={clsx(s.rowData, !command.command && s.rowDataEmpty)}>
        {command.command || t('commands.empty')}
      </span>
      <span className={clsx(sc.autoSendTag, !auto && sc.autoSendTagDraft)}>
        {auto ? '自动' : '编辑'}
      </span>
      {command.desc && (
        <span className={s.rowDesc} title={command.desc}>
          {command.desc}
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
