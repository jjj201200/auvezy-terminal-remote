/**
 * defaults / ensureDefaultUserConfig 单测
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_COMMANDS,
  ensureDefaultUserConfig,
} from './defaults.js';

describe('DEFAULT_SHORTCUTS / DEFAULT_COMMANDS', () => {
  it('快捷键非空且 enabled 默认全 true', () => {
    expect(DEFAULT_SHORTCUTS.length).toBeGreaterThan(0);
    for (const s of DEFAULT_SHORTCUTS) {
      expect(typeof s.label).toBe('string');
      expect(typeof s.data).toBe('string');
      expect(s.enabled).toBe(true);
    }
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

  it('用户值优先', () => {
    const custom = { shortcuts: [{ label: 'X', data: 'x', enabled: true }] };
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
