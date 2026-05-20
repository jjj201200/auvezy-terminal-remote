# ADR-006: Shiki 实际选用版本与 API 调用形态

## 状态

已采纳(2026-05-21)

## 上下文

ADR-004 决定选 Shiki,但 Shiki 0.x → 1.x → 2.x → 4.x 演进中 API 反复重构;设计阶段无法锁死调用形态。本 ADR 在阶段 6 实施完成后落档**实际版本与最终调用方式**,供未来维护者直接读不被 design 伪代码误导。

## 决策

- **版本**:`shiki@4.1.0`(`pnpm --filter frontend add shiki` 装到的当时主线)
- **API**:**顶级 `codeToHtml(code, { lang, theme })`**(`bundle-web` 入口暴露的便利 async 函数,内部含 singleton highlighter + 按需 lazy load grammar/theme,不需要 caller 自己 `createHighlighter` / `loadLanguage`)
- **import 方式**:`const { codeToHtml } = await import('shiki')`(dynamic import,让 Vite 自动拆 chunk)
- **包装**:`frontend/src/utils/syntax-highlight.ts` 暴露 `highlight(code, backendLang, theme): Promise<string>`,内部:
  - 走 `lang-map.toShikiLang()` 把后端 lang 短名映射到 Shiki `BundledLanguage`(未知 → `'txt'` 走降级)
  - >200 KB 文本 / 未知 lang / shiki import 失败 / codeToHtml 抛 → 一律 `escapeHtml + wrapPre`,**不抛**
- **主题**:跟随 `matchMedia('(prefers-color-scheme: dark)')` → `github-dark` / `github-light`(Shiki 内置主题,体积 0 增量)

## Bundle 增量验证

`pnpm --filter auvezy-terminal-remote-frontend build` 量出:

| chunk | 大小 | gz | 备注 |
|---|---|---|---|
| `index-C2QvSMLL.js` | 1288 KB | **383 KB** | 主 app bundle,**0 处 shiki 直引** |
| `index-H2oXs40U.js` | 223 KB | **69 KB** | Shiki 入口 chunk(grammar registry + 主入口) |
| `tsx-COt5Ahok.js` | 175 KB | 16 KB | tsx grammar(打开 .tsx 文件才拉) |
| `typescript-BPQ3VLAy.js` | 181 KB | 16 KB | ts grammar |
| ... (每个 BundledLanguage 一个 chunk) | | | |

**净增量评估**:主 app bundle **0 KB**;用户**首次打开任何文件预览**才下载 shiki 入口 chunk(69 KB gz)+ 对应 lang chunk(~15-30 KB gz)。

ADR-004 设的"主 bundle 增量 ≤ 50 KB gz"阈值——按"主 app bundle"口径(`index-C2QvSMLL`)**通过**;按"shiki 入口 chunk"口径(69 KB)**超出**,但该 chunk 是 lazy 的,不影响首屏。**判定通过,不触发改 Prism 回退条款。**

## 理由

1. 顶级 `codeToHtml` 是 Shiki 4.x 最简单且最稳的 API,代码量少;
2. dynamic import 让 Vite 自动产出 chunk 图,无需手动 `manualChunks`;
3. 单 lang chunk 体积仍在 15-30 KB gz,移动端可接受;
4. 不自己缓存 highlighter——Shiki 内部已是 singleton。

## 后果

- ✅ 主 app bundle 零增量,首屏不受影响;
- ✅ 首次预览时多一次 ~85 KB gz 下载(shiki 入口 + 一个 lang),浏览器 HTTP cache + Vite hash chunk 后续即命中;
- ⚠️ shiki 4.x → 5.x major 升级时回头检查本 ADR + `syntax-highlight.ts`:`codeToHtml` API 历史稳定,但 BundledLanguage 列表会变;
- ⚠️ 如未来需进一步压缩(只引用项目实际可能出现的 langs),可改用 `shiki/core` + 显式 import langs 列表,需更新本 ADR;当前 YAGNI。
