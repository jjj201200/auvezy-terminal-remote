/**
 * 默认快捷键与命令 + UserConfig 类型（前后端共享）
 *
 * UserConfig：
 *   - 文件层（~/.atrrc），所有字段可选
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
  /**
   * 所属分组 id。
   *
   * 0.5 之前是 ShortcutGroupId 字面量 union；0.6 起放宽为 string，因为用户
   * 能自定义分组（id 是 UUID）。运行时 normalize：内置组对应内置 id，自定义
   * 组对应 UUID，缺省视为旧配置 → UI 归入「自定义」组。
   */
  group?: string;
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
  /** 所属分组 id（0.6 起为开放 string，理由同 ConfigurableShortcut.group） */
  group?: string;
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
      { label: 'Enter', data: '\r', enabled: true, desc: '回车 / 确认' },
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
// 命令分组
// ============================================================

/** 所有内置命令分组 id */
export type CommandGroupId =
  | 'session'      // 会话生命周期：clear / compact / resume / exit
  | 'context'      // 上下文与代码：add-dir / init / memory
  | 'agent'        // Claude 自身能力：agents / model / hooks / mcp / output-style
  | 'workflow'     // 任务与配置：todos / config / permissions / status / statusline
  | 'auth'         // 账号与登录：login / logout
  | 'help'         // 信息：help / cost / doctor / pr_comments / release-notes
  | 'tools'        // 杂项工具：bashes / install-github-app / vim / migrate-installer / security-review / terminal-setup / upgrade
  | 'custom';

/** 分组定义 */
export interface CommandGroupDef {
  id: CommandGroupId;
  /** 显示名 */
  title: string;
  /** 说明 */
  desc: string;
  /** 该组默认启用项；不在此列表的命令 enabled=false */
  items: Array<Omit<ConfigurableCommand, 'group'>>;
}

/**
 * 内置命令分组定义
 *
 * 来源：Claude Code 当前公开的斜杠命令。
 * 设计原则：
 *  - 「会话」组（session）默认全部启用，覆盖最高频的清屏 / 紧凑 / 恢复 / 退出
 *  - 其他组默认 enabled=false，由用户在设置面板勾选或一键启用
 *  - 每条命令带 desc 简短说明（按钮 title 提示与设置面板均会展示）
 *  - autoSend 默认 true（点击即发送）；带占位参数的命令会显式置 false（填入待编辑）
 */
export const COMMAND_GROUPS: CommandGroupDef[] = [
  {
    id: 'session',
    title: '会话',
    desc: '会话生命周期相关：清空、压缩、恢复、退出。',
    items: [
      { label: '/clear', command: '/clear', enabled: true, autoSend: true, desc: '清空当前会话历史' },
      { label: '/compact', command: '/compact', enabled: true, autoSend: true, desc: '将会话压缩成摘要以节省上下文' },
      { label: '/resume', command: '/resume', enabled: true, autoSend: true, desc: '从最近的会话继续' },
      { label: '/exit', command: '/exit', enabled: true, autoSend: true, desc: '退出 Claude Code' },
    ],
  },
  {
    id: 'context',
    title: '上下文',
    desc: '让 Claude 看到更多上下文：加目录、初始化项目记忆、查看记忆。',
    items: [
      { label: '/add-dir', command: '/add-dir ', enabled: false, autoSend: false, desc: '把额外目录加入 Claude 的可读范围' },
      { label: '/init', command: '/init', enabled: false, autoSend: true, desc: '为当前项目生成初始 CLAUDE.md' },
      { label: '/memory', command: '/memory', enabled: false, autoSend: true, desc: '查看 Claude 当前的项目记忆' },
    ],
  },
  {
    id: 'agent',
    title: '能力',
    desc: 'Claude 自身的能力配置：子 agent、模型、hooks、MCP、输出风格。',
    items: [
      { label: '/agents', command: '/agents', enabled: false, autoSend: true, desc: '管理可用的子 agent' },
      { label: '/model', command: '/model', enabled: false, autoSend: true, desc: '切换使用的模型' },
      { label: '/hooks', command: '/hooks', enabled: false, autoSend: true, desc: '管理生命周期 hooks' },
      { label: '/mcp', command: '/mcp', enabled: false, autoSend: true, desc: '查看 / 管理 MCP 服务器' },
      { label: '/output-style', command: '/output-style', enabled: false, autoSend: true, desc: '切换输出风格' },
      { label: '/output-style:new', command: '/output-style:new ', enabled: false, autoSend: false, desc: '新建一个输出风格（需追加描述）' },
    ],
  },
  {
    id: 'workflow',
    title: '工作流',
    desc: '任务清单、设置、权限、状态展示。',
    items: [
      { label: '/todos', command: '/todos', enabled: false, autoSend: true, desc: '查看当前的 TODO 列表' },
      { label: '/config', command: '/config', enabled: false, autoSend: true, desc: '查看 / 修改 Claude Code 设置' },
      { label: '/permissions', command: '/permissions', enabled: false, autoSend: true, desc: '查看 / 修改工具调用权限' },
      { label: '/status', command: '/status', enabled: false, autoSend: true, desc: '查看当前会话状态' },
      { label: '/statusline', command: '/statusline', enabled: false, autoSend: true, desc: '配置状态行显示' },
      { label: '/context', command: '/context', enabled: false, autoSend: true, desc: '查看当前上下文使用情况' },
    ],
  },
  {
    id: 'auth',
    title: '账号',
    desc: '登录、登出与账号切换。',
    items: [
      { label: '/login', command: '/login', enabled: false, autoSend: true, desc: '登录 / 切换 Anthropic 账号' },
      { label: '/logout', command: '/logout', enabled: false, autoSend: true, desc: '登出当前账号' },
    ],
  },
  {
    id: 'help',
    title: '信息',
    desc: '帮助、费用、诊断、PR 评论、版本说明。',
    items: [
      { label: '/help', command: '/help', enabled: false, autoSend: true, desc: '查看可用的斜杠命令' },
      { label: '/cost', command: '/cost', enabled: false, autoSend: true, desc: '查看本会话累计消耗' },
      { label: '/doctor', command: '/doctor', enabled: false, autoSend: true, desc: '运行环境健康检查' },
      { label: '/pr_comments', command: '/pr_comments', enabled: false, autoSend: true, desc: '抓取并阅读当前 PR 上的评论' },
      { label: '/release-notes', command: '/release-notes', enabled: false, autoSend: true, desc: '查看最新版本说明' },
    ],
  },
  {
    id: 'tools',
    title: '工具',
    desc: '杂项工具：后台 bash、GitHub App、安全审查、终端设置、升级等。',
    items: [
      { label: '/bashes', command: '/bashes', enabled: false, autoSend: true, desc: '查看后台 bash 进程' },
      { label: '/install-github-app', command: '/install-github-app', enabled: false, autoSend: true, desc: '安装 / 配置 GitHub App' },
      { label: '/migrate-installer', command: '/migrate-installer', enabled: false, autoSend: true, desc: '迁移到原生安装器' },
      { label: '/security-review', command: '/security-review', enabled: false, autoSend: true, desc: '让 Claude 做一次安全审查' },
      { label: '/terminal-setup', command: '/terminal-setup', enabled: false, autoSend: true, desc: '配置终端集成' },
      { label: '/upgrade', command: '/upgrade', enabled: false, autoSend: true, desc: '升级到最新 Claude Code' },
      { label: '/vim', command: '/vim', enabled: false, autoSend: true, desc: '切换 Vim 键位' },
    ],
  },
];

// ============================================================
// 默认命令（扁平化分组数据）
// ============================================================

/**
 * 默认命令列表 = 所有内置分组的 items 扁平化 + 标注 group 字段。
 *
 * - 「会话」组保持 enabled=true（在 COMMAND_GROUPS 内已设）
 * - 其他组保持 enabled=false（在 COMMAND_GROUPS 内已设）
 */
export const DEFAULT_COMMANDS: ConfigurableCommand[] = COMMAND_GROUPS.flatMap((g) =>
  g.items.map((c) => ({ ...c, group: g.id })),
);

/** 按 id 取命令分组定义；找不到返回 undefined */
export function findCommandGroup(id: string): CommandGroupDef | undefined {
  return COMMAND_GROUPS.find((g) => g.id === id);
}

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
  /**
   * 终端下方的快捷按键（扁平存储 = 落盘真实形态）。
   *
   * frontend 消费层（Toolbar / InstanceView）按 enabled 过滤后送 PTY，需要扁平。
   * 设置面板编辑时另外用 migrateShortcutsToTree() 派生嵌套分组树做 CRUD，
   * 保存前通过 flattenShortcuts() 反扁平化写回 shortcuts。
   */
  shortcuts?: ConfigurableShortcut[];
  /** 终端下方的命令选择器项；与 shortcuts 同设计 */
  commands?: ConfigurableCommand[];
  /**
   * 分组元数据：描述用户对分组的"看法"（顺序 / 自定义 title 覆盖 / 自定义分组的存在）。
   *
   * shortcuts/commands 是扁平真值，每条带 group 字段引用分组 id。但仅靠扁平：
   *  - 用户改了"vim"组的 title 为"我的 vim 配置" → 信息丢失（扁平里没有 title）
   *  - 用户拖拽分组顺序（vim 移到 common 之前） → 顺序丢失（扁平按 group id 分桶时
   *    自然按内置 SHORTCUT_GROUPS 顺序）
   *  - 用户新建空分组（暂时没项） → 完全没痕迹
   *
   * actionGroupMeta 补足这些。entries 顺序 = 用户期望的渲染顺序；
   * 没出现在 entries 里的分组按内置默认顺序追加在尾部。
   */
  actionGroupMeta?: import('./action-tree.js').ActionGroupMeta;
  /** Web Push VAPID 公钥（如果已配置；阶段 9 启用） */
  vapidPublicKey?: string;
  /** 字体缩放比例（1.0 = 默认；阶段 4 暂留口子，UI 不做） */
  fontScale?: number;
  /** 显示偏好：xterm 自适应字号目标列数 + 字间距 */
  display?: DisplayPrefs;
  /** 网络偏好：WS 自动重连上限等 */
  network?: NetworkPrefs;
  /** 输入偏好：是否使用底部输入框 / 直接输入模式等 */
  input?: InputPrefs;
  /**
   * Workdir 白名单（picomatch glob 模式数组）
   *
   * 创建实例时如果该列表非空，cwd 必须命中其中至少一个 pattern 才允许 spawn；
   * 列表为空（或省略）= 不限制（所有路径都通过白名单这一关）。
   * 仍受黑名单约束：白名单通过后还要 not-match 黑名单。
   *
   * 示例：
   *   ["/home/me/projects/**", "/mnt/d/work/**"]
   */
  workdirAllow?: string[];
  /**
   * Workdir 黑名单（picomatch glob 模式数组）
   *
   * 任何命中这里 pattern 的 cwd 都会被拒绝 spawn，即使白名单通过。
   *
   * 默认值：systemPaths（'/etc/**', '/root/**', '/sys/**', '/proc/**'）—— 防误用。
   * 用户可在 ~/.atrrc 中显式 set `"workdirDeny": []` 清空（不推荐）。
   * 命令行 `--workdir-deny <patterns>` 优先级高于配置文件。
   *
   * 注：列表为 undefined 时使用默认；为 [] 时表示用户显式想要"无任何黑名单"
   */
  workdirDeny?: string[];
  /**
   * Integrations 偏好(可热插拔的"识别原终端工具上下文"模块体系)
   *
   * - enabled:总开关。false → 不激活任何模块,纯透传 PTY
   * - forceModule:'auto'(默认,各模块依次 detect)/ 模块 id(强制) / 'none'
   * - perModule:各模块自己的子开关(如 ClaudeCode 的事件细分)
   */
  integrations?: IntegrationsPrefs;
}

/**
 * 渲染集成偏好。与运行时集成(forceModule 单选)不同,渲染集成是多选 ——
 * 每个模块独立 enabled,可同时启用。详见
 * docs/plans/obsidian-integration/adrs/001-rendering-vs-runtime-integration.md。
 */
export interface RenderingIntegrationPrefs {
  markdown?: {
    enabled?: boolean;
    /**
     * 预览正文字号(px)。0 = 自动(用应用默认 --fs-md);固定值范围
     * [MARKDOWN_FONT_SIZE_MIN, MARKDOWN_FONT_SIZE_MAX]。
     *
     * Why 不学 display.maxCols 用列数反推:终端列数是 TUI 绘制的硬契约
     * (字号 = 宽度/列数/0.6),markdown 是比例字体 + 自动折行,列数只是
     * 排版学 measure(每行字符数)的软约束,反推在手机(过小)与宽桌面
     * (被上限夹)两端都崩,故直接用 px。
     */
    fontSize?: number;
  };
  obsidian?: {
    enabled?: boolean;
    /** YAML frontmatter 渲染为 Properties 表;关:frontmatter 块直接 strip */
    frontmatter?: boolean;
    /** [[Foo]] / [[Foo|alias]];关:仍识别但渲染为 disabled 样式 */
    wikilink?: boolean;
    /** ![[...]] 嵌入;关:仍识别但渲染为占位框 */
    embed?: boolean;
    /** 13 类 callout(GFM Alert 超集);关:回退普通 blockquote */
    callout?: boolean;
    /** ==highlight== / %%comment%% / #tag / ^block-id;关:保留原文 */
    inlineSyntax?: boolean;
  };
}

/**
 * Integrations 偏好结构。与 backend/src/integrations/types.ts 的 IntegrationPreferences 等价
 * (不直接 import 跨包是为了让 shared 包不依赖 backend)。
 */
export interface IntegrationsPrefs {
  enabled?: boolean;
  forceModule?: 'auto' | 'claude-code' | 'none';
  perModule?: {
    'claude-code'?: {
      events?: {
        approvals?: boolean;
        toolProgress?: boolean;
        turnLifecycle?: boolean;
        sessionLifecycle?: boolean;
        userPrompts?: boolean;
      };
    };
  };
  /** 渲染集成 — 与 forceModule 单选无关,各模块独立 enabled */
  rendering?: RenderingIntegrationPrefs;
}

/** Integrations 默认值(供 ensureDefaultUserConfig 兜底用) */
export const DEFAULT_INTEGRATIONS: Required<{
  enabled: boolean;
  forceModule: 'auto' | 'claude-code' | 'none';
  perModule: {
    'claude-code': {
      events: {
        approvals: boolean;
        toolProgress: boolean;
        turnLifecycle: boolean;
        sessionLifecycle: boolean;
        userPrompts: boolean;
      };
    };
  };
  rendering: {
    markdown: { enabled: boolean; fontSize: number };
    obsidian: {
      enabled: boolean;
      frontmatter: boolean;
      wikilink: boolean;
      embed: boolean;
      callout: boolean;
      inlineSyntax: boolean;
    };
  };
}> = {
  enabled: true,
  forceModule: 'auto',
  perModule: {
    'claude-code': {
      events: {
        approvals: true,
        toolProgress: true,
        turnLifecycle: true,
        sessionLifecycle: true,
        userPrompts: false,
      },
    },
  },
  rendering: {
    markdown: { enabled: true, fontSize: 0 },
    obsidian: {
      enabled: true,
      frontmatter: true,
      wikilink: true,
      embed: true,
      callout: true,
      inlineSyntax: true,
    },
  },
};

/**
 * 输入偏好
 *
 * - useInputBar：true（默认）= 显示底部输入框，行编辑后回车发送（适合中文/长命令）；
 *   false = 隐藏输入框，让 xterm 自己接管按键（实时发到 PTY），更接近桌面终端。
 *
 * - tuiScrollEnabled：是否启用 TUI 滚动接管（移动端 swipe / 桌面 wheel 转
 *   SGR mouse byte，让 Claude Code / vim / htop 内部逐行滚 transcript）。
 *   默认 true——多数用户用 ATR 就是为了在 TUI 里看 transcript；普通 shell
 *   不在 alt-screen 时 hook 不接管，对老使用习惯无影响。
 *
 * - tuiTapEnabled：是否启用移动端触摸 tap → SGR mouse press+release，让
 *   Claude TUI 等程序的"点击交互"在手机上能用。默认 true。
 *   背景：xterm v5.5.0 在 mouse reporting 激活时主动跳过 touch 路径
 *   （Terminal.ts:835 early-return），且 passive 监听不能 preventDefault →
 *   浏览器 W3C 规范下不再合成 mouse 事件 → xterm 收不到 click。我们自己
 *   在 touchend 检测 tap（位移<10px / 时长<500ms）后拼一对 SGR byte 发 PTY。
 *
 * - scrollLines：开启 TUI 滚动后，一次滚动事件（鼠标 wheel notch / 一段 swipe）
 *   对应的行数。直接拼 SGR 1006 mouse byte 发 PTY，逐行精确。
 *   取值：
 *     - 数字 1 / 3 / 5 / 10：固定行数
 *     - 'half'：当前可视区高度的一半（运行时 = floor(rows/2)）
 *     - 'full'：整个可视区高度（= rows）
 *   默认 3（接近 CLAUDE_CODE_SCROLL_SPEED 默认值）
 *
 * - wheelSensitivity:鼠标滚轮 / 触摸板敏感度。控制 TUI alt-screen 内累计多少
 *   像素的 deltaY 才发一次 scrollLines 行 SGR。
 *   背景:macOS Chrome 触摸板每次惯性滚动会发上百个小 deltaY 事件,旧实现
 *   每个事件直发 N 行 → 一拨手指几百行,飞过 transcript。新实现按 cellHeight
 *   倍数累计:
 *     - 'low':2 × cellHeight 累计阈值,最不灵敏(适合 mac 触摸板)
 *     - 'med':1 × cellHeight,默认,鼠标 / Win 触摸板手感正常
 *     - 'high':0.5 × cellHeight,最灵敏(适合传统离散鼠标滚轮)
 *   默认 'med'
 */
export type ScrollLinesValue = number | 'half' | 'full';
export type WheelSensitivity = 'low' | 'med' | 'high';

export interface InputPrefs {
  useInputBar?: boolean;
  tuiScrollEnabled?: boolean;
  tuiTapEnabled?: boolean;
  scrollLines?: ScrollLinesValue;
  wheelSensitivity?: WheelSensitivity;
}

/** input 字段的硬默认 */
export const DEFAULT_INPUT: {
  useInputBar: boolean;
  tuiScrollEnabled: boolean;
  tuiTapEnabled: boolean;
  scrollLines: ScrollLinesValue;
  wheelSensitivity: WheelSensitivity;
} = {
  useInputBar: true,
  tuiScrollEnabled: true,
  tuiTapEnabled: true,
  scrollLines: 3,
  wheelSensitivity: 'med',
};

/** scrollLines 预设值（设置面板按顺序渲染） */
export const SCROLL_LINES_PRESETS: readonly ScrollLinesValue[] = [1, 3, 5, 10, 'half', 'full'] as const;

/** wheelSensitivity 三档(设置面板渲染顺序) */
export const WHEEL_SENSITIVITY_PRESETS: readonly WheelSensitivity[] = ['low', 'med', 'high'] as const;

/** wheelSensitivity 字符串值 → cellHeight 倍数(累计阈值) */
export const WHEEL_SENSITIVITY_MULTIPLIER: Readonly<Record<WheelSensitivity, number>> = {
  low: 2,
  med: 1,
  high: 0.5,
};

/**
 * 网络偏好
 *
 * - reconnectMaxAttempts：WS 自动重连的硬上限。达到后停止自动重试，
 *   只能由用户手动点击重连按钮恢复。范围 [1, 1000]，默认 60。
 *   动机：移动端流量敏感——失联状态下持续 SYN 重连会真实产生流量
 */
export interface NetworkPrefs {
  reconnectMaxAttempts?: number;
}

/** network 默认 */
export const DEFAULT_NETWORK: Required<NetworkPrefs> = {
  reconnectMaxAttempts: 60,
};

/** 重连上限 UI 范围 */
export const RECONNECT_MAX_ATTEMPTS_MIN = 1;
export const RECONNECT_MAX_ATTEMPTS_MAX = 1000;

/**
 * 显示偏好
 *
 * - fontSizeMin / fontSizeMax：自适应字号的夹紧上下限(用户可调,默认 6 / 18);
 *   maxCols 算出的字号会被 clamp 到这个范围。改小 fontSizeMin 可换更多列。
 *   硬下限 FONT_SIZE_FLOOR(6)/上限 FONT_SIZE_CEIL(32) 限制设置面板取值范围。
 * - maxCols(原 targetCols):xterm 自适应字号的目标列数;0 / 缺失 = 关闭自适应。
 *   常用预设 80 / 100 / 120;移动端窄屏用 80 即可填满。算法:
 *   fontSize = floor(containerWidth / maxCols / 0.6),clamp 到 [fontSizeMin, fontSizeMax]
 * - letterSpacing:字间距(px);负值压缩、正值拉宽。范围 [-2, 4],默认 0
 */
export interface DisplayPrefs {
  fontSizeMin?: number;
  fontSizeMax?: number;
  /** 自适应字号目标列数(原名 targetCols,0.7.x 起改名:"目标"暗示一定生效,
   *  实际是上限,clamp 到字号范围内可能小于该值) */
  maxCols?: number;
  letterSpacing?: number;
  /** 调色板主题;命名跟 Claude Code 的 /theme 选项对齐,方便用户对照 */
  theme?: TerminalThemeName;
  /** 文件预览启用 markdown 可视化渲染(.md / .markdown);默认 true,
   *  关闭时 .md 走纯文本路径(同其它代码文件) */
  markdownPreview?: boolean;
}

/** 仅供 normalize 内部识别 0.7.0 之前的 config.json 用 —— 不应暴露给业务代码 */
interface LegacyDisplayPrefs {
  targetCols?: unknown;
}

/**
 * Claude Code /theme 命令的 7 个内建主题名。
 * 映射为 xterm 的调色板（包括 dark/light variants 和色盲友好变体）。
 * 'auto' 由前端根据 prefers-color-scheme 解析为 dark 或 light。
 */
export type TerminalThemeName =
  | 'dark'
  | 'light'
  | 'dark-ansi'
  | 'light-ansi'
  | 'dark-daltonized'
  | 'light-daltonized'
  | 'auto';

/** display 字段的硬默认 */
export const DEFAULT_DISPLAY: Required<DisplayPrefs> = {
  fontSizeMin: 6, // 0.7.x 把下限从 8 放到 6,牺牲一些清晰度换更多列
  fontSizeMax: 18,
  maxCols: 0, // 0 = 关闭自适应
  letterSpacing: 0,
  theme: 'auto', // 跟随系统亮暗模式:dark → Campbell, light → Solarized Light
  markdownPreview: true,
};

/** 列数预设（设置面板按钮） */
export const COLS_PRESETS = [80, 100, 120] as const;

/** 字号设置 UI 允许选择的范围(超过这个范围渲染会糊或塞不下) */
export const FONT_SIZE_FLOOR = 6;
export const FONT_SIZE_CEIL = 32;

/** Markdown 预览正文字号:0 = 自动(应用默认 --fs-md);固定值取值范围与预设 */
export const MARKDOWN_FONT_SIZE_AUTO = 0;
export const MARKDOWN_FONT_SIZE_MIN = 10;
export const MARKDOWN_FONT_SIZE_MAX = 24;
/** 设置面板字号预设(与 display.COLS_PRESETS 对应的 markdown 侧预设) */
export const MARKDOWN_FONT_SIZE_PRESETS = [12, 13, 14, 15, 16, 18] as const;

/** letterSpacing 范围 */
export const LETTER_SPACING_MIN = -2;
export const LETTER_SPACING_MAX = 4;

/**
 * 把可能缺字段或脏数据的 UserConfig 补全为完整可用形态
 *
 * 不修改入参；用户原值优先，仅在字段缺失或类型不对时回退到默认。
 *
 * 旧版 shortcuts / commands（v0.2 之前，无 group 字段）：直接整段丢弃，
 * 回到对应的 DEFAULT_*。
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
  const shortcutsLegacy =
    userShortcuts !== null &&
    userShortcuts.some((s) => typeof s.group !== 'string' || s.group.length === 0);
  const shortcuts =
    userShortcuts === null || shortcutsLegacy ? DEFAULT_SHORTCUTS : userShortcuts;

  const userCommands =
    Array.isArray(src.commands) && src.commands.length > 0 ? src.commands : null;
  const commandsLegacy =
    userCommands !== null &&
    userCommands.some((c) => typeof c.group !== 'string' || c.group.length === 0);
  const commands =
    userCommands === null || commandsLegacy ? DEFAULT_COMMANDS : userCommands;

  // input 子块：normalize boolean / number 字段，缺失/非法 → 默认值
  // 变量名故意不叫 input，避免与函数参数 input 同名引起 TS 推断混乱
  const useInputBarValue =
    typeof src.input?.useInputBar === 'boolean'
      ? src.input.useInputBar
      : DEFAULT_INPUT.useInputBar;
  const tuiScrollEnabledValue =
    typeof src.input?.tuiScrollEnabled === 'boolean'
      ? src.input.tuiScrollEnabled
      : DEFAULT_INPUT.tuiScrollEnabled;
  const tuiTapEnabledValue =
    typeof src.input?.tuiTapEnabled === 'boolean'
      ? src.input.tuiTapEnabled
      : DEFAULT_INPUT.tuiTapEnabled;
  // scrollLines normalize：数字 ∈ [1, 200]、或 'half' / 'full'；其他回退默认
  const slRaw = src.input?.scrollLines;
  const scrollLines: ScrollLinesValue =
    typeof slRaw === 'number' && Number.isFinite(slRaw) && slRaw >= 1 && slRaw <= 200
      ? Math.trunc(slRaw)
      : slRaw === 'half' || slRaw === 'full'
        ? slRaw
        : DEFAULT_INPUT.scrollLines;
  // wheelSensitivity normalize:三选一,非法回退默认
  const wsRaw = src.input?.wheelSensitivity;
  const wheelSensitivity: WheelSensitivity =
    wsRaw === 'low' || wsRaw === 'med' || wsRaw === 'high'
      ? wsRaw
      : DEFAULT_INPUT.wheelSensitivity;
  const inputPrefs: {
    useInputBar: boolean;
    tuiScrollEnabled: boolean;
    tuiTapEnabled: boolean;
    scrollLines: ScrollLinesValue;
    wheelSensitivity: WheelSensitivity;
  } = {
    useInputBar: useInputBarValue,
    tuiScrollEnabled: tuiScrollEnabledValue,
    tuiTapEnabled: tuiTapEnabledValue,
    scrollLines,
    wheelSensitivity,
  };

  // workdir 白名单：用户未设 = undefined（不限制）；用户设了非数组 = 视为 undefined
  // 字符串元素全部 trim 后剔空 → 防止"空字符串 pattern 命中所有路径"
  const workdirAllow = normalizeStringArray(src.workdirAllow);

  // workdir 黑名单：用户没设（undefined）→ 用 DEFAULT_WORKDIR_DENY 兜底（复制一份，
  // 因为 UserConfig.workdirDeny 是 mutable string[]，DEFAULT 是 readonly）；
  // 用户显式设了空数组 [] → 尊重，表示"我不要任何黑名单"（但仍受白名单约束）；
  // 设了非数组 → 与 undefined 同义（用默认）
  const workdirDeny =
    src.workdirDeny === undefined || !Array.isArray(src.workdirDeny)
      ? [...DEFAULT_WORKDIR_DENY]
      : normalizeStringArray(src.workdirDeny) ?? [];

  // display 子块:任一字段缺失 / 越界 → 用 DEFAULT_DISPLAY 兜底
  const rawDisplay = src.display;
  let fontSizeMin = normalizeBoundedNumber(
    rawDisplay?.fontSizeMin,
    FONT_SIZE_FLOOR,
    FONT_SIZE_CEIL,
    DEFAULT_DISPLAY.fontSizeMin,
    { truncate: true },
  );
  let fontSizeMax = normalizeBoundedNumber(
    rawDisplay?.fontSizeMax,
    FONT_SIZE_FLOOR,
    FONT_SIZE_CEIL,
    DEFAULT_DISPLAY.fontSizeMax,
    { truncate: true },
  );
  if (fontSizeMin > fontSizeMax) {
    // 用户把 min 设得比 max 大 → 交换,保持区间合法
    [fontSizeMin, fontSizeMax] = [fontSizeMax, fontSizeMin];
  }
  // maxCols 优先;旧字段 targetCols 作 fallback(老 config.json 平滑迁移)
  const legacyTargetCols = (rawDisplay as LegacyDisplayPrefs | undefined)?.targetCols;
  const maxCols = normalizeBoundedNumber(
    rawDisplay?.maxCols ?? legacyTargetCols,
    0,
    500,
    DEFAULT_DISPLAY.maxCols,
    { truncate: true },
  );
  const letterSpacing = normalizeBoundedNumber(
    rawDisplay?.letterSpacing,
    -4,
    8,
    DEFAULT_DISPLAY.letterSpacing,
  );
  const themeRaw = rawDisplay?.theme;
  const theme: TerminalThemeName =
    themeRaw === 'dark' ||
    themeRaw === 'light' ||
    themeRaw === 'dark-ansi' ||
    themeRaw === 'light-ansi' ||
    themeRaw === 'dark-daltonized' ||
    themeRaw === 'light-daltonized' ||
    themeRaw === 'auto'
      ? themeRaw
      : DEFAULT_DISPLAY.theme;
  const markdownPreview =
    typeof rawDisplay?.markdownPreview === 'boolean'
      ? rawDisplay.markdownPreview
      : DEFAULT_DISPLAY.markdownPreview;
  const display: DisplayPrefs = {
    fontSizeMin,
    fontSizeMax,
    maxCols,
    letterSpacing,
    theme,
    markdownPreview,
  };

  // integrations:对象 deep-merge,缺失字段全用默认。
  // 总开关 / forceModule 单字段;perModule 当前只认 'claude-code' 的 events,逐个字段填默认
  const rawIntegrations = src.integrations;
  const ccUserEvents =
    rawIntegrations?.perModule?.['claude-code']?.events ?? {};
  const ccDefaults = DEFAULT_INTEGRATIONS.perModule['claude-code'].events;

  // 渲染集成 — 兼容 0.8.x:display.markdownPreview 是旧位置,0.9 起搬到
  // integrations.rendering.markdown.enabled。新字段存在则优先用新的;旧字段保留
  // 三个 minor(0.9/0.10/0.11),0.12 删除(详见 design.md §4.3)。
  const userRenderingMd = rawIntegrations?.rendering?.markdown?.enabled;
  const renderingMdEnabled =
    typeof userRenderingMd === 'boolean'
      ? userRenderingMd
      : typeof rawDisplay?.markdownPreview === 'boolean'
        ? rawDisplay.markdownPreview
        : DEFAULT_INTEGRATIONS.rendering.markdown.enabled;
  const userObsidian = rawIntegrations?.rendering?.obsidian;
  const obsDefaults = DEFAULT_INTEGRATIONS.rendering.obsidian;
  // markdown 正文字号:0 = 自动;固定值 clamp 到 [MIN, MAX],非整数取整,
  // 非法(缺字段 / NaN / 越界外的乱值)回退自动
  const userMdFontSize = rawIntegrations?.rendering?.markdown?.fontSize;
  const mdFontSize =
    userMdFontSize === MARKDOWN_FONT_SIZE_AUTO
      ? MARKDOWN_FONT_SIZE_AUTO
      : typeof userMdFontSize === 'number' && Number.isFinite(userMdFontSize)
        ? Math.max(
            MARKDOWN_FONT_SIZE_MIN,
            Math.min(MARKDOWN_FONT_SIZE_MAX, Math.round(userMdFontSize)),
          )
        : MARKDOWN_FONT_SIZE_AUTO;
  const rendering: RenderingIntegrationPrefs = {
    markdown: { enabled: renderingMdEnabled, fontSize: mdFontSize },
    obsidian: {
      enabled:
        typeof userObsidian?.enabled === 'boolean'
          ? userObsidian.enabled
          : obsDefaults.enabled,
      frontmatter:
        typeof userObsidian?.frontmatter === 'boolean'
          ? userObsidian.frontmatter
          : obsDefaults.frontmatter,
      wikilink:
        typeof userObsidian?.wikilink === 'boolean'
          ? userObsidian.wikilink
          : obsDefaults.wikilink,
      embed:
        typeof userObsidian?.embed === 'boolean'
          ? userObsidian.embed
          : obsDefaults.embed,
      callout:
        typeof userObsidian?.callout === 'boolean'
          ? userObsidian.callout
          : obsDefaults.callout,
      inlineSyntax:
        typeof userObsidian?.inlineSyntax === 'boolean'
          ? userObsidian.inlineSyntax
          : obsDefaults.inlineSyntax,
    },
  };

  const integrations: IntegrationsPrefs = {
    enabled:
      typeof rawIntegrations?.enabled === 'boolean'
        ? rawIntegrations.enabled
        : DEFAULT_INTEGRATIONS.enabled,
    forceModule:
      rawIntegrations?.forceModule === 'auto' ||
      rawIntegrations?.forceModule === 'claude-code' ||
      rawIntegrations?.forceModule === 'none'
        ? rawIntegrations.forceModule
        : DEFAULT_INTEGRATIONS.forceModule,
    perModule: {
      'claude-code': {
        events: {
          approvals:
            typeof ccUserEvents.approvals === 'boolean' ? ccUserEvents.approvals : ccDefaults.approvals,
          toolProgress:
            typeof ccUserEvents.toolProgress === 'boolean'
              ? ccUserEvents.toolProgress
              : ccDefaults.toolProgress,
          turnLifecycle:
            typeof ccUserEvents.turnLifecycle === 'boolean'
              ? ccUserEvents.turnLifecycle
              : ccDefaults.turnLifecycle,
          sessionLifecycle:
            typeof ccUserEvents.sessionLifecycle === 'boolean'
              ? ccUserEvents.sessionLifecycle
              : ccDefaults.sessionLifecycle,
          userPrompts:
            typeof ccUserEvents.userPrompts === 'boolean'
              ? ccUserEvents.userPrompts
              : ccDefaults.userPrompts,
        },
      },
    },
    rendering,
  };

  return {
    ...src,
    shortcuts,
    commands,
    display,
    input: inputPrefs as InputPrefs,
    workdirAllow,
    workdirDeny,
    integrations,
  };
}

/**
 * 默认 workdir 黑名单：把"用户绝对不会想在这里 spawn 终端"的系统目录拦下来
 *
 * 安全意图：即使用户没显式配 workdirDeny，攻击者拿到 token 后也不能用
 * `/etc/cron.d` / `/root/.ssh` 这类路径作 cwd 绕过。
 *
 * 用户可以在 ~/.atrrc 中显式 `"workdirDeny": []` 关闭（但不推荐）。
 * 命令行 `--workdir-deny` 优先级高，可在配置基础上扩展或覆盖。
 */
export const DEFAULT_WORKDIR_DENY: readonly string[] = Object.freeze([
  '/etc/**',
  '/root/**',
  '/sys/**',
  '/proc/**',
]);

/** 数组字段 normalize：不是数组 → undefined；trim + 剔空字符串 → 干净的 string[] */
function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

/** 数字字段 normalize:非数 / NaN / Infinity / 越界 → fallback。truncate=true
 *  会把小数截成整数(整型字段如端口、字号用),false 保留小数(letterSpacing 用)。 */
function normalizeBoundedNumber(
  input: unknown,
  min: number,
  max: number,
  fallback: number,
  opts: { truncate?: boolean } = {},
): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  if (input < min || input > max) return fallback;
  return opts.truncate ? Math.trunc(input) : input;
}
