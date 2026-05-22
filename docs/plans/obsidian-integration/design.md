# Obsidian 集成 — 设计稿

> **状态**:设计稿 v1
> **日期**:2026-05-22
> **目标版本**:0.9.0(纳入下一个 minor;无 breaking change,有数据迁移)
> **作者**:Drowsy + 咕咕

---

## 0. 一句话陈述

**把 .md 预览升级为完整 Obsidian-flavored 渲染(frontmatter 属性表 / 13 类 callout / wikilink 跳转 / 多类 embed / inline 语法);同时把"渲染相关的功能模块"提升为顶层「集成」分类的一类(与 Claude Code 这类"运行时集成"并列),把现有 `display.markdownPreview` 也迁入其下。**

---

## 1. 为什么要做

### 1.1 用户痛点

- 0.8.0 已经上了 markdown 富文本预览,但**对 Obsidian vault** 体验仍很糟:
  - **每篇笔记顶部 YAML frontmatter** 被 react-markdown 渲染成 `<hr>` + 散文段落,占大半屏且语义全失
  - `==重点==` 显示成 `==重点==` 纯文本
  - `> [!info]` / `> [!todo]` / `> [!success]` 等大部分 callout 类型当成普通 blockquote(我们只识别 GFM Alert 的 5 类)
  - `[[Note]]` / `![[image.png]]` 纯文本,无跳转无嵌入
  - `%%隐藏注释%%` 直接显示出来
  - `#tag` 当成 H1
- ATR 的文件浏览器**以实例工作目录为天然 vault root**,具备**真做 wikilink 跳转 / embed 嵌入**的全部条件 —— 不是"展示样式"而是"真功能"

### 1.2 借此机会重构「集成」概念

`backend/src/integrations/` 当前的"集成"特指**运行时 CLI hook 集成**(detect/prepareSpawn/onHookPayload 接口,目前只有 claude-code)。但用户视角下,**"扩展 .md 渲染管线"也是一种集成** —— 同样可开关、有子选项、可热插拔。

把"集成"概念从单一的"运行时进程 hook"拓宽为**双层**:

```
集成 (Integration)
├── 运行时 (Runtime)  ── 进程生命周期 hook,单选(forceModule 决定激活哪个)
│   └── Claude Code     ── 现有,不动
└── 渲染 (Rendering)  ── 文件预览管线,多选(各自独立 enabled)
    ├── Markdown        ── 既有 display.markdownPreview 开关迁移至此
    └── Obsidian        ── 新增,5 个子开关
```

详见 ADR-001。

### 1.3 明确不做

| 维度 | 决策 |
|---|---|
| 编辑 Obsidian 笔记(只读保持) | ❌ ATR 文件浏览器 0.x 全程只读(见 file-browser ADR-002) |
| Dataview / Templater 等第三方 plugin 语法 | ❌ 仅做 Obsidian 内核语法 |
| Canvas / Excalidraw 渲染 | ❌ |
| 创建/删除/重命名 wikilink 目标 | ❌ |
| Graph view / Backlinks 面板 | ❌ |
| 实时协作 / vault 同步 | ❌ |
| 自定义 callout 类型(用户在 vault CSS 里定义的) | ❌ 仅渲染 13 类内置 |
| Obsidian 的 link format 三选项(shortest/relative/absolute)| ❌ 这是**写入**设置,我们只读 |

---

## 2. 名词

- **Vault root**:对 ATR 而言 = 实例的工作目录(`instance.cwd`)。Obsidian 概念,**不需要 `.obsidian/` 目录存在**也成立
- **Frontmatter / Properties**:文件首部 `---\n...\n---` 之间的 YAML,Obsidian 阅读视图渲染为"属性表"
- **Wikilink**:`[[Note]]` / `[[Note|alias]]` / `[[Note#Heading]]` / `[[Note#^block-id]]`
- **Embed (Transclusion)**:`![[Foo]]`,wikilink 加 `!` 前缀,把目标内联嵌入
- **Callout**:`> [!type] title\n> body`,blockquote 的 Obsidian 扩展,13 种类型 + 多种别名
- **Inline syntax**(本文档简称):`==highlight==` / `%%comment%%` / `#tag` / `^block-id` 四种 inline 级 Obsidian 扩展
- **Block ID**:笔记行尾 `^my-id`(段落)或行单独 `^my-id`(列表/引用块),用于被 wikilink 引用
- **运行时集成 / 渲染集成**:见 ADR-001
- **shortest-path 启发式**:wikilink 短名形态有多个匹配时,选与当前文件**共同前缀目录段数最多**的那个;详见 ADR-003

---

## 3. 架构总览

```
┌────────────────────────── 前端 (frontend/) ──────────────────────────┐
│                                                                       │
│  settings/IntegrationsSettings.tsx (改造)                             │
│  ├─ Runtime 分组                                                      │
│  │  └─ Claude Code (不变)                                             │
│  └─ Rendering 分组 (新)                                               │
│     ├─ Markdown          (从 DisplaySettings 迁移)                    │
│     └─ Obsidian          (新 modal,5 个子开关)                       │
│                                                                       │
│  files/PreviewPane.tsx                                                │
│   └─ if rendering.markdown.enabled                                    │
│      → lazy import MarkdownPreview                                    │
│         └─ if rendering.obsidian.enabled                              │
│            → lazy import files/markdown/obsidian/*  (二级 chunk)      │
│                                                                       │
│  files/markdown/obsidian/  (新目录)                                   │
│  ├─ index.ts             模块元数据 + plugin 组装                     │
│  ├─ frontmatter.tsx      Properties 表(类型推断 + chip / link 渲染)│
│  ├─ callout.tsx          13 类 + 别名 + +/- collapsible + nested      │
│  ├─ wikilink.tsx         active/disabled 两种渲染 + 跳转接线          │
│  ├─ embed.tsx            5 类分发:image / md / pdf / audio / video  │
│  ├─ inline-syntax.ts     remark plugin: ==/%%/#tag/^id               │
│  ├─ resolve-link.ts      调 backend,LRU + 批量队列                   │
│  └─ callout-types.ts     13 类静态表(纯前端常量,不进 shared)       │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  POST /api/files/resolve-links
┌──────────────────────────── backend (broker) ────────────────────────┐
│  api/file-routes.ts (扩展)                                           │
│   └─ POST /api/files/resolve-links  批量 wikilink → AbsPath          │
│                                                                       │
│  files/wikilink-resolver.ts  (新)                                    │
│  ├─ WorkspaceIndex (instance 级单例 + LRU 内存,不持久化)            │
│  │  ├─ build()    懒触发,首次 resolve 时全走 cwd                    │
│  │  ├─ lookup()   {target, fromPath} → ResolveResult                 │
│  │  └─ watch()    fs.watch (rename/unlink) 增量;失败回退 5min 重扫  │
│  └─ shortest-path 启发式 + heading/block ref(共享 markdown parser)  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────── shared/src/defaults.ts ──────────────────────┐
│  IntegrationsPrefs (扩展):                                          │
│    rendering?: {                                                     │
│      markdown?: { enabled?: boolean }                                │
│      obsidian?: {                                                    │
│        enabled?: boolean                                             │
│        frontmatter?, wikilink?, embed?, callout?, inlineSyntax?      │
│      }                                                               │
│    }                                                                  │
│  normalize: 旧 display.markdownPreview → rendering.markdown.enabled  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型

### 4.1 `shared/src/defaults.ts` 扩展

```ts
/**
 * 渲染集成偏好。与运行时集成(forceModule 单选)不同,渲染集成是多选 ——
 * 每个模块独立 enabled,可同时启用。
 *
 * Why 与 perModule 平行而不复用:
 * - perModule 的语义是"该模块自己的细节子开关"(只在 forceModule 选中
 *   该模块时生效),与 enabled 共享激活逻辑;
 * - rendering.* 不参与 forceModule,enabled 直接决定是否激活,语义不同。
 */
export interface RenderingIntegrationPrefs {
  markdown?: { enabled?: boolean };
  obsidian?: {
    enabled?: boolean;
    /** YAML frontmatter 渲染为 Properties 表;关:frontmatter 直接 strip 不显示 */
    frontmatter?: boolean;
    /** [[Foo]] / [[Foo|alias]] 渲染;关:仍识别语法但显示为 disabled 样式 */
    wikilink?: boolean;
    /** ![[...]] 嵌入;关:仍识别但显示为占位框 */
    embed?: boolean;
    /** 13 类 callout(对 GFM Alert 的超集);关:回退到 react-markdown 默认 blockquote */
    callout?: boolean;
    /** ==highlight== / %%comment%% / #tag / ^block-id;关:语法保持原样显示 */
    inlineSyntax?: boolean;
  };
}

export interface IntegrationsPrefs {
  enabled?: boolean;
  forceModule?: 'auto' | 'claude-code' | 'none';
  perModule?: { 'claude-code'?: { events?: Partial<ClaudeCodeEventToggles> } };
  /** NEW */
  rendering?: RenderingIntegrationPrefs;
}

export const DEFAULT_INTEGRATIONS = {
  enabled: true,
  forceModule: 'auto',
  perModule: { 'claude-code': { events: { /* 不变 */ } } },
  rendering: {
    markdown: { enabled: true },     // 等价于旧 DEFAULT_DISPLAY.markdownPreview
    obsidian: {
      enabled: true,                  // 默认开 — 对非 Obsidian 用户也无害
      frontmatter: true,
      wikilink: true,
      embed: true,
      callout: true,
      inlineSyntax: true,
    },
  },
} as const satisfies Required<IntegrationsPrefs>;
```

### 4.2 effective 计算

Obsidian 集成强依赖 Markdown 集成。前端读偏好时:

```ts
const md = prefs.rendering?.markdown?.enabled ?? true;
const obs = md && (prefs.rendering?.obsidian?.enabled ?? true);
//          ^^ markdown 关时 obsidian 直接失效,不需要改写存储值
```

UI 上:Markdown 关闭时,Obsidian section 整体 `aria-disabled` + opacity 0.5,加 hint
"需要先启用 Markdown"。**用户存储的 obsidian.enabled 值不动**,重开 markdown 立刻恢复。

### 4.3 数据迁移

`shared/src/defaults.ts` 的 `ensureDefaultUserConfig` 加 normalize 规则:

```ts
// 兼容 0.8.x:display.markdownPreview === false → rendering.markdown.enabled = false
const legacyMdPreview = rawDisplay?.markdownPreview;
const userMd = rawIntegrations?.rendering?.markdown?.enabled;
const mdEnabled =
  typeof userMd === 'boolean' ? userMd :
  typeof legacyMdPreview === 'boolean' ? legacyMdPreview :
  DEFAULT_INTEGRATIONS.rendering.markdown.enabled;

// 写回新位置;旧字段也保留(不删,3 个 minor 后再清理)
// 不删的原因:旧客户端 PUT config 时仍会带 display.markdownPreview,
// strict normalize 把它 strip 掉会造成"旧版前端保存了 markdown 开关却读不到"。
```

旧字段 `display.markdownPreview` 保留 3 个 minor(0.9 / 0.10 / 0.11),0.12 删除。期间任意一处变更同时写两处,以最严格的(false 优先)为准。

---

## 5. 集成面板 UI

### 5.1 结构

`IntegrationsSettings.tsx` 改造:

```
┌───────────────────────────────────────────────────────┐
│ ☐ 启用集成 (总开关,既有)                            │
├───────────────────────────────────────────────────────┤
│ 识别策略 (既有,只影响运行时集成)                    │
│ [auto] [claude-code] [none]                          │
├───────────────────────────────────────────────────────┤
│ 运行时集成                                           │
│ ─────────────────────────────────────────────────── │
│ Claude Code                              [Active] >  │
│ 在终端跑 claude 时拦截 hook…                         │
├───────────────────────────────────────────────────────┤
│ 渲染集成                                             │
│ ─────────────────────────────────────────────────── │
│ ☑ Markdown                                          │
│ .md / .markdown 文件富文本预览                       │
│                                                      │
│ ☑ Obsidian                              [详细…]    │
│ 在 Markdown 渲染管线上叠加 Obsidian 扩展语法         │
│ (需要先启用 Markdown)                                │
└───────────────────────────────────────────────────────┘
```

两组 header(`运行时` / `渲染`)用 `<h3>` + 一行 hint,跟 GeneralSettings 的小标题样式一致。

### 5.2 Markdown 行

直接 `BoolToggleRow`,无详细 modal。这是把 `display.markdownPreview` 平移过来,**无新选项**。

### 5.3 Obsidian 详细 modal

按 `ClaudeCodeSettingsModal` 风格,5 行 `BoolToggleRow`:

| 子开关 | i18n key | 默认 |
|---|---|---|
| Frontmatter (Properties 表) | `obsidian.toggleFrontmatter` | true |
| Wikilink (`[[...]]`) | `obsidian.toggleWikilink` | true |
| Embed (`![[...]]`) | `obsidian.toggleEmbed` | true |
| Callout (13 类 `> [!type]`) | `obsidian.toggleCallout` | true |
| Inline 语法 (==/%%/#/^) | `obsidian.toggleInlineSyntax` | true |

Modal 顶部 hint:"这些开关在 Obsidian 集成总开关启用时生效。关闭子开关后,对应语法仍**被识别**,但渲染为提示样式而非交互/嵌入"(为 wikilink/embed 这一行为做总说明,避免每行 hint 重复)。

### 5.4 DisplaySettings 清理

移除 `BoolToggleRow markdownPreview`(`DisplaySettings.tsx:478-483`)和相关 i18n key `display.markdownPreview*`。后续打开"显示"tab 看不到它,引导用户去"集成"tab。

发版 CHANGELOG 要写明"Markdown 预览开关已迁移到 集成 → 渲染 → Markdown"。

---

## 6. 渲染管线

### 6.1 plugin 组装

`MarkdownPreview.tsx` 主入口按 effective 子开关动态拼:

```ts
const md = effective.markdown;           // 必须 true,否则根本不走 MarkdownPreview
const obs = effective.obsidian;          // = md && obsidian.enabled

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeRaw, rehypeKatex];

if (obs) {
  // 总开关开 → 永远识别所有 Obsidian 语法(子开关只控制"渲染成什么")
  remarkPlugins.push(remarkFrontmatter);          // 识别 ---YAML---,产出 mdast 节点
  remarkPlugins.push(remarkObsidianCallout);      // 自写,识别 > [!type]+/-
  remarkPlugins.push(remarkObsidianInline);       // 自写,==/%%/#/^
  remarkPlugins.push(remarkObsidianLink);         // 自写,[[...]] 与 ![[...]]
}
```

**Why 子开关不控制 plugin 加载,只控制 components 渲染**:
- wikilink 关时仍要"识别成 wikilink 节点 + 用 disabled 样式"(你的需求 3)→ plugin 必须跑
- 一旦总开关确定,plugin 列表就稳定,React 无需 re-mount ReactMarkdown
- 用 `components.wikilink` / `components.callout` 等做条件渲染,粒度更细且 cheap

**自写 plugin 输出自定义节点(非 raw HTML)**:每个 Obsidian remark plugin 产出
mdast 节点带自定义 `type`(`obsFrontmatter` / `obsCallout` / `obsWikilink` /
`obsEmbed` / `obsHighlight` / `obsComment` / `obsTag` / `obsBlockId`)。这些节点
经默认 mdast→hast 阶段保留 `node.type`,react-markdown 的 `components` 表按
`type` 匹配渲染 — **不**走 `rehype-raw`(后者只处理 raw HTML 字符串,识别不了
自定义节点 type)。`rehype-raw` 仍保留是为 frontmatter 之外的 raw HTML(用户在
markdown 里手写 `<details>` 等)。

### 6.2 chunk 拆分

```
react-markdown 主 chunk   (≈80KB)   只在 rendering.markdown 开时加载
└─ obsidian 二级 chunk   (≈100KB) 只在 rendering.obsidian 开时加载
    ├─ js-yaml          (≈30KB)
    ├─ remark-frontmatter (≈3KB)
    ├─ obsidian/* 自写  (≈15KB)
    └─ KaTeX            ← 仍在主 chunk(数学不属于 Obsidian)
```

代码实现:`MarkdownPreview` 内通过 `lazy(() => import('./markdown/obsidian'))` 加载 obsidian module
聚合点 `markdown/obsidian/index.ts`。React Suspense 给 obsidian plugin 一个 inline fallback(显示 raw markdown 1 帧)。

### 6.3 各 plugin 行为

#### 6.3.1 Frontmatter

remark-frontmatter 识别 `---\nyaml\n---` 输出 `yaml` 节点。我们的 plugin
`remarkObsidianFrontmatter` 把 `yaml` 节点替换为 HAST 自定义节点 `obsFrontmatter`,
携带原始 YAML 字符串。

`components.obsFrontmatter` 用 `js-yaml.load(safeSchema)` 解析,失败显示
"frontmatter 解析失败:<错误>" + 原文(不丢内容)。解析成功生成属性表:

```
┌─────────────────────────────────────────┐
│ ▼ Properties        (3 项)              │  默认展开;localStorage 记折叠状态
├─────────────────────────────────────────┤
│ # tags        [project] [active] [+3]   │
│ 🔗 related    [[Note A]] [[Note B]]    │
│ 📅 created    2026-05-08                │
└─────────────────────────────────────────┘
```

类型推断:
| YAML 类型 | UI 图标 | 渲染 |
|---|---|---|
| `string` | `A` text | 纯文本 |
| `number` | `#` | 数字 |
| `boolean` | `☑` | ✓ / ✗ |
| ISO date 字符串 / Date | `📅` | 本地化日期 |
| `string` 匹配 `[[...]]` | `🔗` | 走 wikilink 组件(继承 enabled/disabled 状态) |
| array | 容器,每项递归推断 | chip 列表 |

`tags` / `aliases` / `cssclass` 三个特殊 key 即使值是 string 也按 array 处理(对齐 Obsidian)。

#### 6.3.2 Callout

完整 13 类(含别名):

| 主类 | 别名 | i18n title | 颜色 token |
|---|---|---|---|
| `note` | (无) | `obsidian.calloutNote` | `--color-info` |
| `abstract` | `summary`, `tldr` | `obsidian.calloutAbstract` | `--color-info` |
| `info` | (无) | `obsidian.calloutInfo` | `--color-info` |
| `todo` | (无) | `obsidian.calloutTodo` | `--color-info` |
| `tip` | `hint`, `important` | `obsidian.calloutTip` | `--color-success` |
| `success` | `check`, `done` | `obsidian.calloutSuccess` | `--color-success` |
| `question` | `help`, `faq` | `obsidian.calloutQuestion` | `--color-warn` |
| `warning` | `caution`, `attention` | `obsidian.calloutWarning` | `--color-warn` |
| `failure` | `fail`, `missing` | `obsidian.calloutFailure` | `--color-alarm` |
| `danger` | `error` | `obsidian.calloutDanger` | `--color-alarm` |
| `bug` | (无) | `obsidian.calloutBug` | `--color-alarm` |
| `example` | (无) | `obsidian.calloutExample` | `--color-info` |
| `quote` | `cite` | `obsidian.calloutQuote` | `--color-muted` |

> **memory 提示:不存在 `--color-danger`,项目 alarm tone 用 `--color-alarm`。已对齐。**

语法识别(正则用 `i` flag,Obsidian 大小写不敏感):

```
^\[!([\w-]+)\]([+-]?)\s*(.*)$
   ^^^^^^^   ^^^^^^   ^^^
   类型 m1   m2:折叠  m3:自定义标题
```

`m2`: 空 = 不可折叠;`+` = 默认展开可折叠;`-` = 默认折叠可折叠。
`m3`: 空 = 用 i18n 默认标题(`obsidian.calloutXxx`);非空 = 用户标题(支持 inline markdown,要走 ReactMarkdown 二级解析)。

嵌套(`> > [!type]`)用 mdast 自然嵌套结构,无需特殊处理。

**替换现有 GFM Alert 实现**:`MarkdownPreview.tsx` 的 `renderBlockquote` / `ALERT_RE` / `stripAlertMarker` / `extractLeadingText` 在 callout plugin 启用时全部不再使用(它们是 13 类的 5 类子集 + 缺折叠)。callout 子开关关闭时,直接 fallback 到 react-markdown 默认 blockquote(**不**回退到 5 类 GFM Alert,因为 callout 关 = 用户明确不要这个语法)。

#### 6.3.3 Wikilink

remark plugin 用正则在 text 节点里切出 `[[...]]`,产出 mdast 自定义节点:

```ts
type WikilinkNode = {
  type: 'wikilink';
  target: string;          // 'Foo' 或 'Foo#H2' 或 'Foo#^id'
  alias?: string;          // |alias 部分
  isEmbed: boolean;        // 是否带 ! 前缀
};
```

正则:`(!?)\[\[([^\[\]\|#]+)(#[^\[\]\|]+)?(?:\|([^\[\]]+))?\]\]`

`components.wikilink` 按 `effective.obsidian.wikilink` 切两种渲染:
- **active**:调 `resolveLink({from, target})` → 拿到 `{resolvedPath, ambiguous?, broken?}`
  - 命中 → `<a href="#" onClick={openFile}>` (调 useOpenFile hook,见 §6.4)
  - ambiguous → 命中第一个 + tooltip "N 个候选"
  - broken → `<span class="atr-wikilink-broken">` 红色虚线
- **disabled**:`<span class="atr-wikilink-disabled">[[Foo]]</span>` 灰色虚线,**不发请求**,tooltip "启用 Obsidian wikilink 子开关以跳转"

Embed `isEmbed=true` 时不走 wikilink 渲染,转给 §6.3.4。

#### 6.3.4 Embed(5 类分发)

按目标扩展名分发:

| 类别 | 扩展名 | 渲染 |
|---|---|---|
| image | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` | `<img src="/api/files/raw?...">` 直接复用现有 raw 端点;支持 `|宽度` 参数 |
| md | `.md` `.markdown` (含 `#heading` / `#^block`) | 递归 fetch + MarkdownPreview(子开关全继承) + 可选 heading/block 切片 |
| pdf | `.pdf` | `<iframe src="/api/files/raw?...">` 全高 600px,带"在新标签页打开"链接 |
| audio | `.mp3` `.wav` `.ogg` `.flac` | `<audio controls>` |
| video | `.mp4` `.webm` `.mov` | `<video controls>` |
| (兜底) | 其它 | "Embed 不支持的类型: .xxx" 占位框 |

**循环检测**:渲染 md embed 时维持一个 `Set<resolvedAbsPath>` 沿递归路径传(React context),命中 set → "循环嵌入: <path>" 占位。深度同时硬上限 5 层(无论是否循环),防极端深嵌套。

**lazy 渲染**:embed md 默认 collapsed,显示 "▶ Embed: notes/foo.md (12 KB)" 一行,点击展开。这避免一篇笔记里多个 embed 一次性递归拉满。**例外**:当文档**只有一个** embed 节点时自动展开(常见的 "包含" 用法)。

**关闭状态**:embed 子开关关 → 显示占位框 "📎 ![[Foo]]" + 灰色样式,不发请求,不递归。

#### 6.3.5 Inline syntax

`remarkObsidianInline` 在 text 节点里切出 4 种语法,产出对应 mdast 节点:

| 语法 | 节点 | 渲染 | 关闭时 |
|---|---|---|---|
| `==text==` | `obsHighlight` | `<mark>` | 保留 `==text==` 原文 |
| `%%text%%` | `obsComment` | 不渲染(返回 null) | 保留 `%%text%%` 原文 |
| `#tag` | `obsTag` | `<span class="atr-tag">#tag</span>` chip | 保留 `#tag` 原文 |
| 行尾/独立 `^block-id` | `obsBlockId` | 不渲染(锚点,目标是被引用) | 保留 `^block-id` 原文 |

**Why "关闭时保留原文"而非"渲染为纯文本"**:`==text==` 这种语法在普通 markdown 里就是字符串,关闭子开关 = 用户不想要这个语法识别 = 应当跟普通 markdown 一致(显示原文) — 与 wikilink/embed 的"识别后用降级样式"是有意区分的差异。原因:
- wikilink/embed 是**结构性占位**,纯文本显示 `[[Foo]]` 视觉上很丑
- inline 语法量更多更碎,把 `==a== ==b== ==c==` 渲染成"灰色 a / 灰色 b / 灰色 c"反而比原文更乱

`#tag` 识别正则:`(?<=^|\s)#([A-Za-z][\w/-]*)`

- 前置必须是行首或空白,排除 `text#frag`、URL `#anchor`、`*#*` 等场景
- **首字符必须是 letter**(`A-Za-z`),后续允许 `\w/-` — 这对齐 Obsidian:`#2026`
  纯数字开头**不算** tag(防止跟 markdown footnote `[^1]` / issue ref `#123` 混)
- 行首 `# ` 不被吃掉,因为 ATX heading 在 markdown 解析阶段已优先识别 `# Heading`,
  到 inline 阶段已是 heading 节点的 children,不再有行首 `#`

`^block-id` 识别正则:`(?:^|\s)\^([a-z0-9-]+)\s*$`(应用在每个 text 节点的尾部)

- Obsidian block id **只允许小写字母、数字、连字符**(对齐其链接规范)
- 必须在行尾(`\s*$`)
- 前置允许行首或空白 — 涵盖"段落尾 `text ^id`"和"独占一行 `^id`"两种形态

### 6.4 wikilink 跳转的"打开另一文件"入口

已有现成入口:`useFilePreviewPresenter`(`FileBrowserSheet.tsx:31`),通过
modal-stack 推一层 FilePreviewSheet。wikilink onClick:

```ts
const presentPreview = useFilePreviewPresenter();
const onClickWikilink = (resolved: string, anchor?: Anchor) => {
  pendingAnchorRef.current = anchor;          // 见下方 anchor 机制
  presentPreview({
    instanceId,
    target: { kind: 'text', path: resolved, name: basename(resolved) },
    wrapLines: false,
  });
};
```

**heading / block ref anchor 跨预览传递**:`PreviewTarget` 当前只有 `jumpLine?: number`,
不支持 `{kind:'heading'|'block', id}`。两种方案选择:

- (A) 给 `PreviewTarget` 加 `anchor` 字段 → 改动协议层,牵涉 FileBrowserSheet /
  FilePreviewSheet / PreviewPane 多个组件签名
- (B) **局部 pending anchor**:在 obsidian 模块内 `useRef<Anchor | null>`(或一个轻量
  context),wikilink 点击时写入,目标 MarkdownPreview mount 后 useEffect 消费并
  `scrollIntoView` 对应 DOM 节点(heading slug / `[data-block-id]`)

选 **(B)**。理由:anchor 是 Obsidian 集成专属概念,不该污染通用文件预览协议;
渲染完成后定位本来就要等 DOM 就绪,前端内部状态传递更自然。具体放在
`obsidian/anchor-bus.ts` — 一个模块级 `let pending: Anchor | null` + set/consume
两个函数,**只**在 obsidian 模块内可见。

---

## 7. Backend: wikilink-resolver

### 7.1 API 端点

```
POST /api/files/resolve-links
Headers: 同 file-routes 标准 auth + rate limit
Body: {
  instanceId: string,
  from: string,                // 调用者所在 md 的 path(相对 cwd)
  targets: string[],           // 要解析的 wikilink target,如 ["Foo", "a/b", "Foo#H2"]
}
Response: {
  ok: true,
  results: Array<{
    target: string,
    resolved?: string,         // 命中:相对 cwd 路径
    candidates?: string[],     // ambiguous:全部候选(供 UI 显示 "N 个")
    fragment?: { kind: 'heading'|'block', id: string },  // 锚点信息
    broken?: true,             // 无任何匹配
  }>,
}
```

**Why 批量**:一篇 md 常含 10+ wikilinks,批量一次 RTT 而非 N 次。

**Why POST**:targets 数组可能很长,query string 不合适;且符合"非幂等检索"的语义(后端可能在调用过程中触发首次索引 build,有副作用)。

### 7.2 WorkspaceIndex(`backend/src/files/wikilink-resolver.ts`)

```ts
class WorkspaceIndex {
  private byBasename = new Map<string, string[]>();  // 'foo' → ['notes/foo.md', 'archive/foo.md']
  private built = false;
  private buildPromise: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;

  async ensureBuilt(): Promise<void> {
    if (this.built) return;
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.buildOnce();
    await this.buildPromise;
    this.buildPromise = null;
    this.built = true;
    this.startWatch();
  }

  resolve(from: string, target: string): ResolveResult { /* §7.3 */ }

  private async buildOnce(): Promise<void> { /* 递归 cwd,收集 .md/.markdown */ }
  private startWatch(): void { /* fs.watch + rename/unlink 增量,失败回退每 5min */ }
}
```

**实例级单例**:与 `instance-registry` 一一对应,实例 shutdown 时 watcher close。
**不持久化**:索引完全活在内存。重启 broker 重新 build。理由:
- 持久化需要校验文件 mtime,等于做了一遍重扫,没省事
- 索引很小(每 .md 一个字符串),万级 .md 也就几 MB
- 持久化引入 stale 风险:索引文件没及时更新,wikilink 命中错文件

**LRU**:暂不做 LRU 淘汰,内存足够。**如果**实测发现某些极端 vault(10w+ md)内存压力,加 size cap。

### 7.3 解析算法(对齐 Obsidian)

```
function resolve(from: string, target: string): ResolveResult {
  // 1. 切出 fragment
  const [pathPart, fragPart] = splitFragment(target);  // 'Foo#H2' → ['Foo', '#H2']
  const fragment = parseFragment(fragPart);             // {kind:'heading',id:'H2'} 或 null

  // 2. 含 '/' 走路径形态
  if (pathPart.includes('/')) {
    const fromVault = tryPath(joinVault(pathPart));
    if (fromVault) return ok(fromVault);
    const fromCurrent = tryPath(joinDir(dirname(from), pathPart));
    if (fromCurrent) return ok(fromCurrent);
    return broken();
  }

  // 3. 短名形态 — 查索引
  const candidates = byBasename.get(stripExt(pathPart)) ?? [];
  if (candidates.length === 0) return broken();
  if (candidates.length === 1) return ok(candidates[0]);

  // 4. 多匹配 — shortest-path 启发式
  const best = pickShortestPath(from, candidates);
  return ok(best, { candidates });  // 仍把全部候选传回,UI 显示 "N 个候选"
}

function pickShortestPath(from: string, candidates: string[]): string {
  // 共同目录段数最多 → 字节序最小(用 `<` 而非 localeCompare,见 ADR-003)
  return candidates
    .map(c => ({ c, common: countCommonDirSegments(from, c) }))
    .sort((a, b) => {
      if (b.common !== a.common) return b.common - a.common;
      return a.c < b.c ? -1 : a.c > b.c ? 1 : 0;
    })
    [0].c;
}
```

`stripExt(name)`:去掉 `.md` / `.markdown`,大小写不敏感。
`byBasename` key 在 build 时统一 lowercase,lookup 时 target 也 lowercase(Obsidian wikilink 大小写不敏感)。

### 7.4 安全

- `resolve` 拼出的所有路径**强制走 `resolveSafePath`**(file-routes 既有),防穿越
- 索引 build 时遇到 symlink 跳出 cwd 的:不收录(`realpath` 校验)
- `from` 参数本身要先 `resolveSafePath` 校验,防伪造定位
- POST body size cap 1MB(rate-limiter middleware 加 size limit)

### 7.5 heading / block ref 解析

backend **不**解析 heading / block ref — 它们是渲染层概念,backend 只负责
"目标文件存在与否",不需要懂 markdown 结构。`splitFragment` 仅切分语法
(`Foo#H2` → `pathPart='Foo'`, `fragment={kind:'heading',id:'H2'}`),`fragment`
原样传回前端;前端拿到目标 md 渲染后,自己 scrollIntoView。

**Why backend 不做**:
- 加 markdown parser 等于 backend 引入 `unified` + `remark-parse` 依赖,影响
  npm 包体积(`auvezy-terminal-remote` 是发布到 npm 的唯一包,体积敏感)
- 前端已经要渲染该 md,无论如何都会 parse 一遍,backend 做等于重复
- markdown 渲染后的 DOM 才是定位 heading 的真权威(slug 生成依赖渲染规则)

**前端 anchor 消费**(对应 §6.4 anchor bus):
- heading:`document.querySelector('[data-heading-id="<slug>"]')` →
  `scrollIntoView`。slug 算法 = lowercase + 空格替为连字符 + 去除非
  `\w-` 字符(对齐 Obsidian)
- block ref:`document.querySelector('[data-block-id="<id>"]')` →
  `scrollIntoView`

`data-heading-id` / `data-block-id` 属性由 `components.h1..h6` / `components.obsBlockId`
渲染时挂上。

---

## 8. 国际化(完整 key 清单)

`frontend/src/i18n/messages.ts` 加 namespace `obsidian.*`:

```ts
obsidian: {
  // 集成面板
  sectionRendering: string;          // "渲染集成" / "Rendering Integrations"
  sectionRuntime: string;            // "运行时集成" / "Runtime Integrations"
  markdownTitle: string;             // "Markdown"
  markdownDescription: string;
  obsidianTitle: string;             // "Obsidian"
  obsidianDescription: string;
  obsidianRequiresMarkdown: string;  // "需要先启用 Markdown"
  obsidianModalTitle: string;        // "Obsidian 集成详细设置"
  obsidianModalHint: string;         // 关闭子开关时降级行为的总说明

  // 子开关
  toggleFrontmatter: string;
  toggleFrontmatterHint: string;
  toggleWikilink: string;
  toggleWikilinkHint: string;
  toggleEmbed: string;
  toggleEmbedHint: string;
  toggleCallout: string;
  toggleCalloutHint: string;
  toggleInlineSyntax: string;
  toggleInlineSyntaxHint: string;

  // Frontmatter UI
  frontmatterTitle: string;          // "Properties"
  frontmatterCount: string;          // "{n} 项"
  frontmatterParseError: string;
  frontmatterEmpty: string;

  // Callout(13 类默认标题)
  calloutNote: string;
  calloutAbstract: string;
  calloutInfo: string;
  calloutTodo: string;
  calloutTip: string;
  calloutSuccess: string;
  calloutQuestion: string;
  calloutWarning: string;
  calloutFailure: string;
  calloutDanger: string;
  calloutBug: string;
  calloutExample: string;
  calloutQuote: string;

  // Wikilink
  wikilinkBroken: string;            // tooltip "目标不存在"
  wikilinkAmbiguous: string;         // tooltip "{n} 个候选"
  wikilinkDisabledHint: string;      // tooltip "启用 Obsidian wikilink 集成以跳转"

  // Embed
  embedExpand: string;               // "▶ Embed: {path} ({size})"
  embedCollapse: string;
  embedNotFound: string;
  embedUnsupportedType: string;
  embedCircular: string;
  embedDepthLimit: string;
  embedDisabledHint: string;
}
```

en.ts + zh-CN.ts 同步实现。

---

## 9. 安全

- POST `/resolve-links` 走 fileLimiter(与 list/read 共享 per-IP 配额)
- backend WorkspaceIndex build 必须 chdir-safe(只 walk cwd,跟随 symlink 时 realpath 校验未跳出)
- 解析结果的 `resolved` 路径**永远是 cwd 相对路径**,绝对路径不外泄
- wikilink 渲染的 `<a href="#">` 永远是占位,跳转通过 onClick 走前端路由,不走真实 URL(防 phishing)
- frontmatter YAML 用 `js-yaml.load(text)` — v4 起 `load()` 默认即 safe schema
  (不再支持 `!!js/function` 等可执行类型);旧 `safeLoad` 已 deprecated,**不要**
  指定 `{ schema: SAFE_SCHEMA }`(v4 没有这个导出)
- embed `<iframe>` / `<video>` / `<audio>` src 永远是 `/api/files/raw?...` 同源端点,不允许 frontmatter 里写的 `[[https://...]]` 走外部

---

## 10. 测试策略

每个新文件**测试成对**(对齐 claude-code 集成范式):

| 测试文件 | 覆盖 |
|---|---|
| `frontmatter.test.tsx` | YAML 类型推断(7 种)、解析失败 fallback、tags/aliases/cssclass 强制 array、折叠状态 |
| `callout.test.tsx` | 13 类各识别一次、所有别名命中、`+`/`-` 折叠、嵌套、大小写不敏感、自定义标题渲染 inline markdown |
| `wikilink.test.tsx` | active vs disabled 渲染分支、broken 样式、ambiguous tooltip、alias、跳转点击 |
| `embed.test.tsx` | 5 类分发、循环检测、深度上限、子开关关闭占位、单 embed 自动展开 |
| `inline-syntax.test.ts` | 4 种语法识别 + 关闭时保留原文、`#tag` lookbehind、`^block-id` 行尾/独立 |
| `wikilink-resolver.test.ts` | build/lookup/watch、shortest-path 启发式、stripExt 大小写、resolveSafePath 越界拒绝、fragment 拆分 |
| `obsidian-integration.test.tsx` | 5 子开关组合各开各关,DOM 变化端到端验证 |
| `defaults.test.ts` 扩展 | 旧 markdownPreview → rendering.markdown.enabled 迁移、effective 计算、不删旧字段 |

smoke test:阶段末跑真实 Obsidian vault(若 Drowsy 没有,用 `obsidian-help` 仓库的 md 文件作 fixture),`pnpm stop` 释放端口,清临时进程。

---

## 11. 阶段拆分

| 阶段 | 范围 | 大致改动 | 验证 |
|---|---|---|---|
| **S0** | ADR 落地 + plan 目录骨架 | 4 个 ADR md | review |
| **S1** | shared 数据结构 + 迁移 + normalize 测试 | `shared/src/defaults.ts` | 单测 |
| **S2** | 集成面板 UI 改造(双分组 + Markdown 行 + Obsidian modal);DisplaySettings 清理 | settings/* + i18n 全量 keys | 手动 UI |
| **S3** | Frontmatter 渲染 | `obsidian/frontmatter.tsx` + js-yaml + remark-frontmatter | 单测 + UI |
| **S4** | Callout 13 类(替换 GFM Alert) | `obsidian/callout.tsx` + callout-types.ts | 单测 + UI |
| **S5** | Inline syntax | `obsidian/inline-syntax.ts` | 单测 |
| **S6a** | Wikilink backend — WorkspaceIndex + 解析算法 + `/api/files/resolve-links` 端点 + fs.watch | `files/wikilink-resolver.*` + `api/file-routes.ts` | 单测(13 用例 ADR-003) |
| **S6b** | Wikilink 前端 — remark plugin + active/disabled 组件 + 复用 useFilePreviewPresenter + anchor-bus | `obsidian/wikilink.*` + `obsidian/anchor-bus.ts` | 单测 + 跨文件跳转 smoke |
| **S7** | Embed 5 类分发 + heading/block ref + 循环检测 | `obsidian/embed.tsx` + backend fragment 拆分 | 单测 + UI |
| **S8** | 集成 smoke(真 Obsidian vault)+ chunk 体积验证 + CHANGELOG + 发版准备 | 文档 + 打包数据 | 打包尺寸对比 |

每阶段结束:commit + 更新 `progress/0X-阶段X.md` + smoke + `pnpm stop` 释放端口。

---

## 12. 风险与回退

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| WorkspaceIndex 首次 build 在大 vault(数万 md)阻塞过久 | 中 | UX | build 异步 + UI 显示"索引中"占位;实测后必要时加 worker_threads |
| fs.watch 在 WSL/macOS 大目录失效或丢事件 | 中 | wikilink 解析陈旧 | 5min 周期重扫兜底(即使 watch 失败也最多陈旧 5min) |
| obsidian chunk 体积失控 | 低 | 加载慢 | S8 用 vite 打包报告核对,>150KB 触发回看 |
| 旧客户端 PUT config 时 strip 掉新字段 | 中 | 用户保存了开关读不到 | normalize 写两处 + 旧字段保留 3 minor(已在 §4.3) |
| heading slug 算法跟 Obsidian 不一致 | 低 | 跨笔记 heading 跳错位置 | S7 文档对齐 Obsidian 的 slugify 规则(去标点 + 空格→连字符 + 小写),加测试 |

**回退**:全功能由 `rendering.obsidian.enabled` 控制,出严重 bug 时引导用户关掉这一个开关即可降级到现有 markdown 渲染(0.8.0 行为)。无需 hotfix 也能止损。

---

## 13. ADR 索引

- ADR-001:渲染集成 vs 运行时集成 — 两类「集成」概念并列
- ADR-002:Obsidian 强依赖 Markdown — 子开关与依赖关系
- ADR-003:wikilink 解析算法 — 全 vault 短名 + shortest-path 启发式
- ADR-004:循环 / 深度限制 — embed 沿路径 Set 检测 + 硬上限 5
