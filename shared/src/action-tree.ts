/**
 * Action tree（shortcuts / commands 的嵌套树 schema）
 *
 * 与扁平 ConfigurableShortcut[] / ConfigurableCommand[] 并存：
 *  - 扁平结构（旧）→ 仍用作 PTY 消费层（Toolbar / InstanceView 按 enabled 过滤后发到终端）
 *  - 嵌套结构（新）→ 用作设置面板的 CRUD 数据源（增删改查分组与项）
 *
 * source of truth = 嵌套结构。flatten() helper 把嵌套结构折成扁平给消费层用。
 *
 * 设计要点：
 *  - 每个分组与每个项都有稳定 id（用户分组 / 用户项用 UUID；内置分组与内置项
 *    用稳定字符串 id，便于 builtinKey 反查默认值）
 *  - 内置项保留 builtinKey（如 "common/esc"）让"重置为默认"能找到原始值
 *  - 用户删除内置组 / 改了 title / 改了 desc 都被尊重，不会被 normalize 回滚
 *
 * 与 ADR-012 配套使用，见
 *   docs/plans/open-claude-remote-clone/adrs/012-shortcuts-commands-nested-tree.md
 */

// ─────────────────────── 类型 ───────────────────────

/** 一条快捷键项（终端下方按钮，点击 data 直接发到 PTY） */
export interface ShortcutItem {
  /** 项的稳定唯一 id；用户项 = UUID，内置项 = 'common/esc' 这种 */
  id: string;
  /** 按钮显示名 */
  label: string;
  /** 发送的数据，可含转义如 \x1b 表示 ESC */
  data: string;
  /** 是否启用（disabled 项不会在 Toolbar 渲染） */
  enabled: boolean;
  /** 可选描述，按钮 title + 设置面板说明 */
  desc?: string;
  /**
   * 内置项的稳定 key（如 "common/esc"）。
   * 用户从内置项复制 / 修改后保留此字段 → "重置为默认"能反查 BUILTIN 表恢复。
   * 用户全新建项不带 builtinKey
   */
  builtinKey?: string;
}

/** 一组快捷键 */
export interface ShortcutGroup {
  /** 分组稳定唯一 id；用户分组 = UUID，内置分组 = 'common' / 'vim' 等 */
  id: string;
  /** 分组显示名（用户可改） */
  title: string;
  /** 分组说明（用户可改），不传 = 不显示 */
  desc?: string;
  /** 该分组的项；顺序即渲染顺序 */
  items: ShortcutItem[];
  /**
   * 是否曾作为内置分组（'common' / 'vim' 等）。让 UI 在"还原默认"时知道
   * 该不该提示"会丢失你对此分组的修改"。用户新建分组不带此字段
   */
  builtinKey?: string;
}

/** 一条命令项（终端下方命令选择器，点击填入或自动发送） */
export interface CommandItem {
  id: string;
  /** 按钮显示名 */
  label: string;
  /** 命令文本，autoSend=true 时直接发送，false 时填入输入框等用户编辑 */
  command: string;
  enabled: boolean;
  /** true=点击直接发送（默认），false=填入等待编辑 */
  autoSend?: boolean;
  desc?: string;
  builtinKey?: string;
}

/** 一组命令 */
export interface CommandGroup {
  id: string;
  title: string;
  desc?: string;
  items: CommandItem[];
  builtinKey?: string;
}

// ─────────────────────── flatten / 反扁平化 ───────────────────────

/**
 * 把分组嵌套结构折扁。在每条 item 上注入 `group` 字段（= 所属 group.id）。
 * 给现有消费层（Toolbar / InstanceView）继续用扁平协议。
 */
export function flattenShortcuts(
  groups: ShortcutGroup[],
): Array<ShortcutItem & { group: string }> {
  return groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));
}

export function flattenCommands(
  groups: CommandGroup[],
): Array<CommandItem & { group: string }> {
  return groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));
}

// ─────────────────────── 分组元数据 ───────────────────────

/**
 * 单个分组的元数据条目。
 *
 *  - id：分组 id（内置 'common' 等 / 用户分组 UUID）
 *  - title：用户起的标题；不传 = 沿用内置 title
 *  - desc：用户起的描述；不传 = 沿用内置 desc
 *  - hidden：当前不实现，留给未来；删除直接从 entries 里移除并把扁平里属于该
 *    分组的项一并删掉
 */
export interface GroupMetaEntry {
  id: string;
  title?: string;
  desc?: string;
}

export interface ActionGroupMeta {
  /**
   * shortcuts 的分组顺序与 title 覆盖。
   * entries 顺序 = 用户期望的渲染顺序；entries 里没出现的分组按内置默认顺序追加在尾部
   */
  shortcuts?: GroupMetaEntry[];
  commands?: GroupMetaEntry[];
}

// ─────────────────────── id 生成 ───────────────────────

/**
 * 生成一个稳定的随机 id（不依赖 crypto.randomUUID 以兼容旧浏览器 / SSR）。
 * 格式：`${prefix}-${timestamp36}-${random36}`，长度 24 左右。
 */
export function makeActionId(prefix: 'g' | 'i'): string {
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${r}`;
}
