# S7 · Embed

- ✅ `classify()` → 5 类 + unsupported
  - image:.png .jpg .jpeg .gif .webp .svg → `<img>`
  - md:.md .markdown → 折叠 details + 动态 import MarkdownPreview 递归渲染
  - pdf:.pdf → `<iframe>` 全宽 600px + 外链
  - audio:.mp3 .wav .ogg .flac → `<audio controls>`
  - video:.mp4 .webm .mov → `<video controls>`
- ✅ `EmbedDispatch` 主组件 — resolveLink 解析 → 按 kind 分发到 5 子组件
- ✅ `EmbedAncestorsProvider` Context — 沿递归路径传 `Set<resolvedPath>`
- ✅ 循环检测 + 硬深度 `EMBED_DEPTH_LIMIT=5`
- ✅ md embed 默认折叠 + 动态 import MarkdownPreview 避免循环依赖
- ✅ 子开关关闭占位 `📎 ![[...]]` + tooltip + 不发请求
- ✅ MarkdownPreview 顶层 EmbedAncestorsProvider 包,初始 set = `{自己 path}`
  防自指 embed 无限递归

实现选型说明:`<iframe>` / `<audio>` / `<video>` 的 src 都走 `/api/files/raw`
(broker 系统级,复用既有 auth + workdir-policy 校验)。

下一步:S8 收口(清理 + smoke + CHANGELOG)。
