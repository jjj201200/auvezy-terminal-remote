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
} from 'auvezy-terminal-remote-shared';
import clsx from 'clsx';
import { ScrollableTabs, type ScrollableTabItem } from './ScrollableTabs.js';
import { HScroller } from '../ui/HScroller.js';
import { PressPreview } from '../ui/PressPreview.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './Toolbar.module.scss';

// id 是协议字段不变，title 在组件内通过 t() 渲染
const CUSTOM_SHORTCUT_GROUP_ID: ShortcutGroupId = 'custom';
const CUSTOM_COMMAND_GROUP_ID: CommandGroupId = 'custom';

/**
 * TUI 专属分组 → 需要的激活集成模块 id（见 ToolbarProps.filterByTui）
 *
 * 快捷键组 id 与模块 id 同名；命令组用简名（claude / codex）。
 */
const TUI_SHORTCUT_GROUP_MODULE: Record<string, string> = {
  'claude-code': 'claude-code',
  codex: 'codex',
};
const TUI_COMMAND_GROUP_MODULE: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
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
  /**
   * 打开 Skill / MCP 自动发现 modal。
   *
   * 传了才显示入口按钮——按钮固定挂在「常用」组（快捷键）与
   * 「会话」组（命令）的内容行末尾，不占配置条目位（动态数据，
   * 由 backend /api/discovery 扫描）。两组 tab 不可见时入口随之隐藏。
   */
  onOpenDiscovery?: () => void;
  /**
   * TUI 分组过滤开关（= integrations 总开关）。
   *
   * true 时 claude-code / claude 与 codex / codex 四个 TUI 专属组只在
   * activeTuiModule 与之匹配（实例检测到对应 TUI）时出现在分类行；
   * false / 缺省时不做过滤，仅按条目 enabled 显示。
   */
  filterByTui?: boolean;
  /** 实例当前激活的集成模块 id（SessionStatusExtras.integrationId，可为 null） */
  activeTuiModule?: string | null;
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
  onOpenDiscovery,
  filterByTui,
  activeTuiModule,
  disabled,
}: ToolbarProps): JSX.Element | null {
  const t = useT();
  const customLabel = t('toolbar.customGroup');

  // TUI 专属分组的过滤谓词：过滤开启时，组要求模块与实例激活模块一致
  const tuiFilterOn = filterByTui === true;
  const activeModule = activeTuiModule ?? null;
  const shortcutVisible = (groupId: string): boolean =>
    !tuiFilterOn ||
    TUI_SHORTCUT_GROUP_MODULE[groupId] === undefined ||
    TUI_SHORTCUT_GROUP_MODULE[groupId] === activeModule;
  const commandVisible = (groupId: string): boolean =>
    !tuiFilterOn ||
    TUI_COMMAND_GROUP_MODULE[groupId] === undefined ||
    TUI_COMMAND_GROUP_MODULE[groupId] === activeModule;

  // ──────── 快捷键按 group 分桶（仅启用项）────────
  const shortcutBuckets = useMemo(() => {
    const map = new Map<string, ConfigurableShortcut[]>();
    for (const g of SHORTCUT_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_SHORTCUT_GROUP_ID, []);
    for (const sc of shortcuts ?? []) {
      if (!sc.enabled) continue;
      const gid =
        sc.group && map.has(sc.group as string)
          ? (sc.group as string)
          : CUSTOM_SHORTCUT_GROUP_ID;
      map.get(gid)!.push(sc);
    }
    return map;
  }, [shortcuts]);

  // ──────── 命令按 group 分桶（仅启用项）────────
  const commandBuckets = useMemo(() => {
    const map = new Map<string, ConfigurableCommand[]>();
    for (const g of COMMAND_GROUPS) map.set(g.id, []);
    map.set(CUSTOM_COMMAND_GROUP_ID, []);
    for (const c of commands ?? []) {
      if (!c.enabled) continue;
      const gid =
        c.group && map.has(c.group as string)
          ? (c.group as string)
          : CUSTOM_COMMAND_GROUP_ID;
      map.get(gid)!.push(c);
    }
    return map;
  }, [commands]);

  // ──────── 当前可见的分类 tab 列表 ────────
  const visibleShortcutGroups = useMemo<ScrollableTabItem[]>(() => {
    const arr: ScrollableTabItem[] = [];
    for (const g of SHORTCUT_GROUPS) {
      if (!shortcutVisible(g.id)) continue;
      if ((shortcutBuckets.get(g.id) ?? []).length > 0) {
        arr.push({ id: g.id, title: g.title });
      }
    }
    if ((shortcutBuckets.get(CUSTOM_SHORTCUT_GROUP_ID) ?? []).length > 0) {
      arr.push({ id: CUSTOM_SHORTCUT_GROUP_ID, title: customLabel });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shortcutVisible 依赖 tuiFilterOn/activeModule
  }, [shortcutBuckets, customLabel, tuiFilterOn, activeModule]);

  const visibleCommandGroups = useMemo<ScrollableTabItem[]>(() => {
    const arr: ScrollableTabItem[] = [];
    for (const g of COMMAND_GROUPS) {
      if (!commandVisible(g.id)) continue;
      if ((commandBuckets.get(g.id) ?? []).length > 0) {
        arr.push({ id: g.id, title: g.title });
      }
    }
    if ((commandBuckets.get(CUSTOM_COMMAND_GROUP_ID) ?? []).length > 0) {
      arr.push({ id: CUSTOM_COMMAND_GROUP_ID, title: customLabel });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commandVisible 依赖 tuiFilterOn/activeModule
  }, [commandBuckets, customLabel, tuiFilterOn, activeModule]);

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

      {/* 下行：当前激活组下的按钮 —— 用 HScroller 与上方分类行同款溢出策略 */}
      <HScroller
        className={s.keys}
        scrollerClassName={s.keysScroller}
        disabled={disabled}
        refreshKey={active?.kind === 'shortcut' ? activeShortcuts : activeCommands}
      >
        {active === null && <span className={s.empty}>{t('toolbar.pickGroup')}</span>}
        {active?.kind === 'shortcut' && activeShortcuts.length === 0 && (
          <span className={s.empty}>{t('toolbar.groupEmpty')}</span>
        )}
        {active?.kind === 'command' && activeCommands.length === 0 && (
          <span className={s.empty}>{t('toolbar.groupEmpty')}</span>
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

        {/* Skill / MCP 自动发现入口：固定挂在「常用」（快捷键）与「会话」（命令）
            两个组的内容行末尾，不在用户配置里占条目位 */}
        {onOpenDiscovery &&
          !disabled &&
          ((active?.kind === 'shortcut' && active.groupId === 'common') ||
            (active?.kind === 'command' && active.groupId === 'session')) && (
            <PressPreview
              label={t('discovery.toolbarButton')}
              desc={t('discovery.toolbarButtonHint')}
              disabled={disabled}
              onPress={onOpenDiscovery}
              className={clsx(s.btn, s.btnDiscovery)}
            >
              {t('discovery.toolbarButton')}
            </PressPreview>
          )}
      </HScroller>
    </div>
  );
}
