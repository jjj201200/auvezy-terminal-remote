# S5 · Inline Syntax

- ✅ `remarkObsidianInline` 自写 plugin(==/%%/#tag/^id 4 种)
- ✅ `#tag` 首字符必 letter,排除 `#123` / `url#frag`(对齐 Obsidian 实际行为)
- ✅ `^block-id` 仅行尾,字符集 `[a-z0-9-]`(Obsidian 规范);带 `data-block-id` 属性
  供 S6b anchor-bus scrollIntoView 定位
- ✅ enabled=false 整 plugin no-op,原文保留
- ✅ 父节点白名单(paragraph/listItem/blockquote/tableCell/heading)— 跳 link/code/
  emphasis/strong 等已是 inline 上下文的位置,避免误识别字面字符
- ✅ 单测 12 用例全过(highlight 2 + comment 2 + tag 5 + block-id 3)

实现选型:用 `emphasis` 节点作 hast 载体 + `data.hName` 重写 tag 为自定义元素,
保留 `data.hProperties.className` 让 plugin 直接写视觉样式 class。组件层只决定
DOM 结构(`<mark>` / `<span>` / null for comment)。

下一步:S6 wikilink(前后端,batch 3 起点)。
