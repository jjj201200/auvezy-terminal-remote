# wikilink-modal-stack 总览

## 目标
1. wikilink 跨文件预览叠加(不是替换),返回保留阅读位置
2. 同文件不重复堆叠,环检测时把已有层"提到视觉顶"
3. 深栈提供"全部关闭" + 栈视图(Recent Apps 风)出口

## 完成阶段

### S1 — ModalStack 基础设施(`s1-implementation.md`)
- `topRank` 决定视觉顺序;`bringToTop(id)` 改 topRank 不动数组位置
- `group` 字段做批量分组(与 kind 互补);`popGroup(g)` 一键关一组
- `find(predicate)` 按 meta 谓词查找,供环检测
- `ModalRenderContext` 新增 `activatedSeq` + `groupSize`,供 render 函数决定 UI 与触发副作用
- 单测覆盖 bringToTop / find / popGroup / activatedSeq / groupSize(8 个新用例,共 20)

### S2 — wikilink 入口 + UI 整合
- `useFilePreviewPusher` 新增:无 kind 叠加 + 环检测 + 命中则 bringToTop
- `useFilePreviewPresenter` 保留(FileBrowser 入口单例),也接 group + meta + onCloseAll + onShowStack
- `FilePreviewSheet` headerExtra 加 IconStack2(栈视图) + IconCircleX(全部关闭),group 深度 ≥ 2 时显示
- "全部关闭"走 `useConfirm({ tone: 'danger' })` 二次确认
- `PreviewStackView` 新组件:纵向卡片列表(Recent Apps 风),点卡 = bringToTop + 关本视图,横向 swipe>80px 关单层
- `useModalStackGroup(group)` hook:订阅 group state,栈视图响应栈变化重渲染
- MarkdownPreview 接 `activationSeq`,bringToTop 后重跑 anchor scrollIntoView

### S3 — 视觉与交互打磨
- `BrailleSpinner` 共享组件(`⣾⣽⣻⢿⡿⣟⣯⣷` 8 帧,accent 磷光绿 + phosphor-glow,sm/md/lg);用于 FileBrowser 列表 loading / MarkdownPreview / Suspense fallback
- FileBrowser 列表 500ms 后才显示 loading 遮罩,inert 阻挡误点
- bringToTop 触发 fade-in/fade-out(file-preview group,320ms cubic-bezier);will-change:opacity 防合成器跳帧
- 全屏 sheet 隐藏 vaul Drawer 顶部拖拽手柄(`hideDragHandle`)

### S4 — 结构性重构(`s4-structural-refactor.md`)

**问题诊断**:ModalStack 与 Radix Dialog 抢同一份 modal 语义,产生反复 hack(pointer-events 注入、scrollLock lockStack、focus trap 重叠)。最根本症状:bringToTop 后新视觉顶 layer **鼠标滚轮失效**(react-remove-scroll 全局 lockStack 只允许"最后 push 的"实例处理 wheel,bringToTop 不重 mount → 永远不在 lockStack 顶)。

**重构**:
- Radix Dialog / vaul Drawer 永久 `modal={false}`,降级为"纯渲染 + 动画 + a11y 工具"
- backdrop 由 Sheet 自画(div fixed inset:0),不再用 Dialog.Overlay(modal=false 时 Radix 不渲染)
- Sheet 内 DOM id 改 useId() 派生唯一值,props.id 降为 `data-sheet-id`(防 multiple FilePreviewSheet 叠加时 id 冲突)
- 全屏 sheet 加 `hideBackdrop` prop
- 删除所有 pointer-events hack(contentInteractiveStyle / CSS !important 兜底)
- 删除 `nonModal` prop 后又删(经历"显式 nonModal" → "默认 nonModal=true" → "彻底不暴露,永久 nonModal" 三步)

### S5 — 杂项修复
- useViewportFix:删除 kbLayout 路径(meta viewport 是 resizes-visual,layout 不会缩;窗口缩放被误判为键盘 + baseline 不更新导致 `--vv-bottom` 卡死)
- MarkdownPreview SCSS:`--color-bg-elev`(alpha 0.5)在 modal `--color-bg` 不透明背景上几乎不可见 → 改用 `--color-bg-hover`(inline code / kbd / pre / th / katex / errorState / task checkbox);`hr::after` 改 `--color-bg` 才能真遮线
- `.root code` base 规则替代 `:not(pre)>code`,裸 code / 嵌套 inline code 都拿到样式;加 `white-space: normal` 兜底
- fenced code `.line-content` `white-space: pre` → `pre-wrap` + `overflow-wrap: anywhere`,长行换行(Obsidian/GitHub 风格)
- 全部 Sheet 底色统一从 `--color-bg-elev` 改 `--color-bg`(不透明),所有 modal 视觉一致

## 验证

- 单测:`pnpm vitest run` 139/139 通过
- 类型:`pnpm exec tsc --noEmit` 干净
- 手动 smoke:
  - vault 内 A.md → [[B]] → [[C]] → [[A]],栈深 3,A 在视觉顶,B/C 滚动位置保留
  - esc 关 A → 回到 C(原阅读位置)
  - 栈视图(IconStack2)显示 3 张卡,点卡 bringToTop + 关本视图,横向 swipe 关单层
  - "全部关闭"(IconCircleX)走 confirm,确认后关掉整个 group(包括 FileBrowser 入口那层)
  - 鼠标滚轮在所有 sheet 内可用(重构后已修)
  - 窗口缩放 `--vv-bottom` 不卡死

## 关键架构决策(本计划独有,不在其它 plan)
1. **ModalStack 接管 modal 语义,Radix/vaul 只做渲染**:这是后续所有 sheet 行为(滚动、focus、外部点击)的根基
2. **bringToTop 不重 mount**:scrollTop / state / 嵌入的 React tree 全保留 — 这是"wikilink 切换不丢阅读位置"的唯一可能实现
3. **kind = 单例语义;group = 批量语义**:两者正交,允许"同 group 多个共存 + 整组操作"
