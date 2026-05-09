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
  type ActionGroupMeta,
  type GroupMetaEntry,
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
  metaEntries?: GroupMetaEntry[],
): ShortcutGroup[] {
  if (!Array.isArray(flat) || flat.length === 0) {
    if (metaEntries && metaEntries.length > 0) {
      return buildEmptyGroupsFromMeta<ShortcutGroup>(metaEntries, SHORTCUT_GROUPS);
    }
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

  // 2. 输出顺序：
  //    - 优先 metaEntries 顺序（用户拖拽过的顺序）
  //    - 然后内置 SHORTCUT_GROUPS 顺序中没在 meta 出现的
  //    - 最后自定义 group id（出现在 buckets 但既没在 meta 也不是内置）
  const groups: ShortcutGroup[] = [];
  const seen = new Set<string>();

  if (metaEntries) {
    for (const m of metaEntries) {
      const bucket = buckets.get(m.id);
      const def = SHORTCUT_GROUPS.find((g) => g.id === m.id);
      if (!bucket && !def) {
        // meta 引用了一个既无项也非内置的组 → 视为空自定义分组
        groups.push({
          id: m.id,
          title: m.title ?? m.id,
          desc: m.desc,
          items: [],
        });
        seen.add(m.id);
        continue;
      }
      if (!bucket) continue; // 用户曾删空 → 跳过（即使 meta 有也无意义）
      seen.add(m.id);
      groups.push({
        id: m.id,
        title: m.title ?? def?.title ?? m.id,
        desc: m.desc ?? def?.desc,
        builtinKey: def?.id,
        items: bucket.map((s, idx) => buildItemFromFlatShortcut(m.id, s, idx, def)),
      });
    }
  }

  for (const def of SHORTCUT_GROUPS) {
    if (seen.has(def.id)) continue;
    const bucket = buckets.get(def.id);
    if (!bucket) continue;
    seen.add(def.id);
    groups.push({
      id: def.id,
      title: def.title,
      desc: def.desc,
      builtinKey: def.id,
      items: bucket.map((s, idx) => buildItemFromFlatShortcut(def.id, s, idx, def)),
    });
  }
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

/**
 * meta 描述了空分组（用户新建的还没添加项）→ 生成空 items 的占位组。
 * 泛型避免 union return 让调用方拆类型。
 */
function buildEmptyGroupsFromMeta<T extends ShortcutGroup | CommandGroup>(
  entries: GroupMetaEntry[],
  builtinDefs: readonly { id: string; title: string; desc: string }[],
): T[] {
  return entries.map((m) => {
    const def = builtinDefs.find((d) => d.id === m.id);
    return {
      id: m.id,
      title: m.title ?? def?.title ?? m.id,
      desc: m.desc ?? def?.desc,
      builtinKey: def?.id,
      items: [],
    } as unknown as T;
  });
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
  metaEntries?: GroupMetaEntry[],
): CommandGroup[] {
  if (!Array.isArray(flat) || flat.length === 0) {
    if (metaEntries && metaEntries.length > 0) {
      return buildEmptyGroupsFromMeta<CommandGroup>(metaEntries, COMMAND_GROUPS);
    }
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
  if (metaEntries) {
    for (const m of metaEntries) {
      const bucket = buckets.get(m.id);
      const def = COMMAND_GROUPS.find((g) => g.id === m.id);
      if (!bucket && !def) {
        groups.push({ id: m.id, title: m.title ?? m.id, desc: m.desc, items: [] });
        seen.add(m.id);
        continue;
      }
      if (!bucket) continue;
      seen.add(m.id);
      groups.push({
        id: m.id,
        title: m.title ?? def?.title ?? m.id,
        desc: m.desc ?? def?.desc,
        builtinKey: def?.id,
        items: bucket.map((c, idx) => buildItemFromFlatCommand(m.id, c, idx, def)),
      });
    }
  }
  for (const def of COMMAND_GROUPS) {
    if (seen.has(def.id)) continue;
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

// ─────────────────────── 嵌套树 → flat + meta ───────────────────────

/**
 * 嵌套树 → 扁平 + meta：
 *  - flat：每条 item flatten 成 ConfigurableShortcut，注入 group: groupId
 *  - meta：保留分组顺序 + 用户的 title / desc 覆盖（仅当与内置默认值不同时）
 */
export function splitShortcutTree(groups: ShortcutGroup[]): {
  flat: ConfigurableShortcut[];
  meta: GroupMetaEntry[];
} {
  const flat: ConfigurableShortcut[] = [];
  const meta: GroupMetaEntry[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      flat.push({
        label: it.label,
        data: it.data,
        enabled: it.enabled,
        desc: it.desc,
        group: g.id,
      });
    }
    meta.push(buildMetaEntry(g.id, g.title, g.desc, SHORTCUT_GROUPS));
  }
  return { flat, meta };
}

export function splitCommandTree(groups: CommandGroup[]): {
  flat: ConfigurableCommand[];
  meta: GroupMetaEntry[];
} {
  const flat: ConfigurableCommand[] = [];
  const meta: GroupMetaEntry[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      flat.push({
        label: it.label,
        command: it.command,
        enabled: it.enabled,
        autoSend: it.autoSend,
        desc: it.desc,
        group: g.id,
      });
    }
    meta.push(buildMetaEntry(g.id, g.title, g.desc, COMMAND_GROUPS));
  }
  return { flat, meta };
}

/**
 * 给 split 用的 meta entry 构造：仅当 title/desc 与内置默认不同时才写入字段，
 * 让 meta 体积最小（每改一个字段就只多写一个字段）
 */
function buildMetaEntry(
  id: string,
  title: string,
  desc: string | undefined,
  defs: readonly { id: string; title: string; desc: string }[],
): GroupMetaEntry {
  const def = defs.find((d) => d.id === id);
  const entry: GroupMetaEntry = { id };
  if (!def || title !== def.title) entry.title = title;
  if (def && desc !== def.desc) entry.desc = desc;
  if (!def && desc !== undefined) entry.desc = desc;
  return entry;
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
