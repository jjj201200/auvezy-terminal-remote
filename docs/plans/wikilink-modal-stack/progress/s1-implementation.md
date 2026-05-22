# S1 — 实施记录

日期:2026-05-23

## 改动文件

- `frontend/src/components/ui/modal-stack/types.ts`
  - `ModalEntryInput` 加 `group?` / `meta?`
  - `ModalEntry` 加 `group` / `meta` / `topRank`
  - `ModalRenderContext` 加 `activatedSeq` / `groupSize`
  - `ModalStackHandle` 加 `bringToTop` / `find` / `popGroup`
- `frontend/src/components/ui/modal-stack/ModalStack.tsx`
  - 全局 `topRankSeq` 单调递增计数器,`Z_INDEX_BASE = 1000`
  - `normalizeEntry` 给新 entry 分配 topRank
  - `bringToTop(id)`:setState 更新对应 entry 的 topRank,数组位置不动
  - `find` / `popGroup` 实现
  - `pop` 改为按 topRank 定义"之上"(原按数组位置)— 这样 bringToTop 后
    esc 只关视觉栈顶
  - esc handler 选 topRank 最大的而非数组末尾
  - `ModalLayerRoot` 加 `zIndex` prop,显式分层,不再靠 DOM 顺序
  - `ModalStackPortal` 计算 `maxTopRank` + `groupCounts`,注入 ctx
- `frontend/src/components/ui/modal-stack/presenters.tsx`
  - 新增 `useFilePreviewPusher`,带 group + meta 环检测
  - `useFilePreviewPresenter` 保留不变(FileBrowser 入口用)
- `frontend/src/components/files/markdown/obsidian/wikilink.tsx`
  - `useFilePreviewPresenter` → `useFilePreviewPusher`(单行替换)
- `frontend/src/components/files/FilePreviewSheet.tsx`
  - 加 `activationSeq` / `onCloseAll` 可选 props
  - headerExtra 拼接 wrap toggle + "全部关闭"按钮
- `frontend/src/components/files/PreviewPane.tsx`
  - `activationSeq` 透传给 MarkdownPreview
- `frontend/src/components/files/MarkdownPreview.tsx`
  - `activationSeq?` prop,anchor useEffect deps 加上
- `frontend/src/components/files/FileBrowserSheet.module.scss`
  - 新增 `.closeAll` 样式(alarm 色 hover)
- `frontend/src/i18n/{messages,en,zh-CN}.ts`
  - 加 `files.previewCloseAll`
- `frontend/src/components/ui/modal-stack/ModalStack.test.tsx`
  - 新增 8 个测试覆盖 bringToTop / find / popGroup / activatedSeq / groupSize

## 验证

- `pnpm vitest run` — 全部 139 测试通过
- `pnpm exec tsc --noEmit` — 无类型错误

## 待手动 smoke

按 design.md §6 集成测试章节,需要在真实 vault 中操作:

1. 启 dev:`atr broker start` + `pnpm --filter ...-frontend dev`
2. 打开一个 .md 文件,做 A → B → C → A 跳转,验证:
   - 栈深 3(A 复用,不变 4)
   - A 在视觉顶时,B/C 仍可见(滚动位置保留)
   - esc 关 A → C 在顶 + 原滚动位置
   - "全部关闭"按钮深度 ≥ 2 时显示,点击关到只剩 FileBrowser
3. 带 anchor 跳转 `[[B#H2]]` 后再 `[[B#H3]]`,验证 bringToTop 后跳新 anchor
