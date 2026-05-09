# ADR-001: broker 与 worker 严格进程分离

## 状态

已采纳（2026-05-09）

## 上下文

0.6.x：每个 atr 进程同时承担两个职责 ——

1. **入口**：监听 LAN IP，提供 web UI、API、WS、静态资源
2. **PTY 宿主**：spawn / 维护一个子进程（claude / zsh / vim）、转发 IO

多实例时这两个职责并存，所有实例都暴露 LAN，造成：

- 每实例 cookie name 必须 port-suffixed（`session_id_p<port>`）防同 hostname cookie 串
- 每个 origin 独立 SW / 独立 push subscription
- 用户切实例 = 跨 origin（流转 token / 重新 auth）
- 共享一个反代域名（如 Tailscale Serve）只能反代到一个 backend，其它实例够不着

0.7.0 引入 path-routing（`/i/<instanceId>/...`）后必须有一个进程**单独负责**接收外部请求、按 instanceId 反代到对应 PTY 宿主。这是经典的**反向代理 + 后端服务**架构。

## 决策

把入口职责拆出独立进程 `atr-broker`：

- **broker 进程**：监听对外 host（默认 `0.0.0.0:3000`），提供 web UI 静态资源、`/i/<id>/*` 反代、WS upgrade 反代、SPA fallback。**不跑 PTY**。
- **worker 进程**：spawn 子进程跑 PTY，绑 `127.0.0.1:<auto>` 不暴露 LAN。**所有外部请求通过 broker 反代到 worker**。

## 拒绝的替代方案

### 方案 A：对等模式（每个 atr 进程互为 broker）

- 任何 atr 进程都能反代到同 PC 上的兄弟实例
- 第一个启动的进程 grab LAN 入口（其它降级为 worker）
- 入口进程退出时 leader election 让另一个升级

**拒绝原因**：

- leader election 实现复杂（监听端口的"接管"涉及到 socket fd 转移 / 短暂请求丢失）
- "我既是 broker 又是 worker"职责模糊，cookie / sessions / SW 隔离逻辑要在每个进程里同时存在
- 对用户不直观："我开了 3 个 atr 进程，谁是入口？" —— 需要 UI 解释

### 方案 B：broker 是单独可执行二进制（`atr-broker`）

- 用户用 `npm i -g auvezy-terminal-remote-broker` 安装 broker
- worker 仍是 `auvezy-terminal-remote`

**拒绝原因**：

- 增加发布复杂度（两个 npm 包必须版本同步）
- 用户体验差：onboarding 多一步"再装一个 broker"
- 共享代码（registry / sessions / shared-token）跨包重复

### 方案 C：保持 0.6.x 单进程，broker 当 Express middleware 嵌入

- 不分进程，broker 只是 worker 启动时多挂的中间件链
- worker 既反代别人也跑自己 PTY

**拒绝原因**：本质上是"对等模式 +1"，问题相同。我们 0.6.x spike 就是这条路，踩了 9 个坑（design.md §1.2）。

## 后果

### 正面

- 职责清晰：broker 永远不接触 PTY 数据；worker 永远不接收外部连接
- broker 可以独立升级 / 重启，不影响 worker（worker 已绑 loopback）
- 安全模型简单：worker 不暴露 LAN，攻击面降低
- 可以为 broker 单独做 service install（开机自启），worker 按需启

### 负面 / 取舍

- 用户跑 `atr claude` 多了一步 "ensure broker"（fork / 复用）
- 单纯为跑一个临时 `atr zsh` 也会拉起 broker 进程（资源浪费 < 30MB，可接受）
- 调试时多一个进程要看（mitigation：`atr broker logs` 命令）

## 相关

- ADR-002（broker 生命周期）
- ADR-009（worker loopback only）
- design.md §4.1 进程拓扑
