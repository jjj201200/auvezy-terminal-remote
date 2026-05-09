# ADR-004: HTTP 反代用 `http-proxy` 库

## 状态

已采纳（2026-05-09）

## 上下文

broker 需要把 `/i/<id>/*` 反代到 `http://127.0.0.1:<port>/*`。包括：

- 普通 HTTP（GET / POST / PUT / DELETE）
- POST body 透传（含 chunked / Content-Length）
- SSE 长连接（`/api/instances/stream`）
- WebSocket upgrade（`/i/<id>/ws`）
- 错误处理（worker 死了 / 超时）
- X-Forwarded-* 头注入

我们 0.6.x spike 自己用 Node `http.request` + `net.connect` 写了 ~100 行代码，**已踩坑**：

- `req.on('close')` 误触发 destroy upstream → ECONNRESET
- POST body 透传被 Express body parser 抢消费 → upstream 等不到 body
- 返回的 response cookie / set-cookie 头透传不正确
- WebSocket raw socket 拼接 HTTP 请求头容易出错

## 决策

引入 [`http-proxy`](https://github.com/http-party/node-http-proxy) npm 包，用它的 `createProxyServer().web()` 和 `.ws()` 方法。

理由：
- 老牌项目（2012-）、生产环境广泛使用（webpack-dev-server / vite / create-react-app proxy 都基于它或 http-proxy-middleware）
- 处理过 SSE / WebSocket / chunked / 大文件 / 错误回调
- API 简洁：
  ```ts
  const proxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:3001' });
  proxy.web(req, res);   // HTTP
  proxy.ws(req, socket, head);  // WebSocket upgrade
  ```
- 包大小：~30KB（gzip ~10KB），broker bundle 增长可接受

## 拒绝的替代方案

### 方案 A：自己写（0.6.x spike 的路）

**拒绝原因**：spike 已经验证踩坑成本大于库引入成本。我们应该专注 atr 自身业务，不重新发明反代轮子。

### 方案 B：`http-proxy-middleware`

`http-proxy` 的 Express middleware 包装。

**拒绝原因**：

- 多一层抽象（middleware → http-proxy → http），复杂度增加
- middleware 风格在我们场景下没好处（broker 反代是一整块逻辑，不是 middleware 链中的一环）
- 其它框架的兼容性（Koa / fastify）我们不需要

### 方案 C：`fastify-http-proxy`

用 fastify 替代 Express。

**拒绝原因**：换 web 框架是大改动；atr 整套是 Express，没必要为反代换栈。

### 方案 D：在前面加 nginx / Caddy 当反代

让用户在 broker 之前再放一层。

**拒绝原因**：

- 用户体验崩溃：装 atr 还要装 nginx / Caddy + 写配置
- 0.6.x 的核心卖点就是"`atr <cmd>` 一条命令"，引入外部反代直接破功

## 实现要点

- broker 启动时创建一个 `httpProxy.createProxyServer()`，复用整个进程的连接池
- `target` 不固定（每个请求按 instanceId 算），用 `proxy.web(req, res, { target })` 动态传
- 错误回调：`proxy.on('error', ...)` 统一处理 ECONNRESET / ETIMEDOUT，返回 502 + JSON
- WS upgrade：在 httpServer `'upgrade'` 事件里调 `proxy.ws()`，注意必须用 `prependListener` 抢在我们自己 WsServer 之前
- 增加 X-Forwarded-* 头：用 `proxyReq.setHeader()`（参见 ADR-008）

## 后果

### 正面

- 0.6.x spike 的所有 ECONNRESET / body 透传 bug 直接消失
- SSE / WebSocket 自动正确（包括压缩、keep-alive）
- 错误模型完整（库本身有 `error`、`econnreset`、`proxyReqError` 等事件）
- 维护精力放在 atr 自己的业务上

### 负面 / 取舍

- 多一个 npm 依赖
  缓解：http-proxy 是稳定老库，安全审计良好；就 ~10KB gzip
- 不能 100% 控制反代行为
  缓解：库提供了所有需要的 hook（proxyReq / proxyRes / error）；真有不能做的事再考虑

## 监控

- 加 logger 在 proxy `error` 事件：[broker] HTTP 反代失败 instanceId / port / err
- proxyReq 事件可加 X-ATR-Forwarded-* 注入

## 相关

- ADR-001、ADR-008
- design.md §7（协议细节）
