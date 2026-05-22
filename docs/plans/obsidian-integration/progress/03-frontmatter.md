# S3 · Frontmatter

- ✅ S3-1:装 js-yaml + remark-frontmatter + unified + 类型(slow but ok,prefer-offline 仍走 npm registry)
- ✅ S3-1:obsidian 模块入口骨架(`frontend/src/components/files/markdown/obsidian/index.tsx`)
- ✅ S3-2:FrontmatterTable 组件 + 7 种类型推断(text/number/checkbox/date/list/link + null fallback)
- ✅ S3-2:tags/aliases/cssclass 强制 array;YAML 解析失败 graceful fallback
- ✅ S3-2:单测 16 用例全过(10 inferType + 6 component)
- ✅ S3-3:`remarkObsidianFrontmatter` plugin:enabled=true → 转 mdast 'yaml' 节点为带 `hName: 'obs-frontmatter'` 的占位;enabled=false → strip
- ✅ S3-3:MarkdownPreview 动态 import obsidian 模块(lazy chunk),合并 remark plugins + components
- ✅ S3-3:删除既有 GFM Alert 实现(`renderBlockquote` / `ALERT_RE` / `stripAlertMarker` / `extractLeadingText` / `cloneElement` import)— 为 S4 callout 让位

旧 GFM Alert 5 类样式 SCSS 暂保留(MarkdownPreview.module.scss),S4 重写 callout 时统一清理。

下一步:S4 callout 13 类。
