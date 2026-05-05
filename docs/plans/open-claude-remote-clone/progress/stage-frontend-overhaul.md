# Stage Frontend Overhaul · 设计文档

> 状态：设计阶段（未开工）
>
> 日期：2026-05-05
>
> 输入：用户提出 4 项诉求 ——
> ①清理原作者私货
> ②前端样式大改造（移动端友好、简约）
> ③移动端不应出现页面级滚动（实质：布局不应超出一屏）
> ④快捷键设置里的乱码

---

## §1 范围与目标

### 在范围内

1. **私货清扫（彻底）**
   - 删除 `analysis/upstream/` 整个目录（含 `.tgz` 与解包内容）
   - 删除 `docs/plans/open-claude-remote-clone/design.md` 中 `> **作者**：复刻者` 一行
   - 更新 `.gitignore`，把 `analysis/upstream/` 加入忽略，防止再次导入
   - 不做 git history rewrite（高风险操作，单独决策）
2. **快捷键设置乱码修复**：编辑层加可读转义编解码（§3）
3. **前端样式整体改造**
   - 引入 Tailwind v4 + Radix Primitives + vaul + lucide-react + clsx
   - 改写 `frontend/src/styles/global.css` 为 Tailwind token + utility 体系
   - 字号梯度收紧（10–15px 六档，默认 13px）
   - 全局禁用 emoji（保留按键名 ↑↓←→ 等 Unicode 几何符号；图标统一用 lucide 单色 stroke）
4. **移动端布局根因修复**
   - 用 `100dvh` + `visualViewport` 解决 `100vh` + 地址栏 + 软键盘导致的内容被挤出一屏
   - 快捷键栏单行横向滚动
   - InstanceTabs 折叠为右上角按钮 + sheet（移动端）
   - PushToggle 移入 SettingsModal「通知」分页
   - SettingsModal / CreateInstanceModal 桌面 modal、移动端 sheet（≤768px 切换）

### 不在范围内

- 协议字段（`shared/src/ws-protocol.ts`、`constants.ts`）
- 后端逻辑（`backend/`）
- xterm.js 行为（仅外层容器布局变化，xterm 自身配置不动）
- CLI 命令、安装脚本

---

## §2 私货清扫详细清单

仍要清理的项目（用户要求"清理干净"）：

| 项 | 处理 |
|---|---|
| `analysis/upstream/open-claude-remote-0.1.1.tgz` | 删除 |
| `analysis/upstream/package/` | 删除整个解包目录 |
| `analysis/` 顶层是否保留 | 若仅含 `upstream` 子目录，连同删除；否则只删 upstream |
| `docs/plans/open-claude-remote-clone/design.md:5` `> **作者**：复刻者` | 删除该行 |
| `.gitignore` | 追加 `/analysis/upstream/` |
| `CLAUDE.md` "不复制上游 `analysis/upstream/` 内任何源代码" 提示 | 改为 "不参考任何上游源码（已删除参考材料）" |

不需要清理：

- `mailto:claude-remote@local`（VAPID subject 占位，技术需要，非个人信息）
- `~/.claude-remote/` 目录名（项目自己的运行时目录）

---

## §3 快捷键设置乱码修复

### 根因

`shared/src/defaults.ts` 默认 shortcut 的 `data` 字段是真 ANSI 控制字节：

```ts
{ label: 'Esc',   data: '\x1b',     ... },
{ label: 'Enter', data: '\r',       ... },
{ label: '↑',     data: '\x1b[A',   ... },
```

`ShortcutSettings.tsx` 直接 `<input value={s.data}>`，浏览器无法显示 `0x00–0x1F` / `0x7F` 控制字符 → 看到空白方块或乱码。

### 修法（编辑层 codec）

新增 `frontend/src/utils/escape-codec.ts`：

```ts
/** 把控制字节转为可读转义字符串（用于 input 显示） */
export function encodeForInput(raw: string): string;

/** 上面的逆运算（用于 input onChange 写回 store） */
export function decodeFromInput(s: string): { value: string; warning: string | null };
```

转义规则：

| 字符 | 编码 | 备注 |
|---|---|---|
| `\` | `\\` | 防止用户直接写 `\` 时被误转义 |
| `\x1b` (ESC) | `\e` | 习惯写法，比 `\x1b` 短 |
| `\r` | `\r` | |
| `\n` | `\n` | |
| `\t` | `\t` | |
| 其它 `\x00–\x1F` | `\xHH` | 两位小写 hex |
| `\x7F` | `\x7f` | DEL |
| 普通可打印 | 原样 | |

不支持 `\u`/`\u{}`（避免歧义、Unicode 转义 UI 几乎用不到）。

### 单测

`escape-codec.test.ts` 覆盖：

- 编码：`Esc / Tab / Enter / 上箭头 / 反斜杠 / 普通字符 / 混合`
- 解码：每个反向用例 + 非法转义（如 `\q` `\x1` `\xZZ`）原样保留并返回 warning
- 双向往返：`decode(encode(x)) === x` 对所有上述用例

### UI 改动

- `ShortcutSettings.tsx`：input value 改成 `encodeForInput(s.data)`；onChange `decodeFromInput(rawString)`，warning 时标红边框 + helper text；保存时若仍有 warning，禁用保存按钮
- placeholder 改纯 ASCII：`发送数据（如 \e 表示 ESC，\r 表示回车）`
- 字段右侧加 `text-xs muted` 说明：`支持 \e \r \n \t \xHH`

### 协议层不动

- `shared/src/defaults.ts` 内 `DEFAULT_SHORTCUTS.data` 仍是真控制字节
- 后端不感知 codec，落盘 `config.json` 仍是真字节
- 跨端共享 config / attach 子命令 / 多实例兼容性零成本

---

## §4 技术栈引入与构建

### 新增依赖（frontend/package.json）

| 包 | 版本 | 用途 |
|---|---|---|
| `tailwindcss` | `^4.0` | 样式引擎，零配置 |
| `@tailwindcss/vite` | `^4.0` | Vite 插件 |
| `@radix-ui/react-dialog` | `^1` | Modal 与 sheet 共用底座 |
| `@radix-ui/react-tabs` | `^1` | SettingsModal 内 tab 切换 |
| `@radix-ui/react-switch` | `^1` | toggle |
| `@radix-ui/react-tooltip` | `^1` | 桌面端图标按钮悬浮说明 |
| `vaul` | `^1` | 移动端底部 sheet（drag 手势、橡皮筋） |
| `lucide-react` | `^0.4xx` | 单色 stroke 图标（按发布时最新次版本） |
| `clsx` | `^2` | 条件 className 拼接 |

预估 tree-shake 后总打包增量 ≈ 35–45KB gzip。

### Vite 配置

`frontend/vite.config.ts` 加入 `@tailwindcss/vite` 插件；不改 build target、不引 PostCSS。

### Tailwind 接入

- 新建 `frontend/src/styles/index.css`，内容只有 token + 3 条全局基础规则（其余靠 utility）
- 删除旧 `frontend/src/styles/global.css`（690 行 BEM）
- `main.tsx` import 切换为 `./styles/index.css`
- 保留 `@import '@xterm/xterm/css/xterm.css'`

### 字号梯度

| Token | 字号 | 行高 | 用途 |
|---|---|---|---|
| `text-2xs` | 10px | 14px | 实例 tab 端口号、徽标 |
| `text-xs` | 11px | 16px | 状态栏 pill、快捷键标签、副说明 |
| `text-sm` | 12px | 18px | 设置项主文字、按钮、输入框 |
| `text-base` | 13px | 20px | 默认正文 / 终端输入 |
| `text-md` | 14px | 22px | AuthPage 副标题级 |
| `text-lg` | 15px | 22px | 页面/弹窗标题 |

字重：默认 400；`font-medium`（500）仅用在激活的 tab 与 SettingsModal 主按钮文字；不用 600+。

### 颜色与字体

颜色保持 GitHub Dark 现有 token，字体保持 JetBrains Mono / 系统 sans。

---

## §5 组件抽象（新增 / 改造）

### 新建 `frontend/src/components/ui/`

| 组件 | 实现 | 用途 |
|---|---|---|
| `Sheet` | Radix Dialog（桌面）+ vaul Drawer（移动 ≤768px） | SettingsModal、CreateInstanceModal、移动端实例切换 |
| `Modal` | 桌面分支单独导出 | 不需要移动 sheet 行为的极简弹窗 |
| `IconButton` | `<button>` + lucide 图标 + 触控 ≥44×44（移动） | InputBar 设置、关闭、上滚、实例下拉 |
| `Pill` | 带 `tone-ok/warn/error/muted/accent` 变体 | StatusBar、实例 tab 端口号 |
| `Toggle` | Radix Switch | 设置项 boolean |
| `TextField` | 受控 input + 错误态边框 + helper text | AuthPage、ShortcutSettings、CommandSettings |
| `useMediaQuery` | hook | Sheet 内部判定桌面/移动 |

### 改造现有组件

| 组件 | 变化 |
|---|---|
| `InputBar` | `IconButton` 替换 "⚙ 设置"（lucide `Settings` 14×14）；快捷键栏移动端单行横向滚动；按钮触控 ≥40×32 |
| `StatusBar` | pill 字号降到 `text-xs`；移除冗余 padding |
| `ShortcutSettings` | input 走 escape codec；移动端两行布局（label+data 一行、enable+remove 一行） |
| `SettingsModal` | Radix Dialog + Tabs；新增"通知"分页内嵌 PushToggle；移动端 Sheet |
| `CreateInstanceModal` | Sheet 化 |
| `IpChangeToast` | 去 ⚠；位置上移避开输入栏 |
| `InstanceTabs` | 拆为桌面（顶部 tab）/ 移动（右上角 IconButton + Sheet）两形态 |
| `ScrollToBottomButton` | lucide `ArrowDown`；触控 44×44 |
| `PushToggle` | 移入 SettingsModal "通知" 分页；从 ConsolePage 顶栏移除 |

---

## §6 页面级布局重写

### `ConsolePage` 新结构（移动优先）

```
#app  (flex-col, h-100dvh, overflow-hidden)
└── ConsolePage
    ├── 顶栏 (h-36px, flex, border-b)
    │   ├── [桌面] InstanceTabs (flex-1, overflow-x-auto)
    │   ├── [移动] 实例切换 IconButton + 当前名 (flex-1)
    │   ├── StatusBar (右侧 pill 组, gap-1)
    │   └── Settings IconButton
    ├── 终端区 (flex-1, min-h-0, relative)
    │   ├── TerminalView (absolute inset-0)
    │   └── ScrollToBottomButton (absolute right-3 bottom-3)
    ├── 快捷键栏 (h-32px, flex, gap-1, overflow-x-auto, scrollbar-hide)
    └── InputBar (h-44px, sticky bottom-0, padding-bottom: safe-bottom)
```

变化点：

- 顶栏合并：原 InstanceTabs + StatusBar 两行合一行，省 28px 纵向
- PushToggle 不在顶栏
- InputBar 拆出独立的快捷键栏，便于 sticky 处理
- safe-area 集中：撤销 `#app` 全方向 padding；改为 InputBar `padding-bottom: env(safe-area-inset-bottom)`、顶栏 `padding-top: env(safe-area-inset-top)`、左右安全区给主容器

### `AuthPage` 微调

- 卡片 `max-w-360` → `max-w-320`，`p-24` → `p-20`
- 标题 20px → 15px（`text-lg`），副标题 13px → 11px（`text-xs muted`）
- 输入框 14px → 13px

---

## §7 移动端键盘 / 视口处理

### 核心机制

新增 `frontend/src/hooks/useViewportFix.ts`：

- 监听 `window.visualViewport` 的 `resize` / `scroll`
- 用 CSS 变量 `--app-vh: <visualViewport.height>px` 同步实测高度
- `#app { height: var(--app-vh, 100dvh) }`，回退到 `100dvh`
- 检测键盘弹起：当 `window.innerHeight - visualViewport.height >= 100` 时视为键盘打开，给 `<body>` 加 `data-keyboard="true"`；CSS 利用此 hook 隐藏 ScrollToBottomButton（避免被键盘遮）

### 输入框行为

- focus 时 `inputElement.scrollIntoView({ block: 'nearest' })`，配合 hook 让 InputBar 紧贴键盘上沿
- iOS 防 zoom：`<input>` 视觉字号 13px，但 `index.html` 已 `user-scalable=no`，不会触发自动放大

### 滚动条策略

| 区域 | 滚动 | 滚动条 |
|---|---|---|
| `html, body, #app` | `overflow: hidden` | 无 |
| 终端 (xterm) | xterm 内部滚动 | 桌面可见、移动端隐藏 |
| SettingsModal / Sheet 内容 | 垂直滚动 | 桌面窄滚动条、移动端隐藏 |
| 快捷键栏 / InstanceTabs | 横向滚动 | 全平台隐藏 |

---

## §8 实施分阶段

### Stage A · 基础设施

- 删除 `analysis/upstream/`、清 design.md「作者：复刻者」、更新 `.gitignore` 与 `CLAUDE.md`
- 新增 Tailwind v4 + Radix + vaul + lucide + clsx 依赖
- 建 `styles/index.css`、迁 token、删 `global.css`
- `main.tsx` 切 import
- 验收：`pnpm build` 通过、`pnpm typecheck` 通过、页面能打开

### Stage B · UI primitives

- 实现 `components/ui/` 全部 primitive
- 实现 `utils/escape-codec.ts` + 单测
- 实现 `hooks/useViewportFix.ts`
- 验收：`pnpm test` 全绿；primitives 在简单页面手测通过

### Stage C · 页面重构

- `ConsolePage` 新布局（顶栏合并、快捷键独立行、InputBar sticky）
- `InputBar` / `StatusBar` / `ShortcutSettings` / `CommandSettings` / `SettingsModal` 重写
- PushToggle 迁入 SettingsModal "通知" 分页
- InstanceTabs 拆桌面 / 移动两形态
- IpChangeToast / ScrollToBottomButton / AuthPage 改造
- 全局移除 emoji（4 处：🔔 ⚙ ⚠ 以及 ↓ 文本符号视情况换 lucide）
- 验收：手动 smoke 桌面 Chrome、iPhone Safari 模拟、Android Chrome 模拟

### Stage D · 清理与文档

- 更新 `CHANGELOG.md`
- 写 ADR：`adrs/0011-frontend-stack-tailwind-radix.md`（5 段式：状态/背景/决策/理由/后果）
- 更新 `progress/overview.md`

回滚：每个 Stage 一次 commit，可独立 revert。

---

## §9 验证清单

| 项 | 验证方法 |
|---|---|
| 私货清理彻底 | `git ls-files \| grep -i upstream` 无命中；`grep -r "作者：复刻者" docs` 无命中 |
| 快捷键无乱码 | 设置打开默认快捷键，input 显示 `\e \r \t \e[A` 等可读字符串 |
| 移动端无溢出 | iPhone SE 模拟（375×667）打开页面、点输入框、检查 InputBar 始终可见 |
| 桌面 modal / 移动 sheet | viewport 切宽窄，SettingsModal / CreateInstanceModal 形态正确切换 |
| 无 emoji | `grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]'` 在 frontend/src 内 0 命中（按键名箭头例外） |
| 字号收紧 | 主输入框 13px、状态栏 11px、标题 ≤15px |
| 推送按钮在设置内 | 顶栏不再有推送按钮；SettingsModal 有"通知"分页 |
| 类型与单测 | `pnpm typecheck` 通过；`pnpm test` 全绿（含 escape-codec 新单测） |
| 键盘弹起体验 | 移动端模拟点击输入框，InputBar 紧贴键盘上沿、不被遮 |

---

## §10 决策摘要

| 决策点 | 选定 | 理由 |
|---|---|---|
| UI 风格 | A · 终端工具感（保留 GitHub Dark） | 项目本质是终端工具 |
| 组件库 | Tailwind v4 + Radix + vaul + lucide + clsx | 现有 CSS 变量可直接 `@theme` 消费；Radix 解 a11y；vaul 专做 sheet |
| Push 按钮位置 | C · 移到设置面板"通知"分页 | 多数用户用 LAN HTTP，按钮永远显示"不支持"，浪费视觉 |
| 设置面板形态 | A · 桌面 modal / 移动 sheet | 行业标准 |
| CreateInstanceModal | 同上规则 | 一致性 |
| 移动端滚动条 | A · 修根因（`100dvh` + 内部 flex） | 用户实际诉求是布局不溢出 |
| 快捷键栏移动端 | A · 单行横向滚动 | 紧凑、省纵向 |
| InstanceTabs 移动端 | A · 折叠为右上角按钮 + sheet | 多实例低频，省一行高度 |
| 视觉装饰 | 全局禁 emoji；用 lucide 单色 stroke | 极客感、与 mono 字体一致 |
| 字号 | 6 档梯度，默认 13px | 当前 7 档无层级，普遍偏大 |
| 颜色对比度 | A · 维持现状 | 低风险 |
