# ADR-007: 服务端注入 `<base href>` + vite `base: './'`

## 状态

已采纳（2026-05-09）

## 上下文

`/i/<id>/...` 路径下加载的 HTML 里如果是绝对资源路径（`<script src="/assets/foo.js">`），浏览器会请求 `https://host/assets/foo.js`，**绕过 broker 的 `/i/<id>/` 反代**。这要么 404，要么命中 broker 的"自身静态资源"处理（如果 hash 一样能误命中，但脆弱）。

需要让浏览器把所有相对路径解析到 `/i/<id>/` 这个 base 下。三种方案：

- A. 服务端注入 `<base href>` + vite 编译期相对路径
- B. 客户端运行时 `withBase(path)` 函数包所有路径
- C. SW 内拦截请求重写

## 决策

**A. 服务端注入 `<base href>` + vite `base: './'`**：

1. **vite.config.ts 设 `base: './'`**：编译产物里所有 `<script src>`、`<link href>` 都是相对路径（`./assets/foo.js`）
2. **broker 反代 HTML 响应时注入** `<base href="/i/<id>/">` 到 `<head>` 末尾
3. **前端代码统一用相对 URL**：`fetch('api/auth')`（不是 `'/api/auth'`），`new WebSocket(new URL('ws', location.href))`

浏览器解析时：
- 当前 URL `https://host/i/<id>/...`
- `<base href>` = `/i/<id>/`
- `<script src="./assets/foo.js">` → 解析为 `https://host/i/<id>/assets/foo.js` ✓
- `fetch('api/auth')` → `https://host/i/<id>/api/auth` ✓

## 拒绝的替代方案

### 方案 B：运行时 `withBase()` 拼接

每个 fetch / WebSocket / asset 调用前用 `withBase(path)` 函数补 prefix。

**拒绝原因**（0.6.x spike 实测）：

- 散落各处易漏（Express 静态资源、第三方库、动态 import 都不走我们的 fetch wrapper）
- 维护成本高（每加一个 fetch 要记得调 withBase）
- 隐式耦合：`withBase` 通过读 `window.location.pathname` 推断 base，跟 URL 强绑定；URL 变了行为变了，跨场景测试难
- service worker scope / asset URL 这两块根本绕不开 base href，必须服务端注入

### 方案 C：SW 拦截请求重写

SW 收到请求看是不是 `/api/...`，若是改写为 `/i/<id>/api/...` 再走网络。

**拒绝原因**：

- SW 注册前的请求（HTML、SW 自身、初始 asset）拦不到
- 无 SW 环境（Safari 隐身模式）完全失效
- 复杂度高，调试困难

### 方案 D：用 hash 路由（`/#/i/<id>/...`）

**拒绝原因**：见 ADR-005（PWA 模型）已拒绝。

## 实现要点

### vite 配置

```ts
export default defineConfig({
  base: './',
  // ...
});
```

### broker HTML 注入

broker 反代 worker 响应时检查 `Content-Type: text/html`：

```ts
proxy.on('proxyRes', (proxyRes, req, res) => {
  if (!proxyRes.headers['content-type']?.includes('text/html')) return;

  // 收集 body
  const chunks: Buffer[] = [];
  proxyRes.on('data', (c) => chunks.push(c));
  proxyRes.on('end', () => {
    let html = Buffer.concat(chunks).toString('utf-8');
    const baseTag = `<base href="/i/${instanceId}/">`;
    // 简单字符串替换
    html = html.replace('</head>', `  ${baseTag}\n</head>`);
    res.setHeader('content-length', Buffer.byteLength(html));
    res.end(html);
  });
});
```

> **不用 HTML parser**：atr 自家 build 出的 HTML 格式可控，字符串替换足够。引入 cheerio / parse5 增加依赖 + 解析整个 DOM 浪费。

### 前端代码

- 删除 0.6.x spike 引入的 `services/base-path.ts`
- 所有 `fetch('/api/foo')` 改 `fetch('api/foo')`（去掉前导 `/`）
- WebSocket：`new WebSocket(new URL('ws', location.href + '/'))` —— 注意末尾加 `/`，否则 base 解析不正确
- SW：scope 由 manifest / 注册时控制，路由判断用 `self.registration.scope`

## 后果

### 正面

- 前端代码无 base path 感知，写法跟普通 SPA 一样
- 编译产物 / 第三方库 / 动态 import 全部自动正确（浏览器 base href 是规范）
- 服务端注入逻辑集中（broker 一个地方处理），易于维护

### 负面 / 取舍

- HTML 字符串替换有 edge case 风险（如果 vite 输出格式变化没有 `</head>` 闭合就失败）
  缓解：vite 输出格式稳定；测试覆盖检查注入正确性
- broker 必须 buffer HTML 全 body 才能注入（不能流式）—— 但 atr index.html < 5KB，影响可忽略
- 浏览器 base href 是经典特性，所有现代浏览器支持；iOS Safari 老版本（< 14）有些 bug 但我们目标是新版

## 验证清单

实施时跑以下场景确保 base href 正确工作：

- [ ] 加载 `/i/<id>/`，HTML 含 `<base href="/i/<id>/">`
- [ ] 加载的 `*.js` / `*.css` URL 是 `/i/<id>/assets/...`
- [ ] `fetch('api/auth')` 实际请求 `/i/<id>/api/auth`
- [ ] WebSocket 连接 `/i/<id>/ws`
- [ ] SW 注册成功，scope 正确（`/`）
- [ ] PWA 加主屏图标后 start_url 是 `/`（单 PWA 模型）

## 相关

- ADR-003（URL scheme）
- ADR-005（单 PWA）
- design.md §7.2 worker 响应改写、§8 前端改造
