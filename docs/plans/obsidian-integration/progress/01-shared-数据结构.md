# S1 · shared 数据结构 + 迁移

- ✅ 扩 IntegrationsPrefs.rendering 类型与 DEFAULT_INTEGRATIONS(S1-1)
- ✅ ensureDefaultUserConfig 双写迁移:旧 display.markdownPreview → 新 rendering.markdown.enabled(S1-2)
- ✅ 单测覆盖 legacy / new / partial 三种 case(28 个 defaults.test 全过)

旧 `display.markdownPreview` 类型与 `DEFAULT_DISPLAY.markdownPreview` 默认值
保留(S2-4 之后 UI 不再读写,但 normalize 仍读 — 双写窗口 3 个 minor)。

下一步:S2 集成面板 UI 改造。
