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
 * 修改这里的默认值会影响：
 * - 全新用户首次启动时落盘到 config.json 的初始内容
 * - 已有 config.json 但 shortcuts/commands 字段缺失时 API 返回的内容
 */

// ============================================================
// 类型
// ============================================================

/** 快捷输入项（终端下方快捷栏按钮，点击发送 data 到 PTY） */
export interface ConfigurableShortcut {
  /** 按钮显示名 */
  label: string;
  /** 发送的数据，可含转义如  表示 ESC */
  data: string;
  /** 是否启用 */
  enabled: boolean;
  /** 可选描述 */
  desc?: string;
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
// 默认快捷键
// ============================================================

/**
 * 默认快捷键列表
 *
 * 这些是 Claude Code 终端交互最常用的按键：Esc 取消、Enter 确认、
 * Tab 补全、方向键导航、Shift+Tab 反向切换。
 */
export const DEFAULT_SHORTCUTS: ConfigurableShortcut[] = [
  { label: 'Esc', data: '\x1b', enabled: true, desc: 'ESC 键' },
  { label: 'Enter', data: '\r', enabled: true, desc: '回车' },
  { label: 'Tab', data: '\t', enabled: true, desc: 'Tab' },
  { label: '↑', data: '\x1b[A', enabled: true, desc: '上箭头' },
  { label: '↓', data: '\x1b[B', enabled: true, desc: '下箭头' },
  { label: '←', data: '\x1b[D', enabled: true, desc: '左箭头' },
  { label: '→', data: '\x1b[C', enabled: true, desc: '右箭头' },
  { label: 'S-Tab', data: '\x1b[Z', enabled: true, desc: 'Shift+Tab 反向切换' },
];

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
 */
export function ensureDefaultUserConfig(input: UserConfig | null | undefined): Required<
  Pick<UserConfig, 'shortcuts' | 'commands'>
> &
  UserConfig {
  const src = input ?? {};
  const shortcuts =
    Array.isArray(src.shortcuts) && src.shortcuts.length > 0
      ? src.shortcuts
      : DEFAULT_SHORTCUTS;
  const commands =
    Array.isArray(src.commands) && src.commands.length > 0 ? src.commands : DEFAULT_COMMANDS;
  return { ...src, shortcuts, commands };
}
