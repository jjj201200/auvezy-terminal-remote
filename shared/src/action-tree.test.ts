import { describe, it, expect } from 'vitest';
import {
  flattenShortcuts,
  flattenCommands,
  makeActionId,
  type ShortcutGroup,
  type CommandGroup,
} from './action-tree.js';
import {
  buildDefaultShortcutGroups,
  buildDefaultCommandGroups,
  lookupBuiltinShortcut,
  lookupBuiltinCommand,
  migrateShortcutsToTree,
  migrateCommandsToTree,
  splitShortcutTree,
  splitCommandTree,
} from './action-tree-defaults.js';
import {
  SHORTCUT_GROUPS,
  COMMAND_GROUPS,
  type ConfigurableShortcut,
  type ConfigurableCommand,
} from './defaults.js';

// ─────────────────────── flatten ───────────────────────

describe('flattenShortcuts', () => {
  it('保持组顺序与项顺序，注入 group 字段', () => {
    const groups: ShortcutGroup[] = [
      {
        id: 'g1',
        title: 'G1',
        items: [
          { id: 'g1/0', label: 'A', data: 'a', enabled: true },
          { id: 'g1/1', label: 'B', data: 'b', enabled: false },
        ],
      },
      {
        id: 'g2',
        title: 'G2',
        items: [{ id: 'g2/0', label: 'C', data: 'c', enabled: true }],
      },
    ];
    const flat = flattenShortcuts(groups);
    expect(flat.map((it) => it.label)).toEqual(['A', 'B', 'C']);
    expect(flat.map((it) => it.group)).toEqual(['g1', 'g1', 'g2']);
  });
  it('空分组数组 → 空数组', () => {
    expect(flattenShortcuts([])).toEqual([]);
  });
});

describe('flattenCommands', () => {
  it('注入 group 字段', () => {
    const groups: CommandGroup[] = [
      {
        id: 'session',
        title: '会话',
        items: [
          {
            id: 'session/0',
            label: '/clear',
            command: '/clear',
            enabled: true,
            autoSend: true,
          },
        ],
      },
    ];
    const flat = flattenCommands(groups);
    expect(flat[0]?.group).toBe('session');
    expect(flat[0]?.label).toBe('/clear');
  });
});

// ─────────────────────── builtin defaults ───────────────────────

describe('buildDefaultShortcutGroups', () => {
  it('每个内置 SHORTCUT_GROUPS 都有对应输出，且 builtinKey 设了', () => {
    const out = buildDefaultShortcutGroups();
    expect(out.length).toBe(SHORTCUT_GROUPS.length);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]?.id).toBe(SHORTCUT_GROUPS[i]?.id);
      expect(out[i]?.builtinKey).toBe(SHORTCUT_GROUPS[i]?.id);
      expect(out[i]?.items.length).toBe(SHORTCUT_GROUPS[i]?.items.length);
      for (let j = 0; j < out[i]!.items.length; j++) {
        expect(out[i]!.items[j]?.builtinKey).toBe(`${SHORTCUT_GROUPS[i]!.id}/${j}`);
        expect(out[i]!.items[j]?.id).toBe(`${SHORTCUT_GROUPS[i]!.id}/${j}`);
      }
    }
  });
});

describe('buildDefaultCommandGroups', () => {
  it('每个内置 COMMAND_GROUPS 都有对应输出', () => {
    const out = buildDefaultCommandGroups();
    expect(out.length).toBe(COMMAND_GROUPS.length);
    expect(out[0]?.id).toBe(COMMAND_GROUPS[0]?.id);
  });
});

// ─────────────────────── lookup ───────────────────────

describe('lookupBuiltinShortcut', () => {
  it('已知 builtinKey 返回原始 label/data', () => {
    const first = SHORTCUT_GROUPS[0]?.items[0];
    if (!first) throw new Error('SHORTCUT_GROUPS 不应为空');
    const looked = lookupBuiltinShortcut(`${SHORTCUT_GROUPS[0]?.id}/0`);
    expect(looked?.label).toBe(first.label);
    expect(looked?.data).toBe(first.data);
  });
  it('未知 builtinKey 返回 undefined', () => {
    expect(lookupBuiltinShortcut('not-a-real-key')).toBeUndefined();
  });
});

describe('lookupBuiltinCommand', () => {
  it('已知 builtinKey 返回原始 command', () => {
    const first = COMMAND_GROUPS[0]?.items[0];
    if (!first) throw new Error('COMMAND_GROUPS 不应为空');
    const looked = lookupBuiltinCommand(`${COMMAND_GROUPS[0]?.id}/0`);
    expect(looked?.label).toBe(first.label);
    expect(looked?.command).toBe(first.command);
  });
});

// ─────────────────────── 迁移 ───────────────────────

describe('migrateShortcutsToTree', () => {
  it('undefined / 空 → 默认分组树', () => {
    const out1 = migrateShortcutsToTree(undefined);
    const out2 = migrateShortcutsToTree([]);
    expect(out1.length).toBe(SHORTCUT_GROUPS.length);
    expect(out2.length).toBe(SHORTCUT_GROUPS.length);
  });

  it('按 group 字段分桶，保留内置组顺序', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'X', data: 'x', enabled: true, group: 'vim' },
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
    ];
    const out = migrateShortcutsToTree(flat);
    // common 在 SHORTCUT_GROUPS 中早于 vim → 输出也应 common 先
    const ids = out.map((g) => g.id);
    const commonIdx = ids.indexOf('common');
    const vimIdx = ids.indexOf('vim');
    expect(commonIdx).toBeGreaterThanOrEqual(0);
    expect(vimIdx).toBeGreaterThan(commonIdx);
    expect(out.find((g) => g.id === 'common')?.items[0]?.label).toBe('Esc');
  });

  it('用户没数据的内置组不被强行补回（尊重用户删除）', () => {
    // 用户曾经删掉了所有 vim 项 → 迁移后不应包含 vim 组
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
    ];
    const out = migrateShortcutsToTree(flat);
    expect(out.find((g) => g.id === 'vim')).toBeUndefined();
    expect(out.find((g) => g.id === 'common')).toBeDefined();
  });

  it('未知 group id 作为自定义分组追加在尾部', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
      { label: 'My', data: 'm', enabled: true, group: 'my-custom' },
    ];
    const out = migrateShortcutsToTree(flat);
    expect(out[out.length - 1]?.id).toBe('my-custom');
    expect(out[out.length - 1]?.title).toBe('my-custom');
    // 自定义组没有 builtinKey
    expect(out[out.length - 1]?.builtinKey).toBeUndefined();
  });

  it('内置组里 label 匹配上内置项 → 项继承 builtinKey', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
    ];
    const out = migrateShortcutsToTree(flat);
    const item = out.find((g) => g.id === 'common')?.items[0];
    expect(item?.builtinKey).toMatch(/^common\/\d+$/);
  });

  it('缺 group 字段（旧旧版数据）→ 进 custom 桶', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'Lone', data: 'l', enabled: true } as ConfigurableShortcut,
    ];
    const out = migrateShortcutsToTree(flat);
    // custom 是内置组，会按内置顺序输出
    const cust = out.find((g) => g.id === 'custom');
    expect(cust).toBeDefined();
    expect(cust?.items[0]?.label).toBe('Lone');
  });
});

describe('migrateCommandsToTree', () => {
  it('undefined / 空 → 默认分组树', () => {
    expect(migrateCommandsToTree(undefined).length).toBe(COMMAND_GROUPS.length);
  });

  it('按 group 字段分桶并保留内置顺序', () => {
    const flat: ConfigurableCommand[] = [
      { label: '/help', command: '/help', enabled: true, group: 'help' },
      { label: '/clear', command: '/clear', enabled: true, group: 'session' },
    ];
    const out = migrateCommandsToTree(flat);
    const ids = out.map((g) => g.id);
    expect(ids.indexOf('session')).toBeLessThan(ids.indexOf('help'));
  });
});

// ─────────────────────── meta-aware migrate ───────────────────────

describe('migrateShortcutsToTree (meta-aware)', () => {
  it('meta entries 顺序覆盖内置默认顺序', () => {
    // SHORTCUT_GROUPS 中 common 在 vim 之前；用 meta 让 vim 先输出
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
      { label: 'h', data: 'h', enabled: true, group: 'vim' },
    ];
    const out = migrateShortcutsToTree(flat, [
      { id: 'vim' },
      { id: 'common' },
    ]);
    expect(out.map((g) => g.id)).toEqual(['vim', 'common']);
  });

  it('meta 里的 title / desc 覆盖内置默认', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
    ];
    const out = migrateShortcutsToTree(flat, [
      { id: 'common', title: '我的最爱', desc: '改过的描述' },
    ]);
    expect(out[0]?.title).toBe('我的最爱');
    expect(out[0]?.desc).toBe('改过的描述');
    expect(out[0]?.builtinKey).toBe('common'); // 仍是内置组
  });

  it('meta 里引用了空分组（没扁平 item） → 输出空 items 占位组', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
    ];
    const out = migrateShortcutsToTree(flat, [
      { id: 'common' },
      { id: 'my-empty', title: '我的空组' },
    ]);
    const empty = out.find((g) => g.id === 'my-empty');
    expect(empty).toBeDefined();
    expect(empty?.items).toEqual([]);
    expect(empty?.title).toBe('我的空组');
  });

  it('meta 没列出的分组按内置默认顺序追加', () => {
    const flat: ConfigurableShortcut[] = [
      { label: 'Esc', data: '\x1b', enabled: true, group: 'common' },
      { label: 'h', data: 'h', enabled: true, group: 'vim' },
    ];
    const out = migrateShortcutsToTree(flat, [{ id: 'vim' }]);
    expect(out.map((g) => g.id)).toEqual(['vim', 'common']);
  });

  it('flat 空 + meta 给了 → 仅返回 meta 的占位组', () => {
    const out = migrateShortcutsToTree([], [
      { id: 'my-only', title: '只此一组' },
    ]);
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe('my-only');
  });
});

// ─────────────────────── splitShortcutTree ───────────────────────

describe('splitShortcutTree', () => {
  it('每个 item 进 flat 并注入 group；每个分组进 meta', () => {
    const groups: ShortcutGroup[] = [
      {
        id: 'common',
        title: '常用',
        desc: '最常用的导航与控制键，默认全部启用。',
        items: [
          { id: 'common/0', label: 'Esc', data: '\x1b', enabled: true, desc: 'ESC' },
        ],
      },
      {
        id: 'my-cust',
        title: '我的',
        items: [{ id: 'my-cust/0', label: 'X', data: 'x', enabled: true }],
      },
    ];
    const { flat, meta } = splitShortcutTree(groups);
    expect(flat.map((s) => s.label)).toEqual(['Esc', 'X']);
    expect(flat.map((s) => s.group)).toEqual(['common', 'my-cust']);
    expect(meta.map((m) => m.id)).toEqual(['common', 'my-cust']);
  });

  it('内置 title / desc 没改 → meta entry 不带 title / desc', () => {
    const def = buildDefaultShortcutGroups()[0];
    if (!def) throw new Error('shortcut defaults empty');
    const { meta } = splitShortcutTree([def]);
    expect(meta[0]?.title).toBeUndefined();
    expect(meta[0]?.desc).toBeUndefined();
    expect(meta[0]?.id).toBe(def.id);
  });

  it('内置 title 改了 → meta entry 带 title', () => {
    const def = buildDefaultShortcutGroups()[0];
    if (!def) throw new Error('shortcut defaults empty');
    const { meta } = splitShortcutTree([{ ...def, title: '新名' }]);
    expect(meta[0]?.title).toBe('新名');
  });

  it('round-trip：split → migrate 应稳定', () => {
    const tree1 = buildDefaultShortcutGroups();
    const { flat, meta } = splitShortcutTree(tree1);
    const tree2 = migrateShortcutsToTree(flat, meta);
    // 顺序、id、items 长度一致；title/desc 经过迁移恢复
    expect(tree2.map((g) => g.id)).toEqual(tree1.map((g) => g.id));
    expect(tree2.map((g) => g.items.length)).toEqual(tree1.map((g) => g.items.length));
    expect(tree2[0]?.title).toBe(tree1[0]?.title);
  });
});

describe('splitCommandTree', () => {
  it('round-trip 稳定', () => {
    const tree1 = buildDefaultCommandGroups();
    const { flat, meta } = splitCommandTree(tree1);
    const tree2 = migrateCommandsToTree(flat, meta);
    expect(tree2.map((g) => g.id)).toEqual(tree1.map((g) => g.id));
  });
});

// ─────────────────────── makeActionId ───────────────────────

describe('makeActionId', () => {
  it('生成的 id 不重复', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(makeActionId('g'));
    expect(ids.size).toBe(100);
  });
  it('前缀正确', () => {
    expect(makeActionId('g')).toMatch(/^g-/);
    expect(makeActionId('i')).toMatch(/^i-/);
  });
});
