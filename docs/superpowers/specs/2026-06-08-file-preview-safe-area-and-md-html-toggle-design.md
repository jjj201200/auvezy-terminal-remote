# 文件预览：安全区适配 + md/html 源码↔渲染切换

日期：2026-06-08
状态：已确认，待实现

## 背景与目标

两个独立但同属"文件预览界面"的改进：

1. **安全区适配**：主界面靠 `#app` 的 `top: env(safe-area-inset-top)` 让位 iPhone 刘海/动态岛，但文件预览界面没考虑安全区，顶部被刘海遮、底部被 home indicator 遮。
2. **md / html 渲染与源码切换**：md 默认渲染但无法切回源码；html 当前只有 Shiki 源码高亮、没有渲染。要默认渲染、右上角加单个图标按钮切换源码/渲染模式。

## 需求 1：安全区适配

### 根因（已核实）

- 主界面：`_reset.scss` 里 `#app { position: fixed; top: env(safe-area-inset-top, 0px); }` 钉进安全区，所有应用内容自动避开刘海。
- 预览 sheet：`.previewSheet`（`FileBrowserSheet.module.scss`）用 `height: 100dvh; inset: 0; top: 0`，且通过 ModalStack 的 `ModalLayerRoot`（`position: fixed; inset: 0`）渲染。`position: fixed` 相对**视口**定位，portal 渲染脱离 `#app` 文档流 → 完全绕过 `#app` 的 top inset。
- 结果：sheet 铺满整个物理屏幕，header 顶进刘海/动态岛，body 底部内容压到 home indicator 下。

### 方案

只改 `.previewSheet`（全屏预览专用）与 PreviewStackView 的 `.sheet`（同样全屏），**不动**通用 `Sheet` / `ModalStack`——避免影响 settings / confirm 等居中小窗。

- `.previewSheet` 加 `padding-top: env(safe-area-inset-top, 0px)`：把 header 推到安全区下方（与 `#app` 的 top inset 对齐语义）。竖屏锁定（manifest orientation=portrait），left/right inset 不处理。
- `.previewSheet` 的 `.body`（或预览容器底部）补 `env(safe-area-inset-bottom)`：让底部内容（markdown 末行、媒体控件）抬到 home indicator 上方。背景仍用不透明 `--color-bg` 铺满整屏，刘海/indicator 区是干净底色而非黑断层。
- PreviewStackView 的全屏 `.sheet` 同样处理（顶部 + 底部安全区让位）。

### 覆盖范围

text / markdown / image / video / audio 全部预览类型，以及 PreviewStackView 栈视图。

## 需求 2：md / html 源码↔渲染切换

### 已核实事实

- md：`PreviewPane` 已按 `isMarkdownPath(path)` + `mdEnabled` 选 `MarkdownPreview`（渲染）或 `TextPreview`（源码）。渲染是默认，但用户无法切回源码。
- html：后端 `mime-detect.ts` 归 `previewable: 'text'`、lang=`html`，前端落到 `TextPreview` 走 Shiki 源码高亮。当前无渲染路径。前端文件类型判定靠 **path 后缀**（`isMarkdownPath`），不靠 lang。
- 依赖：项目无 DOMPurify；已有 iframe 用法（obsidian embed）。
- header 控件模式：`FilePreviewSheet` 用 `headerExtra` slot 放 wrap toggle / 栈视图 / 全部关闭按钮，图标按钮用 `s.iconAction`。
- 状态记忆：**每次默认渲染** → 不写 prefs，纯组件内 `useState`。
- `isMarkdownPath` 调用点：`FilePreviewSheet.tsx:65`、`PreviewPane.tsx:58`。

### 决策（用户确认）

- 切换按钮形态：**单个图标按钮 toggle**（rendered → `IconCode` 看源码；source → `IconEye` 看渲染）。
- 状态记忆：**每次默认渲染模式**，不持久化。
- html 渲染：**每次打开 html 渲染时让用户选「沙箱模式 / 危险模式」**，不静默记住（符合项目安全红线"显式授权"）。

### 方案

**1. 文件类型判定**（`file-kind.tsx`）
新增 `isHtmlPath(path)`，对齐 `isMarkdownPath`：判 `.html` / `.htm` / `.xhtml`（忽略大小写）。

**2. 视图模式状态**（`FilePreviewSheet.tsx`）
- `const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')`，组件内态，不持久化。
- 仅当 target 是 md（且 mdEnabled）或 html 时，在 `headerExtra` 渲染切换按钮（单图标 toggle，`s.iconAction`）。
- wrap toggle 显示条件调整为：text 且非 md/html，**或** 处于 source 模式（源码模式 wrap 才有意义）。

**3. 渲染分发**（`PreviewPane.tsx`）
新增 prop `viewMode: 'rendered' | 'source'`，分发：

| 文件 | rendered | source |
|---|---|---|
| md（mdEnabled） | `MarkdownPreview` | `TextPreview` |
| html | `HtmlPreview`（新） | `TextPreview` |
| 其它 text | `TextPreview` | `TextPreview` |

**4. HtmlPreview 组件**（新文件 `HtmlPreview.tsx`）
进入 html 渲染模式时**先显示选择卡**，不直接渲染：

```
⚠ 此 HTML 将作为网页渲染
[ 沙箱模式（推荐）]  ← iframe sandbox srcdoc，禁脚本，安全
[ 危险模式 ]          ← iframe sandbox="allow-scripts allow-same-origin" srcdoc，脚本执行
```

- 沙箱模式：`<iframe sandbox srcdoc={raw}>`，不含 `allow-scripts` → 脚本不执行，纯静态渲染，无法读 token / 发请求。
- 危险模式：`<iframe sandbox="allow-scripts allow-same-origin" srcdoc={raw}>` → 页面脚本执行，如实呈现风险。

用 iframe 而非 `dangerouslySetInnerHTML`：即便危险模式，iframe 也给基本 DOM/CSS 隔离（页面样式不污染 app）；"脚本能跑"通过放开 `allow-scripts` 实现。

每次进入 html 渲染都问、不全局记住：安全选择不应被静默记住后在另一文件上沉默生效——与项目安全红线一致。

### 涉及文件

- `file-kind.tsx`：+`isHtmlPath`
- `FilePreviewSheet.tsx`：viewMode 态 + 切换按钮 + wrap 显示条件
- `PreviewPane.tsx`：+`viewMode` prop + html 分发
- `HtmlPreview.tsx`：**新建**
- `FileBrowserSheet.module.scss`：`.previewSheet` 安全区 + HtmlPreview 选择卡 + iframe 样式
- `PreviewStackView.module.scss`：`.sheet` 安全区
- i18n（en.ts / zh-CN.ts / messages.ts）：切换按钮 label、沙箱/危险模式选项文案、html 渲染警告

## 安全说明（可追溯）

CLAUDE.md 有安全红线。本设计在 html 渲染上**保留 iframe 隔离**，不走裸 `dangerouslySetInnerHTML`：
- 默认/推荐是沙箱模式（脚本禁用）。
- 危险模式由用户**每次显式选择**才放开 `allow-scripts`，且仅作用于 iframe 内，不直接访问 app 的 DOM/token。
- 不持久化该选择，避免一次授权在后续文件上沉默生效。
