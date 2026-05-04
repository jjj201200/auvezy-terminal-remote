/**
 * 默认快捷键与命令（前后端共享）
 *
 * 用户配置文件 ~/.claude-remote/config.json 中：
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
