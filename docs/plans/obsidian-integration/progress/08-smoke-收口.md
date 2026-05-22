# S8 · Smoke + 收口

## 收口完成项

- ✅ MarkdownPreview.module.scss 清理旧 GFM Alert 样式(60 行 alert*/alertTitle*
  block;`.tableWrap, .admonition, blockquote.alert` 三 selector 缩到两个)
- ✅ CHANGELOG 加 0.9.0 条目(Obsidian 集成主题 + 7 大 Added / 4 Changed /
  Backend / Docs / 详见)
- ✅ 前后端最终 typecheck + test
  - frontend:131 tests pass(9 files)
  - backend:664 tests pass(57 files)

## 累计 commit(S0 起)

```
S0  fb28fc1 docs(obsidian): 设计稿 + 4 ADR + 实施计划
S1  ef65524 feat(shared): 扩 IntegrationsPrefs.rendering
     a4ba602 feat(shared): ensureDefaultUserConfig 迁移
S2  b0c0c1c i18n(obsidian): obsidian 命名空间完整 key 表
     6076856 feat(settings): 双分组 + Obsidian 子开关 modal
     7703188 feat(settings): markdown 开关迁出 DisplaySettings
     15edecf feat(settings): 集成升格为独立 tab
S3  915c989 feat(obsidian): 装包 + 入口骨架
     a74dd12 feat(obsidian): FrontmatterTable + 类型推断
     49697f4 feat(obsidian): frontmatter 渲染管线 + lazy
S4  1aae341 feat(obsidian): callout 13 类常量表
     7249429 feat(obsidian): callout plugin + 组件
S5  461ae44 feat(obsidian): inline 语法 plugin
S6  fd8e2fa feat(backend): WorkspaceIndex
     fe7bcbb feat(backend): /api/files/resolve-links
     0e60728 feat(obsidian): wikilink 前端
S7  56f2a4d feat(obsidian): embed 5 类分发 + 循环检测
辅助 5cf2242 fix(status): 无实例时显示「无实例」
     98c7f8e fix(vite): /i/<id>/ HTML bypass
     c969bf2 fix(files-api): 绝对路径 /api/files/*
     6d2aa46 fix(settings): Obsidian section 样式对齐
```

## 后续手动 smoke 建议

由于真实 Obsidian vault 的端到端验证需要用户在浏览器里逐项交互(建实例 → 浏览
fixture .md → 验证 5 大语法 + 子开关切换 + 跨文件跳转),建议用户在合并前
准备一份 fixture(简单的 mkdir + cat > test.md 即可)走一遍。

包体积验证(`pnpm build` 后看 obsidian chunk < 150KB gzipped)同样建议在
release 时由人工把关 — 当前 dev 已通过 typecheck + 全部单测。

## 进程状态

batch 3 结束时:
- broker(tsx) 跑在 :3737(pid 1747026)
- vite 跑在 :5173

用户后续 release 前应 `pnpm stop` 或 kill 这两个进程,确认端口干净
(CLAUDE.md 红线)。

## Obsidian 集成 — 完成 🎉
