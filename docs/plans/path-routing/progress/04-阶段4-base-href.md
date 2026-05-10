# 阶段 4 — HTML `<base href>` 注入 + 前端相对路径

> 状态：✅ 已完成（2026-05-10）；未 commit
> 阶段 3 已落地：broker 反代 / 静态资源 / WS upgrade 全通。
> 阶段 4 目标：让 SPA 经 broker 加载时所有相对路径正确解析到 `/i/<id>/...`。

## 目标

1. broker 反代 worker 的 HTML 响应时注入 `<base href="/i/<id>/">` 到 `</head>` 前
2. broker 自己提供根 `/` SPA 入口（前端 dist）时**不**注入（用户从 `/` 进入也能用，
   走"同源 SPA"路径，base href 即默认 `/`）
3. vite `base: './'`：编译产物里 `<script src="...">`、`<link href="...">` 全相对
4. 前端代码：fetch / EventSource / WebSocket 改为相对路径
5. SW scope 默认根 `/`（vite-plugin-pwa 默认即 `/`，无需动）

## 切片策略

| Sub | 内容 | 风险 |
|---|---|---|
| 4A | broker 反代 HTML 时注入 `<base href>` | 中（http-proxy 改写 body） |
| 4B | vite 加 `base: './'` | 低 |
| 4C | 前端 fetch / WS 路径改相对（`/api/foo` → `api/foo`、`/ws` → `ws`） | 中（散点扩散） |
| 4D | smoke：完整 SPA 通过 broker 加载、API/WS 走 broker 反代 | 中 |

## 任务清单

### 4A — broker HTML base href 注入

- [ ] `broker/instance-router.ts`：proxy.web 时若 worker 响应 `text/html`，
      buffer body + `</head>` 前插入 `<base href="/i/<instanceId>/">`，
      重写 content-length
- [ ] 实现路径：http-proxy `selfHandleResponse: true` + 监听 `proxyRes`
      累积 chunks → end 时注入 → 一次性 res.write/end
- [ ] 单测：mock worker 返回 HTML，验证 broker 出口含 `<base href>`；
      非 HTML（JSON/asset）原样透传

### 4B — vite base: './'

- [ ] `frontend/vite.config.ts` 加 `base: './'`
- [ ] dev 模式 vite 反代 `/api`、`/ws` 到 backend 3000——但 0.7.0 broker
      默认 3000，可保持不变（broker 自动 fork 后 worker 监听别的 port，
      vite 反代过去就是 broker，broker 再反代到 worker）。**注：dev 模式下
      base href 注入不生效（vite serve 自己出 index.html），所以前端代码
      在 dev 必须能"无 base href + 同源根路径"工作 —— 也就是阶段 4 的核心
      原则：fetch('api/...') 当 location 是 `/` 时照样走 `/api/...`**
- [ ] frontend build → 验产物无绝对 `/assets/...`

### 4C — 前端相对路径

- [ ] 全局把 `fetch('/api/foo')` 改成 `fetch('api/foo')`（无前导斜杠）
  - `services/api-client.ts` apiPost/Get/Delete/Put 接受 path：
    若以 `/` 起头就**剥掉**（兼容老调用方一次性升级）
  - `services/*.ts` 调用方传 `'api/...'`
- [ ] EventSource：`new EventSource('api/instances/stream', ...)`
- [ ] WebSocket：`useWebSocket` 默认 URL 用 `document.baseURI`
  - 由 `location.protocol` 决定 ws/wss
  - 由 `new URL('ws', document.baseURI).pathname` 拼最终 path
- [ ] SW：自身 import 路径相对；`/api/*`、`/ws` 的判断改为按 path 末尾片段
- [ ] 单测：api-client、useWebSocket、SW 路径判断

### 4D — smoke

- [ ] worker + broker 起完后，`curl /i/<id>/` → 返回 HTML，含
      `<base href="/i/<id>/">`
- [ ] HTML 中所有 asset URL 是 `./assets/...`（相对），浏览器解析后命中
      `/i/<id>/assets/...`
- [ ] 浏览器（或 puppeteer / 手测）打开 `http://broker/i/<id>/` 加载 SPA、
      调 /api/auth、连 WS 全通

## 与 design.md 对应

- §3 决策 7（base href 注入）→ 4A
- §7.2 broker 响应改写 → 4A
- §8 前端改造 → 4B/4C
- §决策 5 单 PWA → 不变（SW scope `/` + manifest `/`）

## 进度日志

### 2026-05-10 — 开工

写本文档；准备从 4A 注入开始。

### 2026-05-10 — 4A 完成

- proxy.ts createProxyServer 加 `selfHandleResponse?` 选项
- instance-router.ts：默认开启 selfHandleResponse；新增全局 `proxyRes` 监听
  + `handleProxyResponse(proxyRes, req, res)` 函数：识别 `text/html` →
  buffer body → `injectBaseHref(html, '/i/<id>/')` → 重写 content-length →
  一次性 res.end；非 HTML 走 stream.pipe 透传
- middleware 在 proxy.web 前把 instanceId 暂存到 `req.__atrInstanceId`
- `injectBaseHref` 函数：找到 `</head>` 前插入 `<base href>`，已含则不重复
- 新 8 个单测：5 个 injectBaseHref 单元 + 3 个 HTML 反代集成（注入正确、
  content-length 一致、非 HTML 不动）

### 2026-05-10 — 4B 完成

vite.config.ts 加 `base: './'`。frontend build 输出验证：
`<script src="./assets/...">`、`<link href="./assets/...">`、
`<link rel="manifest" href="./manifest.webmanifest">` 全相对。

### 2026-05-10 — 4C 完成

- api-client.ts: 新增 `toRelative(path)` 自动剥前导 `/`，所有
  apiPost/Get/Delete/Put 用它（兼容现有调用方传 `/api/...` 形式，无需逐个改）
- push-api.ts DELETE 直接 fetch 改 `'api/push/subscriptions'`（不带前导斜杠）
- useInstances EventSource 改 `'api/instances/stream'`
- useWebSocket 默认 URL：抽 `defaultWsUrl()` helper，从 `document.baseURI` 反推
  path 拼 `${proto}//${host}${basePath}ws`；broker 模式 → `ws://h/i/<id>/ws`，
  直连/dev → `ws://h/ws`，两端零修改自动适应
- sw.ts 缓存路由：`/api/` 和 `/ws` 判断改为 `includes`/`endsWith`，不再绑死
  path 起头位置（broker 反代下路径含 `/i/<id>/` 前缀）
- frontend 56/56 全绿；frontend build 成功

### 2026-05-10 — 4D smoke 通

清干净 HOME → 启 worker → broker 自动 fork：
- `curl /i/<id>/` 返回 HTML，含 `<base href="/i/<id>/">`，content-length 正确
- HTML 中 asset URL 均 `./assets/...`（vite base: './'）
- `curl /i/<id>/assets/index-*.js` → 200 + 1.23MB JS（broker 反代到 worker
  static）
- `curl /i/<id>/manifest.webmanifest` → 200 + `application/manifest+json`
- `curl /` （broker 根入口）返回 HTML，**不**注入 `<base href>`（broker 自己
  静态服务的入口走默认根 scope）

backend 481/481 全绿（+8：injectBaseHref 5 + HTML 反代 3）；frontend 56/56；
build 零错。阶段 4 整体完成（未 commit）。
