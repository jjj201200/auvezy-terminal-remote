/**
 * 默认快捷键与命令 + UserConfig 类型（前后端共享）
 *
 * UserConfig：
 *   - 文件层（~/.claude-remote/config.json），所有字段可选
 *   - 仅描述"用户偏好"，不含运行期决定的端口、token、命令路径
 *
 * 默认值规则：
 * - 字段缺失或为空数组时，API 层自动填充这里的默认值（不写回文件）
 * - 字段已有值时一律以用户配置为准
 *
 * 分组：
 * - SHORTCUT_GROUPS 定义所有内置分组（常用 / vim / readline / tmux / 信号 等）
 * - DEFAULT_SHORTCUTS 由分组扁平化得到，给现有 API/组件继续用
 * - 「常用」组默认 enabled=true，其他组默认 enabled=false（用户在设置里勾选启用）
 */

// ============================================================
// 类型
// ============================================================

/** 快捷输入项（终端下方快捷栏按钮，点击发送 data 到 PTY） */
export interface ConfigurableShortcut {
  /** 按钮显示名 */
  label: string;
  /** 发送的数据，可含转义如 \x1b 表示 ESC */
  data: string;
  /** 是否启用 */
  enabled: boolean;
  /** 可选描述（在按钮 title 提示与设置面板中展示） */
  desc?: string;
  /** 所属分组 id；缺省视为旧配置 → UI 归入「自定义」组 */
  group?: ShortcutGroupId;
}

/** 命令项（终端下方命令选择器，点击后填入或直接发送） */
export interface ConfigurableCommand {
  /** 按钮显示名 */
  label: string;
  /** 要执行的命令文本 */
  command: string;
  /** 是否启用 */
  enabled: boolean;
  /** true=点击直接发送（默认），false=填入输入框等待用户编辑 */
  autoSend?: boolean;
  /** 可选描述 */
  desc?: string;
}

// ============================================================
// 快捷键分组
// ============================================================

/** 所有内置分组的 id（用作 ConfigurableShortcut.group 取值） */
export type ShortcutGroupId =
  | 'common'
  | 'editing'
  | 'readline'
  | 'vim'
  | 'tmux'
  | 'signals'
  | 'custom';

/** 分组定义 */
export interface ShortcutGroupDef {
  id: ShortcutGroupId;
  /** 分组显示名 */
  title: string;
  /** 分组说明（除「常用」外都展示给用户阅读，便于决定是否启用） */
  desc: string;
  /** 该组默认启用项；不在此列表的快捷键 enabled=false */
  items: Array<Omit<ConfigurableShortcut, 'group'>>;
}

/**
 * 内置快捷键分组定义
 *
 * 设计原则：
 *  - 「常用」组（common）默认全部 enabled=true，覆盖最高频的方向键 / Esc / Tab / Enter
 *  - 其余组默认 enabled=false，由用户在设置面板勾选或一键启用
 *  - 每个非 common 组带 desc，说明使用场景与典型程序，避免用户猜
 *  - 同一物理按键在不同组里用不同 label 区分（例：editing 的 ^C vs signals 的 SIGINT）
 *
 * 物理按键说明：
 *  - \x1b      = ESC（27）
 *  - \r        = CR (Enter)
 *  - \t        = Tab (HT)
 *  - \x1b[A/B/C/D = ↑↓→← (CSI)
 *  - \x1b[Z    = Shift+Tab
 *  - \x01..\x1a = Ctrl-A..Ctrl-Z（^A 的 ASCII 是 1，^B 是 2，… ^Z 是 26）
 *  - \x7f      = Backspace（多数终端用 DEL 而非 BS）
 *  - \x1bb / \x1bf = Alt-b / Alt-f（Meta 前缀 ESC + 字母）
 */
export const SHORTCUT_GROUPS: ShortcutGroupDef[] = [
  {
    id: 'common',
    title: '常用',
    desc: '最常用的导航与控制键，默认全部启用。',
    items: [
      { label: 'Esc', data: '\x1b', enabled: true, desc: 'ESC 键 / 取消当前操作' },
      { label: 'Enter', data: '\r', enabled: true, desc: '回车 / 确认' },
      { label: 'Tab', data: '\t', enabled: true, desc: 'Tab / 自动补全' },
      { label: 'BkSp', data: '\x7f', enabled: true, desc: '退格 / 删除光标前一个字符' },
      { label: '↑', data: '\x1b[A', enabled: true, desc: '上箭头 / 历史命令上一条' },
      { label: '↓', data: '\x1b[B', enabled: true, desc: '下箭头 / 历史命令下一条' },
      { label: '←', data: '\x1b[D', enabled: true, desc: '左箭头' },
      { label: '→', data: '\x1b[C', enabled: true, desc: '右箭头' },
      {
        label: 'S-Tab',
        data: '\x1b[Z',
        enabled: true,
        desc: 'Shift+Tab / 反向切换（Claude 审批菜单上一项、菜单补全反向轮询）',
      },
    ],
  },
  {
    id: 'editing',
    title: '行编辑',
    desc:
      '当前行编辑控制：清行、退格、删除、终止当前命令等。在大多数 shell（zsh/bash）和 REPL（python/node）中都可用。',
    items: [
      { label: '^C', data: '\x03', enabled: false, desc: 'Ctrl-C / 中断当前命令' },
      { label: '^D', data: '\x04', enabled: false, desc: 'Ctrl-D / EOF（空行下退出 shell）' },
      { label: '^L', data: '\x0c', enabled: false, desc: 'Ctrl-L / 清屏（保留当前行）' },
      { label: '^U', data: '\x15', enabled: false, desc: 'Ctrl-U / 删除光标到行首' },
      { label: '^K', data: '\x0b', enabled: false, desc: 'Ctrl-K / 删除光标到行尾' },
      { label: '^W', data: '\x17', enabled: false, desc: 'Ctrl-W / 删除前一个单词' },
      { label: '^A', data: '\x01', enabled: false, desc: 'Ctrl-A / 移动到行首' },
      { label: '^E', data: '\x05', enabled: false, desc: 'Ctrl-E / 移动到行尾' },
      { label: '^Z', data: '\x1a', enabled: false, desc: 'Ctrl-Z / 挂起当前进程到后台' },
    ],
  },
  {
    id: 'readline',
    title: 'Readline 编辑',
    desc:
      'GNU Readline / zsh emacs 风格的进阶编辑：按单词跳转、撤销、搜索历史。在 bash/zsh/python REPL/psql 等基于 readline 的程序里生效。',
    items: [
      { label: '⌥←', data: '\x1bb', enabled: false, desc: 'Alt-B / 向后跳一个单词' },
      { label: '⌥→', data: '\x1bf', enabled: false, desc: 'Alt-F / 向前跳一个单词' },
      { label: '^R', data: '\x12', enabled: false, desc: 'Ctrl-R / 反向搜索历史命令' },
      { label: '^S', data: '\x13', enabled: false, desc: 'Ctrl-S / 正向搜索历史（部分终端被流控占用）' },
      { label: '^T', data: '\x14', enabled: false, desc: 'Ctrl-T / 交换光标前后两个字符' },
      { label: '^Y', data: '\x19', enabled: false, desc: 'Ctrl-Y / 粘贴（yank）刚删除的内容' },
      { label: '^_', data: '\x1f', enabled: false, desc: 'Ctrl-_ / 撤销上一次编辑' },
      { label: '⌥D', data: '\x1bd', enabled: false, desc: 'Alt-D / 向前删一个单词' },
      { label: '⌥.', data: '\x1b.', enabled: false, desc: 'Alt-. / 插入上条命令的最后一个参数' },
    ],
  },
  {
    id: 'vim',
    title: 'Vim',
    desc:
      'Vim / Neovim 操作。包含 Esc 退到 Normal 模式、保存退出、搜索等。仅在你常用 vim 编辑文件时启用。',
    items: [
      { label: ':w', data: ':w\r', enabled: false, desc: '保存（Normal 模式下）' },
      { label: ':q', data: ':q\r', enabled: false, desc: '退出（Normal 模式下）' },
      { label: ':wq', data: ':wq\r', enabled: false, desc: '保存并退出' },
      { label: ':q!', data: ':q!\r', enabled: false, desc: '强制退出不保存' },
      { label: 'gg', data: 'gg', enabled: false, desc: '跳到文件开头（Normal 模式）' },
      { label: 'G', data: 'G', enabled: false, desc: '跳到文件末尾（Normal 模式）' },
      { label: 'u', data: 'u', enabled: false, desc: '撤销（Normal 模式）' },
      { label: '^R', data: '\x12', enabled: false, desc: 'Ctrl-R / 重做（Normal 模式）' },
      { label: '/', data: '/', enabled: false, desc: '进入搜索模式' },
      { label: 'n', data: 'n', enabled: false, desc: '跳到下一个搜索匹配' },
    ],
  },
  {
    id: 'tmux',
    title: 'tmux / screen',
    desc:
      'tmux（默认前缀 Ctrl-B）和 GNU screen（默认前缀 Ctrl-A）的常用操作。前缀键发出后再按目标键即触发。如果改过前缀键请自行编辑 data 字段。',
    items: [
      { label: 'tm:c', data: '\x02c', enabled: false, desc: 'tmux 新建窗口（prefix + c）' },
      { label: 'tm:n', data: '\x02n', enabled: false, desc: 'tmux 下一个窗口（prefix + n）' },
      { label: 'tm:p', data: '\x02p', enabled: false, desc: 'tmux 上一个窗口（prefix + p）' },
      { label: 'tm:d', data: '\x02d', enabled: false, desc: 'tmux 分离会话（prefix + d）' },
      { label: 'tm:%', data: '\x02%', enabled: false, desc: 'tmux 垂直分屏（prefix + %）' },
      { label: 'tm:"', data: '\x02"', enabled: false, desc: 'tmux 水平分屏（prefix + "）' },
      { label: 'tm:x', data: '\x02x', enabled: false, desc: 'tmux 关闭当前面板（prefix + x）' },
      { label: 'sc:c', data: '\x01c', enabled: false, desc: 'screen 新建窗口（prefix + c）' },
      { label: 'sc:n', data: '\x01n', enabled: false, desc: 'screen 下一个窗口（prefix + n）' },
      { label: 'sc:d', data: '\x01d', enabled: false, desc: 'screen 分离会话（prefix + d）' },
    ],
  },
  {
    id: 'signals',
    title: '进程信号',
    desc:
      '直接发送进程控制字符。与「行编辑」组里的 ^C/^D/^Z 物理按键相同，只是按用途单独列出，方便手机上一键停 / 退 / 挂起进程。',
    items: [
      { label: 'SIGINT', data: '\x03', enabled: false, desc: 'Ctrl-C / 中断（INT 信号）' },
      { label: 'EOF', data: '\x04', enabled: false, desc: 'Ctrl-D / 发送 EOF（关闭输入）' },
      { label: 'SIGTSTP', data: '\x1a', enabled: false, desc: 'Ctrl-Z / 挂起到后台（TSTP 信号）' },
      { label: 'SIGQUIT', data: '\x1c', enabled: false, desc: 'Ctrl-\\ / 退出并 core dump（QUIT 信号）' },
    ],
  },
];

// ============================================================
// 默认快捷键（扁平化分组数据，给 ConfigStore / API 使用）
// ============================================================

/**
 * 默认快捷键列表 = 所有分组的 items 扁平化 + 标注 group 字段
 *
 * - 「常用」组保持 enabled=true（在 SHORTCUT_GROUPS 内已设）
 * - 其他组保持 enabled=false（在 SHORTCUT_GROUPS 内已设）
 * - 用户在设置面板里改动 enabled 后会写回 config.json，下次读取以用户值为准
 */
export const DEFAULT_SHORTCUTS: ConfigurableShortcut[] = SHORTCUT_GROUPS.flatMap((g) =>
  g.items.map((s) => ({ ...s, group: g.id })),
);

/** 按 id 取分组定义；找不到返回 undefined */
export function findShortcutGroup(id: string): ShortcutGroupDef | undefined {
  return SHORTCUT_GROUPS.find((g) => g.id === id);
}

// ============================================================
// 默认命令
// ============================================================

/**
 * 默认命令列表
 *
 * Claude Code 内置斜杠命令的常用入口。用户可在设置页禁用、新增、排序。
 */
export const DEFAULT_COMMANDS: ConfigurableCommand[] = [
  { label: '/clear', command: '/clear', enabled: true, desc: '清屏' },
  { label: '/compact', command: '/compact', enabled: true, desc: '紧凑对话' },
  { label: '/resume', command: '/resume', enabled: true, desc: '恢复会话' },
  { label: '/stats', command: '/stats', enabled: true, desc: '统计信息' },
  { label: '/exit', command: '/exit', enabled: true, desc: '退出' },
];

// ============================================================
// UserConfig（文件层）
// ============================================================

/**
 * 用户配置（落盘形态，所有字段都可选）
 *
 * 与 AppConfig（backend 运行时形态）的区别：
 *  - UserConfig：仅描述"偏好"，缺失字段一律由默认值兜底
 *  - AppConfig：含端口、token、host 等运行期信息，必填
 *
 * 不在 UserConfig 内的字段：
 *  - port / host / token / claudeCommand 等：CLI > env > 默认值，不进 config.json
 *  - 任何只有运行期才能确定的值（instanceId、displayIp）
 */
export interface UserConfig {
  /** 终端下方的快捷按键 */
  shortcuts?: ConfigurableShortcut[];
  /** 终端下方的命令选择器项 */
  commands?: ConfigurableCommand[];
  /** Web Push VAPID 公钥（如果已配置；阶段 9 启用） */
  vapidPublicKey?: string;
  /** 字体缩放比例（1.0 = 默认；阶段 4 暂留口子，UI 不做） */
  fontScale?: number;
}

/**
 * 把可能缺字段或脏数据的 UserConfig 补全为完整可用形态
 *
 * 不修改入参；用户原值优先，仅在字段缺失或类型不对时回退到默认。
 *
 * 旧版 shortcuts（v0.2 之前，无 group 字段）：直接整段丢弃，回到 DEFAULT_SHORTCUTS。
 *  - 判断条件：数组里存在任意一项缺 group 字段
 *  - 不做按 label/data 的智能迁移：升级即重置默认，简单可预期
 */
export function ensureDefaultUserConfig(input: UserConfig | null | undefined): Required<
  Pick<UserConfig, 'shortcuts' | 'commands'>
> &
  UserConfig {
  const src = input ?? {};
  const userShortcuts =
    Array.isArray(src.shortcuts) && src.shortcuts.length > 0 ? src.shortcuts : null;
  const isLegacy =
    userShortcuts !== null &&
    userShortcuts.some((s) => typeof s.group !== 'string' || s.group.length === 0);
  const shortcuts =
    userShortcuts === null || isLegacy ? DEFAULT_SHORTCUTS : userShortcuts;
  const commands =
    Array.isArray(src.commands) && src.commands.length > 0 ? src.commands : DEFAULT_COMMANDS;
  return { ...src, shortcuts, commands };
}
