# ADR-008: broker → worker 用 `X-ATR-Forwarded-*` 头传上下文

## 状态

已采纳（2026-05-09）

## 上下文

worker 在 0.6.x 时绑 LAN，自己知道：
- 监听的 hostname / IP（`detectDisplayIp` 选的那个）
- 端口
- 用来生成 entry URL（push subscription endpoint、share URL、扫码 URL 等）

0.7.0 worker 只听 `127.0.0.1`，外部 hostname / proto / 端口都是 broker 的事。worker 怎么知道？

例：worker 要给 push subscription 写 endpoint 时，正确的 endpoint 应该是 `https://wsl.tail3e456b.ts.net/i/<id>/api/push/...` 而不是 `http://127.0.0.1:43210/...`。

> **术语**：本 ADR 中的 "entry URL" 指**用户浏览器看到的入口 URL**（相对于
> worker 自己的 127.0.0.1:<port> loopback 而言），范围限定在私网 / Tailnet /
> 反代域名 / 本机 loopback。**不是公网**——0.7.0 不解决公网穿透
> （见 design.md §1.2）。早期实现叫 `getPublicUrl`，因 "public" 容易被读成
> "公网"已统一改名 `getEntryUrl`。

## 决策

broker 反代到 worker 时注入一组 `X-ATR-Forwarded-*` 头：

| 头 | 值 | 用途 |
|---|---|---|
| `X-ATR-Forwarded-Instance` | 目标 instanceId | worker 校验"我是被定向访问的"，避免误用别人的 cookie |
| `X-ATR-Forwarded-Host` | 用户访问的 hostname（含 port，如 `wsl.tail3e456b.ts.net`） | 生成 entry URL |
| `X-ATR-Forwarded-Proto` | `http` / `https` | 生成 entry URL |
| `X-ATR-Forwarded-Path` | broker 收到的完整 path（含 `/i/<id>/`） | 调试日志 |
| `X-Forwarded-For` | 真实 client IP | rate limit / 日志 |

worker 端：
- 提供 helper `getEntryUrl(req)` 从这些头反推外部 URL
- push / share / 扫码 URL 等所有需要"用户能访问的 URL"都用这个 helper
- 头不存在时（直连 worker，仅在调试 / 失败兜底）退化用 `req.host`

## 拒绝的替代方案

### 方案 A：worker 通过 broker.json 读 broker 的对外 hostname

worker 启动时读 broker.json 知道 broker 监听的 host/port，自己拼。

**拒绝原因**：

- broker 监听 `0.0.0.0:3000`，但用户访问可能通过反代域名（Tailscale Serve `wsl.ts.net`、nginx `atr.example.com`）—— broker 自己也不知道用户实际访问的 hostname
- 同一个 broker 同时被多个 hostname 访问（LAN IP / Tailscale 域名）是常态，写死一个 hostname 错的概率高

### 方案 B：用标准 `X-Forwarded-Host` / `X-Forwarded-Proto` 头

不加自定义 `X-ATR-` prefix，沿用业界标准头。

**拒绝原因**（部分采用）：

- `X-Forwarded-Host` / `X-Forwarded-Proto` 是行业标准，**这两个会保留并由 broker 注入**
- 但 `X-ATR-Forwarded-Instance` / `X-ATR-Forwarded-Path` 是 atr 内部协议，加 `X-ATR-` prefix 避免跟其它反代（如外层 nginx）的同名头冲突
- 用 `X-ATR-` 的好处：worker 可以严格断言"这个 instance id 是 broker 给的（可信）"，跟 client 自己塞的伪造头区分

### 方案 C：用 Unix Domain Socket（worker 监听 socket 文件）

broker / worker 走 UDS 通信，多种信息直接用 socket peer credentials 拿。

**拒绝原因**：

- Windows 不支持 UDS（要做平台分支）
- 调试困难（curl 不能直接打 UDS）
- 跨进程协议增加复杂度，TCP loopback 已经足够安全（worker 只 listen 127.0.0.1）

## 实现要点

### broker 端（http-proxy hooks）

```ts
proxy.on('proxyReq', (proxyReq, req, res, options) => {
  proxyReq.setHeader('X-ATR-Forwarded-Instance', instanceId);
  proxyReq.setHeader('X-Forwarded-Host', req.headers.host ?? '');
  proxyReq.setHeader('X-Forwarded-Proto', req.protocol ?? 'http');
  proxyReq.setHeader('X-ATR-Forwarded-Path', req.url ?? '');
  proxyReq.setHeader('X-Forwarded-For', req.ip ?? '');
});
```

### worker 端（getEntryUrl）

```ts
function getEntryUrl(req: Request, subPath = ''): string {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const instance = req.headers['x-atr-forwarded-instance'];
  const base = instance ? `/i/${instance}` : '';
  return `${proto}://${host}${base}${subPath}`;
}
```

## 后果

### 正面

- worker 不需要知道自己暴露在哪个 hostname 下
- push / share / 扫码 URL 等场景统一用 helper，不再散落
- 多反代场景（Tailscale Serve + LAN IP 同时可达）天然支持
- `X-ATR-` prefix 让我们能信任 broker 注入的内容

### 负面 / 取舍

- worker 测试 fixture 要构造这些头（mitigation：测试 helper 提供）
- 直连 worker（loopback，调试用）时头缺失，需要回退路径
  缓解：worker 启动 banner 警告"通过 broker 访问，直连未初始化 entry URL"

## 安全考虑

`X-Forwarded-For` / `X-Forwarded-Host` 在多层反代场景下有伪造风险（client 可能塞这俩头）。但我们场景下：

- worker 只听 `127.0.0.1`，外部 client 包根本到不了 worker
- 只有 broker 能连 worker，所以 worker 看到的这些头一定是 broker 注入的
- broker 收到 client 请求时**会移除** client 的 `X-Forwarded-*` 头，只用自己注入的（避免 client 自欺）

## 相关

- ADR-001（broker / worker 分离）
- ADR-009（worker loopback only）
- design.md §7.1 注入头
