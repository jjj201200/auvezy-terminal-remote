/**
 * Action tree 默认值生成 + 旧扁平 → 新嵌套迁移
 *
 * 内置分组（'common' / 'vim' / 'session' 等）与内置项的稳定 id 由本模块定义。
 * 用户首次安装 / 升级时，UserConfig.shortcutGroups 缺失就由 buildDefault*Groups()
 * 生成；用户已有旧扁平 shortcuts: ConfigurableShortcut[] 时由 migrate*ToTree()
 * 按 group 字段重新分桶。
 */

import {
  SHORTCUT_GROUPS,
  COMMAND_GROUPS,
  type ConfigurableShortcut,
  type ConfigurableCommand,
  type ShortcutGroupDef,
  type CommandGroupDef,
} from './defaults.js';
import {
  type ShortcutGroup,
  type ShortcutItem,
  type CommandGroup,
  type CommandItem,
} from './action-tree.js';

// ─────────────────────── builtin 默认值 ───────────────────────

/**
 * 内置分组生成默认 ShortcutGroup[]：
 *  - group.id / group.builtinKey = 内置 id（'common' / 'vim' 等）
 *  - item.id = `${groupId}/${index}` 作为稳定 id（保持迁移幂等）
 *  - item.builtinKey = 同 item.id（让"重置为默认"能反查）
 */
export function buildDefaultShortcutGroups(): ShortcutGroup[] {
  return SHORTCUT_GROUPS.map(toShortcutGroup);
}

export function buildDefaultCommandGroups(): CommandGroup[] {
  return COMMAND_GROUPS.map(toCommandGroup);
}

function toShortcutGroup(def: ShortcutGroupDef): ShortcutGroup {
  return {
    id: def.id,
    title: def.title,
    desc: def.desc,
    builtinKey: def.id,
    items: def.items.map((s, idx) => ({
      id: `${def.id}/${idx}`,
      label: s.label,
      data: s.data,
      enabled: s.enabled,
      desc: s.desc,
      builtinKey: `${def.id}/${idx}`,
    })),
  };
}

function toCommandGroup(def: CommandGroupDef): CommandGroup {
  return {
    id: def.id,
    title: def.title,
    desc: def.desc,
    builtinKey: def.id,
    items: def.items.map((c, idx) => ({
      id: `${def.id}/${idx}`,
      label: c.label,
      command: c.command,
      enabled: c.enabled,
      autoSend: c.autoSend,
      desc: c.desc,
      builtinKey: `${def.id}/${idx}`,
    })),
  };
}

// ─────────────────────── builtinKey 反查（"重置为默认"用） ───────────────────────

/**
 * 给定 builtinKey（如 "common/0"），返回内置项的原始值。
 * 不存在 → undefined（builtinKey 已失效，比如内置项被代码改 id 了）
 */
export function lookupBuiltinShortcut(
  key: string,
): Omit<ShortcutItem, 'id' | 'builtinKey'> | undefined {
  for (const g of SHORTCUT_GROUPS) {
    for (let i = 0; i < g.items.length; i++) {
      if (`${g.id}/${i}` === key) {
        const s = g.items[i];
        if (!s) return undefined;
        return { label: s.label, data: s.data, enabled: s.enabled, desc: s.desc };
      }
    }
  }
  return undefined;
}

export function lookupBuiltinCommand(
  key: string,
): Omit<CommandItem, 'id' | 'builtinKey'> | undefined {
  for (const g of COMMAND_GROUPS) {
    for (let i = 0; i < g.items.length; i++) {
      if (`${g.id}/${i}` === key) {
        const c = g.items[i];
        if (!c) return undefined;
        return {
          label: c.label,
          command: c.command,
          enabled: c.enabled,
          autoSend: c.autoSend,
          desc: c.desc,
        };
      }
    }
  }
  return undefined;
}

// ─────────────────────── 旧扁平 → 新嵌套 迁移 ───────────────────────

/**
 * 把旧扁平 shortcuts: ConfigurableShortcut[] 迁移为嵌套 ShortcutGroup[]。
 *
 * 规则：
 *  - 按 item.group 字段分桶（缺 group 字段的丢进 'custom' 桶）
 *  - 每桶继承内置分组的 title / desc（如果是内置 id）；自定义 group id 找不到 →
 *    用 group id 本身作为 title（用户后续可改）
 *  - 桶内项目顺序与原扁平数组一致
 *  - 内置 group 桶可能被用户某项替换过 data/label —— 一律保留用户值，但
 *    item.builtinKey 设为 `${group}/${idx}`（idx 是原内置 items 中按 label 匹配的下标），
 *    匹配不到就不带 builtinKey（视为新项）
 */
export function migrateShortcutsToTree(
  flat: ConfigurableShortcut[] | undefined,
): ShortcutGroup[] {
  if (!Array.isArray(flat) || flat.length === 0) {
    return buildDefaultShortcutGroups();
  }
  // 1. 按 group 分桶；缺 group 字段 → 'custom'
  const buckets = new Map<string, ConfigurableShortcut[]>();
  for (const s of flat) {
    const g = typeof s.group === 'string' && s.group.length > 0 ? s.group : 'custom';
    let bucket = buckets.get(g);
    if (!bucket) {
      bucket = [];
      buckets.set(g, bucket);
    }
    bucket.push(s);
  }

  // 2. 内置分组优先按内置顺序输出；用户自定义 group id 追加在尾部
  const groups: ShortcutGroup[] = [];
  const seen = new Set<string>();
  for (const def of SHORTCUT_GROUPS) {
    const bucket = buckets.get(def.id);
    if (!bucket) continue; // 该内置组完全没用户数据 → 跳过（用户曾删过）
    seen.add(def.id);
    groups.push({
      id: def.id,
      title: def.title,
      desc: def.desc,
      builtinKey: def.id,
      items: bucket.map((s, idx) => buildItemFromFlatShortcut(def.id, s, idx, def)),
    });
  }
  // 用户自定义 group id（不在 SHORTCUT_GROUPS 内）
  for (const [gid, bucket] of buckets) {
    if (seen.has(gid)) continue;
    groups.push({
      id: gid,
      title: gid,
      items: bucket.map((s, idx) => buildItemFromFlatShortcut(gid, s, idx, undefined)),
    });
  }
  return groups;
}

function buildItemFromFlatShortcut(
  groupId: string,
  s: ConfigurableShortcut,
  idx: number,
  def: ShortcutGroupDef | undefined,
): ShortcutItem {
  // 找 builtinKey：内置 def 中按 label 匹配，能匹配上则 key = `${groupId}/${matchIdx}`
  let builtinKey: string | undefined;
  if (def) {
    const m = def.items.findIndex((it) => it.label === s.label);
    if (m >= 0) builtinKey = `${groupId}/${m}`;
  }
  return {
    id: `${groupId}/migrated-${idx}`,
    label: s.label,
    data: s.data,
    enabled: s.enabled,
    desc: s.desc,
    builtinKey,
  };
}

export function migrateCommandsToTree(
  flat: ConfigurableCommand[] | undefined,
): CommandGroup[] {
  if (!Array.isArray(flat) || flat.length === 0) {
    return buildDefaultCommandGroups();
  }
  const buckets = new Map<string, ConfigurableCommand[]>();
  for (const c of flat) {
    const g = typeof c.group === 'string' && c.group.length > 0 ? c.group : 'custom';
    let bucket = buckets.get(g);
    if (!bucket) {
      bucket = [];
      buckets.set(g, bucket);
    }
    bucket.push(c);
  }
  const groups: CommandGroup[] = [];
  const seen = new Set<string>();
  for (const def of COMMAND_GROUPS) {
    const bucket = buckets.get(def.id);
    if (!bucket) continue;
    seen.add(def.id);
    groups.push({
      id: def.id,
      title: def.title,
      desc: def.desc,
      builtinKey: def.id,
      items: bucket.map((c, idx) => buildItemFromFlatCommand(def.id, c, idx, def)),
    });
  }
  for (const [gid, bucket] of buckets) {
    if (seen.has(gid)) continue;
    groups.push({
      id: gid,
      title: gid,
      items: bucket.map((c, idx) => buildItemFromFlatCommand(gid, c, idx, undefined)),
    });
  }
  return groups;
}

function buildItemFromFlatCommand(
  groupId: string,
  c: ConfigurableCommand,
  idx: number,
  def: CommandGroupDef | undefined,
): CommandItem {
  let builtinKey: string | undefined;
  if (def) {
    const m = def.items.findIndex((it) => it.label === c.label);
    if (m >= 0) builtinKey = `${groupId}/${m}`;
  }
  return {
    id: `${groupId}/migrated-${idx}`,
    label: c.label,
    command: c.command,
    enabled: c.enabled,
    autoSend: c.autoSend,
    desc: c.desc,
    builtinKey,
  };
}
