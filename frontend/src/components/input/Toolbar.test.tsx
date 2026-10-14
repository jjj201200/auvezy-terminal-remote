/**
 * Toolbar TUI 分组过滤回归测试
 *
 * 行为契约（0.19 起）：claude-code / claude 与 codex / codex 四个 TUI 专属
 * 分组在 Toolbar 分类行的可见性由「集成总开关 + 实例激活模块」联动：
 *  - 集成关闭（filterByTui=false / 缺省）→ 不过滤，仅按条目 enabled 显示
 *  - 集成开启 → 仅当 activeTuiModule 与组要求的模块一致时显示
 * 通用分组（常用 / 会话 / 自定义等）与设置面板不受过滤影响。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type {
  ConfigurableShortcut,
  ConfigurableCommand,
} from 'auvezy-terminal-remote-shared';
import { I18nProvider } from '../../i18n/i18n-context.js';
import { Toolbar } from './Toolbar.js';

// ScrollableTabs 用 CSS.escape（jsdom 未实现）、HScroller 可能用 ResizeObserver；
// 本测试只关分组可见性语义，mock 成平铺渲染（tab title 文本仍可查询）
vi.mock('./ScrollableTabs.js', () => ({
  ScrollableTabs: ({ items }: { items: Array<{ id: string; title: string }> }) => (
    <div>{items.map((it) => <span key={it.id}>{it.title}</span>)}</div>
  ),
}));
vi.mock('../ui/HScroller.js', () => ({
  HScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const tuiShortcuts: ConfigurableShortcut[] = [
  { label: 'Esc×2', data: '\x1b\x1b', enabled: true, group: 'claude-code' },
  { label: '^T', data: '\x14', enabled: true, group: 'codex' },
  { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
];

const tuiCommands: ConfigurableCommand[] = [
  { label: '/model', command: '/model', enabled: true, autoSend: true, group: 'claude' },
  { label: '/diff', command: '/diff', enabled: true, autoSend: true, group: 'codex' },
  { label: '/clear', command: '/clear', enabled: true, autoSend: true, group: 'session' },
];

function renderToolbar(props: {
  filterByTui?: boolean;
  activeTuiModule?: string | null;
}) {
  return render(
    <I18nProvider>
      <Toolbar
        shortcuts={tuiShortcuts}
        commands={tuiCommands}
        onSendData={() => {}}
        onSubmitCommand={() => {}}
        onPrefillCommand={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

/** 分类行里 tab title 的出现次数（快捷键「Codex」与命令「Codex」同名，需计数） */
function tabCount(title: string): number {
  return screen.queryAllByText(title).length;
}

describe('Toolbar TUI 分组过滤', () => {
  it('集成关闭（缺省）→ 四个 TUI 组不过滤，全部显示', () => {
    renderToolbar({});
    expect(tabCount('Claude Code')).toBe(1);
    expect(tabCount('Claude')).toBe(1);
    expect(tabCount('Codex')).toBe(2); // 快捷键组 + 命令组同名
    expect(tabCount('常用')).toBe(1);
    expect(tabCount('会话')).toBe(1);
  });

  it('集成关闭（显式 false）→ 同样不过滤', () => {
    renderToolbar({ filterByTui: false, activeTuiModule: null });
    expect(tabCount('Claude Code')).toBe(1);
    expect(tabCount('Codex')).toBe(2);
  });

  it('集成开启 + 检测到 claude-code → 只显示 Claude 侧两组', () => {
    renderToolbar({ filterByTui: true, activeTuiModule: 'claude-code' });
    expect(tabCount('Claude Code')).toBe(1);
    expect(tabCount('Claude')).toBe(1);
    expect(tabCount('Codex')).toBe(0);
    // 通用组不受影响
    expect(tabCount('常用')).toBe(1);
    expect(tabCount('会话')).toBe(1);
  });

  it('集成开启 + 检测到 codex → 只显示 Codex 侧两组', () => {
    renderToolbar({ filterByTui: true, activeTuiModule: 'codex' });
    expect(tabCount('Claude Code')).toBe(0);
    expect(tabCount('Claude')).toBe(0);
    expect(tabCount('Codex')).toBe(2);
    expect(tabCount('常用')).toBe(1);
  });

  it('集成开启 + 未检测到 TUI（普通 shell）→ 四组全隐藏，通用组保留', () => {
    renderToolbar({ filterByTui: true, activeTuiModule: null });
    expect(tabCount('Claude Code')).toBe(0);
    expect(tabCount('Claude')).toBe(0);
    expect(tabCount('Codex')).toBe(0);
    expect(tabCount('常用')).toBe(1);
    expect(tabCount('会话')).toBe(1);
  });

  it('TUI 组条目未启用 → 即使模块匹配也不显示（桶空无 tab）', () => {
    render(
      <I18nProvider>
        <Toolbar
          shortcuts={[{ label: 'X', data: 'x', enabled: false, group: 'claude-code' }]}
          commands={[{ label: '/m', command: '/m', enabled: false, group: 'claude' }]}
          onSendData={() => {}}
          onSubmitCommand={() => {}}
          onPrefillCommand={() => {}}
          filterByTui
          activeTuiModule="claude-code"
        />
      </I18nProvider>,
    );
    expect(tabCount('Claude Code')).toBe(0);
    expect(tabCount('Claude')).toBe(0);
  });
});
