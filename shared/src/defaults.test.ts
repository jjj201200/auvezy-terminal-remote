/**
 * defaults / ensureDefaultUserConfig 单测
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_COMMANDS,
  DEFAULT_INTEGRATIONS,
  SHORTCUT_GROUPS,
  COMMAND_GROUPS,
  findShortcutGroup,
  ensureDefaultUserConfig,
} from './defaults.js';

describe('SHORTCUT_GROUPS', () => {
  it('包含全部预期分组', () => {
    const ids = SHORTCUT_GROUPS.map((g) => g.id);
    expect(ids).toEqual([
      'common',
      'editing',
      'readline',
      'vim',
      'tmux',
      'signals',
      'claude-code',
      'codex',
    ]);
  });

  it('common 组所有项默认 enabled=true', () => {
    const common = SHORTCUT_GROUPS.find((g) => g.id === 'common');
    expect(common).toBeDefined();
    for (const item of common!.items) expect(item.enabled).toBe(true);
  });

  it('非 common 组所有项默认 enabled=false', () => {
    for (const g of SHORTCUT_GROUPS) {
      if (g.id === 'common') continue;
      for (const item of g.items) expect(item.enabled).toBe(false);
    }
  });

  it('common 组同时包含 Tab 与 Shift+Tab', () => {
    const common = SHORTCUT_GROUPS.find((g) => g.id === 'common');
    const datas = common!.items.map((s) => s.data);
    expect(datas).toContain('\t');
    expect(datas).toContain('\x1b[Z');
  });

  it('common 组包含退格键', () => {
    const common = SHORTCUT_GROUPS.find((g) => g.id === 'common');
    const datas = common!.items.map((s) => s.data);
    expect(datas).toContain('\x7f');
  });

  it('每个分组都有非空 desc', () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.desc.length).toBeGreaterThan(0);
    }
  });

  it('每个分组的每条快捷键都有 desc（除常用外便于用户决定是否启用）', () => {
    for (const g of SHORTCUT_GROUPS) {
      if (g.id === 'common') continue;
      for (const item of g.items) {
        expect(item.desc, `${g.id}/${item.label}`).toBeTruthy();
      }
    }
  });
});

describe('findShortcutGroup', () => {
  it('已知 id 返回组定义', () => {
    expect(findShortcutGroup('common')?.id).toBe('common');
    expect(findShortcutGroup('vim')?.title).toBe('Vim');
  });
  it('未知 id 返回 undefined', () => {
    expect(findShortcutGroup('nope')).toBeUndefined();
  });
});

describe('DEFAULT_SHORTCUTS / DEFAULT_COMMANDS', () => {
  it('DEFAULT_SHORTCUTS 是所有分组扁平化', () => {
    const total = SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0);
    expect(DEFAULT_SHORTCUTS.length).toBe(total);
  });

  it('DEFAULT_SHORTCUTS 每项都带 group 字段', () => {
    for (const s of DEFAULT_SHORTCUTS) {
      expect(s.group).toBeDefined();
      expect(typeof s.label).toBe('string');
      expect(typeof s.data).toBe('string');
    }
  });

  it('DEFAULT_SHORTCUTS 默认启用项 = common 组项数', () => {
    const enabledCount = DEFAULT_SHORTCUTS.filter((s) => s.enabled).length;
    const commonCount = SHORTCUT_GROUPS.find((g) => g.id === 'common')!.items.length;
    expect(enabledCount).toBe(commonCount);
  });

  it('命令列表至少含 /clear', () => {
    const labels = DEFAULT_COMMANDS.map((c) => c.label);
    expect(labels).toContain('/clear');
  });
});

describe('ensureDefaultUserConfig', () => {
  it('null/undefined → 全默认', () => {
    expect(ensureDefaultUserConfig(null).shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(ensureDefaultUserConfig(undefined).commands).toEqual(DEFAULT_COMMANDS);
  });

  it('空数组 → 也回退到默认（避免用户清空后无可用项）', () => {
    const r = ensureDefaultUserConfig({ shortcuts: [], commands: [] });
    expect(r.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(r.commands).toEqual(DEFAULT_COMMANDS);
  });

  it('用户值优先（新版有 group 字段；缺失的内置条目追加到尾部）', () => {
    const custom = {
      shortcuts: [{ label: 'X', data: 'x', enabled: true, group: 'custom' as const }],
    };
    const r = ensureDefaultUserConfig(custom);
    // 用户条目原样保留在最前
    expect(r.shortcuts[0]).toEqual(custom.shortcuts[0]);
    // 内置默认条目（用户列表缺失）全部追加到尾部
    expect(r.shortcuts).toHaveLength(1 + DEFAULT_SHORTCUTS.length);
    // commands 字段缺失 → 默认
    expect(r.commands).toEqual(DEFAULT_COMMANDS);
  });

  it('保留其它字段（如 fontScale）', () => {
    const r = ensureDefaultUserConfig({ fontScale: 1.2 });
    expect(r.fontScale).toBe(1.2);
  });

  it('shortcuts 不是数组 → 回退默认', () => {
    // @ts-expect-error 测脏数据
    const r = ensureDefaultUserConfig({ shortcuts: 'invalid' });
    expect(r.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it('input.wheelSensitivity 缺失 → 默认 med', () => {
    const r = ensureDefaultUserConfig({});
    expect(r.input?.wheelSensitivity).toBe('med');
  });

  it('input.wheelSensitivity 接受 low/med/high', () => {
    expect(ensureDefaultUserConfig({ input: { wheelSensitivity: 'low' } } as never).input?.wheelSensitivity).toBe('low');
    expect(ensureDefaultUserConfig({ input: { wheelSensitivity: 'med' } } as never).input?.wheelSensitivity).toBe('med');
    expect(ensureDefaultUserConfig({ input: { wheelSensitivity: 'high' } } as never).input?.wheelSensitivity).toBe('high');
  });

  it('input.wheelSensitivity 非法值 → 回退 med', () => {
    expect(ensureDefaultUserConfig({ input: { wheelSensitivity: 'extreme' } } as never).input?.wheelSensitivity).toBe('med');
    expect(ensureDefaultUserConfig({ input: { wheelSensitivity: 1.5 } } as never).input?.wheelSensitivity).toBe('med');
    expect(ensureDefaultUserConfig({ input: { wheelSensitivity: null } } as never).input?.wheelSensitivity).toBe('med');
  });

  it('display:新 maxCols 字段透传,旧 targetCols 字段平滑迁移', () => {
    // 旧 config 只有 targetCols
    const r1 = ensureDefaultUserConfig({ display: { targetCols: 100 } } as never);
    expect(r1.display?.maxCols).toBe(100);

    // 新 config maxCols 优先,即便 targetCols 也存在(旧字段忽略)
    const r2 = ensureDefaultUserConfig({
      display: { maxCols: 120, targetCols: 80 },
    } as never);
    expect(r2.display?.maxCols).toBe(120);
  });

  it('display:fontSizeMin > fontSizeMax 时自动 swap', () => {
    const r = ensureDefaultUserConfig({
      display: { fontSizeMin: 20, fontSizeMax: 10 },
    } as never);
    expect(r.display?.fontSizeMin).toBe(10);
    expect(r.display?.fontSizeMax).toBe(20);
  });

  it('display:fontSize 越界(超 FONT_SIZE_FLOOR/CEIL) → 默认值', () => {
    const r = ensureDefaultUserConfig({
      display: { fontSizeMin: 2, fontSizeMax: 100 },
    } as never);
    // 都越界 → 都回默认 6 / 18
    expect(r.display?.fontSizeMin).toBe(6);
    expect(r.display?.fontSizeMax).toBe(18);
  });
});

describe('ensureDefaultUserConfig：旧版直接重置', () => {
  it('旧版（任何一项无 group 字段）→ 整段丢弃，回到默认', () => {
    const oldConfig = {
      shortcuts: [
        { label: 'Esc', data: '\x1b', enabled: true },
        { label: 'Tab', data: '\t', enabled: true },
      ],
    };
    const r = ensureDefaultUserConfig(oldConfig);
    expect(r.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it('部分项无 group 字段也判定为旧版（保守策略）', () => {
    const mixed = {
      shortcuts: [
        { label: 'Esc', data: '\x1b', enabled: true, group: 'common' as const },
        { label: 'foo', data: 'bar', enabled: true },
      ],
    };
    const r = ensureDefaultUserConfig(mixed);
    expect(r.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it('全部有 group 字段 → 视为新版，原样保留 + 条目级合并补缺', () => {
    const newConfig = {
      shortcuts: [
        { label: 'Esc', data: '\x1b', enabled: true, group: 'common' as const },
      ],
    };
    const r = ensureDefaultUserConfig(newConfig);
    // 用户条目第一，其余内置缺失条目追加
    expect(r.shortcuts[0]?.label).toBe('Esc');
    expect(r.shortcuts).toHaveLength(DEFAULT_SHORTCUTS.length);
  });
});

describe('ensureDefaultUserConfig：条目级合并（0.19 起）', () => {
  it('老配置自动获得新增默认分组（claude / codex / claude-code / codex）', () => {
    // 模拟 0.18 老用户：只有旧 6 组快捷键 + 旧 7 组命令
    const legacyShortcuts = DEFAULT_SHORTCUTS.filter((s) =>
      ['common', 'editing', 'readline', 'vim', 'tmux', 'signals'].includes(s.group ?? ''),
    );
    const legacyCommands = DEFAULT_COMMANDS.filter((c) =>
      ['session', 'context', 'agent', 'workflow', 'auth', 'help', 'tools'].includes(c.group ?? ''),
    );
    expect(legacyShortcuts.length).toBeLessThan(DEFAULT_SHORTCUTS.length);
    expect(legacyCommands.length).toBeLessThan(DEFAULT_COMMANDS.length);

    const r = ensureDefaultUserConfig({
      shortcuts: legacyShortcuts,
      commands: legacyCommands,
    });
    // 老条目原样在前，新组条目全部补齐
    expect(r.shortcuts).toHaveLength(DEFAULT_SHORTCUTS.length);
    expect(r.commands).toHaveLength(DEFAULT_COMMANDS.length);
    expect(r.shortcuts.some((s) => s.group === 'claude-code')).toBe(true);
    expect(r.shortcuts.some((s) => s.group === 'codex')).toBe(true);
    expect(r.commands.some((c) => c.group === 'claude')).toBe(true);
    expect(r.commands.some((c) => c.group === 'codex')).toBe(true);
  });

  it('幂等：合并结果再过一次 ensure 不会重复追加', () => {
    const once = ensureDefaultUserConfig({
      shortcuts: [{ label: 'X', data: 'x', enabled: true, group: 'custom' as const }],
    });
    const twice = ensureDefaultUserConfig({ shortcuts: once.shortcuts });
    expect(twice.shortcuts).toEqual(once.shortcuts);
  });

  it('用户已删除的内置条目会复活（键缺失即补），但不会重复', () => {
    const removed = DEFAULT_SHORTCUTS.filter((s) => s.data !== '\x1b[Z'); // 删掉 S-Tab
    const r = ensureDefaultUserConfig({ shortcuts: removed });
    const stabCount = r.shortcuts.filter((s) => s.data === '\x1b[Z').length;
    expect(stabCount).toBe(1);
  });

  it('用户改过 enabled / label 的同键条目不被覆盖', () => {
    const edited = DEFAULT_SHORTCUTS.map((s) =>
      s.data === '\x1b' && s.group === 'common'
        ? { ...s, label: '我的Esc', enabled: false }
        : s,
    );
    const r = ensureDefaultUserConfig({ shortcuts: edited });
    const esc = r.shortcuts.find((s) => s.group === 'common' && s.data === '\x1b');
    expect(esc?.label).toBe('我的Esc');
    expect(esc?.enabled).toBe(false);
  });
});

describe('claude / codex 默认分组', () => {
  it('四个新分组所有条目默认 enabled=false（用户自行启用）', () => {
    for (const id of ['claude-code', 'codex'] as const) {
      const g = SHORTCUT_GROUPS.find((x) => x.id === id);
      expect(g, id).toBeDefined();
      for (const item of g!.items) expect(item.enabled, `${id}/${item.label}`).toBe(false);
    }
    for (const id of ['claude', 'codex'] as const) {
      const g = COMMAND_GROUPS.find((x) => x.id === id);
      expect(g, id).toBeDefined();
      for (const item of g!.items) expect(item.enabled, `${id}/${item.label}`).toBe(false);
    }
  });

  it('claude 命令组按常用度排序：前 5 条是会话类高频命令', () => {
    const g = COMMAND_GROUPS.find((x) => x.id === 'claude')!;
    const first5 = g.items.slice(0, 5).map((c) => c.command);
    expect(first5).toEqual(['/clear', '/compact', '/resume', '/exit', '/rewind']);
  });

  it('codex 命令组前 3 条是 /clear /new /resume', () => {
    const g = COMMAND_GROUPS.find((x) => x.id === 'codex')!;
    const first3 = g.items.slice(0, 3).map((c) => c.command);
    expect(first3).toEqual(['/clear', '/new', '/resume']);
  });

  it('新分组条目数量达到"全集"量级（数据完整性哨兵）', () => {
    const claudeCmds = COMMAND_GROUPS.find((x) => x.id === 'claude')!.items;
    const codexCmds = COMMAND_GROUPS.find((x) => x.id === 'codex')!.items;
    expect(claudeCmds.length).toBeGreaterThanOrEqual(100);
    expect(codexCmds.length).toBeGreaterThanOrEqual(45);
  });

  it('claude / codex 命令组内 command 无重复', () => {
    for (const id of ['claude', 'codex'] as const) {
      const cmds = COMMAND_GROUPS.find((x) => x.id === id)!.items.map((c) => c.command);
      expect(new Set(cmds).size, id).toBe(cmds.length);
    }
  });

  it('废弃命令已从默认常量移除（/vim /pr_comments；/bashes 已更名 /tasks）', () => {
    const allCmds = DEFAULT_COMMANDS.map((c) => c.command);
    expect(allCmds).not.toContain('/vim ');
    expect(allCmds).not.toContain('/pr_comments');
    expect(allCmds).not.toContain('/bashes');
    expect(allCmds).toContain('/tasks');
  });
});

describe('rendering integration defaults', () => {
  it('exposes markdown.enabled and obsidian.* sub-toggles via DEFAULT_INTEGRATIONS', () => {
    expect(DEFAULT_INTEGRATIONS.rendering.markdown.enabled).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.markdown.fontSize).toBe(0);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.enabled).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.frontmatter).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.wikilink).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.embed).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.callout).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.inlineSyntax).toBe(true);
  });
});

describe('rendering integration migration', () => {
  it('migrates legacy display.markdownPreview=false to rendering.markdown.enabled=false when new field absent', () => {
    const input = {
      display: { markdownPreview: false },
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0];
    const out = ensureDefaultUserConfig(input);
    expect(out.integrations.rendering?.markdown?.enabled).toBe(false);
    // 旧字段保留(双写窗口)
    expect(out.display.markdownPreview).toBe(false);
  });

  it('prefers new rendering.markdown.enabled over legacy display.markdownPreview', () => {
    const input = {
      display: { markdownPreview: false },
      integrations: { rendering: { markdown: { enabled: true } } },
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0];
    const out = ensureDefaultUserConfig(input);
    expect(out.integrations.rendering?.markdown?.enabled).toBe(true);
  });

  it('fills obsidian sub-toggles with defaults when partially configured', () => {
    const input = {
      integrations: { rendering: { obsidian: { wikilink: false } } },
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0];
    const out = ensureDefaultUserConfig(input);
    const obs = out.integrations.rendering?.obsidian;
    expect(obs?.enabled).toBe(true);
    expect(obs?.wikilink).toBe(false);
    expect(obs?.frontmatter).toBe(true);
    expect(obs?.embed).toBe(true);
    expect(obs?.callout).toBe(true);
    expect(obs?.inlineSyntax).toBe(true);
  });

  it('normalizes markdown.fontSize: 0=auto, fixed clamped to [10,24], garbage→auto', () => {
    const mk = (fontSize: unknown) =>
      ensureDefaultUserConfig({
        integrations: { rendering: { markdown: { enabled: true, fontSize } } },
      } as unknown as Parameters<typeof ensureDefaultUserConfig>[0]);

    expect(mk(0).integrations.rendering?.markdown?.fontSize).toBe(0);
    expect(mk(15).integrations.rendering?.markdown?.fontSize).toBe(15);
    // 越界 clamp
    expect(mk(4).integrations.rendering?.markdown?.fontSize).toBe(10);
    expect(mk(99).integrations.rendering?.markdown?.fontSize).toBe(24);
    // 非整数取整
    expect(mk(14.6).integrations.rendering?.markdown?.fontSize).toBe(15);
    // 非法值回退自动
    expect(mk(Number.NaN).integrations.rendering?.markdown?.fontSize).toBe(0);
    expect(mk('16').integrations.rendering?.markdown?.fontSize).toBe(0);
    // 缺字段 = 自动
    const missing = ensureDefaultUserConfig({
      integrations: { rendering: { markdown: { enabled: true } } },
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0]);
    expect(missing.integrations.rendering?.markdown?.fontSize).toBe(0);
  });
});

describe('recentFilesLimit normalize', () => {
  it('缺省 → 默认 20', () => {
    expect(ensureDefaultUserConfig({}).recentFilesLimit).toBe(20);
  });

  it('合法值透传:0(不记录) / -1(不限) / 正整数', () => {
    expect(ensureDefaultUserConfig({ recentFilesLimit: 0 }).recentFilesLimit).toBe(0);
    expect(ensureDefaultUserConfig({ recentFilesLimit: -1 }).recentFilesLimit).toBe(-1);
    expect(ensureDefaultUserConfig({ recentFilesLimit: 50 }).recentFilesLimit).toBe(50);
  });

  it('非整数截整;小于 -1 归为 -1;非法值回退 20', () => {
    expect(ensureDefaultUserConfig({ recentFilesLimit: 8.9 } as never).recentFilesLimit).toBe(8);
    expect(ensureDefaultUserConfig({ recentFilesLimit: -5 } as never).recentFilesLimit).toBe(-1);
    expect(ensureDefaultUserConfig({ recentFilesLimit: 'x' } as never).recentFilesLimit).toBe(20);
    expect(ensureDefaultUserConfig({ recentFilesLimit: null } as never).recentFilesLimit).toBe(20);
  });
});
