/**
 * defaults / ensureDefaultUserConfig 单测
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_COMMANDS,
  SHORTCUT_GROUPS,
  findShortcutGroup,
  ensureDefaultUserConfig,
} from './defaults.js';

describe('SHORTCUT_GROUPS', () => {
  it('包含全部预期分组', () => {
    const ids = SHORTCUT_GROUPS.map((g) => g.id);
    expect(ids).toEqual(['common', 'editing', 'readline', 'vim', 'tmux', 'signals']);
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

  it('用户值优先（新版有 group 字段）', () => {
    const custom = {
      shortcuts: [{ label: 'X', data: 'x', enabled: true, group: 'custom' as const }],
    };
    const r = ensureDefaultUserConfig(custom);
    expect(r.shortcuts).toEqual(custom.shortcuts);
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

  it('全部有 group 字段 → 视为新版，原样保留', () => {
    const newConfig = {
      shortcuts: [
        { label: 'Esc', data: '\x1b', enabled: true, group: 'common' as const },
      ],
    };
    const r = ensureDefaultUserConfig(newConfig);
    expect(r.shortcuts).toHaveLength(1);
    expect(r.shortcuts[0]?.label).toBe('Esc');
  });
});
