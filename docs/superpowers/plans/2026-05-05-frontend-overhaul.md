# Frontend Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理仓库残留参考材料；修复快捷键设置乱码；用 Tailwind v4 + Radix Primitives + vaul + lucide-react 重写前端样式；用 `100dvh` + `visualViewport` 修移动端布局溢出。

**Architecture:** 删 `analysis/upstream/` 并最小化 design.md 残留 → 引入 Tailwind v4（Vite 插件、`@theme` 直接消费现有 CSS 变量）→ 在 `components/ui/` 建一组 primitives（Sheet/Modal/IconButton/Pill/Toggle/TextField）+ 工具（escape codec、useViewportFix、useMediaQuery）→ 重写所有现有组件、删旧 BEM CSS、合并顶栏、把 PushToggle 移入 Settings、InstanceTabs 桌面/移动两形态、所有 emoji 换为 lucide 图标。

**Tech Stack:**
- Tailwind CSS v4（`@tailwindcss/vite`，零配置 + `@theme` 注入 token）
- Radix UI: `react-dialog`、`react-tabs`、`react-switch`、`react-tooltip`
- vaul（移动端底部 sheet）
- lucide-react（单色 stroke 图标）
- clsx（条件 className）
- 现有：React 19、Vite 6、xterm.js 5、zustand 5、vitest 3

**Spec:** `docs/plans/open-claude-remote-clone/progress/stage-frontend-overhaul.md`

---

## File Structure

### 删除

- `analysis/upstream/` — 整个目录及内容
- `frontend/src/styles/global.css` — 旧 690 行 BEM（在 Stage A 末尾删，先并行运行）

### 新增

| 文件 | 责任 |
|---|---|
| `frontend/src/styles/index.css` | Tailwind 入口 + `@theme` token + 3 条全局基础规则 |
| `frontend/src/utils/escape-codec.ts` | 控制字符 ↔ 可读转义字符串编解码 |
| `frontend/src/utils/escape-codec.test.ts` | 上面的单测 |
| `frontend/src/utils/cn.ts` | 极薄的 `clsx` re-export，方便统一 import |
| `frontend/src/hooks/useMediaQuery.ts` | 监听 media query，返回 boolean |
| `frontend/src/hooks/useViewportFix.ts` | visualViewport hook，写 `--app-vh` 与 `data-keyboard` |
| `frontend/src/components/ui/Sheet.tsx` | Radix Dialog 桌面 + vaul Drawer 移动 双形态 |
| `frontend/src/components/ui/Modal.tsx` | 桌面 modal（无移动 sheet 行为）|
| `frontend/src/components/ui/IconButton.tsx` | lucide 图标按钮，44×44 触控目标 |
| `frontend/src/components/ui/Pill.tsx` | 状态徽标，支持多 tone |
| `frontend/src/components/ui/Toggle.tsx` | Radix Switch 包装 |
| `frontend/src/components/ui/TextField.tsx` | 受控 input + 错误态 + helper |

### 修改

| 文件 | 变化 |
|---|---|
| `.gitignore` | 追加 `/analysis/upstream/` |
| `CLAUDE.md` | 移除"不复制 analysis/upstream"行 |
| `docs/plans/open-claude-remote-clone/design.md` | 删"作者：复刻者"行 |
| `frontend/package.json` | 加依赖 |
| `frontend/vite.config.ts` | 加 `@tailwindcss/vite` 插件 |
| `frontend/index.html` | 不变（已有 viewport-fit=cover、user-scalable=no）|
| `frontend/src/main.tsx` | import `./styles/index.css` |
| `frontend/src/App.tsx` | 包一层 viewport hook、loading 文案换 utility |
| `frontend/src/pages/ConsolePage.tsx` | 顶栏合并、PushToggle 移除、InstanceTabs 拆桌面/移动、快捷键栏独立行 |
| `frontend/src/pages/AuthPage.tsx` | 字号下调、间距收紧 |
| `frontend/src/components/input/InputBar.tsx` | IconButton 替代 ⚙；快捷键栏单行横向滚动 |
| `frontend/src/components/status/StatusBar.tsx` | Pill 组件、字号 11px |
| `frontend/src/components/instances/InstanceTabs.tsx` | 桌面横向 tab；导出 `MobileInstanceSwitcher`（移动 sheet）|
| `frontend/src/components/instances/CreateInstanceModal.tsx` | 用 Sheet primitive |
| `frontend/src/components/settings/SettingsModal.tsx` | Radix Dialog+Tabs；新增"通知"分页内嵌 PushToggle；移动端走 Sheet |
| `frontend/src/components/settings/ShortcutSettings.tsx` | input 走 codec；移动端两行布局 |
| `frontend/src/components/settings/CommandSettings.tsx` | 改用 Toggle/TextField primitives |
| `frontend/src/components/common/PushToggle.tsx` | 不再用 emoji；样式 utility 化（仍是独立组件，被 SettingsModal 内嵌）|
| `frontend/src/components/common/IpChangeToast.tsx` | 去 ⚠；位置上移 |
| `frontend/src/components/terminal/ScrollToBottomButton.tsx` | lucide `ArrowDown`；触控 44×44 |
| `frontend/src/components/terminal/TerminalView.tsx` | className 默认值改 utility |

---

## Pre-flight

- [ ] **Step 0: 启动检查**

Run:
```bash
cd /mnt/d/github/open-claude-remote
git status
pnpm typecheck
pnpm test
```
Expected: 工作区无未提交改动（除 `frontend/src/components/common/PushToggle.tsx` 用户已删 emoji 的草稿）；typecheck 通过；test 全绿。

如果 PushToggle.tsx 有改动且不是你做的，**先把它 commit 或 stash**，避免被本计划的改动覆盖。

```bash
git diff frontend/src/components/common/PushToggle.tsx
# 若有改动且确认是用户的预改 emoji，commit 它：
git add frontend/src/components/common/PushToggle.tsx
git commit -m "chore(ui): 删除 PushToggle 上的铃铛 emoji（用户手改）"
```

---

# Stage A · 基础设施

## Task A1: 私货清扫

**Files:**
- Delete: `analysis/upstream/` (整个目录)
- Modify: `.gitignore`
- Modify: `CLAUDE.md`
- Modify: `docs/plans/open-claude-remote-clone/design.md`

- [ ] **Step 1: 删除 analysis/upstream/**

```bash
git rm -r analysis/upstream
ls analysis/  # 检查 analysis/ 是否还有别的内容
```
Expected: `git rm` 成功；如果 `ls analysis/` 显示空（没有其它子目录/文件），下一步把 `analysis/` 空目录也删了。

```bash
# 仅在 analysis/ 已空时执行
rmdir analysis 2>/dev/null || true
```

- [ ] **Step 2: 更新 .gitignore**

读 `.gitignore` 找到末尾，追加：

```
# 不再保留上游参考材料（已删除）
/analysis/upstream/
```

- [ ] **Step 3: 修改 CLAUDE.md**

`CLAUDE.md:14` 当前是：

```markdown
- **clean-room 复刻**：基于行为级规格摘要独立实现，不复制上游 `analysis/upstream/` 内任何源代码
```

改为：

```markdown
- **clean-room 复刻**：基于行为级规格摘要独立实现，不参考任何上游源码（参考材料已删除）
```

- [ ] **Step 4: 删 design.md "作者：复刻者"**

`docs/plans/open-claude-remote-clone/design.md:5` 当前包含：

```markdown
> **作者**：复刻者
```

整行删除（连同前后空行如果留下 2 行空行的话保留 1 行）。

- [ ] **Step 5: 验证清扫干净**

```bash
git ls-files | grep -i upstream
grep -rn "作者：复刻者" docs/ 2>/dev/null
```
Expected: 两条命令都无输出。

- [ ] **Step 6: Commit**

```bash
git add -A analysis .gitignore CLAUDE.md docs/plans/open-claude-remote-clone/design.md
git commit -m "chore: 清理 analysis/upstream 参考材料与 design.md 残留署名"
```

---

## Task A2: 安装新依赖

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd /mnt/d/github/open-claude-remote/frontend
pnpm add tailwindcss@^4 @tailwindcss/vite@^4 \
  @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-switch @radix-ui/react-tooltip \
  vaul lucide-react clsx
```
Expected: `package.json` 的 `dependencies` 内出现以上所有包，无 peer warning（React 19 兼容）。

如出现 React 19 peer warning（Radix 早期可能 only 18），`pnpm add` 会强行装但运行无碍；记录但不阻塞。

- [ ] **Step 2: 配置 Vite 插件**

修改 `frontend/vite.config.ts`，import 区域加：

```ts
import tailwindcss from '@tailwindcss/vite';
```

`plugins` 数组改为：

```ts
plugins: [react(), tailwindcss()],
```

- [ ] **Step 3: typecheck + 启动 dev 验证**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
```
Expected: 通过。

```bash
cd /mnt/d/github/open-claude-remote/frontend
pnpm dev
```
启动后立刻 Ctrl+C 终止；目的仅是确认 vite 启动不报 Tailwind 插件加载错误。

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/github/open-claude-remote
git add frontend/package.json frontend/pnpm-lock.yaml ../pnpm-lock.yaml frontend/vite.config.ts
git commit -m "feat(frontend): 引入 Tailwind v4 + Radix + vaul + lucide + clsx"
```

注：`pnpm add` 在 monorepo 下可能写 root pnpm-lock；按实际情况 add 哪个 lock 文件被改动。

---

## Task A3: 建 Tailwind 入口与 token

**Files:**
- Create: `frontend/src/styles/index.css`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: 创建 styles/index.css**

写入完整内容：

```css
/**
 * Tailwind v4 入口 + 主题 token + 极少全局基础规则
 *
 * 设计原则：
 *  - 颜色 / 字号 / 字体 全部走 @theme，组件内一律 utility
 *  - 仅 3 条全局规则：高度链路、body 默认色彩、#app flex 容器
 *  - safe-area 不在 #app 上叠加；改由具体子元素（顶栏、InputBar）按需处理
 */

@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css";

@theme {
  /* 颜色（GitHub Dark） */
  --color-bg: #0d1117;
  --color-bg-elevated: #161b22;
  --color-border: #30363d;
  --color-fg: #e6edf3;
  --color-fg-muted: #7d8590;
  --color-accent: #58a6ff;
  --color-success: #3fb950;
  --color-error: #ff7b72;
  --color-warning: #d29922;

  /* 字体 */
  --font-mono: 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

  /* 字号梯度（覆盖 Tailwind 默认） */
  --text-2xs: 10px;
  --text-2xs--line-height: 14px;
  --text-xs: 11px;
  --text-xs--line-height: 16px;
  --text-sm: 12px;
  --text-sm--line-height: 18px;
  --text-base: 13px;
  --text-base--line-height: 20px;
  --text-md: 14px;
  --text-md--line-height: 22px;
  --text-lg: 15px;
  --text-lg--line-height: 22px;
}

/* ──────────────── 全局基础（仅 3 条） ──────────────── */

html,
body,
#app {
  height: var(--app-vh, 100dvh);
  overflow: hidden;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  display: flex;
  flex-direction: column;
}

/* ──────────────── 工具类：隐藏滚动条 ──────────────── */

.scrollbar-hide {
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* ──────────────── 键盘弹起时的全局 hook ──────────────── */

body[data-keyboard="true"] .hide-on-keyboard {
  display: none !important;
}
```

- [ ] **Step 2: 切换 main.tsx 的 CSS import**

修改 `frontend/src/main.tsx`：

```ts
import './styles/index.css';
```

(原来是 `./styles/global.css`)。

不要现在删 `global.css`（Stage C 末尾再删，避免新旧重叠期失样），但确认 `main.tsx` 不再引用它。

- [ ] **Step 3: 启动 dev 验证**

```bash
cd /mnt/d/github/open-claude-remote/frontend
pnpm dev
```

打开 `http://localhost:5173`（如已起 backend 则用 backend URL）。

Expected: 页面能加载（视觉混乱 OK——旧 BEM class 还存在但不再有定义；只要不白屏、不 console error）。

按 Ctrl+C 终止。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/index.css frontend/src/main.tsx
git commit -m "feat(frontend): Tailwind v4 入口与主题 token，main 切换 CSS import"
```

---

# Stage B · UI primitives 与工具

## Task B1: escape-codec 工具 + 单测（TDD）

**Files:**
- Create: `frontend/src/utils/escape-codec.ts`
- Create: `frontend/src/utils/escape-codec.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/utils/escape-codec.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { encodeForInput, decodeFromInput } from './escape-codec.js';

describe('encodeForInput', () => {
  it('普通可打印字符原样保留', () => {
    expect(encodeForInput('hello')).toBe('hello');
  });

  it('反斜杠转义为双反斜杠', () => {
    expect(encodeForInput('a\\b')).toBe('a\\\\b');
  });

  it('ESC 转为 \\e', () => {
    expect(encodeForInput('\x1b')).toBe('\\e');
  });

  it('CR LF Tab', () => {
    expect(encodeForInput('\r')).toBe('\\r');
    expect(encodeForInput('\n')).toBe('\\n');
    expect(encodeForInput('\t')).toBe('\\t');
  });

  it('上箭头序列', () => {
    expect(encodeForInput('\x1b[A')).toBe('\\e[A');
  });

  it('其它控制字符走 \\xHH', () => {
    expect(encodeForInput('\x07')).toBe('\\x07');
    expect(encodeForInput('\x1f')).toBe('\\x1f');
    expect(encodeForInput('\x7f')).toBe('\\x7f');
  });

  it('混合', () => {
    expect(encodeForInput('a\x1bb\\c')).toBe('a\\eb\\\\c');
  });
});

describe('decodeFromInput', () => {
  it('普通字符', () => {
    expect(decodeFromInput('hello')).toEqual({ value: 'hello', warning: null });
  });

  it('双反斜杠 -> 反斜杠', () => {
    expect(decodeFromInput('a\\\\b')).toEqual({ value: 'a\\b', warning: null });
  });

  it('\\e -> ESC', () => {
    expect(decodeFromInput('\\e')).toEqual({ value: '\x1b', warning: null });
  });

  it('\\r \\n \\t', () => {
    expect(decodeFromInput('\\r\\n\\t')).toEqual({ value: '\r\n\t', warning: null });
  });

  it('上箭头序列', () => {
    expect(decodeFromInput('\\e[A')).toEqual({ value: '\x1b[A', warning: null });
  });

  it('\\xHH', () => {
    expect(decodeFromInput('\\x07')).toEqual({ value: '\x07', warning: null });
    expect(decodeFromInput('\\x7f')).toEqual({ value: '\x7f', warning: null });
  });

  it('非法转义保留原样并报 warning', () => {
    const r = decodeFromInput('\\q');
    expect(r.value).toBe('\\q');
    expect(r.warning).toMatch(/未识别的转义/);
  });

  it('\\x 后非两位 hex 报 warning', () => {
    const r = decodeFromInput('\\xZZ');
    expect(r.value).toBe('\\xZZ');
    expect(r.warning).toMatch(/不合法的 \\xHH/);
  });

  it('\\x 末尾不足两位报 warning', () => {
    const r = decodeFromInput('\\x1');
    expect(r.value).toBe('\\x1');
    expect(r.warning).toMatch(/不合法的 \\xHH/);
  });

  it('结尾单个反斜杠报 warning', () => {
    const r = decodeFromInput('abc\\');
    expect(r.value).toBe('abc\\');
    expect(r.warning).toMatch(/末尾悬空反斜杠/);
  });
});

describe('roundtrip', () => {
  const cases = [
    '',
    'hello',
    '\x1b',
    '\r\n\t',
    '\x1b[A',
    '\x1b[B',
    '\x1b[D',
    '\x1b[C',
    'a\\b\\c',
    '\x07\x1f\x7f',
    'mixed: \x1b[5~ end',
  ];
  for (const c of cases) {
    it(`encode→decode 等价: ${JSON.stringify(c)}`, () => {
      const r = decodeFromInput(encodeForInput(c));
      expect(r.value).toBe(c);
      expect(r.warning).toBeNull();
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /mnt/d/github/open-claude-remote/frontend
pnpm test escape-codec
```
Expected: 全部 FAIL（模块不存在）。

- [ ] **Step 3: 实现 escape-codec.ts**

创建 `frontend/src/utils/escape-codec.ts`：

```ts
/**
 * 控制字符 ↔ 可读转义字符串
 *
 * 用于 ShortcutSettings / CommandSettings 的 input：
 *  - 文件层（落盘 / 协议）：真控制字节（'\x1b'、'\r' 等）
 *  - UI 编辑层：可读转义（'\e'、'\r' 字面量）
 *
 * 转义规则（与 codec 双向等价）：
 *   '\\' → '\\\\'
 *   '\x1b' → '\\e'
 *   '\r' '\n' '\t' → '\\r' '\\n' '\\t'
 *   其它 0x00–0x1F + 0x7F → '\\xHH'（小写 hex）
 *   其它字符（含 Unicode 可打印）→ 原样
 *
 * 不支持 \\u / \\u{}：UI 用不到，且会引入歧义。
 */

const ENCODE_MAP: Record<string, string> = {
  '\\': '\\\\',
  '\x1b': '\\e',
  '\r': '\\r',
  '\n': '\\n',
  '\t': '\\t',
};

/** 把真控制字节转为可读转义字符串 */
export function encodeForInput(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const direct = ENCODE_MAP[ch];
    if (direct !== undefined) {
      out += direct;
      continue;
    }
    const code = ch.charCodeAt(0);
    // ASCII 控制字符 (0x00-0x1F) 与 DEL (0x7F)
    if (code <= 0x1f || code === 0x7f) {
      out += '\\x' + code.toString(16).padStart(2, '0');
    } else {
      out += ch;
    }
  }
  return out;
}

const DECODE_SHORT: Record<string, string> = {
  '\\': '\\',
  e: '\x1b',
  r: '\r',
  n: '\n',
  t: '\t',
};

/** 解析可读转义字符串回真字节；非法转义保留原样并报 warning */
export function decodeFromInput(s: string): { value: string; warning: string | null } {
  let out = '';
  let warning: string | null = null;
  let i = 0;
  while (i < s.length) {
    const ch = s[i] ?? '';
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    // 反斜杠：看下一个字符
    if (i + 1 >= s.length) {
      warning ??= '末尾悬空反斜杠';
      out += '\\';
      i += 1;
      continue;
    }
    const next = s[i + 1] ?? '';
    if (next === 'x') {
      const hex = s.slice(i + 2, i + 4);
      if (hex.length !== 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
        warning ??= '不合法的 \\xHH 序列';
        out += s.slice(i, i + Math.min(4, s.length - i));
        i += Math.min(4, s.length - i);
        continue;
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
      continue;
    }
    const direct = DECODE_SHORT[next];
    if (direct !== undefined) {
      out += direct;
      i += 2;
      continue;
    }
    warning ??= `未识别的转义 \\${next}`;
    out += '\\' + next;
    i += 2;
  }
  return { value: out, warning };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /mnt/d/github/open-claude-remote/frontend
pnpm test escape-codec
```
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/escape-codec.ts frontend/src/utils/escape-codec.test.ts
git commit -m "feat(frontend): 控制字符 ↔ 可读转义编解码工具"
```

---

## Task B2: cn 工具

**Files:**
- Create: `frontend/src/utils/cn.ts`

- [ ] **Step 1: 写最小工具**

```ts
/**
 * className 拼接：clsx 的薄壳
 *
 * 用法：cn('btn', isActive && 'btn-active', { 'btn-disabled': disabled })
 */

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
```
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/cn.ts
git commit -m "feat(frontend): cn 工具（clsx 薄壳）"
```

---

## Task B3: useMediaQuery hook

**Files:**
- Create: `frontend/src/hooks/useMediaQuery.ts`

- [ ] **Step 1: 实现**

```ts
/**
 * useMediaQuery
 *
 * 监听 media query 匹配状态，SSR 友好（默认 false 直到 hydrate）。
 * 用于 Sheet 在桌面 / 移动端切换底层实现（Radix Dialog vs vaul Drawer）。
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent): void => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/hooks/useMediaQuery.ts
git commit -m "feat(frontend): useMediaQuery hook"
```

---

## Task B4: useViewportFix hook

**Files:**
- Create: `frontend/src/hooks/useViewportFix.ts`

- [ ] **Step 1: 实现**

```ts
/**
 * useViewportFix
 *
 * 解决移动端 100vh 不等于真实可视高度的问题：
 *  - 监听 visualViewport.resize / scroll
 *  - 实测高度写入 CSS 变量 --app-vh（被 #app 高度引用）
 *  - 检测键盘弹起：innerHeight - visualViewport.height >= 100 时，
 *    给 <body> 加 data-keyboard="true"，CSS 利用此 hook 隐藏元素
 *
 * 不依赖任何状态库；挂载即生效，组件树根处调用一次即可。
 */

import { useEffect } from 'react';

const KEYBOARD_THRESHOLD_PX = 100;

export function useViewportFix(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;

    const update = (): void => {
      const height = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-vh', `${height}px`);

      const innerH = window.innerHeight;
      const keyboardOpen =
        vv !== undefined && innerH - height >= KEYBOARD_THRESHOLD_PX;
      if (keyboardOpen) {
        document.body.setAttribute('data-keyboard', 'true');
      } else {
        document.body.removeAttribute('data-keyboard');
      }
    };

    update();

    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    } else {
      window.addEventListener('resize', update);
    }

    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      } else {
        window.removeEventListener('resize', update);
      }
      document.documentElement.style.removeProperty('--app-vh');
      document.body.removeAttribute('data-keyboard');
    };
  }, []);
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/hooks/useViewportFix.ts
git commit -m "feat(frontend): useViewportFix（visualViewport + 键盘检测）"
```

---

## Task B5: Sheet primitive（桌面 modal / 移动 drawer）

**Files:**
- Create: `frontend/src/components/ui/Sheet.tsx`

- [ ] **Step 1: 实现**

```tsx
/**
 * Sheet
 *
 * 双形态弹层：
 *  - 桌面（≥768px）：Radix Dialog 居中卡片
 *  - 移动（<768px）：vaul Drawer 底部滑入
 *
 * 共享 API：受控 open；title 显示在头部；children 内容由调用者负责。
 * footer 可选（按钮区，桌面 / 移动一致）。
 */

import { type JSX, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { cn } from '../../utils/cn.js';

export interface SheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 内容最大高度受限（覆盖默认 90vh / 90dvh） */
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
}: SheetProps): JSX.Element {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Drawer.Content
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border-t border-(--color-border) bg-(--color-bg-elevated) outline-none',
              className,
            )}
          >
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-(--color-border)" />
            <header className="flex items-center justify-between px-4 py-3 border-b border-(--color-border)">
              <span className="text-md text-(--color-fg)">{title}</span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="关闭"
                className="text-(--color-fg-muted) hover:text-(--color-fg) p-1"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-3">{children}</div>
            {footer && (
              <footer className="flex justify-end gap-2 border-t border-(--color-border) px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                {footer}
              </footer>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex w-full max-w-[640px] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-(--color-border) bg-(--color-bg-elevated) outline-none',
            className,
          )}
        >
          <header className="flex items-center justify-between px-5 py-3 border-b border-(--color-border)">
            <Dialog.Title className="text-md text-(--color-fg) font-medium">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭"
                className="text-(--color-fg-muted) hover:text-(--color-fg) p-1"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-(--color-border) px-5 py-3">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
```
Expected: 通过（如果 Tailwind v4 不识别 `bg-(--var)` 任意值变体可改写为 `bg-[var(--color-bg-elevated)]` 等价语法，再 typecheck）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/Sheet.tsx
git commit -m "feat(frontend): Sheet primitive（桌面 Dialog / 移动 Drawer）"
```

---

## Task B6: IconButton primitive

**Files:**
- Create: `frontend/src/components/ui/IconButton.tsx`

- [ ] **Step 1: 实现**

```tsx
/**
 * IconButton
 *
 * 图标按钮：lucide 图标 + 触控目标 ≥40×40（移动端）/ 28×28（桌面）。
 * 默认 ghost 风格（透明底、hover 时浮起边框）。
 */

import { type ButtonHTMLAttributes, type JSX, type ReactNode } from 'react';
import { cn } from '../../utils/cn.js';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** 视觉变体 */
  variant?: 'ghost' | 'accent';
}

export function IconButton({
  children,
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        'min-h-[40px] min-w-[40px] md:min-h-[28px] md:min-w-[28px]',
        'p-2 md:p-1',
        variant === 'ghost' &&
          'text-(--color-fg-muted) hover:bg-(--color-border) hover:text-(--color-fg)',
        variant === 'accent' &&
          'bg-(--color-accent) text-white hover:opacity-90',
        rest.disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/ui/IconButton.tsx
git commit -m "feat(frontend): IconButton primitive"
```

---

## Task B7: Pill primitive

**Files:**
- Create: `frontend/src/components/ui/Pill.tsx`

- [ ] **Step 1: 实现**

```tsx
/**
 * Pill
 *
 * 状态徽标：圆角 99px、等宽字体、单色边框；支持多 tone。
 * 用于 StatusBar、实例 tab 内端口号等。
 */

import { type JSX, type ReactNode } from 'react';
import { cn } from '../../utils/cn.js';

export type PillTone = 'ok' | 'warn' | 'error' | 'muted' | 'accent';

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<PillTone, string> = {
  ok: 'border-(--color-success) text-(--color-success)',
  warn: 'border-(--color-warning) text-(--color-warning)',
  error: 'border-(--color-error) text-(--color-error)',
  muted: 'border-(--color-border) text-(--color-fg-muted)',
  accent: 'border-(--color-accent) text-(--color-accent)',
};

export function Pill({ tone = 'muted', children, className }: PillProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-mono whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/ui/Pill.tsx
git commit -m "feat(frontend): Pill primitive"
```

---

## Task B8: Toggle primitive

**Files:**
- Create: `frontend/src/components/ui/Toggle.tsx`

- [ ] **Step 1: 实现**

```tsx
/**
 * Toggle
 *
 * Radix Switch 的极薄包装：受控 checked + onCheckedChange + 可选 label。
 */

import { type JSX } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { cn } from '../../utils/cn.js';

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: ToggleProps): JSX.Element {
  return (
    <label className={cn('inline-flex items-center gap-2 text-xs text-(--color-fg-muted)', className)}>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          'relative h-[18px] w-[30px] rounded-full border border-(--color-border) bg-(--color-bg) transition-colors',
          'data-[state=checked]:bg-(--color-accent) data-[state=checked]:border-(--color-accent)',
          'disabled:opacity-40',
        )}
      >
        <Switch.Thumb
          className={cn(
            'block h-[12px] w-[12px] translate-x-[2px] rounded-full bg-(--color-fg-muted) transition-transform',
            'data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-white',
          )}
        />
      </Switch.Root>
      {label && <span>{label}</span>}
    </label>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/ui/Toggle.tsx
git commit -m "feat(frontend): Toggle primitive（Radix Switch 包装）"
```

---

## Task B9: TextField primitive

**Files:**
- Create: `frontend/src/components/ui/TextField.tsx`

- [ ] **Step 1: 实现**

```tsx
/**
 * TextField
 *
 * 受控 input + 错误态边框 + helper text。
 * 不带 label（label 由调用者控制布局）。
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 错误信息（非空时切红边） */
  error?: string | null;
  /** 提示文字 */
  helper?: string;
  /** 字体走 mono 还是 sans */
  mono?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { error, helper, mono, className, ...rest },
  ref,
) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <input
        ref={ref}
        {...rest}
        className={cn(
          'rounded-md border bg-(--color-bg) px-2 py-1.5 text-(--color-fg) outline-none',
          'text-sm',
          mono ? 'font-mono' : 'font-sans',
          error
            ? 'border-(--color-error) focus:border-(--color-error)'
            : 'border-(--color-border) focus:border-(--color-accent)',
          'disabled:opacity-50',
          className,
        )}
      />
      {error && <span className="text-xs text-(--color-error) font-sans">{error}</span>}
      {!error && helper && (
        <span className="text-xs text-(--color-fg-muted) font-sans">{helper}</span>
      )}
    </div>
  );
});
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/ui/TextField.tsx
git commit -m "feat(frontend): TextField primitive"
```

---

# Stage C · 页面与组件重构

## Task C1: App 接入 viewport fix

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 改写**

读现有 `App.tsx`，把 `useViewportFix()` 加入根。完整新内容：

```tsx
/**
 * App 根组件
 *
 * 阶段 2：根据认证状态切换 AuthPage / ConsolePage
 *  - pending: 显示加载占位（防止 AuthPage 闪现后又跳走）
 *  - unauthenticated: AuthPage
 *  - authenticated: ConsolePage
 *
 * viewport fix 在根组件挂一次即生效全局。
 */

import type { JSX } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useViewportFix } from './hooks/useViewportFix.js';
import { AuthPage } from './pages/AuthPage.js';
import { ConsolePage } from './pages/ConsolePage.js';

export function App(): JSX.Element {
  useViewportFix();
  const { status, login } = useAuth();

  if (status === 'pending') {
    return (
      <div className="flex flex-1 items-center justify-center text-(--color-fg-muted) font-mono">
        <span>加载中…</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <AuthPage onLogin={login} />;
  }

  return <ConsolePage />;
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/App.tsx
git commit -m "feat(frontend): App 接入 useViewportFix；loading 改 utility 类"
```

---

## Task C2: AuthPage 改造

**Files:**
- Modify: `frontend/src/pages/AuthPage.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * AuthPage
 *
 * 认证页面：用户输入 token 后提交，成功跳到 ConsolePage。
 *
 * 设计：
 * - 受控 input + 显式 submit 按钮
 * - URL 参数 ?token=xxx（来自二维码扫码）自动填充输入框
 *   注意：自动填充但不自动提交——避免恶意链接绕过用户确认
 * - 错误信息红色显示在按钮上方
 */

import { useEffect, useState, type JSX, type FormEvent } from 'react';

export interface AuthPageProps {
  /** 提交 token；返回 null 成功，否则返回错误信息 */
  onLogin: (token: string) => Promise<string | null>;
}

export function AuthPage({ onLogin }: AuthPageProps): JSX.Element {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      if (t) setToken(t);
    } catch {
      /* */
    }
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const msg = await onLogin(token);
    setSubmitting(false);
    if (msg !== null) setError(msg);
  };

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-6">
      <div className="w-full max-w-[320px] rounded-xl border border-(--color-border) bg-(--color-bg-elevated) p-5">
        <h1 className="m-0 mb-1 text-lg font-medium text-(--color-fg)">Open-Claude-Remote</h1>
        <p className="mb-4 mt-0 text-xs text-(--color-fg-muted)">
          输入服务端启动时显示的 Token
        </p>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <input
            type="password"
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2.5 font-mono text-sm text-(--color-fg) outline-none focus:border-(--color-accent)"
            placeholder="64 位 Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />

          {error && <p className="m-0 font-mono text-xs text-(--color-error)">{error}</p>}

          <button
            type="submit"
            disabled={submitting || token.trim().length === 0}
            className="rounded-md bg-(--color-accent) px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '验证中…' : '登录'}
          </button>
        </form>

        <p className="mt-4 text-2xs leading-relaxed text-(--color-fg-muted)">
          扫描终端二维码或手动输入 Token；登录后 Token 会保存在本设备
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/pages/AuthPage.tsx
git commit -m "refactor(frontend): AuthPage 重写为 utility 类、字号收紧"
```

---

## Task C3: StatusBar 用 Pill primitive

**Files:**
- Modify: `frontend/src/components/status/StatusBar.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * StatusBar
 *
 * 状态条：连接状态 + 会话状态两个 Pill。无独立背景，由父容器（顶栏）提供。
 */

import type { JSX } from 'react';
import type { SessionStatus } from '@ocr/shared';
import type { ConnectionStatus } from '../../stores/app-store.js';
import { Pill, type PillTone } from '../ui/Pill.js';

export interface StatusBarProps {
  connection: ConnectionStatus;
  session: SessionStatus;
}

const CONN_LABEL: Record<ConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
};

const SESSION_LABEL: Record<SessionStatus, string> = {
  idle: '空闲',
  running: '运行中',
  waiting_input: '等待审批',
};

const CONN_TONE: Record<ConnectionStatus, PillTone> = {
  connecting: 'warn',
  connected: 'ok',
  disconnected: 'error',
};

const SESSION_TONE: Record<SessionStatus, PillTone> = {
  idle: 'muted',
  running: 'ok',
  waiting_input: 'warn',
};

export function StatusBar({ connection, session }: StatusBarProps): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <Pill tone={CONN_TONE[connection]}>{CONN_LABEL[connection]}</Pill>
      <Pill tone={SESSION_TONE[session]}>{SESSION_LABEL[session]}</Pill>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/status/StatusBar.tsx
git commit -m "refactor(frontend): StatusBar 用 Pill primitive"
```

---

## Task C4: ScrollToBottomButton 用 lucide

**Files:**
- Modify: `frontend/src/components/terminal/ScrollToBottomButton.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * ScrollToBottomButton
 *
 * 用户向上滚动离开底部时显示的悬浮按钮。
 * 键盘弹起时通过 .hide-on-keyboard 隐藏（避免被键盘遮）。
 */

import type { JSX } from 'react';
import { ArrowDown } from 'lucide-react';

export interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({
  visible,
  onClick,
}: ScrollToBottomButtonProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="返回底部"
      title="返回底部"
      className="hide-on-keyboard absolute right-4 bottom-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-(--color-accent) text-white shadow-lg hover:opacity-90"
    >
      <ArrowDown size={18} strokeWidth={1.5} />
    </button>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/terminal/ScrollToBottomButton.tsx
git commit -m "refactor(frontend): ScrollToBottomButton 用 lucide ArrowDown，键盘弹起时隐藏"
```

---

## Task C5: TerminalView className 默认值

**Files:**
- Modify: `frontend/src/components/terminal/TerminalView.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * TerminalView
 *
 * 终端容器，极薄壳。所有逻辑都在 useTerminal 里。
 */

import { forwardRef } from 'react';
import { cn } from '../../utils/cn.js';

export interface TerminalViewProps {
  className?: string;
}

export const TerminalView = forwardRef<HTMLDivElement, TerminalViewProps>(
  function TerminalView({ className }, ref) {
    return <div ref={ref} className={cn('h-full w-full', className)} />;
  },
);
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/terminal/TerminalView.tsx
git commit -m "refactor(frontend): TerminalView className 用 cn 合并"
```

---

## Task C6: IpChangeToast 改造

**Files:**
- Modify: `frontend/src/components/common/IpChangeToast.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * IpChangeToast
 *
 * 屏幕底部黄色横条，IP 漂移时提示用户。
 * 不自动消失；手动 dismiss 或点"复制链接"。
 *
 * 位置上移到 InputBar 之上（避免压输入栏）：bottom = 输入栏高度（44） + safe-bottom + 8。
 */

import { useState, type JSX } from 'react';
import { cn } from '../../utils/cn.js';

export interface IpChangeInfo {
  oldIp: string;
  newIp: string;
  newUrl?: string;
}

export interface IpChangeToastProps {
  info: IpChangeInfo | null;
  onDismiss: () => void;
}

export function IpChangeToast({ info, onDismiss }: IpChangeToastProps): JSX.Element | null {
  const [copied, setCopied] = useState(false);
  if (!info) return null;

  const target = info.newUrl ?? `http://${info.newIp}/`;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'fixed left-2 right-2 z-30 flex flex-wrap items-center gap-2 rounded-lg bg-(--color-warning) px-3 py-2.5 text-sm text-[#0d1117] shadow-xl',
        'bottom-[calc(52px+env(safe-area-inset-bottom)+8px)]',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">服务端 IP 已变化</span>
        <span className="font-mono text-xs">
          {info.oldIp} → <strong>{info.newIp}</strong>
        </span>
        <span className="break-all font-mono text-2xs opacity-80">{target}</span>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded border border-black/30 bg-black/15 px-2.5 py-1 text-xs text-[#0d1117] hover:bg-black/25"
        >
          {copied ? '已复制' : '复制链接'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-black/30 bg-black/15 px-2.5 py-1 text-xs text-[#0d1117] hover:bg-black/25"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/common/IpChangeToast.tsx
git commit -m "refactor(frontend): IpChangeToast 去 ⚠ emoji，位置上移避开输入栏"
```

---

## Task C7: PushToggle 重写（utility 化、不再有 emoji）

**Files:**
- Modify: `frontend/src/components/common/PushToggle.tsx`

注：不再放在顶栏，改由 SettingsModal "通知" 分页内嵌。组件本身仍存在。

- [ ] **Step 1: 改写**

```tsx
/**
 * PushToggle
 *
 * Web Push 订阅开关（设置面板"通知"分页内嵌）。
 * - 不支持时禁用 + 显示原因
 * - 已拒绝权限时显示提示，浏览器已锁，无法再触发
 * - 已订阅 / 未订阅 提供切换按钮
 *
 * 设计原则：极客风、无 emoji；状态描述靠文字 + Pill。
 */

import { type JSX } from 'react';
import { usePushNotification } from '../../hooks/usePushNotification.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import { cn } from '../../utils/cn.js';

export function PushToggle(): JSX.Element {
  const { status, busy, error, subscribe, unsubscribe } = usePushNotification();

  let label: string;
  let toneText: string;
  let tone: PillTone;
  let onClick: (() => void) | null = null;
  let disabled = busy;

  switch (status) {
    case 'unsupported':
      label = '当前浏览器不支持';
      toneText = '不支持';
      tone = 'muted';
      disabled = true;
      break;
    case 'denied':
      label = '通知权限被禁，请在系统设置中开启';
      toneText = '已禁';
      tone = 'error';
      disabled = true;
      break;
    case 'subscribed':
      label = busy ? '处理中…' : '点击关闭推送';
      toneText = '已开启';
      tone = 'ok';
      onClick = () => void unsubscribe();
      break;
    case 'unsubscribed':
    default:
      label = busy ? '处理中…' : '点击开启推送';
      toneText = '未开启';
      tone = 'muted';
      onClick = () => void subscribe();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Pill tone={tone}>{toneText}</Pill>
        <span className="text-xs text-(--color-fg-muted)">
          Claude 触发审批时通过 Web Push 通知到本设备
        </span>
      </div>
      <button
        type="button"
        onClick={onClick ?? undefined}
        disabled={disabled}
        title={error ?? ''}
        className={cn(
          'self-start rounded-md border px-3 py-1.5 text-sm transition-colors',
          'border-(--color-border) bg-(--color-bg) text-(--color-fg) hover:bg-(--color-bg-elevated)',
          disabled && 'opacity-40 cursor-not-allowed',
        )}
      >
        {label}
      </button>
      {error && <span className="text-xs text-(--color-error)">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/common/PushToggle.tsx
git commit -m "refactor(frontend): PushToggle 去 emoji、用 Pill 表达状态"
```

---

## Task C8: ShortcutSettings 用 codec + primitives

**Files:**
- Modify: `frontend/src/components/settings/ShortcutSettings.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * ShortcutSettings
 *
 * 编辑快捷键列表。data 字段在 input 层走 escape codec：
 *  - 显示：encodeForInput(s.data)，把 \x1b 等控制字节变成可读 \e \r \xHH
 *  - 写回：decodeFromInput(rawString)，warning 时标红
 *
 * 布局：
 *  - 桌面：单行（label / data / 启用 / 删除）
 *  - 移动：两行（label+data；启用+删除）
 */

import { useMemo, useState, type JSX } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { ConfigurableShortcut } from '@ocr/shared';
import { encodeForInput, decodeFromInput } from '../../utils/escape-codec.js';
import { TextField } from '../ui/TextField.js';
import { Toggle } from '../ui/Toggle.js';
import { IconButton } from '../ui/IconButton.js';

export interface ShortcutSettingsProps {
  value: ConfigurableShortcut[];
  onChange: (next: ConfigurableShortcut[]) => void;
}

interface RowState {
  /** raw input 字符串（编辑层视图） */
  dataRaw: string;
  /** 当前 raw 解析的 warning */
  warning: string | null;
}

export function ShortcutSettings({ value, onChange }: ShortcutSettingsProps): JSX.Element {
  // 每行的 raw 编辑状态独立维护，保证用户输入 \\e 中途不会被反向编码刷回
  const initialRaws = useMemo<RowState[]>(
    () => value.map((s) => ({ dataRaw: encodeForInput(s.data), warning: null })),
    // 仅初始化一次；后续 value 变化由用户内部驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [raws, setRaws] = useState<RowState[]>(initialRaws);

  const update = (idx: number, patch: Partial<ConfigurableShortcut>): void => {
    onChange(value.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const updateRaw = (idx: number, raw: string): void => {
    const r = decodeFromInput(raw);
    setRaws((prev) => prev.map((p, i) => (i === idx ? { dataRaw: raw, warning: r.warning } : p)));
    if (r.warning === null) update(idx, { data: r.value });
  };
  const remove = (idx: number): void => {
    setRaws((prev) => prev.filter((_, i) => i !== idx));
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    setRaws((prev) => [...prev, { dataRaw: '', warning: null }]);
    onChange([...value, { label: '', data: '', enabled: true }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="py-4 text-center text-sm text-(--color-fg-muted)">
          暂无快捷键，点击下方「新增」添加
        </p>
      )}

      {value.map((s, idx) => {
        const row = raws[idx] ?? { dataRaw: '', warning: null };
        return (
          <div
            key={idx}
            className="flex flex-col gap-2 rounded-md border border-(--color-border) bg-(--color-bg) p-2 md:flex-row md:items-start"
          >
            <TextField
              type="text"
              value={s.label}
              placeholder="显示名"
              mono
              className="md:max-w-[120px]"
              onChange={(e) => update(idx, { label: e.target.value })}
            />
            <TextField
              type="text"
              value={row.dataRaw}
              placeholder="\\e 表示 ESC，\\r 表示回车"
              mono
              error={row.warning}
              helper={row.warning ? undefined : '支持 \\e \\r \\n \\t \\xHH'}
              onChange={(e) => updateRaw(idx, e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Toggle
                checked={s.enabled}
                onCheckedChange={(checked) => update(idx, { enabled: checked })}
                label="启用"
              />
              <IconButton aria-label="删除" onClick={() => remove(idx)}>
                <Trash2 size={14} strokeWidth={1.5} />
              </IconButton>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1 rounded-md border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-accent) hover:border-(--color-accent)"
      >
        <Plus size={12} strokeWidth={1.5} />
        新增快捷键
      </button>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/settings/ShortcutSettings.tsx
git commit -m "feat(frontend): ShortcutSettings 用 escape codec 与 UI primitives，移动端两行布局"
```

---

## Task C9: CommandSettings 改 primitives

**Files:**
- Modify: `frontend/src/components/settings/CommandSettings.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * CommandSettings
 *
 * 编辑命令列表（如 /clear、/compact）。
 * autoSend 默认 true：点击后直接发送。false 则只填到输入框等用户编辑。
 */

import { type JSX } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { ConfigurableCommand } from '@ocr/shared';
import { TextField } from '../ui/TextField.js';
import { Toggle } from '../ui/Toggle.js';
import { IconButton } from '../ui/IconButton.js';

export interface CommandSettingsProps {
  value: ConfigurableCommand[];
  onChange: (next: ConfigurableCommand[]) => void;
}

export function CommandSettings({ value, onChange }: CommandSettingsProps): JSX.Element {
  const update = (idx: number, patch: Partial<ConfigurableCommand>): void => {
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const remove = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    onChange([...value, { label: '', command: '', enabled: true, autoSend: true }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="py-4 text-center text-sm text-(--color-fg-muted)">
          暂无命令，点击下方「新增」添加
        </p>
      )}

      {value.map((c, idx) => (
        <div
          key={idx}
          className="flex flex-col gap-2 rounded-md border border-(--color-border) bg-(--color-bg) p-2 md:flex-row md:items-start"
        >
          <TextField
            type="text"
            value={c.label}
            placeholder="显示名"
            mono
            className="md:max-w-[120px]"
            onChange={(e) => update(idx, { label: e.target.value })}
          />
          <TextField
            type="text"
            value={c.command}
            placeholder="命令文本（如 /clear）"
            mono
            onChange={(e) => update(idx, { command: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              checked={c.enabled}
              onCheckedChange={(checked) => update(idx, { enabled: checked })}
              label="启用"
            />
            <Toggle
              checked={c.autoSend ?? true}
              onCheckedChange={(checked) => update(idx, { autoSend: checked })}
              label="自动发送"
            />
            <IconButton aria-label="删除" onClick={() => remove(idx)}>
              <Trash2 size={14} strokeWidth={1.5} />
            </IconButton>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1 rounded-md border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-accent) hover:border-(--color-accent)"
      >
        <Plus size={12} strokeWidth={1.5} />
        新增命令
      </button>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/settings/CommandSettings.tsx
git commit -m "refactor(frontend): CommandSettings 用 UI primitives，移动端两行布局"
```

---

## Task C10: SettingsModal 用 Sheet + Tabs，新增"通知"分页

**Files:**
- Modify: `frontend/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * SettingsModal
 *
 * 设置面板：桌面 modal / 移动 sheet（共用 Sheet primitive）。
 * 三个 tab：快捷键 / 命令 / 通知。
 *
 * 编辑模型：本地草稿（draft）→ 保存按钮 PUT；保存失败弹 alert（toast 系统未来引入）。
 */

import { useEffect, useState, type JSX } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { UserConfig } from '@ocr/shared';
import { Sheet } from '../ui/Sheet.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { CommandSettings } from './CommandSettings.js';
import { PushToggle } from '../common/PushToggle.js';
import { cn } from '../../utils/cn.js';

export interface SettingsModalProps {
  open: boolean;
  current: UserConfig;
  onSave: (next: UserConfig) => Promise<boolean>;
  onClose: () => void;
}

type TabKey = 'shortcuts' | 'commands' | 'notifications';

export function SettingsModal({
  open,
  current,
  onSave,
  onClose,
}: SettingsModalProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('shortcuts');
  const [draft, setDraft] = useState<UserConfig>(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(current);
      setTab('shortcuts');
    }
  }, [open, current]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) onClose();
    else alert('保存失败，请稍后重试');
  };

  const tabBtnClass = (key: TabKey): string =>
    cn(
      'border-b-2 px-3 py-2 text-sm transition-colors',
      tab === key
        ? 'border-(--color-accent) text-(--color-fg) font-medium'
        : 'border-transparent text-(--color-fg-muted) hover:text-(--color-fg)',
    );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="设置"
      footer={
        tab !== 'notifications' && (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-(--color-border) bg-transparent px-3 py-1.5 text-sm text-(--color-fg) hover:bg-(--color-bg)"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-md bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-[#0d1117] disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        )
      }
    >
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex flex-col gap-3">
        <Tabs.List className="flex border-b border-(--color-border)">
          <Tabs.Trigger value="shortcuts" className={tabBtnClass('shortcuts')}>
            快捷键
          </Tabs.Trigger>
          <Tabs.Trigger value="commands" className={tabBtnClass('commands')}>
            命令
          </Tabs.Trigger>
          <Tabs.Trigger value="notifications" className={tabBtnClass('notifications')}>
            通知
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="shortcuts">
          <ShortcutSettings
            value={draft.shortcuts ?? []}
            onChange={(shortcuts) => setDraft({ ...draft, shortcuts })}
          />
        </Tabs.Content>
        <Tabs.Content value="commands">
          <CommandSettings
            value={draft.commands ?? []}
            onChange={(commands) => setDraft({ ...draft, commands })}
          />
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <PushToggle />
        </Tabs.Content>
      </Tabs.Root>
    </Sheet>
  );
}
```

注：「通知」tab 不需要保存按钮（PushToggle 内部按钮即生效），所以 footer 在该 tab 下不渲染。

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/settings/SettingsModal.tsx
git commit -m "feat(frontend): SettingsModal 用 Sheet+Tabs，新增"通知"分页内嵌 PushToggle"
```

---

## Task C11: CreateInstanceModal 用 Sheet

**Files:**
- Modify: `frontend/src/components/instances/CreateInstanceModal.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * CreateInstanceModal
 *
 * 派生新 headless 实例的简单表单（Sheet 化）：
 *  - cwd（必填，绝对路径）
 *  - name（可选，留空 = cwd 末段）
 */

import { useEffect, useState, type JSX, type FormEvent } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { TextField } from '../ui/TextField.js';

export interface CreateInstanceModalProps {
  open: boolean;
  onSubmit: (cwd: string, name?: string) => Promise<boolean>;
  onClose: () => void;
}

export function CreateInstanceModal({
  open,
  onSubmit,
  onClose,
}: CreateInstanceModalProps): JSX.Element {
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCwd('');
      setName('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!cwd.trim()) {
      setError('cwd 不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(cwd.trim(), name.trim() || undefined);
    setSubmitting(false);
    if (ok) onClose();
    else setError('创建失败：请检查 cwd 是否存在');
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="创建新实例"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-(--color-border) bg-transparent px-3 py-1.5 text-sm text-(--color-fg) hover:bg-(--color-bg)"
          >
            取消
          </button>
          <button
            type="submit"
            form="create-instance-form"
            disabled={submitting || cwd.trim().length === 0}
            className="rounded-md bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-[#0d1117] disabled:opacity-50"
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <form id="create-instance-form" className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-fg-muted)">工作目录（cwd）</span>
          <TextField
            type="text"
            placeholder="/home/me/code/foo"
            value={cwd}
            mono
            onChange={(e) => setCwd(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-fg-muted)">实例名（可选）</span>
          <TextField
            type="text"
            placeholder="留空则用 cwd 末段"
            value={name}
            mono
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="m-0 font-mono text-xs text-(--color-error)">{error}</p>}
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/instances/CreateInstanceModal.tsx
git commit -m "refactor(frontend): CreateInstanceModal 用 Sheet primitive"
```

---

## Task C12: InstanceTabs 拆桌面 / 移动两形态

**Files:**
- Modify: `frontend/src/components/instances/InstanceTabs.tsx`
- Create: `frontend/src/components/instances/MobileInstanceSwitcher.tsx`

- [ ] **Step 1: 改写桌面 InstanceTabs**

```tsx
/**
 * InstanceTabs（桌面）
 *
 * 顶部横向标签条；每个实例一个 tab；点击非当前实例 → location.assign。
 * 「+」按钮触发 onCreateClick。移动端不渲染（用 MobileInstanceSwitcher）。
 */

import { type JSX } from 'react';
import { Plus } from 'lucide-react';
import type { InstanceListItem } from '@ocr/shared';
import { cn } from '../../utils/cn.js';

export interface InstanceTabsProps {
  instances: InstanceListItem[];
  onCreateClick: () => void;
}

export function InstanceTabs({ instances, onCreateClick }: InstanceTabsProps): JSX.Element {
  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) return;
    window.location.assign(`http://${i.host}:${i.port}/`);
  };

  return (
    <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide" aria-label="实例切换">
      {instances.map((i) => (
        <button
          key={i.instanceId}
          type="button"
          onClick={() => handleSwitch(i)}
          title={`${i.cwd} · pid=${i.pid}`}
          disabled={i.isCurrent}
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs',
            i.isCurrent
              ? 'border-(--color-accent) bg-(--color-bg) text-(--color-fg) cursor-default'
              : 'border-(--color-border) text-(--color-fg-muted) hover:text-(--color-fg) hover:border-(--color-fg-muted)',
          )}
        >
          <span>{i.name}</span>
          <span className="font-mono text-2xs opacity-70">:{i.port}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onCreateClick}
        title="创建新实例"
        aria-label="创建新实例"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--color-border) text-(--color-fg-muted) hover:text-(--color-fg) hover:border-(--color-fg-muted)"
      >
        <Plus size={14} strokeWidth={1.5} />
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: 创建 MobileInstanceSwitcher**

```tsx
/**
 * MobileInstanceSwitcher
 *
 * 移动端：右上角按钮 = 当前实例名 + 切换图标。
 * 点击打开底部 sheet 列出全部实例 + 创建按钮。
 */

import { useState, type JSX } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import type { InstanceListItem } from '@ocr/shared';
import { Sheet } from '../ui/Sheet.js';
import { cn } from '../../utils/cn.js';

export interface MobileInstanceSwitcherProps {
  instances: InstanceListItem[];
  onCreateClick: () => void;
}

export function MobileInstanceSwitcher({
  instances,
  onCreateClick,
}: MobileInstanceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = instances.find((i) => i.isCurrent);

  const handleSwitch = (i: InstanceListItem): void => {
    if (i.isCurrent) {
      setOpen(false);
      return;
    }
    window.location.assign(`http://${i.host}:${i.port}/`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-fg-muted) hover:text-(--color-fg)"
        aria-label="切换实例"
      >
        <LayoutGrid size={12} strokeWidth={1.5} />
        <span className="max-w-[100px] truncate">{current?.name ?? '未命名'}</span>
        <span className="font-mono text-2xs opacity-70">:{current?.port ?? '-'}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="实例">
        <div className="flex flex-col gap-1.5">
          {instances.map((i) => (
            <button
              key={i.instanceId}
              type="button"
              onClick={() => handleSwitch(i)}
              className={cn(
                'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm',
                i.isCurrent
                  ? 'border-(--color-accent) bg-(--color-bg) text-(--color-fg)'
                  : 'border-(--color-border) text-(--color-fg-muted) hover:bg-(--color-bg)',
              )}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="truncate text-(--color-fg)">{i.name}</span>
                <span className="truncate font-mono text-xs">{i.cwd}</span>
              </div>
              <span className="ml-2 font-mono text-xs opacity-70">:{i.port}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateClick();
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-(--color-border) px-3 py-2 text-sm text-(--color-accent) hover:border-(--color-accent)"
          >
            <Plus size={14} strokeWidth={1.5} />
            创建新实例
          </button>
        </div>
      </Sheet>
    </>
  );
}
```

- [ ] **Step 3: typecheck + commit**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
git add frontend/src/components/instances/InstanceTabs.tsx frontend/src/components/instances/MobileInstanceSwitcher.tsx
git commit -m "feat(frontend): InstanceTabs 拆桌面/移动两形态，移动端用 Sheet"
```

---

## Task C13: InputBar 拆快捷键栏 + 用 IconButton

**Files:**
- Modify: `frontend/src/components/input/InputBar.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * InputBar
 *
 * 输入栏（仅渲染输入框 + 发送按钮 + 设置按钮）。
 * 快捷键栏拆出，由父级 ConsolePage 直接渲染（独立 sticky 行）。
 *
 * 提供两个组件导出：
 *  - InputBar：输入行
 *  - ShortcutsBar：快捷键行（移动端单行横向滚动；桌面端可换行）
 */

import {
  useState,
  useCallback,
  type JSX,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, Settings } from 'lucide-react';
import type { ConfigurableShortcut } from '@ocr/shared';
import { IconButton } from '../ui/IconButton.js';
import { cn } from '../../utils/cn.js';

export interface InputBarProps {
  onSend: (data: string) => boolean;
  disabled?: boolean;
  onOpenSettings?: () => void;
}

export function InputBar({
  onSend,
  disabled,
  onOpenSettings,
}: InputBarProps): JSX.Element {
  const [value, setValue] = useState('');

  const send = useCallback(
    (withReturn: boolean): void => {
      if (disabled) return;
      const data = withReturn ? value + '\r' : value;
      if (data.length === 0) return;
      if (onSend(data)) setValue('');
    },
    [onSend, disabled, value],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send(true);
      }
    },
    [send],
  );

  const onFormSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      send(true);
    },
    [send],
  );

  return (
    <form
      onSubmit={onFormSubmit}
      className="flex shrink-0 items-stretch gap-2 border-t border-(--color-border) bg-(--color-bg-elevated) px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"
    >
      <input
        type="text"
        placeholder={disabled ? '未连接…' : '输入命令，回车发送'}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="flex-1 min-w-0 rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 font-mono text-base text-(--color-fg) outline-none focus:border-(--color-accent) disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || value.length === 0}
        aria-label="发送"
        className="rounded-md bg-(--color-accent) px-3 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send size={14} strokeWidth={1.5} />
      </button>
      {onOpenSettings && (
        <IconButton onClick={onOpenSettings} aria-label="设置" title="设置">
          <Settings size={14} strokeWidth={1.5} />
        </IconButton>
      )}
    </form>
  );
}

export interface ShortcutsBarProps {
  shortcuts?: ConfigurableShortcut[];
  onShortcut: (data: string) => void;
  disabled?: boolean;
}

export function ShortcutsBar({
  shortcuts,
  onShortcut,
  disabled,
}: ShortcutsBarProps): JSX.Element | null {
  const enabled = (shortcuts ?? []).filter((s) => s.enabled);
  if (enabled.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto scrollbar-hide border-t border-(--color-border) bg-(--color-bg-elevated) px-2 py-1">
      {enabled.map((s, idx) => (
        <button
          type="button"
          key={`${s.label}-${idx}`}
          onClick={() => !disabled && onShortcut(s.data)}
          disabled={disabled}
          title={s.desc ?? s.label}
          className={cn(
            'whitespace-nowrap rounded border border-(--color-border) bg-(--color-bg) px-2.5 py-1 font-mono text-xs text-(--color-fg)',
            'min-h-[28px]',
            'active:bg-(--color-border)',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
```

注：现在 `ConsolePage.tsx` 还在引用旧的 `InputBar`（接收 `shortcuts`/`onOpenSettings` 一起），typecheck 会失败。下一个 task 同步更新 ConsolePage。如果你严格按 task 顺序跑，这一步把这个失败先记下来，下一步会修。

如果你希望保持 typecheck 永远绿，可以把这两个 task 合并成一个 commit。这里按可独立 commit 的粒度拆开，写代码者可灵活合并。

- [ ] **Step 3: 暂存（不 commit，等 ConsolePage 同步）**

```bash
git add frontend/src/components/input/InputBar.tsx
# 暂不 commit
```

或者先合并到下一 task。

---

## Task C14: ConsolePage 重构（顶栏合并、PushToggle 移除、快捷键独立行）

**Files:**
- Modify: `frontend/src/pages/ConsolePage.tsx`

- [ ] **Step 1: 改写**

```tsx
/**
 * ConsolePage
 *
 * 控制台主页：把 useTerminal + useWebSocket + 输入相关组件 + 状态显示串起来。
 *
 * 布局（移动优先）：
 *  - 顶栏（h-9px 左右）：[桌面] InstanceTabs + StatusBar + Settings 图标按钮
 *                       [移动] MobileInstanceSwitcher + StatusBar + Settings
 *  - 终端区（flex-1）
 *  - 快捷键栏（移动端单行横向滚动）
 *  - InputBar（sticky bottom，含 safe-bottom padding）
 *
 * 数据流：
 *  - WS server message → onMessage → 分发至 terminal / 状态 / Toast
 *  - useTerminal onResize → ws.send resize
 *  - InputBar onSend / ShortcutsBar onShortcut → ws.send user_input
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import { Settings } from 'lucide-react';
import type { ServerMessage, SessionStatus, ClientMessage } from '@ocr/shared';
import { useTerminal } from '../hooks/useTerminal.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useAppStore } from '../stores/app-store.js';
import { TerminalView } from '../components/terminal/TerminalView.js';
import { ScrollToBottomButton } from '../components/terminal/ScrollToBottomButton.js';
import { InputBar, ShortcutsBar } from '../components/input/InputBar.js';
import { StatusBar } from '../components/status/StatusBar.js';
import { SettingsModal } from '../components/settings/SettingsModal.js';
import { InstanceTabs } from '../components/instances/InstanceTabs.js';
import { MobileInstanceSwitcher } from '../components/instances/MobileInstanceSwitcher.js';
import { CreateInstanceModal } from '../components/instances/CreateInstanceModal.js';
import { IpChangeToast, type IpChangeInfo } from '../components/common/IpChangeToast.js';
import { IconButton } from '../components/ui/IconButton.js';
import { useLocalNotification } from '../hooks/useLocalNotification.js';

export function ConsolePage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [ipChange, setIpChange] = useState<IpChangeInfo | null>(null);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const { config, save } = useUserConfig();
  const { instances, create: createInstance } = useInstances();
  const localNotify = useLocalNotification();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);

  const handleResize = useCallback((cols: number, rows: number): boolean => {
    return sendRef.current?.({ type: 'resize', cols, rows }) ?? false;
  }, []);

  const {
    write,
    scrollToBottom,
    setAutoFollow,
    showScrollHint,
    adaptToPtySize,
  } = useTerminal(containerRef, handleResize);

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'terminal_output':
          write(msg.data);
          break;
        case 'history_sync':
          write(msg.data);
          if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
            adaptToPtySize(msg.cols, msg.rows);
          }
          setSessionStatus(msg.status);
          break;
        case 'status_update':
          setSessionStatus(msg.status);
          if (msg.status === 'waiting_input') {
            localNotify.notify('Claude 等待审批', msg.detail ?? '请在 Claude 中确认');
          }
          break;
        case 'terminal_resize':
          adaptToPtySize(msg.cols, msg.rows);
          break;
        case 'session_ended':
          write(`\r\n\x1b[33m[会话结束 · exit ${msg.exitCode} · ${msg.reason}]\x1b[0m\r\n`);
          setSessionStatus('idle');
          break;
        case 'error':
          write(`\r\n\x1b[31m[错误 ${msg.code}: ${msg.message}]\x1b[0m\r\n`);
          break;
        case 'ip_changed':
          setIpChange({ oldIp: msg.oldIp, newIp: msg.newIp, newUrl: msg.newUrl });
          break;
        case 'heartbeat':
          break;
      }
    },
    [write, adaptToPtySize, localNotify],
  );

  const { send } = useWebSocket(handleMessage);
  sendRef.current = send;

  const handleUserInput = useCallback(
    (data: string): boolean => send({ type: 'user_input', data }),
    [send],
  );

  const handleScrollToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom, setAutoFollow]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <header className="flex shrink-0 items-center gap-2 border-b border-(--color-border) bg-(--color-bg-elevated) px-2 py-1.5 pt-[calc(env(safe-area-inset-top)+6px)]">
        <div className="min-w-0 flex-1 overflow-hidden">
          {isMobile ? (
            <MobileInstanceSwitcher
              instances={instances}
              onCreateClick={() => setCreateOpen(true)}
            />
          ) : (
            <InstanceTabs
              instances={instances}
              onCreateClick={() => setCreateOpen(true)}
            />
          )}
        </div>
        <StatusBar connection={connectionStatus} session={sessionStatus} />
        <IconButton
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
          title="设置"
        >
          <Settings size={14} strokeWidth={1.5} />
        </IconButton>
      </header>

      <div className="relative min-h-0 flex-1 bg-(--color-bg)">
        <TerminalView ref={containerRef} className="absolute inset-0 p-2" />
        <ScrollToBottomButton visible={showScrollHint} onClick={handleScrollToBottom} />
      </div>

      <ShortcutsBar
        shortcuts={config.shortcuts}
        onShortcut={(data) => send({ type: 'user_input', data })}
        disabled={connectionStatus !== 'connected'}
      />

      <InputBar
        onSend={handleUserInput}
        disabled={connectionStatus !== 'connected'}
      />

      <SettingsModal
        open={settingsOpen}
        current={config}
        onSave={save}
        onClose={() => setSettingsOpen(false)}
      />
      <CreateInstanceModal
        open={createOpen}
        onSubmit={createInstance}
        onClose={() => setCreateOpen(false)}
      />
      <IpChangeToast info={ipChange} onDismiss={() => setIpChange(null)} />
    </div>
  );
}
```

注变化点：
- 顶栏合并（InstanceTabs/MobileInstanceSwitcher + StatusBar + Settings IconButton）
- PushToggle 不再在顶栏（已移入 SettingsModal）
- ShortcutsBar 与 InputBar 分两行渲染
- Settings 入口从 InputBar 移到顶栏（保持 InputBar 简洁）

- [ ] **Step 2: typecheck**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
```
Expected: 通过（连同上一 task 的 InputBar 改动）。

- [ ] **Step 3: 启动 dev 验证**

```bash
cd /mnt/d/github/open-claude-remote
pnpm dev
```

桌面 Chrome 打开页面：
- 顶栏一行同时显示实例 tab + 状态 pill + 设置图标
- 终端区可见
- 快捷键栏一行
- 输入栏在底部

按 F12 → 切到 iPhone SE 模拟（375×667）：
- MobileInstanceSwitcher 取代 InstanceTabs
- 点击设置图标，弹出 sheet（从底部滑入）
- 在 sheet 内切到「通知」tab，看到 PushToggle
- 点击 cwd 输入框（"创建新实例"），sheet 形态正确
- 输入框 focus 时，InputBar 在键盘上方
- 页面无垂直滚动条

按 Ctrl+C 终止。

- [ ] **Step 4: Commit InputBar + ConsolePage 一并提交**

```bash
git add frontend/src/components/input/InputBar.tsx frontend/src/pages/ConsolePage.tsx
git commit -m "feat(frontend): ConsolePage 顶栏合并、ShortcutsBar 独立行、移动端 InstanceSwitcher"
```

---

## Task C15: 删除旧 BEM CSS

**Files:**
- Delete: `frontend/src/styles/global.css`

- [ ] **Step 1: 确认无引用**

```bash
cd /mnt/d/github/open-claude-remote/frontend
grep -rn "global.css\|status-bar__pill\|input-bar__\|settings-modal__\|instance-tab\|push-toggle\|ip-change-toast" src/ 2>/dev/null
```
Expected: 仅在被删的 CSS 文件本身有命中，**source code 内全部是 utility class，无任何旧 BEM class**。

如果 grep 找出仍在引用的旧 class，回到对应组件改成 utility（这种是 task 之间的疏漏）。

- [ ] **Step 2: 删除文件**

```bash
git rm frontend/src/styles/global.css
```

- [ ] **Step 3: 启动 dev 最终验证**

```bash
cd /mnt/d/github/open-claude-remote
pnpm dev
```
所有页面视觉不应回退（如果某处样式丢失，说明刚才 grep 漏了）。Ctrl+C 终止。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(frontend): 删除旧 BEM global.css，全面切换 Tailwind utility"
```

---

# Stage D · 文档与验证

## Task D1: 写 ADR

**Files:**
- Create: `docs/plans/open-claude-remote-clone/adrs/0011-frontend-stack-tailwind-radix.md`

- [ ] **Step 1: 写入**

```markdown
# ADR-0011 · 前端样式栈选型：Tailwind v4 + Radix + vaul

## 状态

已采纳（2026-05-05）

## 背景

阶段 4–9 的 690 行手写 BEM `global.css` 已经覆盖了所有视觉细节，但：

- 字号 7 档无层级、移动端布局用 `100vh` 在地址栏 / 软键盘出现时溢出导致内容被挤出一屏；
- 设置面板与「创建新实例」用居中 modal，移动端体验差；
- 没有可访问性底座（焦点陷阱、`aria-*`、Esc 关闭）；
- 装饰大量依赖 emoji（🔔 ⚙ ⚠），与"极客 / 终端工具"调性不一致。

需要一次系统性升级。

## 决策

引入：

- **Tailwind CSS v4**（`@tailwindcss/vite`）：用 `@theme` 注入现有 CSS 变量为 token，组件层一律 utility，删除手写 BEM；
- **Radix UI primitives**（`react-dialog` / `react-tabs` / `react-switch` / `react-tooltip`）：a11y 底座；
- **vaul**：移动端底部 sheet 专用库（drag 手势、橡皮筋）；
- **lucide-react**：单色 stroke 图标，全面替换 emoji；
- **clsx**：条件 className 拼接。

新增 `frontend/src/components/ui/` 集中 primitives：`Sheet` / `Modal` / `IconButton` / `Pill` / `Toggle` / `TextField`。

## 理由

- Tailwind v4 零配置（无 `tailwind.config.js`、无 PostCSS），且 `@theme` 直接消费已有 CSS 变量，保留视觉资产；
- Radix 是行业事实标准的可访问性底座，体积友好（仅装用到的子包）；
- vaul 与 Radix Dialog 通过统一的 `open` / `onOpenChange` API 拼成 `Sheet` primitive，桌面 / 移动两形态零负担；
- lucide 图标继承 `currentColor` + 统一 `strokeWidth=1.5`，与 JetBrains Mono 字体的极客调性一致；
- 总打包增量 ≈ 35–45KB gzip，对项目轻量级前端可接受。

## 后果

正面：

- 全局移除 emoji，视觉一致性提升；
- 移动端布局改为 `100dvh` + `visualViewport` hook，键盘弹起时输入栏紧贴键盘上沿；
- SettingsModal / CreateInstanceModal 移动端走底部 sheet；
- 所有图标按钮触控目标 ≥40×40，符合移动端规范；
- 字号收紧为 6 档梯度，默认 13px。

负面 / 待权衡：

- 引入 7 个新 npm 依赖，初期对维护人有一定学习成本；
- Tailwind v4 的 `@theme` 与 `bg-(--var)` 任意值变体语法相对新，需要团队熟悉；
- vaul 在不支持 visualViewport 的极旧浏览器降级体验有限（不影响主流移动端）。

回退：每个 Stage 一次 commit；如果未来要回退，可逐 Stage `git revert` 到旧 BEM 实现。
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/d/github/open-claude-remote
git add docs/plans/open-claude-remote-clone/adrs/0011-frontend-stack-tailwind-radix.md
git commit -m "docs(adr): 0011 前端样式栈选型 Tailwind v4 + Radix + vaul"
```

---

## Task D2: 更新 CHANGELOG 与 progress overview

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/plans/open-claude-remote-clone/progress/overview.md`

- [ ] **Step 1: 在 CHANGELOG 顶部加入新条目**

打开 `CHANGELOG.md`，在最上方一段紧跟 `# Changelog` 标题之下追加：

```markdown
## [Unreleased]

### 改动
- 前端整体样式重写：Tailwind v4 + Radix + vaul + lucide；删除 690 行手写 BEM
- 移动端布局根因修复：`100dvh` + visualViewport hook，键盘弹起时输入栏紧贴键盘上沿
- 快捷键设置乱码修复：UI 层加入 `\e \r \n \t \xHH` 编解码；协议层不变
- SettingsModal 与 CreateInstanceModal 桌面 modal / 移动 sheet 自适应
- PushToggle 从顶栏移入 SettingsModal「通知」分页
- InstanceTabs 拆桌面 / 移动两形态（移动端为右上角按钮 + sheet 列表）
- 全局移除 emoji（🔔 ⚙ ⚠），改用 lucide 单色 stroke 图标
- 字号梯度收紧为 6 档，默认 13px
- 清理 `analysis/upstream/` 上游参考材料
```

- [ ] **Step 2: 更新 progress overview**

打开 `docs/plans/open-claude-remote-clone/progress/overview.md`，找到合适位置（如所有阶段列表末尾）追加：

```markdown
### Stage Frontend Overhaul · ✅ 完成（2026-05-XX）

四件事：私货清扫、快捷键乱码修复、Tailwind+Radix+vaul 样式重写、移动端布局根因修复。

详见 `progress/stage-frontend-overhaul.md` 与 `adrs/0011-frontend-stack-tailwind-radix.md`。
```

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/github/open-claude-remote
git add CHANGELOG.md docs/plans/open-claude-remote-clone/progress/overview.md
git commit -m "docs: 更新 CHANGELOG 与 progress overview（前端整体改造完成）"
```

---

## Task D3: 最终验证

**Files:** (无改动)

- [ ] **Step 1: 类型检查**

```bash
cd /mnt/d/github/open-claude-remote
pnpm typecheck
```
Expected: 通过（含 backend / shared / frontend 全部 workspace）。

- [ ] **Step 2: 单测**

```bash
pnpm test
```
Expected: 全绿，含新增 `escape-codec.test.ts` 用例。

- [ ] **Step 3: 私货清扫验证**

```bash
git ls-files | grep -i upstream
grep -rn "作者：复刻者" docs/ 2>/dev/null
grep -rn "🔔\|⚙\|⚠" frontend/src/ 2>/dev/null
```
Expected: 三条全部无输出（emoji 0 命中；按键名 ↑↓←→ 在 shared 默认配置中保留，那是 Unicode 几何符不在搜索范围）。

- [ ] **Step 4: 启动 backend + frontend 联调**

```bash
pnpm dev
```

浏览器打开（按 backend 启动时输出的 URL）：

- [ ] 桌面 Chrome：登录、看到主控台、顶栏一行布局正确、终端能用
- [ ] 设置弹窗：3 个 tab 都正常；快捷键 input 显示 `\e \r \xHH` 等可读字符；改一个保存后回填仍可读
- [ ] 通知 tab：PushToggle 在内部展示
- [ ] 创建新实例 sheet：能开能关
- [ ] 视觉中无 emoji（仅 lucide 图标 + 文字）
- [ ] DevTools → Toggle device toolbar → iPhone SE：
  - 页面无垂直 / 水平滚动条
  - 设置弹窗为底部 sheet（从下方滑入）
  - 输入框 focus 时，InputBar 紧贴键盘上方（模拟器内可看到 visualViewport 变化的视觉效果；真机更准）
  - 实例切换变成右上角按钮 + sheet
  - 快捷键栏单行可左右滚动
- [ ] DevTools → Toggle device toolbar → 关掉。手动调整窗口宽度跨过 768px 阈值，确认 modal/sheet 形态正确切换

按 Ctrl+C 终止。

- [ ] **Step 5: 真机移动浏览器测试（如果可能）**

如果当前环境能启动 backend 并暴露 LAN：
1. 启动 backend：`pnpm start`，记下 LAN URL
2. 用 iPhone Safari 或 Android Chrome 打开 LAN URL
3. 重点验证：
   - 页面不需要滚动就能看到输入框
   - 输入框 focus 调出键盘后，输入框依然在键盘上方而非被遮
   - 设置 sheet 滑入手势顺畅
4. 用完 `pnpm stop` 清理所有实例

如果当前环境无法跑真机（无 LAN / 无设备），在 PR 描述中标注「未做真机验证，建议合并前手测」。

- [ ] **Step 6: Commit（如果验证步骤产生了任何修复）**

如果验证发现问题并修了，commit；否则跳过。

---

## Self-Review

逐项核对 spec → plan：

| Spec 要求 | Plan 任务 |
|---|---|
| §1 范围与目标：四件事 | A1（私货）/ B1+C8（乱码）/ A2-A3+B5-B9+C2-C15（样式）/ B4+C1+C13+C14（移动端） |
| §2 私货清扫：删 analysis/upstream + design.md 残留 + 更新 .gitignore + 改 CLAUDE.md | A1 全覆盖 |
| §3 escape-codec | B1（codec + 单测） + C8（接入 ShortcutSettings） |
| §4 Tailwind 接入 + token + 字号梯度 | A2 + A3 |
| §5 UI primitives 7 个 | B5/B6/B7/B8/B9 + cn(B2) + useMediaQuery(B3) |
| §6 ConsolePage 新布局 + AuthPage 微调 | C14（ConsolePage）+ C2（AuthPage）|
| §7 useViewportFix + 输入框行为 + 滚动条策略 | B4（hook）+ C1（接入）+ C13（InputBar pb safe-bottom）+ index.css scrollbar-hide |
| §8 实施分阶段 | Stage A/B/C/D 完整对应 |
| §9 验证清单 | D3 |
| §10 决策摘要 | D1（ADR）|

**placeholder 扫描**：通读全文无 TBD/TODO；每个代码 step 均有完整代码块；每个 commit 命令均有 `git add` + `git commit -m`。

**类型一致性**：
- `Sheet` 的 `onOpenChange(next: boolean)` 在 SettingsModal/CreateInstanceModal/MobileInstanceSwitcher 调用一致
- `Pill` 的 `tone` 类型 `PillTone` 在 StatusBar 中正确 import
- `escape-codec` 的 `decodeFromInput` 返回 `{ value, warning }`，ShortcutSettings 的消费一致
- `InputBar` 拆分后 `ShortcutsBar` 在 ConsolePage 中作为同模块导出 import 一致
- `MobileInstanceSwitcher` 的 props 与 `InstanceTabs` 对齐

无问题。

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-frontend-overhaul.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 我每个 task 派一个新鲜的 subagent，task 间 review，迭代快、上下文不污染

**2. Inline Execution** — 在本会话直接执行，按 checkpoint 批量执行 + 你确认

**Which approach?**
