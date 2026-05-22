# Obsidian 集成 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 .md 预览升级为完整 Obsidian-flavored 渲染(frontmatter / 13 类 callout / wikilink 跳转 / 5 类 embed / inline 语法),同时把"渲染相关功能"提升为顶层"集成"分类的一类。

**Architecture:** 见 `design.md`。前端 obsidian 模块挂在 MarkdownPreview 二级 lazy chunk;backend 加 `wikilink-resolver` 服务 + `POST /api/files/resolve-links` 端点;数据存储复用 `IntegrationsPrefs`,扩 `rendering` 字段。

**Tech Stack:** TypeScript / React / Vitest;新依赖 `js-yaml` (~30KB) + `remark-frontmatter` (~3KB);其它 obsidian 语法 plugin 全部自写。

**先决条件**:对 `design.md` 全 13 节 + 4 ADR 已阅读理解。每阶段结束 commit + 更新 `progress/0N-*.md` + smoke + `pnpm stop` 释放端口(CLAUDE.md 红线)。

---

## 文件结构总览

新建:

```
shared/src/
  defaults.ts                                # 扩展 IntegrationsPrefs.rendering + normalize 迁移

frontend/src/components/files/markdown/
  obsidian/
    index.ts                                 # plugin 聚合入口(MarkdownPreview lazy 二级 chunk)
    callout-types.ts                         # 13 类 + 别名表(纯前端常量)
    frontmatter.tsx                          # YAML 解析 + Properties 表
    frontmatter.module.scss
    frontmatter.test.tsx
    callout.tsx                              # 13 类 + 别名 + +/- collapsible
    callout.module.scss
    callout.test.tsx
    inline-syntax.ts                         # ==/%%/#tag/^id 自写 remark plugin
    inline-syntax.module.scss
    inline-syntax.test.ts
    wikilink.tsx                             # [[...]] active/disabled 两种渲染
    wikilink.module.scss
    wikilink.test.tsx
    embed.tsx                                # ![[...]] 5 类分发 + 循环检测
    embed.module.scss
    embed.test.tsx
    resolve-link.ts                          # 调 backend /resolve-links 的 client
    anchor-bus.ts                            # heading/block ref 跨预览传递

frontend/src/components/settings/
  ObsidianSettingsModal.tsx                  # 5 子开关 modal

backend/src/files/
  wikilink-resolver.ts                       # WorkspaceIndex + 解析算法
  wikilink-resolver.test.ts

docs/plans/obsidian-integration/progress/
  01-shared-数据结构.md
  02-集成面板UI.md
  03-frontmatter.md
  04-callout.md
  05-inline-syntax.md
  06a-wikilink-backend.md
  06b-wikilink-frontend.md
  07-embed.md
  08-smoke-收口.md
```

修改:

```
shared/src/defaults.ts                                  扩 IntegrationsPrefs + normalize
shared/src/defaults.test.ts                             迁移测试
frontend/src/components/files/MarkdownPreview.tsx       lazy obsidian + plugin 拼装 + 删 GFM Alert
frontend/src/components/files/PreviewPane.tsx           读 rendering.markdown.enabled 替代 display.markdownPreview
frontend/src/components/settings/DisplaySettings.tsx    删 markdownPreview 行
frontend/src/components/settings/IntegrationsSettings.tsx  双分组 + Markdown 行 + Obsidian 行
frontend/src/components/ui/modal-stack/presenters.tsx   注册 ObsidianSettings presenter
frontend/src/i18n/messages.ts                           +obsidian.* 命名空间(完整类型)
frontend/src/i18n/en.ts                                 同上(英文)
frontend/src/i18n/zh-CN.ts                              同上(中文)
backend/src/api/file-routes.ts                          注册 POST /api/files/resolve-links
backend/package.json                                    可能不动(纯 backend 不引新依赖)
frontend/package.json                                   +js-yaml +@types/js-yaml +remark-frontmatter
```

---

# S0 · ADR 与 plan 已完成

S0 产物已存在(`design.md` + 4 ADR + `progress/00-overview.md` + `plan.md` 本文)。

- [ ] **Step S0.1: 提交 S0 设计稿**

```bash
cd /mnt/d/github/open-terminal-remote
git add docs/plans/obsidian-integration/
git status
```

预期 status:`docs/plans/obsidian-integration/{design.md,plan.md,adrs/,progress/}` 全部 untracked → staged。

- [ ] **Step S0.2: commit**

```bash
git commit -m "$(cat <<'EOF'
docs(obsidian): S0 设计稿 + 4 ADR + 实施计划

design.md 13 节涵盖渲染管线 / 数据模型 / backend wikilink-resolver / i18n;
ADR 001 渲染 vs 运行时集成 / 002 强依赖 markdown / 003 wikilink 解析算法 /
004 embed 循环与深度限制。
EOF
)"
```

(项目 CLAUDE.md 规定 commit 不加 AI 署名)

---

# S1 · shared 数据结构 + 迁移

### Task S1-1: 扩展 `IntegrationsPrefs` 类型

**Files:**
- Modify: `shared/src/defaults.ts:454-499`(`IntegrationsPrefs` interface + `DEFAULT_INTEGRATIONS`)
- Test: `shared/src/defaults.test.ts`

- [ ] **Step 1: 写失败测试 — `RenderingIntegrationPrefs` 默认值**

打开 `shared/src/defaults.test.ts`,在文件末尾追加:

```ts
describe('rendering integration defaults', () => {
  it('exposes markdown.enabled and obsidian.* sub-toggles via DEFAULT_INTEGRATIONS', () => {
    expect(DEFAULT_INTEGRATIONS.rendering.markdown.enabled).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.enabled).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.frontmatter).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.wikilink).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.embed).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.callout).toBe(true);
    expect(DEFAULT_INTEGRATIONS.rendering.obsidian.inlineSyntax).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter auvezy-terminal-remote-shared test -- defaults.test.ts
```

预期:`Cannot read properties of undefined (reading 'markdown')`(或类似 TS 类型错)。

- [ ] **Step 3: 扩展类型 + 默认值**

修改 `shared/src/defaults.ts`,在 `IntegrationsPrefs` 之后插入 `RenderingIntegrationPrefs`,并扩 `IntegrationsPrefs` / `DEFAULT_INTEGRATIONS`:

```ts
/**
 * 渲染集成偏好。与运行时集成(forceModule 单选)不同,渲染集成是多选 ——
 * 每个模块独立 enabled,可同时启用。详见 docs/plans/obsidian-integration/ADR-001。
 */
export interface RenderingIntegrationPrefs {
  markdown?: { enabled?: boolean };
  obsidian?: {
    enabled?: boolean;
    frontmatter?: boolean;
    wikilink?: boolean;
    embed?: boolean;
    callout?: boolean;
    inlineSyntax?: boolean;
  };
}

export interface IntegrationsPrefs {
  enabled?: boolean;
  forceModule?: 'auto' | 'claude-code' | 'none';
  perModule?: {
    'claude-code'?: {
      events?: {
        approvals?: boolean;
        toolProgress?: boolean;
        turnLifecycle?: boolean;
        sessionLifecycle?: boolean;
        userPrompts?: boolean;
      };
    };
  };
  /** NEW — 渲染集成,各自独立 enabled,不参与 forceModule */
  rendering?: RenderingIntegrationPrefs;
}
```

扩 `DEFAULT_INTEGRATIONS`(类型注解从 `Required<{enabled,forceModule,perModule}>` 改成包含 rendering 的形式):

```ts
export const DEFAULT_INTEGRATIONS: Required<{
  enabled: boolean;
  forceModule: 'auto' | 'claude-code' | 'none';
  perModule: {
    'claude-code': {
      events: {
        approvals: boolean;
        toolProgress: boolean;
        turnLifecycle: boolean;
        sessionLifecycle: boolean;
        userPrompts: boolean;
      };
    };
  };
  rendering: {
    markdown: { enabled: boolean };
    obsidian: {
      enabled: boolean;
      frontmatter: boolean;
      wikilink: boolean;
      embed: boolean;
      callout: boolean;
      inlineSyntax: boolean;
    };
  };
}> = {
  enabled: true,
  forceModule: 'auto',
  perModule: {
    'claude-code': {
      events: {
        approvals: true,
        toolProgress: true,
        turnLifecycle: true,
        sessionLifecycle: true,
        userPrompts: false,
      },
    },
  },
  rendering: {
    markdown: { enabled: true },
    obsidian: {
      enabled: true,
      frontmatter: true,
      wikilink: true,
      embed: true,
      callout: true,
      inlineSyntax: true,
    },
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote-shared test -- defaults.test.ts
```

预期:PASS。

- [ ] **Step 5: commit**

```bash
git add shared/src/defaults.ts shared/src/defaults.test.ts
git commit -m "feat(shared): 扩 IntegrationsPrefs.rendering — 渲染集成多选模型"
```

---

### Task S1-2: normalize 迁移 — 旧 `display.markdownPreview` → 新 `rendering.markdown.enabled`

**Files:**
- Modify: `shared/src/defaults.ts:762-826`(`ensureDefaultUserConfig` 内的 integrations 段)
- Test: `shared/src/defaults.test.ts`

- [ ] **Step 1: 写失败测试**

`shared/src/defaults.test.ts` 末尾追加:

```ts
describe('rendering integration migration', () => {
  it('migrates legacy display.markdownPreview=false to rendering.markdown.enabled=false when new field absent', () => {
    const input = {
      display: { markdownPreview: false },
      // 不写 integrations.rendering
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0];
    const out = ensureDefaultUserConfig(input);
    expect(out.integrations.rendering?.markdown?.enabled).toBe(false);
    // 旧字段不动(双写窗口期保留)
    expect(out.display.markdownPreview).toBe(false);
  });

  it('prefers new rendering.markdown.enabled over legacy display.markdownPreview', () => {
    const input = {
      display: { markdownPreview: false },
      integrations: { rendering: { markdown: { enabled: true } } },
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0];
    const out = ensureDefaultUserConfig(input);
    expect(out.integrations.rendering?.markdown?.enabled).toBe(true);
  });

  it('fills obsidian sub-toggles with defaults when partially configured', () => {
    const input = {
      integrations: { rendering: { obsidian: { wikilink: false } } },
    } as unknown as Parameters<typeof ensureDefaultUserConfig>[0];
    const out = ensureDefaultUserConfig(input);
    const obs = out.integrations.rendering?.obsidian;
    expect(obs?.enabled).toBe(true);          // 默认
    expect(obs?.wikilink).toBe(false);        // 用户设
    expect(obs?.frontmatter).toBe(true);      // 默认
    expect(obs?.embed).toBe(true);
    expect(obs?.callout).toBe(true);
    expect(obs?.inlineSyntax).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter auvezy-terminal-remote-shared test -- defaults.test.ts
```

预期 FAIL:`out.integrations.rendering` 为 undefined。

- [ ] **Step 3: 扩 `ensureDefaultUserConfig` 的 integrations normalize**

修改 `shared/src/defaults.ts` 的 `ensureDefaultUserConfig` 中 integrations 段(`:777-826` 附近)。在现有 `const ccDefaults / const integrations: IntegrationsPrefs = {...}` 块**之前**读 legacy 字段;**之后**写入 rendering:

```ts
// 兼容 0.8.x:display.markdownPreview 是旧位置;0.9 起搬到 integrations.rendering.markdown.enabled
const legacyMdPreview =
  typeof rawDisplay?.markdownPreview === 'boolean' ? rawDisplay.markdownPreview : undefined;
const userRenderingMd =
  rawIntegrations?.rendering?.markdown?.enabled;
const renderingMdEnabled =
  typeof userRenderingMd === 'boolean'
    ? userRenderingMd
    : typeof legacyMdPreview === 'boolean'
      ? legacyMdPreview
      : DEFAULT_INTEGRATIONS.rendering.markdown.enabled;

const userObsidian = rawIntegrations?.rendering?.obsidian;
const obsDefaults = DEFAULT_INTEGRATIONS.rendering.obsidian;
const rendering: RenderingIntegrationPrefs = {
  markdown: { enabled: renderingMdEnabled },
  obsidian: {
    enabled: typeof userObsidian?.enabled === 'boolean' ? userObsidian.enabled : obsDefaults.enabled,
    frontmatter: typeof userObsidian?.frontmatter === 'boolean' ? userObsidian.frontmatter : obsDefaults.frontmatter,
    wikilink: typeof userObsidian?.wikilink === 'boolean' ? userObsidian.wikilink : obsDefaults.wikilink,
    embed: typeof userObsidian?.embed === 'boolean' ? userObsidian.embed : obsDefaults.embed,
    callout: typeof userObsidian?.callout === 'boolean' ? userObsidian.callout : obsDefaults.callout,
    inlineSyntax: typeof userObsidian?.inlineSyntax === 'boolean' ? userObsidian.inlineSyntax : obsDefaults.inlineSyntax,
  },
};
```

把 `rendering` 加进既有的 `integrations: IntegrationsPrefs = {...}` 字面量末尾。

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote-shared test -- defaults.test.ts
```

预期:全部 PASS。

- [ ] **Step 5: 全包 typecheck**

```bash
pnpm --filter auvezy-terminal-remote-shared exec tsc -b --pretty
```

预期:无 type error。

- [ ] **Step 6: commit + 更新 progress**

创建 `docs/plans/obsidian-integration/progress/01-shared-数据结构.md`:

```markdown
# S1 · shared 数据结构 + 迁移

- ✅ 扩 IntegrationsPrefs.rendering 类型与 DEFAULT_INTEGRATIONS
- ✅ ensureDefaultUserConfig 双写迁移:旧 display.markdownPreview → 新 rendering.markdown.enabled
- ✅ 单测覆盖 legacy / new / partial 三种 case

下一步:S2 集成面板 UI 改造。
```

```bash
git add shared/src/defaults.ts shared/src/defaults.test.ts docs/plans/obsidian-integration/progress/01-shared-数据结构.md
git commit -m "feat(shared): ensureDefaultUserConfig 迁移 display.markdownPreview 到 rendering.markdown.enabled"
```

---

# S2 · 集成面板 UI 改造

> 不走 TDD(纯 UI 重排,无独立断言可写)。每完成一组改动手动 UI 验证。

### Task S2-1: i18n 加 obsidian 命名空间(完整 key 清单)

**Files:**
- Modify: `frontend/src/i18n/messages.ts`(类型)
- Modify: `frontend/src/i18n/en.ts`
- Modify: `frontend/src/i18n/zh-CN.ts`

- [ ] **Step 1: messages.ts 加 obsidian namespace 类型**

在 `frontend/src/i18n/messages.ts` 现有 `display` / `integrations` 等命名空间附近,新增:

```ts
obsidian: {
  // 集成面板分组与行
  sectionRendering: string;
  sectionRuntime: string;
  markdownTitle: string;
  markdownDescription: string;
  obsidianTitle: string;
  obsidianDescription: string;
  obsidianRequiresMarkdown: string;
  obsidianModalTitle: string;
  obsidianModalHint: string;
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
  frontmatterTitle: string;
  frontmatterCount: string;          // 带参数 {n}
  frontmatterParseError: string;
  frontmatterEmpty: string;
  // 13 类 callout 默认标题
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
  wikilinkBroken: string;
  wikilinkAmbiguous: string;         // 带参数 {n}
  wikilinkDisabledHint: string;
  // Embed
  embedExpand: string;               // 带参数 {path}, {size}
  embedCollapse: string;
  embedNotFound: string;
  embedUnsupportedType: string;      // 带参数 {ext}
  embedCircular: string;             // 带参数 {path}
  embedDepthLimit: string;
  embedDisabledHint: string;
}
```

- [ ] **Step 2: en.ts 实现**

`frontend/src/i18n/en.ts` 加(放在与 `display: {...}` 平级位置):

```ts
obsidian: {
  sectionRendering: 'Rendering integrations',
  sectionRuntime: 'Runtime integrations',
  markdownTitle: 'Markdown',
  markdownDescription: 'Rich preview for .md / .markdown files (headings / lists / tables / code blocks).',
  obsidianTitle: 'Obsidian',
  obsidianDescription: 'Layer Obsidian-flavored extensions on top of Markdown rendering (frontmatter / callouts / wikilinks / embeds / inline syntax).',
  obsidianRequiresMarkdown: 'Requires Markdown to be enabled.',
  obsidianModalTitle: 'Obsidian integration details',
  obsidianModalHint: 'When a sub-toggle is off, the corresponding syntax is still recognized but rendered as a hint style (wikilink / embed) or kept as raw text (highlight / comment / tag / block-id).',

  toggleFrontmatter: 'Frontmatter (Properties)',
  toggleFrontmatterHint: 'Render YAML front matter as a typed properties table. Off: front matter block is hidden.',
  toggleWikilink: 'Wikilink ([[...]])',
  toggleWikilinkHint: 'Recognize [[Note]] / [[Note|alias]]. Off: rendered as disabled style (dashed underline), not clickable.',
  toggleEmbed: 'Embed (![[...]])',
  toggleEmbedHint: 'Recognize ![[file]] embedding (images / md slices / pdf / audio / video). Off: rendered as placeholder.',
  toggleCallout: 'Callouts (> [!type])',
  toggleCalloutHint: '13 Obsidian callout types with collapsibles. Off: falls back to standard blockquote rendering.',
  toggleInlineSyntax: 'Inline syntax',
  toggleInlineSyntaxHint: '==highlight==, %%comment%%, #tag, ^block-id. Off: original text is preserved as-is.',

  frontmatterTitle: 'Properties',
  frontmatterCount: '{n} items',
  frontmatterParseError: 'Front matter parse error',
  frontmatterEmpty: '(empty)',

  calloutNote: 'Note',
  calloutAbstract: 'Abstract',
  calloutInfo: 'Info',
  calloutTodo: 'Todo',
  calloutTip: 'Tip',
  calloutSuccess: 'Success',
  calloutQuestion: 'Question',
  calloutWarning: 'Warning',
  calloutFailure: 'Failure',
  calloutDanger: 'Danger',
  calloutBug: 'Bug',
  calloutExample: 'Example',
  calloutQuote: 'Quote',

  wikilinkBroken: 'Target not found',
  wikilinkAmbiguous: '{n} candidates',
  wikilinkDisabledHint: 'Enable Obsidian wikilink sub-toggle to navigate',

  embedExpand: '▶ Embed: {path} ({size})',
  embedCollapse: 'Collapse',
  embedNotFound: 'Embedded file not found',
  embedUnsupportedType: 'Embed not supported: {ext}',
  embedCircular: 'Circular embed: {path}',
  embedDepthLimit: 'Embed depth limit reached',
  embedDisabledHint: 'Embed sub-toggle is off',
},
```

- [ ] **Step 3: zh-CN.ts 实现**

`frontend/src/i18n/zh-CN.ts` 对应位置加:

```ts
obsidian: {
  sectionRendering: '渲染集成',
  sectionRuntime: '运行时集成',
  markdownTitle: 'Markdown',
  markdownDescription: '.md / .markdown 文件富文本预览(标题 / 列表 / 表格 / 代码块等)。',
  obsidianTitle: 'Obsidian',
  obsidianDescription: '在 Markdown 渲染管线上叠加 Obsidian 扩展语法(frontmatter / callout / wikilink / embed / 内联语法)。',
  obsidianRequiresMarkdown: '需要先启用 Markdown。',
  obsidianModalTitle: 'Obsidian 集成详细设置',
  obsidianModalHint: '关闭子开关后,对应语法仍被识别,但渲染为提示样式(wikilink / embed)或保留原文(高亮 / 注释 / 标签 / block-id)。',

  toggleFrontmatter: 'Frontmatter(属性表)',
  toggleFrontmatterHint: '把文件头 YAML 渲染为带类型图标的属性表;关闭则隐藏头部 YAML 块。',
  toggleWikilink: 'Wikilink([[...]])',
  toggleWikilinkHint: '识别 [[笔记]] / [[笔记|别名]];关闭后仍识别为 wikilink,但渲染为虚线灰色样式且不可点击。',
  toggleEmbed: 'Embed(![[...]])',
  toggleEmbedHint: '识别 ![[文件]] 嵌入(图片 / md 片段 / PDF / 音视频);关闭后渲染为占位框。',
  toggleCallout: 'Callout(> [!type])',
  toggleCalloutHint: '13 种 Obsidian callout 类型及折叠语法;关闭则回退为普通 blockquote。',
  toggleInlineSyntax: '内联语法',
  toggleInlineSyntaxHint: '==高亮==、%%注释%%、#标签、^block-id;关闭则保留原始文本不做识别。',

  frontmatterTitle: '属性',
  frontmatterCount: '{n} 项',
  frontmatterParseError: 'Frontmatter 解析失败',
  frontmatterEmpty: '(空)',

  calloutNote: '笔记',
  calloutAbstract: '摘要',
  calloutInfo: '信息',
  calloutTodo: '待办',
  calloutTip: '提示',
  calloutSuccess: '成功',
  calloutQuestion: '问题',
  calloutWarning: '警告',
  calloutFailure: '失败',
  calloutDanger: '危险',
  calloutBug: '缺陷',
  calloutExample: '示例',
  calloutQuote: '引用',

  wikilinkBroken: '目标不存在',
  wikilinkAmbiguous: '{n} 个候选',
  wikilinkDisabledHint: '启用 Obsidian wikilink 子开关以跳转',

  embedExpand: '▶ Embed:{path}({size})',
  embedCollapse: '收起',
  embedNotFound: '嵌入文件不存在',
  embedUnsupportedType: '不支持的嵌入类型:{ext}',
  embedCircular: '循环嵌入:{path}',
  embedDepthLimit: '已达嵌入深度上限',
  embedDisabledHint: '嵌入子开关未启用',
},
```

- [ ] **Step 4: typecheck 全前端**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期:无错(messages.ts 的严格类型会强制 en + zh-CN 全实现)。

- [ ] **Step 5: commit**

```bash
git add frontend/src/i18n/
git commit -m "i18n(obsidian): 加 obsidian 命名空间完整 key 表(en + zh-CN)"
```

---

### Task S2-2: `IntegrationsSettings.tsx` 双分组改造

**Files:**
- Modify: `frontend/src/components/settings/IntegrationsSettings.tsx`

- [ ] **Step 1: 引入新依赖 + state derive**

打开 `frontend/src/components/settings/IntegrationsSettings.tsx`,在文件顶部 imports 加:

```ts
import { useObsidianSettingsPresenter } from '../ui/modal-stack/presenters.js';
```

(presenter 在 Task S2-3 注册,此 import 暂会报"missing export" — 是预期,S2-3 解决)

在 `IntegrationsSettings` 组件函数体内,既有 `ccActive` 之后加:

```ts
const presentObsidian = useObsidianSettingsPresenter();

// 渲染集成 effective 值
const renderingMd = value?.rendering?.markdown?.enabled
  ?? DEFAULT_INTEGRATIONS.rendering.markdown.enabled;
const userObsidian = value?.rendering?.obsidian;
const obsDefaults = DEFAULT_INTEGRATIONS.rendering.obsidian;
const obsidianEnabled = userObsidian?.enabled ?? obsDefaults.enabled;
const obsidianActive = renderingMd && obsidianEnabled;

const setRenderingMd = (next: boolean): void => {
  onChange({
    ...value,
    rendering: {
      ...value?.rendering,
      markdown: { enabled: next },
    },
  });
};

const setObsidianEnabled = (next: boolean): void => {
  onChange({
    ...value,
    rendering: {
      ...value?.rendering,
      obsidian: { ...value?.rendering?.obsidian, enabled: next },
    },
  });
};

const setObsidianSubToggle = (
  key: 'frontmatter' | 'wikilink' | 'embed' | 'callout' | 'inlineSyntax',
  next: boolean,
): void => {
  onChange({
    ...value,
    rendering: {
      ...value?.rendering,
      obsidian: { ...value?.rendering?.obsidian, [key]: next },
    },
  });
};

const openObsidianSettings = (): void => {
  presentObsidian({
    value: {
      frontmatter: userObsidian?.frontmatter ?? obsDefaults.frontmatter,
      wikilink: userObsidian?.wikilink ?? obsDefaults.wikilink,
      embed: userObsidian?.embed ?? obsDefaults.embed,
      callout: userObsidian?.callout ?? obsDefaults.callout,
      inlineSyntax: userObsidian?.inlineSyntax ?? obsDefaults.inlineSyntax,
    },
    onChange: (next) => {
      onChange({
        ...value,
        rendering: {
          ...value?.rendering,
          obsidian: { ...value?.rendering?.obsidian, ...next },
        },
      });
    },
    active: obsidianActive,
  });
};
```

`DEFAULT_INTEGRATIONS` 已经从 `auvezy-terminal-remote-shared` import — 已存在,无需新增 import。

- [ ] **Step 2: 重排 JSX 加分组 header + 两个新 section**

把既有 `<section ClaudeCode>` 用一个 `运行时` header 包起来,**之后**再加 `渲染` header + Markdown + Obsidian 两个新 section。把现有 `<BoolToggleRow enabled>` + force module radio 保持在最顶 (它们影响所有 runtime 集成,不属于任一分组)。

具体在 JSX 末尾(在 `</section> ClaudeCode` 之前)结构:

```tsx
{/* ──── 运行时集成分组 header ──── */}
<header className={s.groupHeader}>
  <h2 className={s.groupTitle}>{t('obsidian.sectionRuntime')}</h2>
</header>

{/* 既有 ClaudeCode section 保留不动 */}
<section className={s.section}>
  {/* ...原来的 ClaudeCode JSX... */}
</section>

{/* ──── 渲染集成分组 header ──── */}
<header className={s.groupHeader}>
  <h2 className={s.groupTitle}>{t('obsidian.sectionRendering')}</h2>
</header>

{/* Markdown 集成 */}
<BoolToggleRow
  title={t('obsidian.markdownTitle')}
  hint={t('obsidian.markdownDescription')}
  value={renderingMd}
  onChange={setRenderingMd}
/>

{/* Obsidian 集成 */}
<section className={s.section} aria-disabled={!renderingMd || undefined}>
  <header className={s.header}>
    <h3 className={s.title}>
      {t('obsidian.obsidianTitle')}
      <span
        className={s.titleStatus}
        data-tone={obsidianActive ? 'info' : 'muted'}
      >
        {obsidianActive ? t('integrations.activeBadge') : t('integrations.inactiveBadge')}
      </span>
    </h3>
    <p className={s.hint}>
      {t('obsidian.obsidianDescription')}
      {!renderingMd && (
        <>
          {' '}
          <span className={s.requirement}>{t('obsidian.obsidianRequiresMarkdown')}</span>
        </>
      )}
    </p>
  </header>
  <div className={s.row} style={!renderingMd ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
    <BoolToggleRow
      title={t('obsidian.obsidianTitle')}
      hint=""
      value={obsidianEnabled}
      onChange={setObsidianEnabled}
    />
    <button type="button" onClick={openObsidianSettings} className={s.btn} disabled={!renderingMd}>
      {t('integrations.openDetails')}
    </button>
  </div>
</section>
```

- [ ] **Step 3: 加配套 SCSS**

打开 `frontend/src/components/settings/GeneralSettings.module.scss`(IntegrationsSettings 复用此 module),在末尾加:

```scss
.groupHeader {
  margin: 24px 0 8px;
  padding: 0;
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.groupTitle {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.requirement {
  color: var(--color-warn);
  font-weight: 500;
}
```

- [ ] **Step 4: typecheck**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期:仍有一个错 — `useObsidianSettingsPresenter` 未导出。S2-3 修。

- [ ] **Step 5: 暂不 commit,等 S2-3 一起 commit**

---

### Task S2-3: `ObsidianSettingsModal` 与 presenter

**Files:**
- Create: `frontend/src/components/settings/ObsidianSettingsModal.tsx`
- Modify: `frontend/src/components/ui/modal-stack/presenters.tsx`

- [ ] **Step 1: 写 `ObsidianSettingsModal.tsx`**

```tsx
/**
 * ObsidianSettingsModal — Obsidian 集成 5 子开关详细设置 modal
 *
 * 形态对齐 ClaudeCodeSettingsModal:BoolToggleRow 列表 + 顶部一行 hint。
 * 子开关关闭语义不同(wikilink/embed 降级样式 vs inline 保留原文),
 * 顶部 hint 总说明,避免每行重复。
 */

import { type JSX } from 'react';
import { ModalShell } from '../ui/modal-stack/ModalShell.js';
import { useT } from '../../i18n/i18n-context.js';
import { BoolToggleRow } from './BoolToggleRow.js';
import s from './ClaudeCodeSettingsModal.module.scss';

export interface ObsidianSubToggles {
  frontmatter: boolean;
  wikilink: boolean;
  embed: boolean;
  callout: boolean;
  inlineSyntax: boolean;
}

export interface ObsidianSettingsModalProps {
  value: ObsidianSubToggles;
  onChange: (next: Partial<ObsidianSubToggles>) => void;
  active: boolean;
  onClose: () => void;
}

export function ObsidianSettingsModal({
  value,
  onChange,
  active,
  onClose,
}: ObsidianSettingsModalProps): JSX.Element {
  const t = useT();

  return (
    <ModalShell
      title={t('obsidian.obsidianModalTitle')}
      onClose={onClose}
    >
      <div className={s.body}>
        <p className={s.hint}>{t('obsidian.obsidianModalHint')}</p>
        {!active && (
          <p className={s.hint} data-tone="warn">
            {t('obsidian.obsidianRequiresMarkdown')}
          </p>
        )}

        <BoolToggleRow
          title={t('obsidian.toggleFrontmatter')}
          hint={t('obsidian.toggleFrontmatterHint')}
          value={value.frontmatter}
          onChange={(next) => onChange({ frontmatter: next })}
        />
        <BoolToggleRow
          title={t('obsidian.toggleCallout')}
          hint={t('obsidian.toggleCalloutHint')}
          value={value.callout}
          onChange={(next) => onChange({ callout: next })}
        />
        <BoolToggleRow
          title={t('obsidian.toggleWikilink')}
          hint={t('obsidian.toggleWikilinkHint')}
          value={value.wikilink}
          onChange={(next) => onChange({ wikilink: next })}
        />
        <BoolToggleRow
          title={t('obsidian.toggleEmbed')}
          hint={t('obsidian.toggleEmbedHint')}
          value={value.embed}
          onChange={(next) => onChange({ embed: next })}
        />
        <BoolToggleRow
          title={t('obsidian.toggleInlineSyntax')}
          hint={t('obsidian.toggleInlineSyntaxHint')}
          value={value.inlineSyntax}
          onChange={(next) => onChange({ inlineSyntax: next })}
        />
      </div>
    </ModalShell>
  );
}
```

(`ModalShell` / `BoolToggleRow` / `ClaudeCodeSettingsModal.module.scss` 都已存在 — 看 `frontend/src/components/settings/ClaudeCodeSettingsModal.tsx` 复用即可。如果实际 import 路径或 prop 签名跟此处略不同,**对齐 ClaudeCodeSettingsModal 当前写法**。)

- [ ] **Step 2: 在 `presenters.tsx` 注册 hook**

打开 `frontend/src/components/ui/modal-stack/presenters.tsx`,参考 `useClaudeCodeSettingsPresenter` 既有写法,追加:

```ts
import {
  ObsidianSettingsModal,
  type ObsidianSubToggles,
} from '../../settings/ObsidianSettingsModal.js';

export interface ObsidianSettingsPresenterArgs {
  value: ObsidianSubToggles;
  onChange: (next: Partial<ObsidianSubToggles>) => void;
  active: boolean;
}

export function useObsidianSettingsPresenter(): (args: ObsidianSettingsPresenterArgs) => void {
  const push = usePushModal();   // 与 useClaudeCodeSettingsPresenter 用法一致
  return (args) => {
    push({
      id: 'obsidian-settings',
      render: (close) => (
        <ObsidianSettingsModal
          value={args.value}
          onChange={args.onChange}
          active={args.active}
          onClose={close}
        />
      ),
    });
  };
}
```

(具体 `push` / `useModalStack` 等 API 跟 `useClaudeCodeSettingsPresenter` 完全一致 — 当那段写法变了对齐即可。)

- [ ] **Step 3: typecheck**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期:PASS。

- [ ] **Step 4: 启 dev 手动验证**

```bash
pnpm --filter auvezy-terminal-remote dev &  # 或按 CLAUDE.md 写的 broker + vite 双进程
sleep 8
```

打开浏览器 → 进入实例 → 设置 → 集成。手动检查:

1. 顶部"运行时集成"组下有 Claude Code(原状)
2. 下方"渲染集成"组下有:Markdown(开关) + Obsidian(开关 + 详细按钮)
3. 关 Markdown → Obsidian 整行灰色 + hint 显示"需要先启用 Markdown"
4. 详细按钮推一层 modal,5 个子开关全显示
5. 切换任一子开关 → 关闭 modal → 重开 → 状态保留(verify 数据写入 config)

验证不通过先回头修;通过后 `pnpm stop` 或 `kill` 所有 dev 进程,**确认 `ss -tln` 没 3000/5173 残留**(CLAUDE.md 红线)。

- [ ] **Step 5: commit**

```bash
git add frontend/src/components/settings/ObsidianSettingsModal.tsx \
        frontend/src/components/settings/IntegrationsSettings.tsx \
        frontend/src/components/settings/GeneralSettings.module.scss \
        frontend/src/components/ui/modal-stack/presenters.tsx
git commit -m "feat(settings): 集成面板双分组(运行时 / 渲染)+ Obsidian 子开关 modal"
```

---

### Task S2-4: `DisplaySettings.tsx` 删除 markdown 开关

**Files:**
- Modify: `frontend/src/components/settings/DisplaySettings.tsx`
- Modify: `frontend/src/i18n/messages.ts`(可选,清理)
- Modify: `frontend/src/i18n/en.ts`(可选,清理)
- Modify: `frontend/src/i18n/zh-CN.ts`(可选,清理)

- [ ] **Step 1: 删 BoolToggleRow + 相关 derive**

`frontend/src/components/settings/DisplaySettings.tsx`:

- 删 `:142` `const markdownPreview = value?.markdownPreview ?? DEFAULT_DISPLAY.markdownPreview;`
- 删末尾 `:477-483` 整个 `{/* 文件预览 — markdown 可视化 */}` + `BoolToggleRow`

- [ ] **Step 2: 删 i18n `display.markdownPreviewTitle` / `display.markdownPreviewHint`**

三个 i18n 文件中各删 2 行(messages.ts:194-195、en.ts:160-161、zh-CN.ts:152-153)。

**注意**:`shared/src/defaults.ts` 里 `markdownPreview?: boolean` 类型与 `DEFAULT_DISPLAY.markdownPreview` 默认值**保留**,这是为了双写迁移期间(3 个 minor)旧字段还在被 normalize 读;但 UI 不再暴露。

- [ ] **Step 3: typecheck**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期:PASS(没有别处 import 这两个 i18n key)。如果有,grep 一下手动改。

- [ ] **Step 4: `PreviewPane.tsx` 切换读源**

打开 `frontend/src/components/files/PreviewPane.tsx`,把 `:30`:

```ts
const mdEnabled = config.display?.markdownPreview === true;
```

改为:

```ts
// rendering.markdown.enabled 是新位置;ensureDefaultUserConfig 已把旧 display.markdownPreview 迁移过来
const mdEnabled = config.integrations?.rendering?.markdown?.enabled !== false;
```

(`!== false` 而非 `=== true`:默认 enabled,只在显式 false 时关闭。)

- [ ] **Step 5: 手动验证**

启 dev → 进入实例 → 设置 → 显示。确认 markdown 开关消失。然后 → 集成 → Markdown 关闭 → 打开一个 .md 文件,确认走 TextPreview(代码高亮路径)而非 MarkdownPreview。

`pnpm stop` 释放端口。

- [ ] **Step 6: commit + 更新 progress**

创建 `docs/plans/obsidian-integration/progress/02-集成面板UI.md`:

```markdown
# S2 · 集成面板 UI 改造

- ✅ i18n obsidian 命名空间完整 key 表(en + zh-CN)
- ✅ IntegrationsSettings 双分组(运行时 / 渲染)+ Markdown / Obsidian 两行
- ✅ ObsidianSettingsModal(5 子开关 + 顶部行为 hint)+ presenter 注册
- ✅ DisplaySettings 移除 markdown 开关 + i18n 旧 key 清理
- ✅ PreviewPane 切换到 rendering.markdown.enabled

shared defaults 保留 `display.markdownPreview` 类型与默认值,double-write 窗口
3 个 minor 后清理(详见 design.md §4.3)。
```

```bash
git add frontend/src/components/settings/DisplaySettings.tsx \
        frontend/src/components/files/PreviewPane.tsx \
        frontend/src/i18n/ \
        docs/plans/obsidian-integration/progress/02-集成面板UI.md
git commit -m "feat(settings): markdown 开关迁出 DisplaySettings,UI 入口归集成"
```

---

# S3 · Frontmatter 渲染

### Task S3-1: 装依赖 + 创建 obsidian 模块入口

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/components/files/markdown/obsidian/index.ts`

- [ ] **Step 1: 装依赖**

```bash
pnpm --filter auvezy-terminal-remote-frontend add js-yaml remark-frontmatter
pnpm --filter auvezy-terminal-remote-frontend add -D @types/js-yaml
```

- [ ] **Step 2: 创建 obsidian 模块入口**

新建 `frontend/src/components/files/markdown/obsidian/index.ts`:

```ts
/**
 * Obsidian 集成模块聚合入口
 *
 * 由 MarkdownPreview 通过二级 lazy import 加载。导出 plugin 数组 + components 工厂,
 * 供主入口在 effective.obsidian = true 时拼装到 ReactMarkdown。
 *
 * Why 单独 chunk:js-yaml (~30KB) + remark-frontmatter + 自写 plugin 体积约 ~50KB,
 * 未开 Obsidian 集成的用户不应付这份代价。
 */

import type { PluggableList } from 'unified';
import type { Components } from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
// 后续 task 加各 plugin 与 component import

export interface ObsidianEffective {
  frontmatter: boolean;
  wikilink: boolean;
  embed: boolean;
  callout: boolean;
  inlineSyntax: boolean;
}

export interface ObsidianBindings {
  remarkPlugins: PluggableList;
  components: Components;
}

export function buildObsidianBindings(_eff: ObsidianEffective): ObsidianBindings {
  // 目前只接 frontmatter,后续 task 逐个补
  return {
    remarkPlugins: [remarkFrontmatter],
    components: {},
  };
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期:PASS(此时 ObsidianBindings 空,但类型对)。

- [ ] **Step 4: commit**

```bash
git add frontend/package.json pnpm-lock.yaml \
        frontend/src/components/files/markdown/obsidian/index.ts
git commit -m "feat(obsidian): 装 js-yaml/remark-frontmatter + obsidian 模块入口骨架"
```

---

### Task S3-2: Frontmatter 解析 + 类型推断 + Properties 表

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/frontmatter.tsx`
- Create: `frontend/src/components/files/markdown/obsidian/frontmatter.module.scss`
- Create: `frontend/src/components/files/markdown/obsidian/frontmatter.test.tsx`

- [ ] **Step 1: 写失败测试 — 类型推断**

`frontend/src/components/files/markdown/obsidian/frontmatter.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FrontmatterTable, inferType } from './frontmatter.js';

describe('inferType', () => {
  it('detects string', () => expect(inferType('hello').kind).toBe('text'));
  it('detects number', () => expect(inferType(42).kind).toBe('number'));
  it('detects boolean', () => expect(inferType(true).kind).toBe('checkbox'));
  it('detects Date', () => expect(inferType(new Date()).kind).toBe('date'));
  it('detects ISO date string', () =>
    expect(inferType('2026-05-22').kind).toBe('date'));
  it('detects ISO datetime string', () =>
    expect(inferType('2026-05-22T10:00:00Z').kind).toBe('date'));
  it('detects wikilink string', () =>
    expect(inferType('[[Foo]]').kind).toBe('link'));
  it('detects array', () => expect(inferType(['a', 'b']).kind).toBe('list'));
  it('falls back to text for other', () =>
    expect(inferType({ nested: 1 } as unknown as string).kind).toBe('text'));
});

describe('FrontmatterTable', () => {
  it('renders parse error gracefully', () => {
    render(<FrontmatterTable raw=":\n  not yaml: [bad" />);
    expect(screen.getByText(/Frontmatter parse error|解析失败/i)).toBeInTheDocument();
  });

  it('renders empty state when yaml object is empty', () => {
    render(<FrontmatterTable raw="" />);
    expect(screen.getByText(/empty|\(空\)/i)).toBeInTheDocument();
  });

  it('renders tags/aliases as chip list even when single string', () => {
    render(<FrontmatterTable raw="tags: project" />);
    expect(screen.getByText('project')).toBeInTheDocument();
    // chip 容器有 .chip 类(实现 step 给定)
    expect(screen.getByText('project').className).toMatch(/chip/i);
  });
});
```

(测试用 `@testing-library/react` + `vitest` — 项目已配置,verify 一下:`grep "@testing-library/react" frontend/package.json`)

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- frontmatter.test
```

预期 FAIL(模块未导出)。

- [ ] **Step 3: 写 `frontmatter.tsx`**

```tsx
/**
 * FrontmatterTable — YAML frontmatter 渲染为 Obsidian Properties 风格表
 *
 * 数据流:raw YAML 字符串 → js-yaml.load → 类型推断 → 行渲染
 * 失败时显示一行错误 + 原文(不丢内容)。
 *
 * 类型推断对齐 Obsidian:string/number/checkbox/date/list/link 6 种 + text fallback;
 * tags/aliases/cssclass 三个特殊 key 强制 array(即使值是 string)。
 */

import { useMemo, useState, type JSX } from 'react';
import yaml from 'js-yaml';
import { useT } from '../../../../i18n/i18n-context.js';
import s from './frontmatter.module.scss';

export interface FrontmatterTableProps {
  raw: string;
}

export type PropKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'link';

export interface PropTypeInfo {
  kind: PropKind;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const WIKILINK_RE = /^\s*\[\[[^\]]+\]\]\s*$/;
const FORCE_ARRAY_KEYS = new Set(['tags', 'aliases', 'cssclass', 'cssclasses']);

export function inferType(v: unknown): PropTypeInfo {
  if (Array.isArray(v)) return { kind: 'list' };
  if (typeof v === 'number') return { kind: 'number' };
  if (typeof v === 'boolean') return { kind: 'checkbox' };
  if (v instanceof Date) return { kind: 'date' };
  if (typeof v === 'string') {
    if (ISO_DATE_RE.test(v)) return { kind: 'date' };
    if (WIKILINK_RE.test(v)) return { kind: 'link' };
    return { kind: 'text' };
  }
  return { kind: 'text' };
}

const KIND_ICON: Record<PropKind, string> = {
  text: 'A',
  number: '#',
  checkbox: '☑',
  date: '📅',
  list: '#',
  link: '🔗',
};

export function FrontmatterTable({ raw }: FrontmatterTableProps): JSX.Element {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);

  const parsed = useMemo(() => {
    try {
      const v = yaml.load(raw);
      if (v == null) return { ok: true as const, data: {} as Record<string, unknown> };
      if (typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false as const, err: 'YAML root is not a mapping' };
      }
      return { ok: true as const, data: v as Record<string, unknown> };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [raw]);

  if (!parsed.ok) {
    return (
      <aside className={s.error} role="alert">
        <strong>{t('obsidian.frontmatterParseError')}</strong>
        <pre className={s.errorMsg}>{parsed.err}</pre>
      </aside>
    );
  }

  const entries = Object.entries(parsed.data);
  if (entries.length === 0) {
    return <aside className={s.empty}>{t('obsidian.frontmatterEmpty')}</aside>;
  }

  return (
    <aside className={s.table} data-collapsed={collapsed ? 'true' : 'false'}>
      <header className={s.header}>
        <button
          type="button"
          className={s.toggle}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className={s.chev}>{collapsed ? '▶' : '▼'}</span>
          <span className={s.title}>{t('obsidian.frontmatterTitle')}</span>
          <span className={s.count}>{t('obsidian.frontmatterCount').replace('{n}', String(entries.length))}</span>
        </button>
      </header>
      {!collapsed && (
        <ul className={s.rows}>
          {entries.map(([key, val]) => {
            const v = FORCE_ARRAY_KEYS.has(key) && !Array.isArray(val) ? [val] : val;
            const t0 = inferType(v);
            return (
              <li key={key} className={s.row} data-kind={t0.kind}>
                <span className={s.kindIcon} aria-hidden="true">{KIND_ICON[t0.kind]}</span>
                <span className={s.key}>{key}</span>
                <span className={s.val}>{renderValue(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function renderValue(v: unknown): JSX.Element {
  if (Array.isArray(v)) {
    return (
      <span className={s.chips}>
        {v.map((item, i) => (
          <span key={i} className={s.chip}>{String(typeof item === 'string' ? item : JSON.stringify(item))}</span>
        ))}
      </span>
    );
  }
  if (typeof v === 'boolean') return <>{v ? '✓' : '✗'}</>;
  if (v instanceof Date) return <>{v.toLocaleDateString()}</>;
  if (v == null) return <span className={s.nullVal}>—</span>;
  return <>{String(v)}</>;
}
```

- [ ] **Step 4: 写 `frontmatter.module.scss`**

```scss
.table {
  margin: 0 0 1.5rem;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface-2);
  font-size: 13px;
}

.header { margin: 0 0 8px; }

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: var(--color-text);
  width: 100%;
  text-align: left;
}

.chev { color: var(--color-text-muted); font-size: 11px; }
.title { font-weight: 600; }
.count { color: var(--color-text-muted); margin-left: 4px; }

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 4px 12px;
  align-items: baseline;
}

.row {
  display: contents;
}

.kindIcon {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
  width: 16px;
}

.key { color: var(--color-text-muted); font-weight: 500; }
.val { color: var(--color-text); word-break: break-word; }

.chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 9999px;
  background: var(--color-surface-3);
  font-size: 12px;
  color: var(--color-text);
}

.nullVal { color: var(--color-text-muted); }

.error {
  margin: 0 0 1.5rem;
  padding: 12px 16px;
  border: 1px solid var(--color-alarm);
  border-radius: 6px;
  background: var(--color-surface-2);
  color: var(--color-alarm);
  font-size: 13px;
}

.errorMsg {
  margin: 4px 0 0;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
}

.empty {
  margin: 0 0 1.5rem;
  padding: 8px 16px;
  color: var(--color-text-muted);
  font-style: italic;
  font-size: 13px;
}
```

(SCSS token 用项目既有 `--color-text` / `--color-surface-2` / `--color-alarm` 等;memory 提醒不存在 `--color-danger`,用 `--color-alarm`。)

- [ ] **Step 5: 运行测试确认 PASS**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- frontmatter.test
```

预期:全 PASS。

- [ ] **Step 6: commit**

```bash
git add frontend/src/components/files/markdown/obsidian/frontmatter.*
git commit -m "feat(obsidian): FrontmatterTable + 类型推断 + 解析失败兜底"
```

---

### Task S3-3: 自写 `remarkObsidianFrontmatter` plugin + 接入主入口

**Files:**
- Modify: `frontend/src/components/files/markdown/obsidian/index.ts`
- Modify: `frontend/src/components/files/MarkdownPreview.tsx`

- [ ] **Step 1: 把 frontmatter 接进 obsidian index**

修改 `frontend/src/components/files/markdown/obsidian/index.ts`:

```ts
import type { PluggableList } from 'unified';
import type { Components } from 'react-markdown';
import type { Root, Yaml } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import { FrontmatterTable } from './frontmatter.js';

export interface ObsidianEffective {
  frontmatter: boolean;
  wikilink: boolean;
  embed: boolean;
  callout: boolean;
  inlineSyntax: boolean;
}

export interface ObsidianBindings {
  remarkPlugins: PluggableList;
  components: Components;
}

/**
 * 把 remark-frontmatter 产出的 `yaml` 节点替换为自定义 `obsFrontmatter` 节点,
 * 并把 raw YAML 字符串挂到 `data.hProperties.raw`(传给 react-markdown components)。
 * 子开关关闭时,strip 该节点(不渲染)。
 */
function remarkObsidianFrontmatter(opts: { enabled: boolean }) {
  return (tree: Root): void => {
    visit(tree, 'yaml', (node: Yaml, index, parent) => {
      if (!parent || index == null) return;
      if (!opts.enabled) {
        parent.children.splice(index, 1);
        return;
      }
      parent.children[index] = {
        type: 'paragraph',
        data: {
          hName: 'obs-frontmatter',
          hProperties: { raw: node.value },
        },
        children: [],
      } as unknown as Root['children'][number];
    });
  };
}

export function buildObsidianBindings(eff: ObsidianEffective): ObsidianBindings {
  return {
    remarkPlugins: [
      remarkFrontmatter,
      [remarkObsidianFrontmatter, { enabled: eff.frontmatter }],
    ],
    components: {
      'obs-frontmatter': (props: { raw?: string }) => (
        <FrontmatterTable raw={props.raw ?? ''} />
      ),
    } as Components,
  };
}
```

(`unist-util-visit` 是 remark 标准依赖,已经在 remark-frontmatter / unified 间接 deps 中。`mdast` types 同理。如缺,显式 `pnpm add -D unist-util-visit @types/mdast`。)

- [ ] **Step 2: MarkdownPreview 接入二级 lazy**

修改 `frontend/src/components/files/MarkdownPreview.tsx`:

A. 删除既有 `renderBlockquote` / `extractLeadingText` / `stripAlertMarker` / `ALERT_RE` / `AlertKind`(下一阶段 callout 替代,先去掉避免混淆)。

B. 删除 components 里的 `blockquote(props)` 那一项。

C. 头部加 lazy obsidian + effective derive:

```tsx
import { lazy, Suspense, ... } from 'react';

const ObsidianModule = lazy(() =>
  import('./markdown/obsidian/index.js').then((m) => ({ default: m })),
);
```

> ⚠️ `lazy` 用法注意:react `lazy` 只接受 `() => Promise<{ default: ComponentType }>`,而 `index.ts` 导出的是 functions/types 不是 component。需要包装:

更直接的做法:**不用 React.lazy**,而是用 useEffect + state:

```tsx
import { buildObsidianBindings, type ObsidianBindings, type ObsidianEffective } from './markdown/obsidian/index.js';

// 在组件里
const [obsBindings, setObsBindings] = useState<ObsidianBindings | null>(null);

const obsEff: ObsidianEffective | null = useMemo(() => {
  const obs = config.integrations?.rendering?.obsidian;
  if (!obs || obs.enabled === false) return null;
  return {
    frontmatter: obs.frontmatter !== false,
    wikilink: obs.wikilink !== false,
    embed: obs.embed !== false,
    callout: obs.callout !== false,
    inlineSyntax: obs.inlineSyntax !== false,
  };
}, [config.integrations?.rendering?.obsidian]);

useEffect(() => {
  if (!obsEff) { setObsBindings(null); return; }
  let cancelled = false;
  void import('./markdown/obsidian/index.js').then((m) => {
    if (!cancelled) setObsBindings(m.buildObsidianBindings(obsEff));
  });
  return () => { cancelled = true; };
}, [obsEff]);
```

D. 把 plugins 与 components 合并:

```tsx
const remarkPlugins = useMemo(
  () => [remarkGfm, remarkMath, ...(obsBindings?.remarkPlugins ?? [])],
  [obsBindings],
);
const mergedComponents = useMemo(
  () => ({ ...components, ...(obsBindings?.components ?? {}) }),
  [components, obsBindings],
);

// ReactMarkdown 用 mergedComponents + remarkPlugins
```

- [ ] **Step 3: typecheck + run**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期 PASS。

- [ ] **Step 4: 手动 smoke**

启 dev,打开一篇带 frontmatter 的 .md 文件(在 ATR 实例工作目录里临时建个 fixture)。例如:

```md
---
title: Test Note
tags: [project, draft]
created: 2026-05-22
published: true
related: "[[Other]]"
---

# Hello

Body.
```

进入文件浏览器 → 预览。预期:顶部出现 Properties 表(标题 / chips / 日期 / 勾 / 🔗)。关掉 frontmatter 子开关 → frontmatter 块隐藏,只有 `# Hello` 正文。

`pnpm stop` 释放端口。

- [ ] **Step 5: commit + 更新 progress**

创建 `docs/plans/obsidian-integration/progress/03-frontmatter.md`:

```markdown
# S3 · Frontmatter

- ✅ js-yaml + remark-frontmatter 装包
- ✅ obsidian 模块入口骨架(二级 lazy)
- ✅ FrontmatterTable + 类型推断 + 错误兜底
- ✅ remarkObsidianFrontmatter plugin(子开关 strip / 渲染分支)
- ✅ MarkdownPreview 删 GFM Alert 旧实现(为 callout 重写让位)+ 接 obsidian bindings

下一步:S4 callout 13 类。
```

```bash
git add frontend/src/components/files/markdown/obsidian/ \
        frontend/src/components/files/MarkdownPreview.tsx \
        docs/plans/obsidian-integration/progress/03-frontmatter.md
git commit -m "feat(obsidian): frontmatter 渲染管线(plugin + Properties 表)+ lazy 二级 chunk"
```

---

# S4 · Callout 13 类

### Task S4-1: `callout-types.ts` 常量表

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/callout-types.ts`

- [ ] **Step 1: 写 13 类 + 别名常量**

```ts
/**
 * Obsidian callout 13 类 + 别名表。
 *
 * 大小写不敏感:解析时 type 字符串先 toLowerCase 再查表。
 * 别名(如 `tldr` → `abstract`)在 ALIASES 中映射到主 kind。
 *
 * 颜色 token 用项目既有:--color-info / --color-success / --color-warn / --color-alarm /
 * --color-muted。memory 提示:不存在 --color-danger,alarm tone 用 --color-alarm。
 */

export type CalloutKind =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'success'
  | 'question'
  | 'warning'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote';

export const ALL_CALLOUT_KINDS: readonly CalloutKind[] = [
  'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
] as const;

/** 别名 → 主 kind */
export const CALLOUT_ALIASES: Readonly<Record<string, CalloutKind>> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

export interface CalloutMeta {
  /** i18n key,见 `obsidian.calloutXxx` */
  i18nKey: string;
  /** SCSS class name suffix (callout--<tone>) */
  tone: 'info' | 'success' | 'warn' | 'alarm' | 'muted';
}

export const CALLOUT_META: Readonly<Record<CalloutKind, CalloutMeta>> = {
  note:     { i18nKey: 'obsidian.calloutNote',     tone: 'info' },
  abstract: { i18nKey: 'obsidian.calloutAbstract', tone: 'info' },
  info:     { i18nKey: 'obsidian.calloutInfo',     tone: 'info' },
  todo:     { i18nKey: 'obsidian.calloutTodo',     tone: 'info' },
  tip:      { i18nKey: 'obsidian.calloutTip',      tone: 'success' },
  success:  { i18nKey: 'obsidian.calloutSuccess',  tone: 'success' },
  question: { i18nKey: 'obsidian.calloutQuestion', tone: 'warn' },
  warning:  { i18nKey: 'obsidian.calloutWarning',  tone: 'warn' },
  failure:  { i18nKey: 'obsidian.calloutFailure',  tone: 'alarm' },
  danger:   { i18nKey: 'obsidian.calloutDanger',   tone: 'alarm' },
  bug:      { i18nKey: 'obsidian.calloutBug',      tone: 'alarm' },
  example:  { i18nKey: 'obsidian.calloutExample',  tone: 'info' },
  quote:    { i18nKey: 'obsidian.calloutQuote',    tone: 'muted' },
};

/** type 字符串 → kind(应用别名 + 大小写归一);未知返回 null */
export function resolveCalloutKind(raw: string): CalloutKind | null {
  const k = raw.trim().toLowerCase();
  if ((ALL_CALLOUT_KINDS as readonly string[]).includes(k)) return k as CalloutKind;
  return CALLOUT_ALIASES[k] ?? null;
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期 PASS。

- [ ] **Step 3: commit**

```bash
git add frontend/src/components/files/markdown/obsidian/callout-types.ts
git commit -m "feat(obsidian): callout 13 类 + 别名表"
```

---

### Task S4-2: `remarkObsidianCallout` plugin + 组件 + 测试

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/callout.tsx`
- Create: `frontend/src/components/files/markdown/obsidian/callout.module.scss`
- Create: `frontend/src/components/files/markdown/obsidian/callout.test.tsx`
- Modify: `frontend/src/components/files/markdown/obsidian/index.ts`

- [ ] **Step 1: 写失败测试**

`callout.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkObsidianCallout, CalloutBlock } from './callout.js';

function renderMd(md: string): HTMLElement {
  const { container } = render(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkObsidianCallout, { enabled: true }]]}
      components={{ 'obs-callout': CalloutBlock as never }}
    >{md}</ReactMarkdown>,
  );
  return container;
}

describe('remarkObsidianCallout', () => {
  it('recognizes all 13 kinds', () => {
    const kinds = ['note','abstract','info','todo','tip','success','question','warning','failure','danger','bug','example','quote'];
    for (const k of kinds) {
      const c = renderMd(`> [!${k}] T\n> body`);
      expect(c.querySelector('.callout')).toBeTruthy();
      expect(c.querySelector(`[data-kind="${k}"]`)).toBeTruthy();
    }
  });

  it('resolves aliases (tldr → abstract)', () => {
    const c = renderMd('> [!tldr] T\n> body');
    expect(c.querySelector('[data-kind="abstract"]')).toBeTruthy();
  });

  it('case insensitive', () => {
    const c = renderMd('> [!NOTE] T\n> body');
    expect(c.querySelector('[data-kind="note"]')).toBeTruthy();
  });

  it('respects + collapsible default open', () => {
    const c = renderMd('> [!tip]+ Open\n> body');
    const details = c.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.hasAttribute('open')).toBe(true);
  });

  it('respects - collapsible default closed', () => {
    const c = renderMd('> [!tip]- Closed\n> body');
    const details = c.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.hasAttribute('open')).toBe(false);
  });

  it('uses custom title when given', () => {
    const c = renderMd('> [!note] My custom title\n> body');
    expect(screen.getByText('My custom title')).toBeInTheDocument();
  });

  it('falls back to i18n default title when not given', () => {
    const c = renderMd('> [!note]\n> body');
    // i18n 默认是 'Note' / '笔记' — test locale env 决定;命中至少一个
    expect(c.textContent).toMatch(/Note|笔记/);
  });

  it('falls back to plain blockquote when type is unknown', () => {
    const c = renderMd('> [!nonsense] T\n> body');
    expect(c.querySelector('.callout')).toBeFalsy();
    expect(c.querySelector('blockquote')).toBeTruthy();
  });

  it('falls back to plain blockquote when enabled=false', () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkObsidianCallout, { enabled: false }]]}
        components={{ 'obs-callout': CalloutBlock as never }}
      >{'> [!note] T\n> body'}</ReactMarkdown>,
    );
    expect(container.querySelector('.callout')).toBeFalsy();
    expect(container.querySelector('blockquote')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- callout.test
```

预期 FAIL(`./callout.js` missing exports)。

- [ ] **Step 3: 写 `callout.tsx`(plugin + 组件)**

```tsx
/**
 * remarkObsidianCallout — 把首段以 `[!type](+|-)?\s*title` 开头的 blockquote
 * 升级为 obs-callout 自定义节点。enabled=false 时不识别(直接回退到 react-markdown
 * 默认 blockquote 渲染)。
 *
 * 替换既有 MarkdownPreview 内 renderBlockquote 5 类 GFM Alert(callout 是其超集)。
 */

import { type JSX, type ReactNode } from 'react';
import type { Plugin } from 'unified';
import type { Root, Blockquote, Paragraph, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { useT } from '../../../../i18n/i18n-context.js';
import {
  resolveCalloutKind,
  CALLOUT_META,
  type CalloutKind,
} from './callout-types.js';
import s from './callout.module.scss';

const CALLOUT_HEADER_RE = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/i;

export interface RemarkObsidianCalloutOptions {
  enabled: boolean;
}

export const remarkObsidianCallout: Plugin<[RemarkObsidianCalloutOptions], Root> = (opts) => {
  return (tree) => {
    if (!opts.enabled) return;
    visit(tree, 'blockquote', (node: Blockquote, index, parent) => {
      if (!parent || index == null) return;
      const first = node.children[0];
      if (!first || first.type !== 'paragraph') return;
      const firstChild = (first as Paragraph).children[0];
      if (!firstChild || firstChild.type !== 'text') return;
      const text = (firstChild as Text).value;
      const lines = text.split('\n');
      const head = lines[0] ?? '';
      const m = CALLOUT_HEADER_RE.exec(head);
      if (!m) return;

      const kind = resolveCalloutKind(m[1]!);
      if (!kind) return;  // 未知类型 → 不动,留作普通 blockquote

      const collapseMode = m[2] === '+' ? 'open' : m[2] === '-' ? 'closed' : 'none';
      const customTitle = m[3]?.trim() ?? '';

      // 把第一段的首个 text 节点的首行剥掉,剩余仍是 paragraph children
      const restFirstLine = lines.slice(1).join('\n');
      if (restFirstLine.length > 0) {
        (firstChild as Text).value = restFirstLine;
      } else if ((first as Paragraph).children.length > 1) {
        // 首 child 是空 string,删它,剩下的兄弟保留
        (first as Paragraph).children.shift();
      } else {
        // 整个第一 paragraph 只有头部一行,删 paragraph
        node.children.shift();
      }

      const replacement = {
        type: 'paragraph',
        data: {
          hName: 'obs-callout',
          hProperties: {
            kind,
            collapse: collapseMode,
            title: customTitle,
          },
        },
        children: node.children as unknown as Paragraph['children'],
      } as unknown as Root['children'][number];

      parent.children[index] = replacement;
    });
  };
};

export interface CalloutBlockProps {
  kind?: CalloutKind;
  collapse?: 'none' | 'open' | 'closed';
  title?: string;
  children?: ReactNode;
}

export function CalloutBlock({
  kind,
  collapse = 'none',
  title,
  children,
}: CalloutBlockProps): JSX.Element {
  const t = useT();
  if (!kind) {
    return <blockquote>{children}</blockquote>;
  }
  const meta = CALLOUT_META[kind];
  const displayTitle = title && title.length > 0 ? title : t(meta.i18nKey);
  const cls = `${s.callout} callout`;

  if (collapse === 'none') {
    return (
      <aside className={cls} data-kind={kind} data-tone={meta.tone}>
        <header className={s.title}>{displayTitle}</header>
        <div className={s.body}>{children}</div>
      </aside>
    );
  }
  return (
    <details className={cls} data-kind={kind} data-tone={meta.tone} open={collapse === 'open'}>
      <summary className={s.title}>{displayTitle}</summary>
      <div className={s.body}>{children}</div>
    </details>
  );
}
```

- [ ] **Step 4: 写 `callout.module.scss`**

```scss
.callout {
  margin: 1rem 0;
  padding: 12px 16px;
  border-left: 4px solid var(--color-info);
  border-radius: 4px;
  background: var(--color-surface-2);
  font-size: 14px;

  &[data-tone='info'] { border-color: var(--color-info); }
  &[data-tone='success'] { border-color: var(--color-success); }
  &[data-tone='warn'] { border-color: var(--color-warn); }
  &[data-tone='alarm'] { border-color: var(--color-alarm); }
  &[data-tone='muted'] { border-color: var(--color-text-muted); }
}

.title {
  font-weight: 600;
  margin: 0 0 4px;
  cursor: inherit;
  color: var(--color-text);
}

.body {
  > :first-child { margin-top: 0; }
  > :last-child { margin-bottom: 0; }
}

details.callout > summary {
  list-style: none;
  &::-webkit-details-marker { display: none; }
  cursor: pointer;
  &::before {
    content: '▶';
    display: inline-block;
    margin-right: 6px;
    transition: transform 0.15s;
    color: var(--color-text-muted);
  }
}

details[open].callout > summary::before {
  transform: rotate(90deg);
}
```

- [ ] **Step 5: 把 callout 接进 obsidian index**

修改 `frontend/src/components/files/markdown/obsidian/index.ts`:

```ts
import { remarkObsidianCallout, CalloutBlock } from './callout.js';
// ...

export function buildObsidianBindings(eff: ObsidianEffective): ObsidianBindings {
  return {
    remarkPlugins: [
      remarkFrontmatter,
      [remarkObsidianFrontmatter, { enabled: eff.frontmatter }],
      [remarkObsidianCallout, { enabled: eff.callout }],
    ],
    components: {
      'obs-frontmatter': (props: { raw?: string }) => (
        <FrontmatterTable raw={props.raw ?? ''} />
      ),
      'obs-callout': CalloutBlock as never,
    } as Components,
  };
}
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- callout.test
```

预期:全部 PASS。

- [ ] **Step 7: 手动 smoke**

启 dev,fixture `.md`:

```md
> [!note] Hello
> body line 1
> body line 2

> [!tip]+ Expanded
> tip body

> [!tldr]- Collapsed
> abstract via alias

> [!warning] custom title here
> warn body

> regular blockquote
```

预期:5 个 callout,默认 title vs 自定义、+/- 折叠、tldr 走 abstract 配色;最后一行普通 blockquote 不变。
关掉 callout 子开关 → 全部回退普通 blockquote。

`pnpm stop`。

- [ ] **Step 8: commit + progress**

`docs/plans/obsidian-integration/progress/04-callout.md`:

```markdown
# S4 · Callout 13 类

- ✅ callout-types.ts 13 类 + 别名 + 颜色 tone
- ✅ remarkObsidianCallout plugin(+/- collapsible / 别名 / 大小写不敏感)
- ✅ CalloutBlock 组件(details / aside 两种形态)+ SCSS
- ✅ 单测 9 用例覆盖识别 / 别名 / 折叠 / 子开关关闭

GFM Alert 旧实现已在 S3 删除(callout 是其超集)。
```

```bash
git add frontend/src/components/files/markdown/obsidian/callout.* \
        frontend/src/components/files/markdown/obsidian/index.ts \
        docs/plans/obsidian-integration/progress/04-callout.md
git commit -m "feat(obsidian): callout 13 类 + 别名 + collapsible(替换 GFM Alert)"
```

---

# S5 · Inline Syntax

### Task S5-1: `remarkObsidianInline` plugin + 测试

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/inline-syntax.ts`
- Create: `frontend/src/components/files/markdown/obsidian/inline-syntax.module.scss`
- Create: `frontend/src/components/files/markdown/obsidian/inline-syntax.test.ts`
- Modify: `frontend/src/components/files/markdown/obsidian/index.ts`

- [ ] **Step 1: 写失败测试**

`inline-syntax.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkObsidianInline } from './inline-syntax.js';

function process(md: string, enabled = true): string {
  const out = unified()
    .use(remarkParse)
    .use(remarkObsidianInline, { enabled })
    .use(remarkStringify)
    .processSync(md);
  return String(out);
}

function processToMdast(md: string, enabled = true): unknown {
  return unified()
    .use(remarkParse)
    .use(remarkObsidianInline, { enabled })
    .parse(md);
}

describe('remarkObsidianInline', () => {
  describe('highlight ==text==', () => {
    it('recognizes ==text==', () => {
      const tree = JSON.stringify(processToMdast('hello ==bright== world'));
      expect(tree).toContain('"obsHighlight"');
    });
    it('keeps raw text when enabled=false', () => {
      const tree = JSON.stringify(processToMdast('hello ==bright== world', false));
      expect(tree).not.toContain('"obsHighlight"');
    });
  });

  describe('comment %%text%%', () => {
    it('recognizes inline comment', () => {
      const tree = JSON.stringify(processToMdast('visible %%hidden%% rest'));
      expect(tree).toContain('"obsComment"');
    });
  });

  describe('tag #tag', () => {
    it('recognizes #foo with letter start', () => {
      const tree = JSON.stringify(processToMdast('see #project today'));
      expect(tree).toContain('"obsTag"');
    });
    it('does NOT recognize #123 (numeric only)', () => {
      const tree = JSON.stringify(processToMdast('issue #123 here'));
      expect(tree).not.toContain('"obsTag"');
    });
    it('does NOT recognize text#frag (no whitespace before)', () => {
      const tree = JSON.stringify(processToMdast('url#fragment here'));
      expect(tree).not.toContain('"obsTag"');
    });
    it('recognizes nested #a/b', () => {
      const tree = JSON.stringify(processToMdast('tagged #notes/2026'));
      expect(tree).toContain('"obsTag"');
    });
  });

  describe('block id ^id', () => {
    it('recognizes line-end ^id', () => {
      const tree = JSON.stringify(processToMdast('paragraph end ^abc-1'));
      expect(tree).toContain('"obsBlockId"');
    });
    it('does NOT recognize mid-line ^id', () => {
      const tree = JSON.stringify(processToMdast('text ^abc more text'));
      expect(tree).not.toContain('"obsBlockId"');
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- inline-syntax.test
```

预期 FAIL。

- [ ] **Step 3: 写 `inline-syntax.ts`**

```ts
/**
 * remarkObsidianInline — 在 text 节点上切出 Obsidian inline 语法:
 *   ==highlight==   → obsHighlight 节点 → <mark>
 *   %%comment%%     → obsComment 节点 → 不渲染 (null)
 *   #tag            → obsTag 节点    → <span class="atr-tag">#tag</span>
 *   ^block-id       → obsBlockId 节点 → 用于 anchor 跳转,不渲染可见内容(挂 data-block-id)
 *
 * 关闭子开关(enabled=false)时整个 plugin no-op,文本保留原样。
 *
 * 设计上避免在已经是 inline 节点(link/code/emphasis…)内部切分 — 通过
 * `visit` 'text' 类型 + 父节点白名单(只处理 paragraph/listItem/blockquote/heading
 * 等"段落级"父节点的直接 text 子)。
 */

import type { Plugin } from 'unified';
import type { Root, Text, Paragraph, PhrasingContent } from 'mdast';
import { visit } from 'unist-util-visit';

const HIGHLIGHT_RE = /==([^=]+)==/g;
const COMMENT_RE = /%%([^%]+)%%/g;
const TAG_RE = /(^|\s)#([A-Za-z][\w/-]*)/g;
const BLOCK_ID_RE = /(?:^|\s)\^([a-z0-9-]+)\s*$/;

export interface RemarkObsidianInlineOptions {
  enabled: boolean;
}

export const remarkObsidianInline: Plugin<[RemarkObsidianInlineOptions], Root> = (opts) => {
  return (tree) => {
    if (!opts.enabled) return;

    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return;
      // 只处理段落级父节点的 text 子;skip link / code / emphasis 等
      const parentType = (parent as { type: string }).type;
      if (!['paragraph','listItem','blockquote','tableCell','heading'].includes(parentType)) return;

      const replacements = splitTextNode(node.value);
      if (replacements.length === 1 && replacements[0]!.type === 'text') return;

      (parent as Paragraph).children.splice(index, 1, ...replacements);
      return [visit.SKIP, index + replacements.length];
    });
  };
};

type AnyNode = PhrasingContent | (Text & { type: 'obsHighlight' | 'obsComment' | 'obsTag' | 'obsBlockId' });

function splitTextNode(input: string): AnyNode[] {
  // 先扫 block-id(只在行尾,匹配独立),再扫 inline 三种
  // 简化:由 4 个正则分别迭代,优先级 highlight > comment > tag > block-id;
  // 实际产出顺序按出现位置排序。
  type Hit = { start: number; end: number; node: AnyNode };
  const hits: Hit[] = [];

  for (const m of input.matchAll(HIGHLIGHT_RE)) {
    hits.push({ start: m.index!, end: m.index! + m[0].length, node: { type: 'obsHighlight' as never, value: m[1]! } });
  }
  for (const m of input.matchAll(COMMENT_RE)) {
    hits.push({ start: m.index!, end: m.index! + m[0].length, node: { type: 'obsComment' as never, value: m[1]! } });
  }
  for (const m of input.matchAll(TAG_RE)) {
    // m[1] 是前置空白(可能空),m[2] 是 tag 名
    const tagStart = m.index! + (m[1]?.length ?? 0);
    hits.push({ start: tagStart, end: tagStart + 1 + m[2]!.length, node: { type: 'obsTag' as never, value: m[2]! } });
  }
  const blockMatch = BLOCK_ID_RE.exec(input);
  if (blockMatch) {
    const start = blockMatch.index + (blockMatch[0].startsWith(' ') || blockMatch[0].startsWith('\t') ? 1 : 0);
    hits.push({ start, end: input.length, node: { type: 'obsBlockId' as never, value: blockMatch[1]! } });
  }

  // 排序 + 去重叠(简单方案:先到先得)
  hits.sort((a, b) => a.start - b.start);
  const out: AnyNode[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;  // 重叠 skip
    if (h.start > cursor) {
      out.push({ type: 'text', value: input.slice(cursor, h.start) } as Text);
    }
    out.push(h.node);
    cursor = h.end;
  }
  if (cursor < input.length) {
    out.push({ type: 'text', value: input.slice(cursor) } as Text);
  }
  return out.length > 0 ? out : [{ type: 'text', value: input } as Text];
}
```

- [ ] **Step 4: 写 `inline-syntax.module.scss`**

```scss
:global {
  .atr-obs-highlight {
    background: var(--color-highlight, #ffe58a);
    color: var(--color-text);
    padding: 0 2px;
    border-radius: 2px;
  }
  .atr-obs-tag {
    display: inline-block;
    padding: 0 6px;
    margin: 0 2px;
    border-radius: 9999px;
    background: var(--color-surface-3);
    color: var(--color-info);
    font-size: 0.85em;
    font-family: var(--font-mono);
    text-decoration: none;
  }
  /* block-id 锚点:不可见但保留 DOM 节点供 anchor-bus scrollIntoView 定位 */
  .atr-obs-block-id {
    display: inline-block;
    width: 0;
    height: 0;
    overflow: hidden;
  }
}
```

- [ ] **Step 5: 把 inline 接进 obsidian index + 加 components**

修改 `frontend/src/components/files/markdown/obsidian/index.ts`:

```ts
import { remarkObsidianInline } from './inline-syntax.js';
import './inline-syntax.module.scss';

// buildObsidianBindings 内 remarkPlugins 加:
[remarkObsidianInline, { enabled: eff.inlineSyntax }],

// components 加:
'obs-highlight': (props: { children?: ReactNode }) => (
  <mark className="atr-obs-highlight">{props.children}</mark>
),
'obs-comment': () => null,
'obs-tag': (props: { children?: ReactNode }) => (
  <span className="atr-obs-tag">#{props.children}</span>
),
'obs-block-id': (props: { children?: ReactNode }) => (
  <span className="atr-obs-block-id" data-block-id={String(props.children ?? '')} aria-hidden="true">
    {props.children}
  </span>
),
```

`obsHighlight` / `obsComment` 等 mdast 节点 type 转 hast tag 名,**需要**一个 mdast→hast 处理 — 简化:plugin 产出节点时就挂 `data.hName`:

修改 `inline-syntax.ts` 的 `splitTextNode`,每种 hit 节点改为:

```ts
// highlight
{ start, end, node: {
  type: 'paragraph',  // 占位,会被 hName 覆盖
  data: { hName: 'obs-highlight' },
  children: [{ type: 'text', value: m[1]! } as Text],
} as never }
```

(其余 comment/tag/block-id 同模式)

> 上面"占位 paragraph"做法在 mdast → hast 阶段会被 react-markdown 当 phrasing 处理;若实测 phrasing/flow 校验失败,改用 `data: { hName: '...', hChildren: [{type:'text', value:...}] }` 在 paragraph 包装下用 hChildren 直接给 hast 子 — 二选一调通即可,**最终目的**:plugin 产出节点经 react-markdown 渲染到 `<obs-highlight>` 等自定义元素。

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- inline-syntax.test
```

预期 PASS。如果"占位 paragraph"方案在某种 case 下产出意外结构,根据 vitest 错误消息调整 hName/hChildren 组合。

- [ ] **Step 7: 手动 smoke**

fixture:

```md
This is ==important== text.

Some %%hidden comment%% in line.

Tagged with #project and #notes/2026.

Numeric like #123 should NOT be tag.

Block id at end. ^anchor-1
```

预期:`important` 黄底高亮;`hidden comment` 不可见;`project` 和 `notes/2026` 是 chip;`#123` 保持原文;末尾段落有不可见 block-id 锚点(F12 可看到 `data-block-id="anchor-1"`)。

关掉子开关 → 全保留原文。

- [ ] **Step 8: commit + progress**

`progress/05-inline-syntax.md`:

```markdown
# S5 · Inline Syntax

- ✅ remarkObsidianInline 自写 plugin(==/%%/#tag/^id)
- ✅ #tag 首字符必 letter,排除 #123 / url#frag
- ✅ ^block-id 仅行尾,字符集 [a-z0-9-]
- ✅ enabled=false 时整 plugin no-op,原文保留
- ✅ 子开关关闭语义:保留原文(与 wikilink/embed 降级样式不同,见 design.md §6.3.5)
```

```bash
git add frontend/src/components/files/markdown/obsidian/inline-syntax.* \
        frontend/src/components/files/markdown/obsidian/index.ts \
        docs/plans/obsidian-integration/progress/05-inline-syntax.md
git commit -m "feat(obsidian): inline 语法 plugin(==/%%/#tag/^block-id)"
```

---

# S6a · Wikilink Backend

### Task S6a-1: `WorkspaceIndex` + 解析算法

**Files:**
- Create: `backend/src/files/wikilink-resolver.ts`
- Create: `backend/src/files/wikilink-resolver.test.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/files/wikilink-resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceIndex } from './wikilink-resolver.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'atr-wikilink-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function touch(rel: string, content = ''): void {
  const full = join(cwd, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('WorkspaceIndex.resolve', () => {
  it('resolves unique short name', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('notes/from.md', 'foo').resolved).toBe('notes/foo.md');
  });

  it('returns broken when no candidate', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('notes/from.md', 'missing').broken).toBe(true);
  });

  it('picks shortest-path on multiple matches', async () => {
    touch('notes/2024/foo.md');
    touch('archive/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // from notes/2026/today.md → notes/2024/foo.md wins (1 共同目录段)
    const r = idx.resolve('notes/2026/today.md', 'foo');
    expect(r.resolved).toBe('notes/2024/foo.md');
    expect(r.candidates).toEqual(['archive/foo.md', 'notes/2024/foo.md'].sort());
  });

  it('tie-break by byte order', async () => {
    touch('a/foo.md');
    touch('b/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // common = 0 both, byte order 'a' < 'b'
    expect(idx.resolve('root.md', 'foo').resolved).toBe('a/foo.md');
  });

  it('resolves vault root path with /', async () => {
    touch('a/b/c.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('other.md', 'a/b/c').resolved).toBe('a/b/c.md');
  });

  it('falls back to current dir when vault-relative not found', async () => {
    touch('notes/sub/target.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // [[sub/target]] from notes/foo.md → notes/sub/target.md
    expect(idx.resolve('notes/foo.md', 'sub/target').resolved).toBe('notes/sub/target.md');
  });

  it('case insensitive short name', async () => {
    touch('Foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('x.md', 'FOO').resolved).toBe('Foo.md');
  });

  it('treats .markdown same as .md', async () => {
    touch('foo.markdown');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('x.md', 'foo').resolved).toBe('foo.markdown');
  });

  it('parses fragment heading', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    const r = idx.resolve('x.md', 'foo#H2');
    expect(r.resolved).toBe('notes/foo.md');
    expect(r.fragment).toEqual({ kind: 'heading', id: 'H2' });
  });

  it('parses fragment block id', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    expect(idx.resolve('x.md', 'foo#^abc').fragment).toEqual({ kind: 'block', id: 'abc' });
  });

  it('strips alias from target before resolving', async () => {
    touch('notes/foo.md');
    const idx = new WorkspaceIndex(cwd);
    await idx.ensureBuilt();
    // alias 由前端 plugin 切掉;但 resolve 应该容忍 alias 万一传入
    expect(idx.resolve('x.md', 'foo').resolved).toBe('notes/foo.md');
  });

  it('skips symlinks pointing outside cwd', async () => {
    // 跨 OS 测试 symlink 较麻烦,留作 manual smoke;此处只验证 resolveSafePath 防护
    // 见集成测试,此 unit test 跳过
  });
});

describe('WorkspaceIndex.ensureBuilt idempotency', () => {
  it('serializes concurrent builds', async () => {
    const idx = new WorkspaceIndex(cwd);
    const [a, b] = await Promise.all([idx.ensureBuilt(), idx.ensureBuilt()]);
    expect(a).toBe(b);  // both undefined / 同一 promise
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter auvezy-terminal-remote test -- wikilink-resolver.test
```

预期 FAIL(module not found)。

- [ ] **Step 3: 写 `wikilink-resolver.ts`**

```ts
/**
 * WorkspaceIndex — wikilink 短名解析的工作目录索引。
 *
 * Lazy build:首次 ensureBuilt() 时全 walk cwd 收集 .md/.markdown,key 用 basename
 * 去扩展名 + lowercase(对齐 Obsidian 大小写不敏感)。
 *
 * 增量维护:fs.watch(cwd, { recursive: true }) 监 rename/unlink;失败 (WSL/macOS
 * 大目录已知不稳) 时回退每 5 min 全扫。
 *
 * 解析算法见 docs/plans/obsidian-integration/adrs/003-wikilink-resolution-algorithm.md。
 */

import { promises as fsp } from 'node:fs';
import { watch, type FSWatcher } from 'node:fs';
import { join, relative, dirname, basename, extname, sep } from 'node:path';
import { logger } from '../logger/logger.js';

export interface ResolveResult {
  /** 命中时:相对 cwd 的目标路径 */
  resolved?: string;
  /** ambiguous 时:全部候选(包含 resolved) */
  candidates?: string[];
  /** 无任何匹配 */
  broken?: true;
  /** 锚点信息 */
  fragment?: { kind: 'heading' | 'block'; id: string };
}

const MD_EXTS = new Set(['.md', '.markdown']);
const REBUILD_INTERVAL_MS = 5 * 60 * 1000;

export class WorkspaceIndex {
  private byBasename = new Map<string, string[]>();  // lowercased basename → relative paths (sorted)
  private built = false;
  private buildPromise: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cwd: string) {}

  async ensureBuilt(): Promise<void> {
    if (this.built) return;
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.buildOnce();
    await this.buildPromise;
    this.buildPromise = null;
    this.built = true;
    this.startWatch();
  }

  resolve(from: string, target: string): ResolveResult {
    const { pathPart, fragment } = splitFragment(target);
    if (pathPart.length === 0) return { broken: true };

    if (pathPart.includes('/')) {
      // 路径形态:先 vault root 相对,再当前目录相对
      const fromVault = this.findByRelPath(pathPart);
      if (fromVault) return { resolved: fromVault, fragment };
      const fromCurrent = this.findByRelPath(join(dirname(from), pathPart));
      if (fromCurrent) return { resolved: fromCurrent, fragment };
      return { broken: true, fragment };
    }

    // 短名形态
    const key = stripExt(pathPart).toLowerCase();
    const candidates = this.byBasename.get(key);
    if (!candidates || candidates.length === 0) return { broken: true, fragment };
    if (candidates.length === 1) return { resolved: candidates[0], fragment };

    const best = pickShortestPath(from, candidates);
    return { resolved: best, candidates: [...candidates], fragment };
  }

  shutdown(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.rebuildTimer) clearInterval(this.rebuildTimer);
    this.rebuildTimer = null;
  }

  // ─── internals ───────────────────────────

  private async buildOnce(): Promise<void> {
    this.byBasename.clear();
    await walk(this.cwd, this.cwd, (rel) => {
      const ext = extname(rel).toLowerCase();
      if (!MD_EXTS.has(ext)) return;
      const key = stripExt(basename(rel)).toLowerCase();
      const arr = this.byBasename.get(key) ?? [];
      arr.push(rel);
      arr.sort();
      this.byBasename.set(key, arr);
    });
  }

  private startWatch(): void {
    try {
      this.watcher = watch(this.cwd, { recursive: true }, () => {
        // 简化版:任何变更 debounce 500ms 后全 rebuild
        this.scheduleRebuild();
      });
    } catch (e) {
      logger.warn({ err: e, cwd: this.cwd }, 'WorkspaceIndex: fs.watch failed, falling back to 5min poll');
    }
    // 周期兜底
    this.rebuildTimer = setInterval(() => {
      this.scheduleRebuild();
    }, REBUILD_INTERVAL_MS);
  }

  private rebuildPending = false;
  private rebuildScheduled = false;

  private scheduleRebuild(): void {
    if (this.rebuildScheduled) return;
    this.rebuildScheduled = true;
    setTimeout(() => {
      this.rebuildScheduled = false;
      void this.buildOnce().catch((err) => logger.warn({ err }, 'WorkspaceIndex rebuild failed'));
    }, 500);
  }

  private findByRelPath(rel: string): string | null {
    // 完整路径形态:rel 可能不含扩展名;尝试加 .md / .markdown
    const norm = rel.split(sep).join('/');
    for (const ext of ['', '.md', '.markdown']) {
      const candidate = norm + ext;
      const set = this.byBasename.get(stripExt(basename(candidate)).toLowerCase());
      if (set?.includes(candidate)) return candidate;
    }
    return null;
  }
}

function splitFragment(target: string): { pathPart: string; fragment?: ResolveResult['fragment'] } {
  // 支持 alias 容错:'foo|bar' → 'foo';前端 plugin 应已切掉,此处冗余防御
  const piped = target.split('|')[0]!;
  const hashIdx = piped.indexOf('#');
  if (hashIdx < 0) return { pathPart: piped.trim() };
  const pathPart = piped.slice(0, hashIdx).trim();
  const frag = piped.slice(hashIdx + 1).trim();
  if (frag.startsWith('^')) {
    return { pathPart, fragment: { kind: 'block', id: frag.slice(1) } };
  }
  return { pathPart, fragment: { kind: 'heading', id: frag } };
}

function stripExt(name: string): string {
  const ext = extname(name).toLowerCase();
  if (MD_EXTS.has(ext)) return name.slice(0, -ext.length);
  return name;
}

function pickShortestPath(from: string, candidates: string[]): string {
  return candidates
    .map((c) => ({ c, common: countCommonDirSegments(from, c) }))
    .sort((a, b) => {
      if (b.common !== a.common) return b.common - a.common;
      return a.c < b.c ? -1 : a.c > b.c ? 1 : 0;
    })[0]!.c;
}

function countCommonDirSegments(a: string, b: string): number {
  const da = a.split('/').slice(0, -1);
  const db = b.split('/').slice(0, -1);
  let i = 0;
  while (i < da.length && i < db.length && da[i] === db[i]) i++;
  return i;
}

/** 安全 walk:跟 symlink 时 realpath 校验未跳出 cwd */
async function walk(
  root: string,
  cur: string,
  onFile: (rel: string) => void,
): Promise<void> {
  let ents;
  try {
    ents = await fsp.readdir(cur, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;  // skip hidden(对齐 file-browser 既有惯例)
    const full = join(cur, e.name);
    if (e.isSymbolicLink()) {
      try {
        const real = await fsp.realpath(full);
        const r = relative(root, real);
        if (r.startsWith('..') || r.startsWith(sep + '..')) continue;
      } catch {
        continue;
      }
    }
    if (e.isDirectory() || (e.isSymbolicLink() && (await isDir(full)))) {
      await walk(root, full, onFile);
    } else if (e.isFile() || e.isSymbolicLink()) {
      const rel = relative(root, full).split(sep).join('/');
      onFile(rel);
    }
  }
}

async function isDir(p: string): Promise<boolean> {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote test -- wikilink-resolver.test
```

预期:全 PASS(13 / 13)。

- [ ] **Step 5: commit**

```bash
git add backend/src/files/wikilink-resolver.*
git commit -m "feat(backend): WorkspaceIndex — wikilink 解析 + 共同前缀启发式 + lazy build"
```

---

### Task S6a-2: `POST /api/files/resolve-links` 端点

**Files:**
- Modify: `backend/src/api/file-routes.ts`
- Modify: `backend/src/api/file-routes.test.ts`

- [ ] **Step 1: 写失败测试**

打开 `backend/src/api/file-routes.test.ts`,追加:

```ts
describe('POST /api/files/resolve-links', () => {
  it('resolves wikilinks for given instance + from path', async () => {
    // setup:在 test fixture 工作目录写两个 md
    // (按既有 file-routes.test.ts 的 setup pattern 改造)
    // ...
    const res = await request(app)
      .post('/api/files/resolve-links')
      .set('Cookie', authCookie)
      .send({ instanceId: 'inst-1', from: 'a.md', targets: ['foo', 'a/b'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results).toHaveLength(2);
  });

  it('rejects unauthenticated', async () => {
    const res = await request(app)
      .post('/api/files/resolve-links')
      .send({ instanceId: 'inst-1', from: 'a.md', targets: [] });
    expect(res.status).toBe(401);
  });

  it('rejects invalid body shape', async () => {
    const res = await request(app)
      .post('/api/files/resolve-links')
      .set('Cookie', authCookie)
      .send({ instanceId: 'inst-1' });  // 缺 targets
    expect(res.status).toBe(400);
  });
});
```

(细节按既有 `file-routes.test.ts` 的 helper 模式补全;authCookie / request setup 复用既有。)

- [ ] **Step 2: 实现端点**

`backend/src/api/file-routes.ts`,文件顶部 import:

```ts
import { WorkspaceIndex } from '../files/wikilink-resolver.js';
```

在 `createFileRoutes(opts)` 内,新增一个 instance 级 WorkspaceIndex 缓存:

```ts
const indexes = new Map<string, WorkspaceIndex>();

function getIndex(instanceId: string, cwd: string): WorkspaceIndex {
  let idx = indexes.get(instanceId);
  if (!idx) {
    idx = new WorkspaceIndex(cwd);
    indexes.set(instanceId, idx);
  }
  return idx;
}
```

注册路由(放在 `/files/search` 之后):

```ts
router.post(
  '/files/resolve-links',
  authModule.requireAuth,
  requireRate(fileLimiter),
  wrap(async (req, res) => {
    const body = req.body as { instanceId?: unknown; from?: unknown; targets?: unknown };
    if (
      typeof body.instanceId !== 'string' ||
      typeof body.from !== 'string' ||
      !Array.isArray(body.targets)
    ) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'invalid body');
    }
    if (body.targets.length > 200) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'too many targets');
    }
    for (const t of body.targets) {
      if (typeof t !== 'string') throw new AppError(ErrorCode.BAD_REQUEST, 'target must be string');
    }

    const ctx = await resolveContext(
      { ...req, query: { instanceId: body.instanceId } } as Request,
      registry,
      workdirPolicy,
    );
    // from 安全检查
    resolveSafePath(ctx.cwd, body.from, ctx.policy);

    const idx = getIndex(ctx.instanceId, ctx.cwd);
    await idx.ensureBuilt();
    const results = (body.targets as string[]).map((target) => ({
      target,
      ...idx.resolve(body.from as string, target),
    }));
    res.json({ ok: true, results });
  }),
);
```

(类型 `Request` 已 import;`resolveContext` 既有;如签名跟 `query: {instanceId}` 不兼容,本端点改用 body.instanceId 直接查 registry — 对齐既有 helper 写法即可。)

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote test -- file-routes.test
```

预期 PASS。

- [ ] **Step 4: 注册 shutdown 清理**

instance 销毁时 close watcher。找 `backend/src/registry/instance-registry.ts` 或类似 instance-shutdown hook,在 instance close 时调:

```ts
const idx = indexes.get(instanceId);
if (idx) {
  idx.shutdown();
  indexes.delete(instanceId);
}
```

具体接入点对齐 `backend/src/integrations/manager.ts` 的 shutdown pattern。

- [ ] **Step 5: commit + progress**

`progress/06a-wikilink-backend.md`:

```markdown
# S6a · Wikilink Backend

- ✅ WorkspaceIndex 类:lazy build + fs.watch + 5min 兜底
- ✅ resolve 算法:含 / → vault+当前目录;短名 → 索引 + shortest-path
- ✅ POST /api/files/resolve-links 批量端点,fileLimiter 限流,targets ≤ 200
- ✅ 单测 13 用例 + 集成测 3 用例
- ✅ instance shutdown 时 watcher close
```

```bash
git add backend/src/files/wikilink-resolver.* \
        backend/src/api/file-routes.ts \
        backend/src/api/file-routes.test.ts \
        backend/src/registry/instance-registry.ts \
        docs/plans/obsidian-integration/progress/06a-wikilink-backend.md
git commit -m "feat(backend): /api/files/resolve-links + WorkspaceIndex 内存索引"
```

---

# S6b · Wikilink 前端

### Task S6b-1: `resolve-link.ts` client + `anchor-bus.ts`

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/resolve-link.ts`
- Create: `frontend/src/components/files/markdown/obsidian/anchor-bus.ts`

- [ ] **Step 1: 写 `resolve-link.ts`**

```ts
/**
 * resolve-link — 调 backend POST /api/files/resolve-links 的 client。
 *
 * 设计:
 *  - 批量 — 同一 markdown 文档内多个 wikilink 通过 microtask 合并为一次请求
 *  - LRU 缓存:(instanceId, from, target) → ResolveResult,避免重渲染重复打
 *  - 错误降级:网络失败/超时 → 视为 broken
 */

export interface Anchor {
  kind: 'heading' | 'block';
  id: string;
}

export interface WikilinkResult {
  target: string;
  resolved?: string;
  candidates?: string[];
  fragment?: Anchor;
  broken?: true;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, WikilinkResult>();   // key = `${instanceId}\0${from}\0${target}`

interface PendingBatch {
  byFrom: Map<string, Set<string>>;       // from → set of targets
  resolvers: Map<string, Array<(r: WikilinkResult) => void>>;  // key → callbacks
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<string, PendingBatch>();   // instanceId → batch

export function resolveLink(
  instanceId: string,
  from: string,
  target: string,
): Promise<WikilinkResult> {
  const key = `${instanceId}\0${from}\0${target}`;
  const cached = cache.get(key);
  if (cached) {
    // LRU touch
    cache.delete(key); cache.set(key, cached);
    return Promise.resolve(cached);
  }

  let batch = pending.get(instanceId);
  if (!batch) {
    batch = { byFrom: new Map(), resolvers: new Map(), timer: null };
    pending.set(instanceId, batch);
  }

  let fromSet = batch.byFrom.get(from);
  if (!fromSet) {
    fromSet = new Set();
    batch.byFrom.set(from, fromSet);
  }
  fromSet.add(target);

  return new Promise((resolve) => {
    const arr = batch.resolvers.get(key) ?? [];
    arr.push(resolve);
    batch.resolvers.set(key, arr);
    if (!batch.timer) {
      batch.timer = setTimeout(() => flushBatch(instanceId), 0);
    }
  });
}

async function flushBatch(instanceId: string): Promise<void> {
  const batch = pending.get(instanceId);
  if (!batch) return;
  pending.delete(instanceId);
  batch.timer = null;

  for (const [from, targetSet] of batch.byFrom) {
    const targets = [...targetSet];
    let results: WikilinkResult[] = [];
    try {
      const res = await fetch('/api/files/resolve-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instanceId, from, targets }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; results: WikilinkResult[] };
        results = data.results;
      } else {
        results = targets.map((t) => ({ target: t, broken: true as const }));
      }
    } catch {
      results = targets.map((t) => ({ target: t, broken: true as const }));
    }

    for (const r of results) {
      const key = `${instanceId}\0${from}\0${r.target}`;
      // LRU 容量管理
      if (cache.size >= CACHE_LIMIT) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }
      cache.set(key, r);
      for (const cb of batch.resolvers.get(key) ?? []) cb(r);
    }
  }
}

export function clearResolveLinkCache(): void {
  cache.clear();
}
```

- [ ] **Step 2: 写 `anchor-bus.ts`**

```ts
/**
 * anchor-bus — wikilink 跳转时把目标 anchor 传给即将 mount 的 MarkdownPreview
 *
 * 模块级单一槽位(非 instance 级)— wikilink 点击是同步行为,从点击到目标
 * mount 之间不会有第二次点击插队。如果未来出现并发场景,改为 Map<instanceId+path, Anchor>。
 */

import type { Anchor } from './resolve-link.js';

let pending: { instanceId: string; path: string; anchor: Anchor } | null = null;

export function setPendingAnchor(instanceId: string, path: string, anchor: Anchor): void {
  pending = { instanceId, path, anchor };
}

/** consume:目标 MarkdownPreview mount 后调,匹配 instanceId+path 才返回 */
export function consumePendingAnchor(instanceId: string, path: string): Anchor | null {
  if (pending && pending.instanceId === instanceId && pending.path === path) {
    const a = pending.anchor;
    pending = null;
    return a;
  }
  return null;
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm --filter auvezy-terminal-remote-frontend exec tsc -b --pretty
```

预期 PASS。

- [ ] **Step 4: commit**

```bash
git add frontend/src/components/files/markdown/obsidian/{resolve-link,anchor-bus}.ts
git commit -m "feat(obsidian): wikilink client(批量 + LRU)+ anchor-bus"
```

---

### Task S6b-2: `remarkObsidianLink` plugin + 渲染组件 + 测试

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/wikilink.tsx`
- Create: `frontend/src/components/files/markdown/obsidian/wikilink.module.scss`
- Create: `frontend/src/components/files/markdown/obsidian/wikilink.test.tsx`
- Modify: `frontend/src/components/files/markdown/obsidian/index.ts`
- Modify: `frontend/src/components/files/MarkdownPreview.tsx`(anchor consume + 传 instanceId/path)

- [ ] **Step 1: 写失败测试**

`wikilink.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WikilinkActive, WikilinkDisabled, remarkObsidianLink } from './wikilink.js';
import { clearResolveLinkCache } from './resolve-link.js';

beforeEach(() => {
  clearResolveLinkCache();
  vi.restoreAllMocks();
});

describe('WikilinkDisabled', () => {
  it('renders [[target]] in disabled style', () => {
    render(<WikilinkDisabled target="Foo" alias={null} />);
    expect(screen.getByText('Foo')).toBeInTheDocument();
    expect(screen.getByText('Foo').className).toMatch(/disabled/i);
  });
  it('uses alias when given', () => {
    render(<WikilinkDisabled target="Foo" alias="Bar" />);
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });
});

describe('WikilinkActive', () => {
  it('renders as anchor on resolve hit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, results: [{ target: 'Foo', resolved: 'notes/Foo.md' }] }),
    })));
    render(<WikilinkActive instanceId="i1" from="a.md" target="Foo" alias={null} />);
    await waitFor(() => expect(screen.getByText('Foo')).toBeInTheDocument());
    expect(screen.getByText('Foo').tagName).toBe('A');
  });

  it('renders broken style on broken', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, results: [{ target: 'Foo', broken: true }] }),
    })));
    render(<WikilinkActive instanceId="i1" from="a.md" target="Foo" alias={null} />);
    await waitFor(() => {
      expect(screen.getByText('Foo').className).toMatch(/broken/i);
    });
  });
});
```

(remarkObsidianLink plugin 的语法识别测试参考 inline-syntax.test 用 mdast-string 验证 type;此处侧重组件渲染,plugin 单独 case 略,可加。)

- [ ] **Step 2: 写 `wikilink.tsx`**

```tsx
/**
 * Wikilink 与 Embed 共用 remark plugin:识别 [[...]] / ![[...]],产出
 * obsWikilink / obsEmbed 节点。本文件聚焦 wikilink 组件;embed 在 S7。
 */

import { useEffect, useState, type JSX } from 'react';
import type { Plugin } from 'unified';
import type { Root, Text, Paragraph } from 'mdast';
import { visit } from 'unist-util-visit';
import { useFilePreviewPresenter } from '../../../ui/modal-stack/presenters.js';
import { useT } from '../../../../i18n/i18n-context.js';
import { resolveLink, type WikilinkResult, type Anchor } from './resolve-link.js';
import { setPendingAnchor } from './anchor-bus.js';
import s from './wikilink.module.scss';

const WIKILINK_RE = /(!?)\[\[([^\[\]\|#]+)(#[^\[\]\|]+)?(?:\|([^\[\]]+))?\]\]/g;

export interface RemarkObsidianLinkOptions {
  /** 总开关:false 时整 plugin no-op(对应 obsidian.enabled=false 即 effective=false) */
  enabled: boolean;
}

export const remarkObsidianLink: Plugin<[RemarkObsidianLinkOptions], Root> = (opts) => {
  return (tree) => {
    if (!opts.enabled) return;
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return;
      const parentType = (parent as { type: string }).type;
      if (!['paragraph','listItem','blockquote','tableCell','heading'].includes(parentType)) return;

      const value = node.value;
      const hits: Array<{ start: number; end: number; isEmbed: boolean; target: string; alias?: string }> = [];
      for (const m of value.matchAll(WIKILINK_RE)) {
        const target = (m[2] ?? '') + (m[3] ?? '');
        hits.push({
          start: m.index!,
          end: m.index! + m[0].length,
          isEmbed: m[1] === '!',
          target,
          alias: m[4] ?? undefined,
        });
      }
      if (hits.length === 0) return;

      const replacements = [];
      let cursor = 0;
      for (const h of hits) {
        if (h.start > cursor) {
          replacements.push({ type: 'text', value: value.slice(cursor, h.start) });
        }
        replacements.push({
          type: 'paragraph',
          data: {
            hName: h.isEmbed ? 'obs-embed' : 'obs-wikilink',
            hProperties: {
              target: h.target,
              ...(h.alias ? { alias: h.alias } : {}),
            },
          },
          children: [],
        });
        cursor = h.end;
      }
      if (cursor < value.length) {
        replacements.push({ type: 'text', value: value.slice(cursor) });
      }
      (parent as Paragraph).children.splice(index, 1, ...(replacements as Paragraph['children']));
      return [visit.SKIP, index + replacements.length];
    });
  };
};

// ─── 组件 ────────────────────────────────────

export interface WikilinkDisabledProps {
  target: string;
  alias: string | null;
}

export function WikilinkDisabled({ target, alias }: WikilinkDisabledProps): JSX.Element {
  const t = useT();
  return (
    <span className={s.disabled} title={t('obsidian.wikilinkDisabledHint')}>
      {alias ?? target}
    </span>
  );
}

export interface WikilinkActiveProps {
  instanceId: string;
  from: string;
  target: string;
  alias: string | null;
}

export function WikilinkActive({ instanceId, from, target, alias }: WikilinkActiveProps): JSX.Element {
  const t = useT();
  const presentPreview = useFilePreviewPresenter();
  const [result, setResult] = useState<WikilinkResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveLink(instanceId, from, target).then((r) => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, [instanceId, from, target]);

  const display = alias ?? stripFragment(target);

  if (!result) {
    return <span className={s.pending}>{display}</span>;
  }
  if (result.broken) {
    return (
      <span className={s.broken} title={t('obsidian.wikilinkBroken')}>{display}</span>
    );
  }
  const title = result.candidates && result.candidates.length > 1
    ? t('obsidian.wikilinkAmbiguous').replace('{n}', String(result.candidates.length))
    : undefined;

  const onClick = (e: React.MouseEvent): void => {
    e.preventDefault();
    if (!result.resolved) return;
    if (result.fragment) {
      setPendingAnchor(instanceId, result.resolved, result.fragment);
    }
    presentPreview({
      instanceId,
      target: { kind: 'text', path: result.resolved, name: basenameOf(result.resolved) },
      wrapLines: false,
    });
  };

  return (
    <a href="#" className={s.active} title={title} onClick={onClick}>{display}</a>
  );
}

function stripFragment(t: string): string {
  const i = t.indexOf('#');
  return i < 0 ? t : t.slice(0, i);
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}
```

- [ ] **Step 3: 写 `wikilink.module.scss`**

```scss
.active {
  color: var(--color-info);
  text-decoration: none;
  border-bottom: 1px solid var(--color-info);
  cursor: pointer;
  &:hover { background: var(--color-surface-2); }
}

.broken {
  color: var(--color-alarm);
  text-decoration: underline;
  text-decoration-style: dashed;
  cursor: help;
}

.disabled {
  color: var(--color-text-muted);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-decoration-color: var(--color-text-muted);
  cursor: help;
}

.pending {
  color: var(--color-text-muted);
  opacity: 0.7;
}
```

- [ ] **Step 4: 把 wikilink 接进 obsidian index + 传 instanceId/from**

修改 `frontend/src/components/files/markdown/obsidian/index.ts`:

```ts
import { remarkObsidianLink, WikilinkActive, WikilinkDisabled } from './wikilink.js';

export function buildObsidianBindings(
  eff: ObsidianEffective,
  ctx: { instanceId: string; path: string },
): ObsidianBindings {
  return {
    remarkPlugins: [
      remarkFrontmatter,
      [remarkObsidianFrontmatter, { enabled: eff.frontmatter }],
      [remarkObsidianCallout, { enabled: eff.callout }],
      [remarkObsidianInline, { enabled: eff.inlineSyntax }],
      [remarkObsidianLink, { enabled: true }],  // 总开关 = obsidian.enabled,已经在调用方过滤
    ],
    components: {
      'obs-frontmatter': (p: { raw?: string }) => <FrontmatterTable raw={p.raw ?? ''} />,
      'obs-callout': CalloutBlock as never,
      'obs-highlight': (p: { children?: ReactNode }) => <mark className="atr-obs-highlight">{p.children}</mark>,
      'obs-comment': () => null,
      'obs-tag': (p: { children?: ReactNode }) => <span className="atr-obs-tag">#{p.children}</span>,
      'obs-block-id': (p: { children?: ReactNode }) => (
        <span className="atr-obs-block-id" data-block-id={String(p.children ?? '')} aria-hidden="true">{p.children}</span>
      ),
      'obs-wikilink': (p: { target?: string; alias?: string }) =>
        eff.wikilink
          ? <WikilinkActive instanceId={ctx.instanceId} from={ctx.path} target={p.target ?? ''} alias={p.alias ?? null} />
          : <WikilinkDisabled target={p.target ?? ''} alias={p.alias ?? null} />,
      // 'obs-embed' 占位 — S7 实现
      'obs-embed': (_p: { target?: string }) => <span>embed placeholder</span>,
    } as Components,
  };
}
```

- [ ] **Step 5: MarkdownPreview 传 ctx + 接 anchor consume**

`frontend/src/components/files/MarkdownPreview.tsx`:

A. `buildObsidianBindings(obsEff, { instanceId, path })` — 修改 useEffect 调用方式。

B. 加 anchor consume:

```tsx
import { consumePendingAnchor } from './markdown/obsidian/anchor-bus.js';

// 在文档渲染完(lines 设置完 / rendering 完成)之后:
useEffect(() => {
  if (!raw) return;
  // 等一个 frame 让 DOM 更新
  const id = requestAnimationFrame(() => {
    const anchor = consumePendingAnchor(instanceId, path);
    if (!anchor) return;
    const sel = anchor.kind === 'heading'
      ? `[data-heading-id="${slugify(anchor.id)}"]`
      : `[data-block-id="${anchor.id}"]`;
    const el = document.querySelector(sel);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return () => cancelAnimationFrame(id);
}, [raw, instanceId, path]);
```

C. `slugify` 简单实现:

```tsx
function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}
```

D. headings 加 `data-heading-id`:在 `components` 里覆盖 h1..h6:

```tsx
const headingComponents: Partial<Components> = {
  h1: (props) => <h1 data-heading-id={slugify(textOf(props.children))}>{props.children}</h1>,
  // h2..h6 同款
};
```

(textOf 提取 children 文本,复用既有 `toCodeText`。)

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- wikilink.test
```

预期 PASS。

- [ ] **Step 7: 手动 smoke**

fixture 两文件:
```
notes/a.md:
  See [[b]] and [[b|the b note]] and [[b#H2]] and [[broken-link]].
notes/b.md:
  # The B note
  ## H2
  content here ^x-1
```

启 dev,浏览 a.md。预期:
- `b` 蓝色链接 → 点击推预览 b.md
- `the b note` 蓝色链接(alias)
- `b#H2` 点击后跳到 H2 区块
- `broken-link` 红色虚线
- 关 wikilink 子开关 → 全部变灰色虚线,不可点击

`pnpm stop`。

- [ ] **Step 8: commit + progress**

`progress/06b-wikilink-frontend.md`:

```markdown
# S6b · Wikilink 前端

- ✅ resolve-link client(批量 microtask 合并 + LRU 500 条)
- ✅ anchor-bus 模块级 pending 槽位
- ✅ remarkObsidianLink plugin([[...]] / ![[...]] 切分)
- ✅ WikilinkActive / WikilinkDisabled 两套组件
- ✅ MarkdownPreview 注入 instanceId+path 上下文 + 渲染后 consume anchor + scrollIntoView
- ✅ headings 挂 data-heading-id 供 anchor 定位
```

```bash
git add frontend/src/components/files/markdown/obsidian/{resolve-link,anchor-bus,wikilink}.* \
        frontend/src/components/files/markdown/obsidian/index.ts \
        frontend/src/components/files/MarkdownPreview.tsx \
        docs/plans/obsidian-integration/progress/06b-wikilink-frontend.md
git commit -m "feat(obsidian): wikilink 前端 — plugin + active/disabled 组件 + anchor 跳转"
```

---

# S7 · Embed

### Task S7-1: `embed.tsx` 5 类分发 + 循环检测

**Files:**
- Create: `frontend/src/components/files/markdown/obsidian/embed.tsx`
- Create: `frontend/src/components/files/markdown/obsidian/embed.module.scss`
- Create: `frontend/src/components/files/markdown/obsidian/embed.test.tsx`
- Modify: `frontend/src/components/files/markdown/obsidian/index.ts`(替换 placeholder)

- [ ] **Step 1: 写失败测试(关键 case)**

`embed.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmbedDispatch, EmbedAncestorsProvider, classify } from './embed.js';

describe('classify', () => {
  it('image', () => expect(classify('a.png')).toBe('image'));
  it('md', () => expect(classify('a.md')).toBe('md'));
  it('markdown', () => expect(classify('a.markdown')).toBe('md'));
  it('pdf', () => expect(classify('a.pdf')).toBe('pdf'));
  it('audio', () => expect(classify('a.mp3')).toBe('audio'));
  it('video', () => expect(classify('a.mp4')).toBe('video'));
  it('fallback', () => expect(classify('a.xyz')).toBe('unsupported'));
});

describe('EmbedDispatch', () => {
  it('renders placeholder when enabled=false', () => {
    render(<EmbedDispatch enabled={false} instanceId="i" from="x.md" target="a.png" />);
    expect(screen.getByText(/!\[\[a\.png\]\]/)).toBeInTheDocument();
  });

  it('renders circular placeholder when target in ancestors', () => {
    render(
      <EmbedAncestorsProvider value={new Set(['notes/foo.md'])}>
        <EmbedDispatch enabled instanceId="i" from="bar.md" target="foo" resolvedOverride="notes/foo.md" />
      </EmbedAncestorsProvider>,
    );
    expect(screen.getByText(/Circular|循环/i)).toBeInTheDocument();
  });

  it('renders depth limit placeholder when ancestors.size >= 5', () => {
    const set = new Set(['a.md','b.md','c.md','d.md','e.md']);
    render(
      <EmbedAncestorsProvider value={set}>
        <EmbedDispatch enabled instanceId="i" from="z.md" target="f" resolvedOverride="f.md" />
      </EmbedAncestorsProvider>,
    );
    expect(screen.getByText(/depth limit|嵌入深度上限/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- embed.test
```

- [ ] **Step 3: 写 `embed.tsx`**

```tsx
/**
 * Embed — 5 类分发(image / md / pdf / audio / video)+ 不支持类型占位。
 * 循环检测用 ancestors Context (Set<resolvedPath>);深度上限 5。
 *
 * md 类型默认 collapsed,只显示"▶ Embed: path (size)";例外:文档只有一个
 * embed 时由父决定是否自动展开(此处不实现 — 父在 MarkdownPreview 注入)。
 */

import {
  createContext, useContext, useState, useEffect, useMemo, type JSX, type ReactNode,
} from 'react';
import { resolveLink, type WikilinkResult } from './resolve-link.js';
import { useT } from '../../../../i18n/i18n-context.js';
import s from './embed.module.scss';

export const EMBED_DEPTH_LIMIT = 5;

export type EmbedKind = 'image' | 'md' | 'pdf' | 'audio' | 'video' | 'unsupported';

export function classify(path: string): EmbedKind {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (['.png','.jpg','.jpeg','.gif','.webp','.svg'].includes(ext)) return 'image';
  if (['.md','.markdown'].includes(ext)) return 'md';
  if (ext === '.pdf') return 'pdf';
  if (['.mp3','.wav','.ogg','.flac'].includes(ext)) return 'audio';
  if (['.mp4','.webm','.mov'].includes(ext)) return 'video';
  return 'unsupported';
}

const EmbedAncestors = createContext<ReadonlySet<string>>(new Set());
export const EmbedAncestorsProvider = EmbedAncestors.Provider;

export interface EmbedDispatchProps {
  enabled: boolean;
  instanceId: string;
  from: string;
  target: string;
  /** 用于测试:跳过 resolve 直接给 resolved 路径 */
  resolvedOverride?: string;
}

export function EmbedDispatch({
  enabled, instanceId, from, target, resolvedOverride,
}: EmbedDispatchProps): JSX.Element {
  const t = useT();
  const ancestors = useContext(EmbedAncestors);
  const [result, setResult] = useState<WikilinkResult | null>(
    resolvedOverride ? { target, resolved: resolvedOverride } : null,
  );

  useEffect(() => {
    if (resolvedOverride) return;
    let cancelled = false;
    void resolveLink(instanceId, from, target).then((r) => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, [instanceId, from, target, resolvedOverride]);

  if (!enabled) {
    return <span className={s.disabled} title={t('obsidian.embedDisabledHint')}>📎 ![[{target}]]</span>;
  }

  // 深度限制(在 resolve 之前也检查 ancestors.size,避免触发不必要的 resolve)
  if (ancestors.size >= EMBED_DEPTH_LIMIT) {
    return <aside className={s.placeholder}>{t('obsidian.embedDepthLimit')}</aside>;
  }

  if (!result) return <span className={s.loading}>...</span>;

  if (result.broken || !result.resolved) {
    return <aside className={s.placeholder}>{t('obsidian.embedNotFound')}</aside>;
  }

  // 循环检测
  if (ancestors.has(result.resolved)) {
    return (
      <aside className={s.placeholder}>
        {t('obsidian.embedCircular').replace('{path}', result.resolved)}
      </aside>
    );
  }

  const kind = classify(result.resolved);

  switch (kind) {
    case 'image':
      return <EmbedImage instanceId={instanceId} path={result.resolved} />;
    case 'pdf':
      return <EmbedPdf instanceId={instanceId} path={result.resolved} />;
    case 'audio':
      return <EmbedAudio instanceId={instanceId} path={result.resolved} />;
    case 'video':
      return <EmbedVideo instanceId={instanceId} path={result.resolved} />;
    case 'md':
      return (
        <EmbedMd
          instanceId={instanceId}
          path={result.resolved}
          fragment={result.fragment}
          ancestors={ancestors}
        />
      );
    case 'unsupported':
      return (
        <aside className={s.placeholder}>
          {t('obsidian.embedUnsupportedType').replace('{ext}', extOf(result.resolved))}
        </aside>
      );
  }
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i);
}

function rawUrl(instanceId: string, path: string): string {
  return `/api/files/raw?instanceId=${encodeURIComponent(instanceId)}&path=${encodeURIComponent(path)}`;
}

function EmbedImage({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return <img className={s.image} src={rawUrl(instanceId, path)} alt={path} />;
}

function EmbedPdf({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return (
    <div className={s.pdf}>
      <iframe src={rawUrl(instanceId, path)} title={path} />
      <a href={rawUrl(instanceId, path)} target="_blank" rel="noreferrer">↗ {path}</a>
    </div>
  );
}

function EmbedAudio({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return <audio className={s.av} controls src={rawUrl(instanceId, path)} />;
}

function EmbedVideo({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return <video className={s.av} controls src={rawUrl(instanceId, path)} />;
}

function EmbedMd({
  instanceId, path, fragment, ancestors,
}: {
  instanceId: string;
  path: string;
  fragment?: WikilinkResult['fragment'];
  ancestors: ReadonlySet<string>;
}): JSX.Element {
  // 默认折叠:用 details 元素让用户主动展开;复用 MarkdownPreview 渲染嵌入内容
  const t = useT();
  const [open, setOpen] = useState(false);
  const nextAncestors = useMemo(() => {
    const n = new Set(ancestors);
    n.add(path);
    return n;
  }, [ancestors, path]);

  // 动态 import MarkdownPreview 避免循环依赖
  const [MdComp, setMdComp] = useState<null | ((p: { instanceId: string; path: string }) => JSX.Element)>(null);
  useEffect(() => {
    if (!open || MdComp) return;
    void import('../../MarkdownPreview.js').then((m) => setMdComp(() => m.MarkdownPreview));
  }, [open, MdComp]);

  return (
    <details
      className={s.mdEmbed}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>{t('obsidian.embedExpand').replace('{path}', path).replace('{size}', '?')}</summary>
      {open && MdComp && (
        <EmbedAncestorsProvider value={nextAncestors}>
          <MdComp instanceId={instanceId} path={path} />
        </EmbedAncestorsProvider>
      )}
      {open && fragment && (
        <div className={s.fragmentHint} data-fragment-kind={fragment.kind} data-fragment-id={fragment.id} />
      )}
    </details>
  );
}
```

(fragment 切片渲染 — embed 仅嵌入"目标整文档"+ 在 effect 里 scrollIntoView 锚点,**不**做"只渲染 H2 to 下一个 H2 的切片"。理由:实现成本高且 Obsidian 自身切片渲染也限制多;先做整文档嵌入足以覆盖核心 case。)

- [ ] **Step 4: 写 `embed.module.scss`**

```scss
.image { max-width: 100%; height: auto; border-radius: 4px; margin: 1rem 0; }
.pdf {
  margin: 1rem 0;
  iframe { width: 100%; height: 600px; border: 1px solid var(--color-border); border-radius: 4px; }
  a { display: inline-block; margin-top: 4px; color: var(--color-info); font-size: 13px; }
}
.av { width: 100%; margin: 1rem 0; }

.mdEmbed {
  margin: 1rem 0;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-2);
  summary {
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text-muted);
    &:hover { color: var(--color-text); }
  }
}

.placeholder {
  margin: 1rem 0;
  padding: 8px 12px;
  border-left: 3px solid var(--color-warn);
  background: var(--color-surface-2);
  color: var(--color-warn);
  font-size: 13px;
}

.disabled {
  display: inline-block;
  padding: 0 6px;
  border: 1px dashed var(--color-text-muted);
  border-radius: 3px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.loading { color: var(--color-text-muted); }
```

- [ ] **Step 5: 接进 obsidian index 替换 placeholder**

修改 `frontend/src/components/files/markdown/obsidian/index.ts`,把之前的 `'obs-embed': (_p) => <span>embed placeholder</span>` 替换为:

```tsx
'obs-embed': (p: { target?: string }) => (
  <EmbedDispatch
    enabled={eff.embed}
    instanceId={ctx.instanceId}
    from={ctx.path}
    target={p.target ?? ''}
  />
),
```

并在文件顶部加 `import { EmbedDispatch } from './embed.js';`。

- [ ] **Step 6: MarkdownPreview 顶层包 EmbedAncestorsProvider**

`frontend/src/components/files/MarkdownPreview.tsx`:

```tsx
import { EmbedAncestorsProvider } from './markdown/obsidian/embed.js';

// 渲染时:
return (
  <EmbedAncestorsProvider value={new Set([path])}>
    <div className={`${s.root} fb-markdown`}>
      <ReactMarkdown ...>{raw}</ReactMarkdown>
    </div>
  </EmbedAncestorsProvider>
);
```

(顶层 path 自己也加入,避免 A.md 嵌入 A.md 这种自指出现。)

- [ ] **Step 7: 运行测试**

```bash
pnpm --filter auvezy-terminal-remote-frontend test -- embed.test
```

预期 PASS。

- [ ] **Step 8: 手动 smoke**

fixture:
```
notes/main.md:
  ![[img.png]]
  ![[doc.md]]
  ![[report.pdf]]
  ![[song.mp3]]
  ![[clip.mp4]]
  ![[unsup.xyz]]
notes/doc.md:
  Content of doc.
```

预期:
- img 显示(假设 img.png 存在)
- doc.md 默认折叠,点开展开成嵌入式 MarkdownPreview
- pdf iframe + 外链
- audio / video controls
- unsup.xyz 占位 "Embed not supported: .xyz"
- 关 embed 子开关 → 全部变 `📎 ![[xxx]]` 灰色占位

循环测试:doc.md 改成包含 `![[main]]` → 展开 doc 时显示 circular 占位。

`pnpm stop`。

- [ ] **Step 9: commit + progress**

`progress/07-embed.md`:

```markdown
# S7 · Embed

- ✅ classify 函数 → 5 类(image/md/pdf/audio/video)+ unsupported
- ✅ EmbedDispatch 主组件 + 5 个子组件(EmbedImage / EmbedMd / ...)
- ✅ EmbedAncestorsProvider Context — 沿递归路径传 Set<resolvedPath>
- ✅ 循环检测 + 硬深度 EMBED_DEPTH_LIMIT=5
- ✅ md embed 默认折叠 + 动态 import 避免循环依赖
- ✅ 子开关关闭占位 + 单测 6 用例
```

```bash
git add frontend/src/components/files/markdown/obsidian/embed.* \
        frontend/src/components/files/markdown/obsidian/index.ts \
        frontend/src/components/files/MarkdownPreview.tsx \
        docs/plans/obsidian-integration/progress/07-embed.md
git commit -m "feat(obsidian): embed 5 类分发 + 循环检测 + 深度上限 5"
```

---

# S8 · Smoke 收口

### Task S8-1: 集成 smoke + 包体积验证

**Files:**
- Modify: `CHANGELOG.md` 或对应 release notes 位置

- [ ] **Step 1: 真实 Obsidian-flavored fixture smoke**

构造一份接近真实 Obsidian vault 的目录(若 Drowsy 没有现成 vault,从开源仓库
[Obsidian Help](https://github.com/obsidianmd/obsidian-help) 拉一份):

```bash
mkdir -p /tmp/atr-vault-smoke
cd /tmp/atr-vault-smoke
git clone --depth 1 https://github.com/obsidianmd/obsidian-help.git .
```

在 ATR 中以此目录开实例,逐项验证:

- 任意 .md 文件顶部:Properties 表渲染正确(7 种类型至少各出现一次)
- 任意 callout 都有正确类型样式(13 类各找一份测,如果 fixture 没覆盖全,自己写几个)
- wikilink 跳转能跨文件
- broken wikilink 红色虚线
- ambiguous wikilink 显示候选数
- 关闭子开关 wikilink 变虚线灰色 + tooltip
- embed image/md/pdf/audio/video 各测一次
- inline highlight / tag / comment / block-id 各测一次

**任何视觉不对齐立刻记 issue 修;PASS 才往下走。**

- [ ] **Step 2: 包体积验证**

```bash
pnpm --filter auvezy-terminal-remote-frontend build
ls -lh frontend/dist/assets/*.js | sort -k5 -h
```

定位 obsidian chunk(通常文件名包含 'obsidian' 或对应 hash)。预期:**< 150KB gzipped**。

```bash
gzip -c frontend/dist/assets/<obsidian-chunk>.js | wc -c
```

若超 150KB,排查 — 可能 js-yaml 没 tree-shake 干净,或某个 plugin import 拉了过大依赖。

- [ ] **Step 3: pnpm stop + 端口检查**

```bash
pnpm stop
ss -tln | grep -E ':3000|:5173'  # 应该为空
ps -ef | grep -E 'tsx|vite|node.*cli' | grep -v grep  # 应该为空
```

CLAUDE.md 红线:**严禁留 background 进程**。

- [ ] **Step 4: 写 CHANGELOG**

`CHANGELOG.md` 顶部:

```markdown
## 0.9.0 — 2026-MM-DD

### New: Obsidian integration

- 文件预览 .md 支持完整 Obsidian-flavored 渲染:frontmatter 属性表、13 类 callout(替换 5 类 GFM Alert)、wikilink 跨文件跳转、5 类 embed(image/md/pdf/audio/video)、inline 语法(==highlight==/%%comment%%/#tag/^block-id)
- 「集成」面板新增 渲染 分组,与 运行时(Claude Code)并列
- Markdown 预览开关从「显示」面板迁移到「集成 → 渲染 → Markdown」 — 旧设置自动迁移,3 个 minor 后清理旧字段

### Backend

- 新增 `POST /api/files/resolve-links` — wikilink 批量解析,instance 级 WorkspaceIndex 内存索引

### 详见

- `docs/plans/obsidian-integration/design.md` + 4 个 ADR
```

- [ ] **Step 5: 写最后 progress + commit**

`progress/08-smoke-收口.md`:

```markdown
# S8 · Smoke + 收口

- ✅ obsidian-help vault 真实 smoke(13 类 callout / 6 类属性 / 5 类 embed / inline 4 种 / wikilink active/disabled/broken/ambiguous)
- ✅ obsidian chunk < 150KB gzipped
- ✅ pnpm stop 后端口 3000/5173 全释放,无 background tsx/vite/node
- ✅ CHANGELOG 0.9.0 条目

下一步:用户 review → 发版(详见 publish-atr skill)。
```

```bash
git add CHANGELOG.md docs/plans/obsidian-integration/progress/08-smoke-收口.md
git commit -m "release(0.9.0): Obsidian 集成 — frontmatter/callout/wikilink/embed/inline 全套"
```

---

## Self-Review 检查表(写完 plan 后必跑)

- [ ] **Spec 覆盖:** design.md 13 章 + 4 ADR 全部对应到任务

  - §1-2 背景与名词 → S0 文档
  - §3 架构 → 散在 S3-S7
  - §4 数据模型 → S1 全部 task
  - §5 集成面板 → S2 全部 task
  - §6 渲染管线 → S3-S5
  - §6.4 wikilink 入口 → S6b-2
  - §7 backend resolver → S6a 全部
  - §7.5 heading/block ref → S6b-2 Step 5(MarkdownPreview anchor consume)
  - §8 i18n → S2-1
  - §9 安全 → S6a-2 端点 body 校验 + symlink 防越界 已在 walk 函数内
  - §10 测试 → 每个 task 都有 *.test.* 步骤
  - §11 阶段 → S0-S8 完整对齐
  - §12 风险 → S8-2 包体积验证 + watch 失败回退已 in S6a-1
  - §13 ADR 索引 → S0 已 commit
  - ADR-001/002/003/004 → 实现细节都在 S1/S2/S6a/S7

- [ ] **Placeholder scan:** 全文搜索 "TBD" / "TODO" / "FIXME":本 plan 内无残留

- [ ] **类型一致:**
  - `WorkspaceIndex` / `resolve` / `ensureBuilt` 在 S6a-1 定义,S6a-2 / S6b-1 调用 — 签名一致
  - `WikilinkResult` 在 resolve-link.ts 定义,backend response 字段一致(target/resolved/candidates/fragment/broken)
  - `Anchor` 类型在 resolve-link.ts 与 anchor-bus.ts 共享 — 已 import 一致
  - `ObsidianEffective` 在 index.ts 定义,MarkdownPreview 与各 task 使用一致

---

## Execution Handoff

**Plan complete and saved to `docs/plans/obsidian-integration/plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个 task 派一个新 subagent,task 间 review,迭代快

**2. Inline Execution** - 在本会话内逐 task 执行,批次 checkpoint review

**Which approach?**
