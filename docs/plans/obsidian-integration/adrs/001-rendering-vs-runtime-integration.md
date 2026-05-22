# ADR-001:渲染集成 vs 运行时集成 — 两类「集成」概念并列

## 状态

已采纳(2026-05-22)

## 上下文

`backend/src/integrations/` 现有的「集成」概念专指**运行时 CLI hook 集成**:

- 接口面:`detect(spawn ctx)` / `prepareSpawn(args)` / `onHookPayload(payload)` / `shutdown()`
- 生命周期:绑定到 PTY 进程,spawn 时识别 + hook 注入 + 进程结束时清理
- 激活模型:**单选** — `IntegrationsPrefs.forceModule` 控制同一时刻激活哪一个模块,各模块互斥
- 当前实现:`claude-code` 是唯一具体模块

引入 Obsidian markdown 渲染时,自然想到"也是一种可开关、可热插拔的扩展",但**强行套用上述接口会让概念漂移**:

| 维度 | 运行时集成 | Obsidian 渲染 |
|---|---|---|
| 触发 | spawn 时按命令名识别 | 打开文件时按扩展名/内容判定 |
| 激活粒度 | 整个 PTY 会话 | 单次文件预览 |
| 并发 | 单选(forceModule) | 可与其它渲染集成同时启用 |
| 生命周期 | 进程级 | UI 组件级 |
| 副作用面 | 写 PTY env / args,影响真实进程 | 修改 react-markdown plugin 列表 |
| `detect` 语义 | "这个命令是不是 Claude Code" | (不适用 — markdown 集成总是想跑 .md) |

如果硬套同一接口,渲染集成会被迫实现一堆**总是返回 fixed 值**的方法(`detect` 永远 true、`prepareSpawn` 永远 null、`onHookPayload` 永远 `[]`),抽象成本高于收益。

但同时,用户视角下二者很相似:都可开关、都有子选项、都属于"扩展 ATR 与外部生态的对接"。设置面板里把它们**作为不同分类共存**,UX 上是合理的。

## 决策

**把「集成」概念从单一的"运行时"拓宽为双层**:

```
集成 (Integration)
├── 运行时 (Runtime)  ── 进程生命周期 hook,Integration 接口,单选
│   └── Claude Code (现有)
└── 渲染 (Rendering)  ── 文件预览管线,无统一运行时接口,多选
    ├── Markdown
    └── Obsidian
```

具体落地:

1. **数据结构**:`IntegrationsPrefs` 加 `rendering?: { markdown?, obsidian? }` 字段,与现有 `enabled` / `forceModule` / `perModule` 平行
2. **`forceModule` 仅作用于运行时集成**(其语义本来就是"选哪个 CLI hook 模块",对渲染集成无意义)
3. **不引入"渲染集成统一接口"**:Markdown 和 Obsidian 各自直接实现,不为一个未来的"第三种渲染集成"预先抽象。YAGNI
4. **设置面板 `IntegrationsSettings.tsx` 分两组 section**(`运行时` / `渲染`),用 `<h3>` + 一行 hint 区分

## 拒绝的替代方案

### 方案 A:把 Obsidian 也实现为 `Integration` 接口

- 强行套用 `detect`/`prepareSpawn` 接口,所有方法 stub。代码冗余,概念漂移
- `forceModule = 'obsidian'` 这个组合无语义(它不阻止 Claude Code 同时跑,也不像 Claude Code 在 spawn 时被识别)
- 后续读 ts 类型的人会困惑"为什么这个集成的 detect 永远返回 true"

### 方案 B:不重构,Obsidian 开关挂在 DisplaySettings(同现有 markdownPreview)

- 跟 Claude Code 集成的位置不对称,用户找不到
- "渲染相关功能模块"本质上跟"运行时 CLI 模块"是同类用户决策(都是"我要不要这个扩展")
- 后续若加 Mermaid / PlantUML / 自定义代码块语言增强,会无处可放

### 方案 C:不区分二者,所有集成放一个 flat 列表

- UI 上 `Claude Code` / `Markdown` / `Obsidian` 平铺
- 缺点:`forceModule` 这种单选机制在 flat 列表里语义混乱(用户疑问"我能只选 Obsidian 而不选 Markdown 吗?")
- 双分组让单选/多选行为明确

## 后果

**正向**:
- 概念清晰,UI 自然引导
- 未来加新运行时集成(gemini-cli / aider)或新渲染集成(mermaid / plantuml)各自归位,无 schema 改动
- 数据结构与代码组织对齐(`backend/src/integrations/` 仍是运行时;前端 `files/markdown/obsidian/` 是渲染)

**负向**:
- 用户教育成本(原本只有"集成 = Claude Code",现在概念扩了)— 用 CHANGELOG 与设置面板 hint 文案缓解
- 数据迁移(`display.markdownPreview` → `rendering.markdown.enabled`)有 3 个 minor 的双写窗口

**重新审视触发条件**:
- 出现第二个运行时集成 + 第二个渲染集成时(各 2 模块),回看是否需要把双层结构再抽象;在此之前不改
