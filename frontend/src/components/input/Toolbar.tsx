/**
 * Toolbar
 *
 * 输入栏上方的工具栏，由两行组成：
 *
 *  1. 分类行：左半渲染快捷键分类（ltr，从左往右），右半渲染命令分类（rtl，从右往左），
 *             中间是细分割线；两侧各自溢出滚动 + 左右箭头 + 触摸/鼠标拖拽。
 *  2. 内容行：根据当前激活分类，渲染对应的"按钮列表"。点击：
 *      - 快捷键 → onSendData(sc.data) 直接发到 PTY（不附加 \r）
 *      - 命令   → autoSend=true：onSubmitCommand(cmd)（直接发送，附加 \r 由父级决定）
 *                 autoSend=false：onPrefillCommand(cmd)（填到输入框等待编辑）
 *
 * 激活态：
 *  - 全局唯一：{kind, groupId} | null
 *  - 默认选第一个非空的快捷键组；若没有快捷键则选第一个非空命令组
 *  - shortcut 与 command 之间是互斥的（一行只显示一组的按钮）
 */

import {
  useEffect,
  useMemo,
  useState,
  type JSX,
} from 'react';
import {
  type ConfigurableShortcut,
  type ConfigurableCommand,
  type ShortcutGroupId,
  type CommandGroupId,
  SHORTCUT_GROUPS,
  COMMAND_GROUPS,
} from '@otr/shared';
import clsx from 'clsx';
import { ScrollableTabs, type ScrollableTabItem } from './ScrollableTabs.js';
import { PressPreview } from '../ui/PressPreview.js';
import s from './Toolbar.module.scss';

const CUSTOM_SHORTCUT_GROUP: { id: ShortcutGroupId; title: string } = {
  id: 'custom',
  title: '自定义',
};
const CUSTOM_COMMAND_GROUP: { id: CommandGroupId; title: string } = {
  id: 'custom',
  title: '自定义',
};

export interface ToolbarProps {
  shortcuts?: ConfigurableShortcut[];
  commands?: ConfigurableCommand[];
  /** 发送原始数据到 PTY（无附加换行，由调用方自己决定） */
  onSendData: (data: string) => void;
  /** 提交一条命令（autoSend=true 走这条；调用方负责附加 \r） */
  onSubmitCommand: (text: string) => void;
  /** 把命令填入输入框（autoSend=false 走这条） */
  onPrefillCommand: (text: string) => void;
  disabled?: boolean;
}

type ActiveKind = 'shortcut' | 'command';
interface ActiveState {
  kind: ActiveKind;
  groupId: string;
}

export function Toolbar({
  shortcuts,
  commands,
  onSendData,
  onSubmitCommand,
  onPrefillCommand,
  disabled,
}: ToolbarProps): JSX.Element | null {
  // ──────── 快捷键按 group 分桶（仅启用项）────────
  const shortcutBuckets = useMemo(() => {
    const map = new Map<string, ConfigurableShortcut[]>();
    for (const g of SHORTCUT_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_SHORTCUT_GROUP.id, []);
    for (const sc of shortcuts ?? []) {
      if (!sc.enabled) continue;
      const gid =
        sc.group && map.has(sc.group as string)
          ? (sc.group as string)
          : CUSTOM_SHORTCUT_GROUP.id;
      map.get(gid)!.push(sc);
    }
    return map;
  }, [shortcuts]);

  // ──────── 命令按 group 分桶（仅启用项）────────
  const commandBuckets = useMemo(() => {
    const map = new Map<string, ConfigurableCommand[]>();
    for (const g of COMMAND_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_COMMAND_GROUP.id, []);
    for (const c of commands ?? []) {
      if (!c.enabled) continue;
      const gid =
        c.group && map.has(c.group as string)
          ? (c.group as string)
          : CUSTOM_COMMAND_GROUP.id;
      map.get(gid)!.push(c);
    }
    return map;
  }, [commands]);

  // ──────── 当前可见的分类 tab 列表 ────────
  const visibleShortcutGroups = useMemo<ScrollableTabItem[]>(() => {
    const arr: ScrollableTabItem[] = [];
    for (const g of SHORTCUT_GROUPS) {
      if ((shortcutBuckets.get(g.id) ?? []).length > 0) {
        arr.push({ id: g.id, title: g.title });
      }
    }
    if ((shortcutBuckets.get(CUSTOM_SHORTCUT_GROUP.id) ?? []).length > 0) {
      arr.push({ id: CUSTOM_SHORTCUT_GROUP.id, title: CUSTOM_SHORTCUT_GROUP.title });
    }
    return arr;
  }, [shortcutBuckets]);

  const visibleCommandGroups = useMemo<ScrollableTabItem[]>(() => {
    const arr: ScrollableTabItem[] = [];
    for (const g of COMMAND_GROUPS) {
      if ((commandBuckets.get(g.id) ?? []).length > 0) {
        arr.push({ id: g.id, title: g.title });
      }
    }
    if ((commandBuckets.get(CUSTOM_COMMAND_GROUP.id) ?? []).length > 0) {
      arr.push({ id: CUSTOM_COMMAND_GROUP.id, title: CUSTOM_COMMAND_GROUP.title });
    }
    return arr;
  }, [commandBuckets]);

  // ──────── 激活态 ────────
  const [active, setActive] = useState<ActiveState | null>(null);

  // 当可见组列表变化时，校正激活态：失效则回退到第一个有效项
  useEffect(() => {
    const hasShortcut = visibleShortcutGroups.length > 0;
    const hasCommand = visibleCommandGroups.length > 0;

    if (!hasShortcut && !hasCommand) {
      if (active !== null) setActive(null);
      return;
    }

    if (active !== null) {
      const stillValid =
        (active.kind === 'shortcut' &&
          visibleShortcutGroups.some((g) => g.id === active.groupId)) ||
        (active.kind === 'command' &&
          visibleCommandGroups.some((g) => g.id === active.groupId));
      if (stillValid) return;
    }

    if (hasShortcut) {
      setActive({ kind: 'shortcut', groupId: visibleShortcutGroups[0]!.id });
    } else {
      setActive({ kind: 'command', groupId: visibleCommandGroups[0]!.id });
    }
  }, [visibleShortcutGroups, visibleCommandGroups, active]);

  // 没有任何启用的快捷键 / 命令 → 整栏隐藏
  if (visibleShortcutGroups.length === 0 && visibleCommandGroups.length === 0) {
    return null;
  }

  // 当前激活组下的按钮列表
  const activeShortcuts =
    active?.kind === 'shortcut' ? shortcutBuckets.get(active.groupId) ?? [] : [];
  const activeCommands =
    active?.kind === 'command' ? commandBuckets.get(active.groupId) ?? [] : [];

  return (
    <div id="toolbar" className={s.root}>
      {/* 上行：两组分类 tab */}
      <div className={s.cats}>
        {visibleShortcutGroups.length > 0 && (
          <ScrollableTabs
            items={visibleShortcutGroups}
            direction="ltr"
            disabled={disabled}
            activeId={active?.kind === 'shortcut' ? active.groupId : null}
            onChange={(id) => setActive({ kind: 'shortcut', groupId: id })}
            className={s.shortcutCats}
          />
        )}
        {visibleShortcutGroups.length > 0 && visibleCommandGroups.length > 0 && (
          <span className={s.divider} aria-hidden="true" />
        )}
        {visibleCommandGroups.length > 0 && (
          <ScrollableTabs
            items={visibleCommandGroups}
            direction="rtl"
            disabled={disabled}
            activeId={active?.kind === 'command' ? active.groupId : null}
            onChange={(id) => setActive({ kind: 'command', groupId: id })}
            className={s.commandCats}
          />
        )}
      </div>

      {/* 下行：当前激活组下的按钮 */}
      <div className={s.keys}>
        {active === null && <span className={s.empty}>选择一个分类</span>}
        {active?.kind === 'shortcut' && activeShortcuts.length === 0 && (
          <span className={s.empty}>该分组暂无启用项</span>
        )}
        {active?.kind === 'command' && activeCommands.length === 0 && (
          <span className={s.empty}>该分组暂无启用项</span>
        )}

        {active?.kind === 'shortcut' &&
          activeShortcuts.map((sc, idx) => (
            <PressPreview
              key={`sc-${sc.label}-${idx}`}
              label={sc.label}
              desc={sc.desc}
              disabled={disabled}
              onPress={() => onSendData(sc.data)}
              className={s.btn}
            >
              {sc.label}
            </PressPreview>
          ))}

        {active?.kind === 'command' &&
          activeCommands.map((c, idx) => {
            const auto = c.autoSend ?? true;
            return (
              <PressPreview
                key={`cmd-${c.label}-${idx}`}
                label={c.label}
                desc={c.desc}
                disabled={disabled}
                onPress={() => {
                  if (auto) onSubmitCommand(c.command);
                  else onPrefillCommand(c.command);
                }}
                className={clsx(s.btn, !auto && s.btnDraft)}
              >
                {c.label}
              </PressPreview>
            );
          })}
      </div>
    </div>
  );
}
