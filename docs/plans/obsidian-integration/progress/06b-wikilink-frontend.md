# S6b · Wikilink 前端

- ✅ `resolve-link.ts` client:批量(microtask 合并)+ LRU 500 条 + 网络失败降级 broken
- ✅ `anchor-bus.ts` 模块级 pending 槽位(setPendingAnchor / consumePendingAnchor)
- ✅ `remarkObsidianLink` plugin:识别 `!?[[target(#frag)?(|alias)?]]` → 产出
  `obs-wikilink` / `obs-embed` 节点
- ✅ `WikilinkActive` 组件:发请求 → broken 红虚线 / ambiguous tooltip / 命中蓝色链接
- ✅ `WikilinkDisabled` 组件:子开关关时虚线灰色 + tooltip,不发请求
- ✅ obsidian/index.tsx 接入:子开关在渲染层切两种组件
- ✅ `MarkdownPreview` 改造:
  - 把 `{ instanceId, path }` ctx 传给 `buildObsidianBindings`
  - heading h1-h6 components 注入 `data-heading-id={slugify(text)}`
  - 渲染完成后 consume pending anchor → scrollIntoView
- ✅ slugify 算法对齐 Obsidian:lowercase + 空白→连字符 + 去除非 \w-
- ✅ embed 节点暂用占位渲染(S7 实现 5 类分发)

下一步:S7 embed。
