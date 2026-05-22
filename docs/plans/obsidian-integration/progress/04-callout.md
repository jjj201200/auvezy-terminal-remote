# S4 · Callout 13 类

- ✅ S4-1:callout-types.ts 13 主类 + 14 别名(summary/tldr/hint/important/check/done/help/faq/caution/attention/fail/missing/error/cite) + 5 tone(info/success/warn/alarm/muted)
- ✅ S4-2:`remarkObsidianCallout` plugin
  - 识别 `> [!type](+|-)?\s*<title>` 首行
  - 大小写不敏感(正则 `i` flag)
  - 别名 + 主 kind 归一(`resolveCalloutKind`)
  - `+` 默认展开可折叠 / `-` 默认折叠 / 无 → 非折叠(aside)
  - 未知类型 → 不动 mdast 节点,留作普通 blockquote
  - enabled=false 整 plugin no-op
- ✅ S4-2:`CalloutBlock` 组件
  - `none` → `<aside>` + header + body
  - `open` / `closed` → `<details>` + `<summary>` + body(CSS ::before 自绘箭头)
  - 自定义 title 优先,否则用 i18n `obsidian.calloutXxx` 默认
- ✅ S4-2:`callout.module.scss` 5 tone 边框色 + details summary 折叠样式
- ✅ 单测 26 用例全过:13 kind + 4 alias + 2 case + 3 collapsible + 2 title + 2 fallback
- ✅ 接入 obsidian/index.tsx:`buildObsidianBindings` 新增 callout plugin + components

旧 5 类 GFM Alert SCSS(`MarkdownPreview.module.scss` 内 `.alert*`)已经孤立 —
S8 收口时清理。

下一步:S5 inline syntax (==/%%/#tag/^id)。
