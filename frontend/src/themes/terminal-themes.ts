/**
 * 终端调色板预设
 *
 * 命名跟 Claude Code 的 `/theme` 命令对齐，方便用户在 Claude Code CLI 和
 * webapp 之间统一视觉。每个 theme 定义完整的 xterm 16 色 ANSI palette
 * + foreground / background / cursor / selection。
 *
 * 现实约束：
 * - 'dark' 和 'dark-ansi' 在 Claude Code 里渲染逻辑略不同（dark 用语义色，
 *   ansi 严格 16 色），但走到 PTY/xterm 层都是 ANSI SGR，所以这里给两个
 *   一样的 Campbell palette（最广为认知的 Win Terminal 默认色）
 * - 'light' / 'light-ansi' 同理对应 Solarized Light（最广用的暗底白字之外
 *   的浅色方案，Claude Code 在 light 模式下也借鉴这套色）
 * - 'dark-daltonized' / 'light-daltonized' 用红绿色盲友好版本（红→品红，
 *   绿→蓝绿，符合 IBM Carbon / SAS Daltonized 的标准映射）
 * - 'auto' 不在表里 —— 由前端根据 window.matchMedia('prefers-color-scheme')
 *   解析为 'dark' 或 'light' 后再查表
 */

import type { TerminalThemeName } from 'auvezy-terminal-remote-shared';

export interface TerminalThemePalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalThemeMeta {
  /** 主题键，跟 Claude Code 一致 */
  key: TerminalThemeName;
  /** 显示名（跟 i18n key 对应） */
  labelKey: 'dark' | 'light' | 'darkAnsi' | 'lightAnsi' | 'darkDaltonized' | 'lightDaltonized' | 'auto';
  /** 是否亮色（用于 UI 区分 + auto 解析时区分） */
  variant: 'dark' | 'light' | 'auto';
}

// ──────────────── 调色板定义 ────────────────

/** Campbell（Windows Terminal / PowerShell 默认，Claude Code dark/dark-ansi 对应） */
const CAMPBELL: TerminalThemePalette = {
  background: '#050608',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: 'rgba(255, 140, 0, 0.55)',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
};

/** Solarized Light（开发者最广用的浅色调色板，Claude Code light/light-ansi 对应） */
const SOLARIZED_LIGHT: TerminalThemePalette = {
  background: '#fdf6e3',
  foreground: '#586e75',
  cursor: '#586e75',
  selectionBackground: 'rgba(7, 54, 66, 0.18)',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#002b36',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
};

/**
 * Dark Daltonized（红绿色盲友好暗色）
 * 红 → 品红/橙红，绿 → 青蓝，避免红绿混淆。
 * 参考 IBM Carbon Color Blind Safe palette。
 */
const DARK_DALTONIZED: TerminalThemePalette = {
  background: '#050608',
  foreground: '#dcdfe4',
  cursor: '#dcdfe4',
  selectionBackground: 'rgba(255, 176, 0, 0.55)',
  black: '#0c0c0c',
  red: '#fe6100',     // 橙红代替正红
  green: '#648fff',   // 蓝代替绿
  yellow: '#ffb000',  // 琥珀
  blue: '#785ef0',    // 紫蓝
  magenta: '#dc267f',
  cyan: '#8ddbe2',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#ff8a3d',
  brightGreen: '#82a7ff',
  brightYellow: '#ffd166',
  brightBlue: '#9b80ff',
  brightMagenta: '#ff4ea0',
  brightCyan: '#aef0f5',
  brightWhite: '#f2f2f2',
};

/** Light Daltonized（红绿色盲友好亮色） */
const LIGHT_DALTONIZED: TerminalThemePalette = {
  background: '#fdf6e3',
  foreground: '#3d3d3d',
  cursor: '#3d3d3d',
  selectionBackground: 'rgba(120, 94, 240, 0.20)',
  black: '#1a1a1a',
  red: '#dc4400',
  green: '#3a5fcd',
  yellow: '#bf6f00',
  blue: '#5a3eaf',
  magenta: '#a8175f',
  cyan: '#0d7d8c',
  white: '#cccccc',
  brightBlack: '#3d3d3d',
  brightRed: '#fe6100',
  brightGreen: '#648fff',
  brightYellow: '#ffb000',
  brightBlue: '#785ef0',
  brightMagenta: '#dc267f',
  brightCyan: '#1ba1b0',
  brightWhite: '#fdf6e3',
};

// ──────────────── 元信息 + lookup ────────────────

export const THEME_LIST: ReadonlyArray<TerminalThemeMeta> = [
  { key: 'dark', labelKey: 'dark', variant: 'dark' },
  { key: 'light', labelKey: 'light', variant: 'light' },
  { key: 'dark-ansi', labelKey: 'darkAnsi', variant: 'dark' },
  { key: 'light-ansi', labelKey: 'lightAnsi', variant: 'light' },
  { key: 'dark-daltonized', labelKey: 'darkDaltonized', variant: 'dark' },
  { key: 'light-daltonized', labelKey: 'lightDaltonized', variant: 'light' },
  { key: 'auto', labelKey: 'auto', variant: 'auto' },
] as const;

/** 解析主题名 → 调色板。auto 走 prefers-color-scheme 选 dark/light */
export function resolveTheme(name: TerminalThemeName | undefined): TerminalThemePalette {
  const effectiveName: TerminalThemeName = (() => {
    if (name === 'auto') {
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    }
    return name ?? 'dark';
  })();

  switch (effectiveName) {
    case 'dark':
    case 'dark-ansi':
      return CAMPBELL;
    case 'light':
    case 'light-ansi':
      return SOLARIZED_LIGHT;
    case 'dark-daltonized':
      return DARK_DALTONIZED;
    case 'light-daltonized':
      return LIGHT_DALTONIZED;
    default:
      return CAMPBELL;
  }
}
