# ADR-002:Obsidian 强依赖 Markdown 集成 — 子开关与依赖关系

## 状态

已采纳(2026-05-22)

## 上下文

引入 Obsidian 渲染集成后,跟 Markdown 集成的关系有三种可选:

1. **独立**:Obsidian 关 Markdown 也开 → 怎么处理 .md?Obsidian 开 Markdown 关 → 同问
2. **强依赖**:Markdown 是 Obsidian 的前置条件,Markdown 关 → Obsidian 自动失效
3. **互斥替换**:Obsidian 开 = Markdown 关(Obsidian "替代" Markdown)

Obsidian 渲染的本质 = 在 Markdown 渲染管线上**叠加** plugin。它没有独立的渲染路径 — 不存在"只渲染 frontmatter 头部但正文用纯文本"这种合理形态。

Markdown 子开关关闭时,`.md` 走 TextPreview 路径(代码高亮),`.md` 在这条路径下是逐行文本 — react-markdown 根本没跑,所有 Obsidian plugin 也无处可挂。

## 决策

**Obsidian 强依赖 Markdown**:

```
effective.markdown  = rendering.markdown.enabled
effective.obsidian  = effective.markdown && rendering.obsidian.enabled
```

具体落地:

1. **存储不强改**:用户 `rendering.obsidian.enabled` 值始终独立保存,即使 Markdown 关闭也不强改为 false。这样用户重开 Markdown 时,Obsidian 自动恢复到他原先的选择
2. **UI 灰显 + hint**:Markdown 关闭时,集成面板的 Obsidian section `aria-disabled` + opacity 0.5 + 详细按钮不可点 + 一行 hint "需要先启用 Markdown"
3. **渲染层用 effective**:`MarkdownPreview.tsx` 内部以 `effective.obsidian` 决定是否挂 obsidian plugin,而非读原始 `rendering.obsidian.enabled`

## 拒绝的替代方案

### 方案 A:独立(Obsidian 关 Markdown 开仍尝试渲染)

- 不存在"只渲染头部"的合理实现 — 一旦走 TextPreview,后续都是逐行文本,Obsidian plugin 无处挂
- 用户预期不清晰:"我关了 Markdown 为什么 Obsidian 还显示"

### 方案 B:互斥(Obsidian 替换 Markdown)

- 实现复杂:Obsidian 内部要重新实现一遍基础 markdown 解析,而 Obsidian 的扩展 plugin 本来就 build on top of react-markdown
- 用户心智:"我要 frontmatter 但不要 wikilink" 这种诉求难表达 — 实际上正是 5 个子开关要解决的事
- 跟生态实践不符 — 所有 `remark-obsidian-*` plugin 都是叠加在 remark 基础上的

### 方案 C:Obsidian 开自动开 Markdown(级联)

- 让 Markdown 开关变成"伪开关" — 看似独立但被 Obsidian 强制拉开,用户困惑
- 用户可能就是想"我有 .md 但不想要任何 Markdown 渲染"(纯文本党),自动开 Markdown 违反意愿

## 后果

**正向**:
- 语义清晰可解释:"Obsidian 是 Markdown 之上的扩展层"
- 实现简单:`effective.obsidian` 一行 derive
- 用户存储不损坏:Obsidian 子开关值在 Markdown 关闭期间被保留,重开后恢复

**负向**:
- 用户初次发现 Obsidian 灰显时需要看 hint 才理解(改不了,这是真实依赖关系)
- 设置面板要引导 — Obsidian section 加文案"需要先启用 Markdown"是必要的,不只是装饰

**回退**:
- 若实测发现"Markdown 关 + Obsidian 开"是常见诉求(目前判断不会),可以考虑实现 TextPreview 内的极简 frontmatter 隐藏(只 strip `---YAML---` 块,不渲染表),这是无需改本 ADR 的扩展点
