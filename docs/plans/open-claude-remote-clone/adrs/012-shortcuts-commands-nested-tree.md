# ADR-012: shortcuts / commands 改为用户可改的嵌套树

## 状态

已接受（2026-05-09）

## 背景

0.5.x 之前 `UserConfig.shortcuts` 与 `UserConfig.commands` 是扁平数组，每项靠
`group: ShortcutGroupId` 字段引用代码里写死的内置分组（`SHORTCUT_GROUPS` /
`COMMAND_GROUPS`）。导致：

1. 用户**不能新建分组**——只能在内置分组里勾选启用 / 自定义少量条目落到 `'custom'` 组
2. 用户**不能改分组标题/描述**——内置 title/desc 是中文写死的
3. 用户**不能删 / 隐藏** 不用的内置分组（vim/tmux 用户可能完全用不到对方）
4. UI 把分组当只读列表渲染，没有 CRUD 概念，加新功能（拖拽、隐藏、还原）时
   "数据结构 / UI 模型 / 默认值" 三处都要凑合

需要一次结构化重构：让分组本身也是用户数据，UI 围绕 CRUD 展开。

## 决策

把 shortcuts 与 commands 的 schema 改成**嵌套树**：

```ts
interface UserConfig {
  shortcuts?: {
    groups: ShortcutGroup[];
  };
  commands?: {
    groups: CommandGroup[];
  };
}

interface ShortcutGroup {
  id: string;             // 用户分组用 UUID；内置分组用稳定 id（如 'common'）
  title: string;          // 用户可改
  desc?: string;          // 用户可改
  hidden?: boolean;       // 暂时保留位（当前迭代不实现 hide）；删除直接 splice
  items: ShortcutItem[];
}

interface ShortcutItem {
  id: string;                   // 用户项 UUID；内置项可用 builtinKey 复用
  label: string;
  data: string;                 // 转义字符串，发到 PTY
  enabled: boolean;
  desc?: string;
  /**
   * 内置项的稳定 key（如 "common/esc"）。
   * 用户复制 / 修改后保留此字段 → 设置面板"重置为默认"能找到原始值。
   * 用户新建项不带 builtinKey
   */
  builtinKey?: string;
}
```

`commands` 同构：`CommandGroup { id, title, desc?, items: CommandItem[] }`，
`CommandItem { id, label, command, enabled, autoSend?, desc?, builtinKey? }`。

**所有分组（含原内置分组）一视同仁**：可重命名、可删（带二次确认）、可重排。
首次安装 / 升级时迁移逻辑生成默认 groups（来自代码里写死的 `BUILTIN_*`）。

## 理由

1. **数据语义对齐 UI**：UI 想做 CRUD 的事，schema 就直接是 CRUD 友好结构。
   再加新功能（拖拽、批量启用）不需要再来一轮"扁平 vs 嵌套"的来回变换。
2. **builtinKey 保留可恢复性**：用户改坏内置项（比如把 Esc 的 data 改坏了）
   仍能从 `BUILTIN_*` 表查回默认值还原。删除整个分组后想要回来，可走"恢复
   全部默认"路径——用户接受了"删错难恢复"的成本，但不至于完全无路可退。
3. **迁移友好**：旧扁平结构 `shortcuts: ConfigurableShortcut[]` 在
   `ensureDefaultUserConfig` 里识别 → 按 `group` 字段分桶 → 包装成新的
   `groups: [...]`。已经存了的用户偏好不丢。
4. **前后端解耦**：backend 不关心分组语义，只做 schema 校验 + 落盘。所有
   "默认值生成 / 迁移 / 显示名"都在 shared，frontend 直接消费。

## 后果

- 正面：
  - 设置面板能用统一的 CRUD UI 做分组级与项级编辑
  - shortcuts / commands 复用同一套 UI 模式（两个 tab 视觉一致）
  - 加分类 / 折叠 / 搜索等功能时不再受限于扁平结构
- 负面：
  - 一次破坏性改 schema：旧 ~/.atrrc 需要 normalize 迁移（已规划）
  - JSON 体积变大（每条多一个 id 字段）
  - 重置为默认 vs 删除 vs 隐藏 三个语义对用户需要清晰区分（UI 难点）
- 中性：
  - 内置分组 / 内置项的稳定 id（如 `'common'` / `'common/esc'`）需要冻结，
    后续不能随意改名，否则 builtinKey 失效

## 备选方案

- **保留扁平 + 加 groups 元数据数组**：双源数据需要保持同步，拖拽要同时
  改两份，复杂度翻倍。不选。
- **完全自由（无内置概念）**：迁移成本高，新用户首次进设置面板看到一片空
  无从下手。不选。
