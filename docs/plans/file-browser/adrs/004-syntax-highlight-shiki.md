# ADR-004: 选 Shiki 做语法高亮

## 状态

已采纳(2026-05-20)

## 上下文

文本预览要语法高亮。前端候选:
- **Shiki**:VS Code 同款 TextMate grammar + Oniguruma WASM,输出 HTML(无运行时 DOM 操作)。
- **Prism.js**:正则驱动,体积小,但高亮粒度低、TS/TSX 等复杂语法表现弱。
- **highlight.js**:正则驱动,默认 bundle 巨大,质量介于 Prism 与 Shiki 之间。

## 决策

**选 Shiki**(`pnpm --filter frontend add shiki@latest`,按需 lazy load grammar)。

> 版本注:本 ADR 写作时 shiki 主线版本约在 1.x — 2.x 之间。Shiki 在 0.x → 1.x → 2.x 演进中多次重构 API(`getHighlighter` → `createHighlighterCore` → `getSingletonHighlighter`、bundle 路径从 `shiki/bundle-web` 到 `shiki/bundle/web`),**实施时按当时 README 调用**;ADR-006(待实施阶段 6 后补)记录最终选用的 shiki 版本与 lazy-load 调用形态,避免后人误信此处伪代码。

## 拒绝的替代方案

### Prism

- TS/TSX/Rust 等高亮粒度差,移动端阅读体验掉档;
- 维护活跃度下降。

### highlight.js

- 完整 bundle 体积大(~500 KB compressed),tree-shake 不够友好;
- 高亮质量仍逊 Shiki。

### 不做高亮(`<pre>` + CSS 行号)

- 代码/日志阅读体验差;
- 用户已明确要求要做。

## 理由

1. **质量最高**:VS Code grammar 直接对齐用户预期;
2. **lazy load 友好**:shiki 现行 bundle 都把 grammar + WASM 拆为可按需加载的 chunk(具体增量取决于版本,约 ~50-150 KB/lang),主 bundle 增量经验值 <10 KB;**实际增量需实施阶段 6 用 `vite build --report` 验证**,不达预期则改用 Prism;
3. **主题与 xterm 暗/亮匹配**:内置 `github-dark` / `github-light` 与现有 `themes/` 视觉风格一致;
4. **WASM 选型与项目口味一致**:0.7.3 用 zxing-wasm 替代 jsQR 已经走 WASM 路线;
5. **降级路径清晰**:加载失败/未知 lang/超大文本 → `escapeHtml`,UI 不报错。

## 后果

- ✅ 新增 `shiki` prod 依赖(frontend 包,**不影响 backend bundle** —— `bundle-backend.js` 只 bundle backend,frontend 独立 vite 打包);
- ✅ 主 bundle 增量极小;首次打开某 lang 文件首屏多一次 chunk 请求(浏览器 HTTP cache + Vite chunk 解决);
- ⚠️ 200 KB 以上文本强制降级(主线程别卡死);
- ⚠️ broker 静态资源体积小幅上升(分 chunk,不影响首屏);
- ⚠️ 实施阶段 6 必须用 `pnpm --filter frontend build -- --report` 量出"主 bundle 增量 + 每 lang chunk 体积",若主 bundle 增量 >50 KB gz 则触发 ADR-006 重新选型(改 Prism)。
