# Path-based 多实例 broker 设计

> **状态**：设计稿 v1
> **日期**：2026-05-09
> **目标版本**：0.7.0（breaking change）
> **作者**：Drowsy + 咕咕

---

## 0. 一句话陈述

**0.7.0 起，atr 把"对外网络入口"从 worker（实例）剥离，集中到 broker 进程；所有外部访问形如 `https://<host>/i/<instanceId>/...`，浏览器看到的永远是同一个 origin。**

---

## 1. 为什么要做这件事

### 1.1 业务驱动

直接动机：让 atr 的 web push 能用。Web Push 要求 PWA 跑在 secure context（HTTPS），LAN 多端口直连场景下既不能拿 valid 证书（CA 不签 IP），也不能走 ts.net 反代到多个端口（tailscale serve 一次只反代一个 backend）。

工程上必须有一个**统一入口**承担 HTTPS / 反代终结、把请求按实例路由给后端 worker。这就是 broker。

### 1.2 顺带解决的历史负债

- **多实例同 hostname 时 cookie 串扰**：0.6.x 用 `session_id_p<port>` 做 port 后缀隔离，是 LAN 多端口直连场景的应急方案；不优雅、与"端口是实现细节"原则冲突
- **跨实例切换是跨 origin**：浏览器 SW / push subscription / cookie 都按 origin 隔离，导致每个实例独立订阅 push、独立 SW、独立 cookie 流转
- **ShareSheet 分享 LAN URL 是脆弱契约**：分享 `http://192.168.x.x:3001/?token=xxx` 给同事，对方能不能访问取决于他网络可达性 + token 滚动
- **多虚拟网卡场景下"扫码 URL"选哪个 IP 是一笔糊涂账**：现有 banner 列出十几个候选 URL，用户需要自己挑

path-based broker 同时解决以上所有问题。

### 1.3 不做这件事会怎样

- push 永远不能在 LAN 自托管场景下工作（除非用户自己上反代）
- "多实例"始终是凑合方案：多端口、多 origin、SW 各管各的
- 我们将持续在"双轨"代码路径里打补丁（v0.6.x spike 已经踩了 9 个坑）

---

## 2. 不做什么（明确边界）

- **不做账号体系**：仍是单用户共享 token；broker 只是流量入口，不引入用户、组织、ACL
- **不做 NAT 穿透 / 隧道**：broker 仍然只绑 LAN（或被 Tailscale Serve / 用户自配反代覆盖），不内置 frp / cloudflared / 自研协议
- **不动 PTY 协议**：broker 与 worker 之间用纯 HTTP/WebSocket 反代，不在 broker 层做协议解析
- **不做 broker 集群 / HA**：单机一个 broker，broker 死了用户重启
- **不向后兼容 0.6.x 的 LAN 多端口直连**：0.7.0 是 breaking release，旧 URL 失效（详见 §10 迁移路径）
- **本期不做 broker 的远端访问授权**：broker 默认绑 `0.0.0.0`，依靠"在 LAN / 在 Tailscale 内"作为信任边界，与 0.6.x 一致

---

## 3. 关键决策一览

| # | 决策 | 拒绝的替代 | ADR |
|---|---|---|---|
| 1 | broker 与 worker 严格进程分离 | 对等模式（每个 atr 互为 broker） | [ADR-001](./adrs/001-broker-worker-split.md) |
| 2 | broker 由首个 worker 启动时 auto-fork；最后一个 worker 退出后 broker **不退** | 用户手动 atr broker 启 / 系统级 daemon | [ADR-002](./adrs/002-broker-lifecycle.md) |
| 3 | URL 形如 `/i/<instanceId>/...`，instanceId 是 UUID | `/i/<port>/`、`/<slug>/`、subdomain | [ADR-003](./adrs/003-url-scheme.md) |
| 4 | HTTP 反代用 `http-proxy`（npm 包），不自己写 | 自己用 Node http 写 / `http-proxy-middleware` | [ADR-004](./adrs/004-proxy-library.md) |
| 5 | 单 PWA 单 origin；实例切换是 SPA 内部路由 | 每实例独立 PWA / 多 SW scope | [ADR-005](./adrs/005-pwa-model.md) |
| 6 | 共享 sessions store（`~/.atr/sessions.json` + 文件锁） | 每实例独立 sessions Map / 用 token 自验证 cookie | [ADR-006](./adrs/006-shared-sessions.md) |
| 7 | 服务端响应注入 `<base href="/i/<id>/">`；前端 vite `base: './'` 全相对 | 运行时 `withBase()` 拼接 / hash 路由 | [ADR-007](./adrs/007-base-href-injection.md) |
| 8 | broker 用 `X-ATR-Forwarded-Instance` 等头告诉 worker 上下文 | worker 自己生成 publicUrl（在 broker 模式下不知道外部 hostname） | [ADR-008](./adrs/008-forwarded-headers.md) |
| 9 | worker 只听 `127.0.0.1`，0.7.0 不再支持 LAN 直连 | 双轨：worker 既听 loopback 又听 LAN | [ADR-009](./adrs/009-worker-loopback-only.md) |
| 10 | broker 提供 `service install` 一键开机自启（systemd / launchd / Windows Service） | 不做（用户自己写）/ 跨平台 daemon 库 | [ADR-010](./adrs/010-service-install.md) |

---

## 4. 架构总览

### 4.1 进程拓扑

```
┌─────────────────────────── PC ───────────────────────────┐
│                                                            │
│   ┌──────────────────────────────────────────────────┐    │
│   │ atr-broker (进程 1)                              │    │
│   │   监听 0.0.0.0:<broker-port>（默认 3000）         │    │
│   │   职责：                                          │    │
│   │    - 终结 HTTP/HTTPS（如启用 cert）               │    │
│   │    - 提供静态资源（frontend-dist）                 │    │
│   │    - SPA fallback                                 │    │
│   │    - /i/<id>/* 反代到对应 worker                  │    │
│   │    - WS upgrade 反代                              │    │
│   │    - 注入 <base href> + X-ATR-Forwarded-* headers │    │
│   │   不做：                                           │    │
│   │    - 不跑 PTY                                     │    │
│   │    - 不维护实例 registry（只读）                   │    │
│   │    - 不签发 session（只透传）                     │    │
│   └────────────┬─────────────────────────────────────┘    │
│                │ HTTP/WS 反代                              │
│                │ host=127.0.0.1                            │
│                │                                            │
│   ┌────────────▼────────┐ ┌──────────┐ ┌──────────┐       │
│   │ atr worker A        │ │ worker B │ │ worker C │       │
│   │  127.0.0.1:<auto>   │ │   ...    │ │   ...    │       │
│   │  跑 PTY (claude/zsh)│ │          │ │          │       │
│   │  写 instances.json  │ │          │ │          │       │
│   └─────────────────────┘ └──────────┘ └──────────┘       │
│                                                            │
│   共享数据：                                                │
│     ~/.atrrc                  - 共享 token + 偏好          │
│     ~/.atr/instances.json     - worker registry            │
│     ~/.atr/sessions.json      - 共享 session store（新）    │
│     ~/.atr/broker.json        - broker 状态（pid/port）（新）│
│                                                            │
└────────────────────────────────────────────────────────────┘
                  ▲
                  │ HTTPS (Tailscale Serve / nginx 反代)
                  │
         ┌────────┴────────┐
         │ 浏览器 / PWA     │
         │ 单一 origin      │
         │ /i/<A>/  /i/<B>/ │
         └─────────────────┘
```

### 4.2 启动流程（用户视角）

```
$ atr claude              # 用户照旧跑这条命令
  ↓
worker process 启动
  ↓
worker 检查 ~/.atr/broker.json
  ├─ 不存在或 pid 已死 → fork 一个 atr-broker 进程
  │                       broker 监听 0.0.0.0:3000（自动找空端口）
  │                       broker 写 ~/.atr/broker.json
  └─ 存在且健康 → 直接复用现有 broker
  ↓
worker 自己绑 127.0.0.1:<auto-port>
worker 写入 instances.json
  ↓
banner 打印 broker 入口 URL（由 broker 提供，不是 worker 自己的端口）
  ↓
worker 跑 PTY，处理终端
```

### 4.3 关闭流程

| 事件 | 行为 |
|---|---|
| worker A 退出（Ctrl+C / 子进程死） | A 从 instances.json 注销；broker 不动 |
| 最后一个 worker 退出 | broker **不退**；继续提供 UI（实例列表为空，用户可在 web 上 "+ 新实例" 触发新 worker） |
| broker 闲置（无 worker、无 client 连接） | broker **不退**。资源占用低（< 30MB），换 UX 一致性 |
| broker 崩溃 / 被 kill | 下次任意 worker 启动时检测 broker.json pid 已死，重新 fork；如启用了 service 自启则由 OS 自动重启 |
| 用户显式 `atr broker stop` | broker 主动退出；不影响在跑的 worker（worker 已经监听 loopback，broker 死了它们仍能被新 broker 接手） |
| `atr stop` / `atr stop <pat>` | 沿用 0.6 语义停 worker；worker 全停后 broker 仍存活 |
| 系统重启 | broker 退（被 OS 杀）；如启用了 service 自启则开机时 OS 拉起 |

---

## 5. 核心组件设计

### 5.1 broker process（新）

#### 5.1.1 职责清单

1. 终结 HTTP（默认）/ HTTPS（如配 cert）
2. 提供 frontend-dist 静态资源 + SPA fallback
3. 路由 `/i/<id>/*` → 对应 worker（HTTP）
4. 路由 `/i/<id>/ws` → 对应 worker（WebSocket upgrade）
5. 注入 `<base href="/i/<id>/">` 到反代回的 HTML
6. 注入 `X-ATR-Forwarded-*` 头到反代请求
7. 维护 broker 状态文件 `~/.atr/broker.json`

#### 5.1.2 broker 不做的事

- **不签发 session**：所有 `/api/auth` 经 broker 透传到 worker
- **不维护 sessions Map**：worker 用共享 sessions store
- **不生成 token**：仍由 worker 在首次启动时生成共享 token 写到 `~/.atrrc`
- **不接 PTY**：永远不知道任何 PTY / WebSocket 消息内容

#### 5.1.3 入口选择

broker 启动时按优先级选 broker port：
1. CLI flag `--broker-port`（如有）
2. 环境变量 `ATR_BROKER_PORT`
3. 默认尝试 `[80, 443, 3000, 8080, 8000]` 依次找第一个能 bind 的
4. 都失败 → 找系统空 port

> 0.7.0 不要求 broker 一定监听 80/443；用户可在 broker 前再放 Tailscale Serve / nginx 反代。详见 §6 部署形态。

#### 5.1.4 broker 状态文件 `~/.atr/broker.json`

```jsonc
{
  "version": 1,
  "pid": 12345,
  "host": "0.0.0.0",
  "port": 3000,
  "displayUrl": "http://192.168.1.5:3000/",  // 给 worker banner 用
  "startedAt": "2026-05-09T13:00:00.000Z"
}
```

worker 读这个文件做两件事：
- 检查 broker 健康（pid alive？）
- 拿 displayUrl 打印 banner（用户实际访问的是 broker 入口，不是 worker port）

### 5.2 worker process（改造）

#### 5.2.1 与 0.6.x 的差异

| 方面 | 0.6.x | 0.7.0 |
|---|---|---|
| 监听 host | `0.0.0.0`（LAN 可达） | `127.0.0.1` only |
| 监听 port | `3000` 起递增 | OS 自动分配空 port |
| Cookie name | `session_id_p<port>`（每实例独立） | `session_id`（统一） |
| Sessions store | 进程内 Map | 共享 `~/.atr/sessions.json` |
| Banner URL | LAN IP + 自身 port | broker 的 displayUrl + `/i/<own-id>/` |
| 创建方式 | 直接 `atr <cmd>` | 仍是 `atr <cmd>`（透明），背后会 ensure broker |

#### 5.2.2 worker 不做的事

- **不再绑 LAN IP**：彻底放弃外部直连
- **不再生成 share URL**：ShareSheet 改由 broker 端 API 提供
- **不再维护"我自己的 publicUrl"**：用 `X-ATR-Forwarded-*` 头反推

### 5.3 共享 sessions store（新）

#### 5.3.1 文件

`~/.atr/sessions.json`

```jsonc
{
  "version": 1,
  "sessions": {
    "<sessionId>": {
      "createdAt": 1778334000000,
      "ip": "100.118.8.59",
      "lastSeenAt": 1778335000000
    }
  }
}
```

#### 5.3.2 一致性策略

- **写入**：用 `withFileLock`（沿用现有 instances.json 的锁机制）；create / delete / lastSeenAt 更新都走文件锁
- **读取**：**不做进程内缓存** —— 每次 `validateSession` 都直接读文件
- **过期**：lazy 清理，validate 时若 `lastSeenAt + ttl < now` 则删除并报失效
- **并发**：依赖文件锁的原子性，不引入 SQLite / Redis（atr 一贯无外部依赖原则）

> 不缓存的理由：sessions 文件 < 10KB、读取 < 1ms、活跃 sessions < 100 条；
> 一台 PC 上 5 个 atr 进程每秒共 50 次读 = 50ms/s IO，完全可接受。
> 缓存换来的性能收益不明显，但会引入"logout 后其它进程仍能用 N 秒"的不一致，
> 不值得。如果未来真成瓶颈再加批量 / 缓存。

#### 5.3.3 性能数字

- 一台 PC 同时活跃的 sessions 数量量级：< 100（每个浏览器 tab 一份，每个 PWA 一份）
- 文件大小 < 10KB，读取时间 < 1ms
- 写入频率：登录 / 失效 / 心跳更新，预期 < 5 次/秒

### 5.4 broker 状态机

```
        +------------+
        | starting   |
        +-----+------+
              | bind 成功
              ▼
        +------------+
        | running    |◄─────┐
        +-----+------+      │
              │ worker 列表  │
              │ 变化（事件）  │
              ▼              │
        +------------+       │
        | reloading  ├───────┘
        | registry   |
        +-----+------+
              │ SIGTERM / atr broker stop
              ▼
        +------------+
        | shutting   |
        | down       |
        +------------+
              │
              ▼  清理 broker.json，退出
            <终>
```

> broker 不需要"等所有 worker 退出再退出"的逻辑：worker 监听 loopback，独立于 broker 存在。broker 重启不影响 worker，只是用户外部访问临时中断。

> broker 重启时**不做 grace period**：直接 503 让客户端重试，前端 WS 重连退避（1s → 2s → 4s）覆盖 1-2s 的窗口。引入 buffer / 状态同步换 1-2s UX 改善不值。

### 5.5 broker CLI 命令

`atr broker` 子命令族（与现有 `atr stop` / `atr list` 同级）：

| 命令 | 行为 |
|---|---|
| `atr broker start [--port N] [--bind HOST]` | 显式启动 broker（前台）。一般用户不用，留给调试 / service 调用 |
| `atr broker stop` | 优雅停 broker（SIGTERM）；不影响 worker |
| `atr broker status` | 打印 broker.json 信息 + 健康检查 + 当前 worker 数 |
| `atr broker service install` | 安装为系统服务（开机自启）；按 OS 选 systemd / launchd / Windows Service |
| `atr broker service uninstall` | 移除系统服务 |
| `atr broker service status` | 查看系统服务状态 |
| `atr broker service logs` | tail 系统服务日志（systemd 走 `journalctl -u atr-broker`，launchd 走 plist 配置的 log path） |

**默认行为**（不显式启动）：用户跑 `atr <cmd>` 时如果没有活的 broker，atr 自动 fork 一个（沿用 §4.2 启动流程）。`atr broker start` 是供 service / 高级用户用的显式入口。

### 5.6 一键开机自启

#### 5.6.1 用户视角

```bash
$ atr broker service install
[atr] 检测到当前系统：Linux (systemd)
[atr] 已写入 /etc/systemd/system/atr-broker.service（需要 sudo）
[atr] 已 enable，将在下次开机时启动
[atr] 立即启动 broker？ [y/N] y
[atr] systemctl start atr-broker → ok
[atr] broker 现在监听 http://0.0.0.0:3000
[atr] 验证：curl http://127.0.0.1:3000/api/health → 200
```

后续：
- 重启 PC 后浏览器直接访问 broker URL，看到 atr 入口（无活实例时显示"+ 创建新实例"）
- 用户跑 `atr claude` 仍然 just works，自动接入已存在的 broker

#### 5.6.2 平台实现

| OS | 机制 | service 文件位置 |
|---|---|---|
| Linux (systemd) | systemd unit | `/etc/systemd/system/atr-broker.service` |
| Linux (其它 init) | 不支持（明示报错，建议用户手动配） | n/a |
| macOS | launchd plist | `~/Library/LaunchAgents/ke.kkjb.atr-broker.plist`（用户级，不需要 sudo） |
| Windows | Windows Service | 用 `node-windows` 或 `nssm`（待选） |
| WSL2 | systemd（WSL 默认 systemd 启用时支持），否则报错引导用户 | 同 Linux systemd |

#### 5.6.3 service 文件骨架（systemd 示例）

```ini
[Unit]
Description=Auvezy Terminal Remote broker
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node /path/to/auvezy-terminal-remote/dist/cli.js broker start
User=<install-time current user>
Restart=on-failure
RestartSec=5s
Environment=ATR_DATA_DIR=%h/.atr

[Install]
WantedBy=default.target
```

> 用 user-level systemd（`systemctl --user`）而非 system-level，避免动 root；用户登录后 broker 才启。
> 例外：用户显式 `--system` flag 时装到 system-level（PC 始终联网用，不需要登录）。

#### 5.6.4 实现选型

| 选择 | 我的决定 | 理由 |
|---|---|---|
| 跨平台 daemon 库（`node-mac` / `node-linux` / `node-windows`） | **不用**，自己写 | 这些库 5+ 年没更新；atr 平台特定逻辑只是 service 文件模板 + `systemctl` / `launchctl` shell 调用，自己写 < 200 行；不引入难维护依赖 |
| 写到 `backend/src/broker/service-installer.ts` | **是** | 单文件，按 platform 分支 |
| 调用 `sudo` 的方式 | **不直接 sudo** | 提示用户跑 `sudo systemctl ...`；只在用户级 systemd 时无需 sudo 直接装 |
| 卸载干净度 | 必须 100% 干净 | uninstall 移除 service 文件 + disable + stop；不留半截配置 |

---

## 6. 部署形态

### 6.1 形态 A：纯本地 LAN（默认）

```
浏览器 ─HTTP─→ broker:3000 ─HTTP─→ worker:N (loopback)
```

用户跑 `atr claude`，broker 自动起在 3000，banner 提示访问 `http://<lan-ip>:3000/`。LAN 内任意设备可访问。

### 6.2 形态 B：Tailscale Serve（推荐）

```
浏览器(tailnet) ─HTTPS─→ tailscale serve ─HTTP─→ broker:3000 ─→ worker
```

用户跑 `tailscale serve --bg --https=443 http://localhost:3000`。tailnet 设备访问 `https://<host>.<tailnet>.ts.net/`，cert 由 Tailscale 申请，valid。这是 push 真正能用的方案。

### 6.3 形态 C：自配反代

用户在 broker 前放 nginx/Caddy 处理 cert + WebSocket upgrade，atr 不参与 TLS。

### 6.4 形态废弃：直连 worker

0.7.0 起 worker 只听 loopback，**LAN 无法直连 worker**。这是 breaking change（详见 §10）。

---

## 7. 协议细节

### 7.1 broker → worker 注入头

| 头 | 含义 | 用途 |
|---|---|---|
| `X-ATR-Forwarded-Instance` | 目标 instanceId | worker 用来确认自己是被 broker 调度（vs 直接被本机程序连） |
| `X-ATR-Forwarded-Host` | 用户访问的 hostname | worker 生成 publicUrl 用（push subscription endpoint 等） |
| `X-ATR-Forwarded-Proto` | `http` / `https` | 同上 |
| `X-ATR-Forwarded-Path` | broker 收到的完整 path（含 `/i/<id>/`） | 调试用 |
| `X-Forwarded-For` | 真实客户端 IP | 标准头，用于 rate limit / 日志 |

### 7.2 worker 响应改写

broker 反代回 worker 响应时，需要按 content-type 做改写：

| Content-Type | 改写 | 原因 |
|---|---|---|
| `text/html` | 注入 `<base href="/i/<id>/">` 到 `<head>` | 让浏览器把所有相对路径解析到 broker path scope |
| `application/javascript` (asset) | 不改写 | 资源路径 vite build 时已处理 |
| `application/manifest+json` | 改写 `start_url` / `scope` 为 `/i/<id>/` | PWA install 行为正确（注：与 §决策 5 单 PWA 模型有冲突，详见下文） |
| 其它 | 透传 | |

#### 7.2.1 `<base href>` 注入实现

简单的字符串替换：找到 `</head>` 在前面插入 `<base href="/i/<id>/">`。

> **风险**：HTML 解析有歧义（注释里的 `</head>`、CDATA 等），但 atr 自己 build 出的 HTML 极可控（vite 输出格式稳定），可接受字符串替换。
>
> **不用真 HTML parser**（cheerio / parse5）：增加 broker 依赖、解析整个 DOM 浪费、对动态注入 SSR 没优势。

#### 7.2.2 单 PWA 模型下的 manifest 处理

§3 决策 5 选了"单 PWA 内部 SPA 路由切实例"。这意味着 PWA 装到主屏只装一个，URL 是 broker 根 `/`，不带 instance 前缀。

具体行为：
- broker 提供根 `/` 路径返回 SPA index.html，加载后 SPA 自己处理 `/i/<id>/` 路由
- broker 提供 `/i/<id>/` 也返回 index.html（同样的 SPA 入口，但 SPA 启动时通过 `window.location.pathname` 自识别"我应该激活哪个实例 tab"）
- manifest 里 `start_url: "/"`，`scope: "/"`
- SW scope `/`

**原则**：PWA / SW / manifest 永远是 "broker 视角"，path-routing 是 SPA 内部行为，浏览器视角下永远是同一个 application。

### 7.3 WebSocket 反代

broker 收到 `/i/<id>/ws` upgrade 请求：

1. 解析出 `<id>`，查找对应 worker port
2. 在 broker 与 worker 之间建立 raw TCP 连接（不解析 ws 帧）
3. 透传 client → worker 的 upgrade 请求（重写 path 为 `/ws`）
4. 透传 worker 响应给 client（101 Switching Protocols + 后续 ws 帧）

`http-proxy` 库 `ws: true` 选项原生支持。

### 7.4 SSE（Server-Sent Events）

worker 的 `/api/instances/stream` 是 SSE 长连接。`http-proxy` 默认对 `text/event-stream` 流式正确（chunked / no buffer）。

需要确认：
- 不开 `selfHandleResponse`（让 http-proxy 直接 pipe stream）
- 不在 broker 里 buffer 响应

---

## 8. 前端改造

### 8.1 vite 配置

```ts
export default defineConfig({
  base: './',  // 全部资源相对路径
  // ...
});
```

`<script src="./assets/...">` 等让浏览器按当前 URL 解析，不再硬编码 `/`。

### 8.2 Service Worker

- scope 永远是 `/`（PWA 单 origin 单 SW）
- precache list 用相对 URL（vite-plugin-pwa 自动处理）
- 路由缓存策略不再硬编码 `/api/`、`/ws` —— 改用 `'/'` scope 内的相对前缀

### 8.3 SPA 路由

引入路由（暂未引入 React Router 的话）或用现有的简单 path 解析：

```ts
function getActiveInstanceId(): string | null {
  const m = window.location.pathname.match(/^\/i\/([^/]+)/);
  return m?.[1] ?? null;
}
```

切换实例 = `history.pushState(null, '', '/i/<targetId>/')` + 重新初始化 InstanceView 状态。

> **不用 React Router 全家桶**：atr 只有 2 层路由（broker root vs instance），自己写 useState + popstate listener 足够；引入路由器是过度设计。

### 8.4 fetch / WS URL 构造

- **取消 `withBase()` 运行时拼接**：HTML 里 `<base href>` 已经搞定相对路径解析，`fetch('/api/foo')` ❌、`fetch('api/foo')` ✓
- 所有 API 调用用相对 path（`'api/auth'`），让浏览器自己拼
- WS：`new WebSocket(new URL('ws', window.location.href + '/'))` 让 base 自然生效

> 这意味着 0.6.x 里 spike 的 `services/base-path.ts` / `withBase` 全部去掉。base href 注入是更稳的服务端方案。

### 8.5 切实例 = 同 origin URL 跳转

```ts
// 旧（0.6.x）：
window.location.assign(buildInstanceUrl(host, port));  // 跨 origin
// 新：
history.pushState(null, '', `/i/${targetId}/`);  // 同 origin
// SPA 自身监听 popstate / pushstate，重新激活对应 InstanceView
```

跨 origin 流转 token / cookie 的逻辑全部删掉。

---

## 9. 安全模型

### 9.1 信任边界

- **信任**：能 TCP 连到 broker 的客户端（依靠 LAN / Tailscale 隔离）
- **不信任**：互联网随机请求（broker 默认不暴露公网；用户自配反代时自己负责加 IP/auth 限制）

### 9.2 Token / Session 模型不变

- token 仍由首个 worker 启动时生成，写 `~/.atrrc`
- broker 启动时读同一 token；它本身不参与 verify，但需要 token 来跟 worker 通信？**不需要**——broker 只透传客户端请求，token 验证由 worker 做
- session 跟 0.6.x 一样按 IP rate limit；broker 注入真实 client IP 到 `X-Forwarded-For`，worker 据此 limit

### 9.3 broker 自我保护

- broker 只接 LAN/127.0.0.1 来的连接（默认）；通过 `--bind 0.0.0.0` 才扩大到所有网卡
- broker 不暴露任何**自有**的特权 endpoint（除了 health）；所有 API 都透传到 worker
- broker 不读 token，也不写日志含 token

### 9.4 worker 隔离

worker 只听 `127.0.0.1`，外部包到不了。这意味着：
- 即使 broker 被攻破，攻击者仍需爆破 worker 的 token（worker 端有 rate limit）
- worker 进程级 sandbox 仍由 OS 提供（cwd / picomatch policy 等不变）

---

## 10. 0.6.x → 0.7.0 迁移

### 10.1 Breaking changes 清单

| 变化 | 影响 | 解决 |
|---|---|---|
| worker 不再监听 LAN | 旧的 `http://192.168.x.x:3001/?token=xxx` URL 失效 | banner 改打 broker URL；分享给同事用新格式 |
| Cookie name 从 `session_id_p<port>` 变 `session_id` | 浏览器存的旧 cookie 失效 | 用户重新登录一次（token 仍在 localStorage） |
| Sessions 从内存 Map 移到文件 | sessions 丢失 | 同上，重新登录 |
| share URL 形态变 | 0.6 分享出去的链接失效 | release notes 提示 |
| 用户跑 `atr claude` 现在会 fork broker | 端口占用规则变（占 broker port + worker auto port） | banner 解释；冲突时报错指导 |

### 10.2 数据迁移

- `~/.atrrc`：无变化
- `~/.atr/instances.json`：worker 仍写，broker 只读
- 新增 `~/.atr/broker.json`、`~/.atr/sessions.json`：首次启动自动建
- 0.6.x 残留的 `~/.atr/settings/<port>.json`：worker 仍按自己 port 写（路径名虽包含 port 但 port 是 worker 内部使用，不再出现在 URL）；考虑 0.8.0 改为按 instanceId 命名

### 10.3 部署文档更新

README / docs/CLI.md 都要改：
- 删除 LAN 多端口直连说明
- 新增 broker 自启 / 自管说明
- Tailscale Serve 集成步骤变成"主推"路径

### 10.4 不做兼容包装

明确**不做** 0.6.x 旧 URL 自动重定向，原因：
- broker 不知道哪个 port 对应哪个 instanceId（worker 用 OS 自动分配，0.6 写死的端口现在不存在）
- 用户量小，breaking 的实际影响可控
- "兼容 0.6 LAN URL" 的设计债比"重新分享一次"的迁移成本大

---

## 11. 关键实现约束

> 这些不是"未决问题"——是已经决定的实现约束，写在这里给实施阶段当 checklist。

### 11.1 broker ensure 流程必须有锁

**约束**：多个 worker 同时 `atr <cmd>` 启动时，必须只有一个 broker 被 fork。

**实现**：
- 用 `withFileLock(broker.json.lock)` 串行化"读 broker.json → 判断是否 fork → 写新 broker.json"
- worker 用 `child_process.spawn(node, [cli.js, 'broker', 'start'], { detached: true, stdio: 'ignore' }).unref()` fork broker
- worker 轮询 broker.json，最多 5s；broker 在 listen 成功后写自己的 pid + port 到该文件
- 5s 内 broker.json 出现且 health check 200 → ok；超时 → worker 抛 `BrokerStartError` 退出（不降级）

**WSL systemd 行为**：`spawn(detached:true).unref()` 让子进程 reparent 到 PID 1，即使 worker 父进程死了 broker 也照常活；systemd 不会"回收"未注册为 service 的孤儿进程。这是标准 unix daemon 模式，跨平台稳定。

### 11.2 broker 永驻

**约束**：broker 一旦启动就常驻，不做"闲置自动退"。

**理由**：
- 用户若启用了 `atr broker service install`，broker 是 OS service，"自动退" 反而和 service 语义冲突
- broker 资源占用极小（< 30MB 内存，无 PTY）
- 把 broker URL 设为浏览器书签 / PWA 主屏图标的用户，需要 URL 永远可达
- 退 broker 的好处（释放端口）实际上 broker 默认在 3000，不冲突 80/443

**显式退出路径**：
- `atr broker stop` 命令（用户主动）
- 收到 SIGTERM / SIGINT（Ctrl+C 直接跑 broker 的进程）
- 启动期严重错误（端口被占等，broker 主动报错退）
- 系统重启（OS 杀），有 service 自启则下次开机被拉起

### 11.3 sessions 读写不缓存

**约束**：`validateSession` / `getSessionFromRequest` 每次都读文件。

**理由**：详见 §5.3.2 "不缓存的理由"。

**性能监控**：实施时加日志埋点 sessions 读延迟；如发现 p99 > 50ms 再考虑批量优化。

### 11.4 多实例全挂载策略

**约束**：MultiInstanceConsole 沿用 0.6.x 全挂载（所有 InstanceView 都 mount，CSS 切显示）。

**理由**：
- 切回来即时显示无 history_sync 等待，是核心 UX
- 实际场景下用户开实例数 < 10，每个 InstanceView ~6MB，总内存 < 60MB 可接受
- "懒挂载 / 非活跃 WS 断开"是过早优化，0.7.0 不做

**未来兜底**：UI 上当实例数 > 10 时给警告提示用户主动管理。

### 11.5 broker 重启不做 grace period

**约束**：broker 重启时直接 503，前端 useWebSocket 重连退避兜底。

**理由**：
- broker 启动 1-2s，前端重连退避（1s → 2s → 4s）大概率第一次重试就成功
- 加 grace period（先 bind 再 buffer 请求 → 等 registry 就绪）增加状态机复杂度，换 1-2s UX 改善不值

**升级路径优化**（不在 0.7.0 范围）：未来可加 `atr broker reload`（保 fd 不关，only swap binary），按需再做。

---

## 12. 实施阶段

> 本节是工作分解；具体每阶段的 ADR 与 progress 写到 `progress/` 子目录里。

### 阶段 1：基础设施（不影响现有功能）
- 新增 `backend/src/broker/` 模块（独立可启动，但 worker 暂不调用）
- 共享 sessions store 实现 + 文件锁 + 测试
- broker.json 状态文件 + 健康检查
- 单元测试覆盖 broker / sessions

### 阶段 2：worker 改造（可单独发 0.7.0-alpha）
- worker 默认绑 `127.0.0.1`（保留 `--legacy-bind-lan` flag 给紧急逃生口，0.8.0 删除）
- worker 启动时 ensure broker（fork or 复用）
- Cookie name 统一 `session_id`
- Sessions 改用共享 store

### 阶段 3：broker HTTP 反代
- 引入 `http-proxy` 依赖
- `/i/<id>/...` 路由
- WS upgrade 反代
- 测试 SSE / 大文件 / POST body / 长连接

### 阶段 4：HTML / asset 改造
- broker 端 `<base href>` 注入
- vite `base: './'` + 全部 asset 改相对路径
- 删 `services/base-path.ts` + `withBase()` 调用
- SW scope 回归 `/`，路由判断改相对前缀

### 阶段 5：SPA 内部路由切实例
- `history.pushState` 替代 `window.location.assign`
- MultiInstanceConsole 监听 popstate
- 删除跨 origin 的 token 流转代码

### 阶段 6：service install 一键开机自启
- `backend/src/broker/service-installer.ts`：systemd / launchd 模板生成
- CLI 子命令 `atr broker service {install,uninstall,status,logs}`
- 平台分支：Linux systemd（user-level 优先 + 可选 `--system`）/ macOS launchd / WSL2 systemd / Windows 暂留为"待支持"提示
- 集成测试：在临时 dir 下生成 service 文件、验证内容、assert 不实际写系统目录

### 阶段 7：迁移文档 + 0.7.0 release
- CHANGELOG breaking section
- README / docs/CLI.md 更新（新增 broker 章节 + service install 步骤）
- 0.7.0 release notes 提示用户重新登录
- npm publish

每阶段完成有独立 git commit + smoke test，progress/ 同步。

---

## 13. 成功标准

0.7.0 release 视为成功的判定：

- [ ] 用户跑 `atr claude` 后浏览器访问 broker URL，看到 atr 主界面
- [ ] 用户能在 web 界面"+ 新实例" 创建第二个 worker，URL 自动切到 `/i/<new>/`
- [ ] 在 Tailscale Serve 反代下 push 通知能正常订阅与触发
- [ ] 浏览器 F5 刷新 `/i/<id>/` URL 不丢实例 / 不丢 cookie
- [ ] 切实例不重新加载 SPA（`window.location` 不变只 path 变）
- [ ] broker 重启后所有 worker 仍可用（用户重新连一次）
- [ ] `atr broker service install` 在 Linux systemd 上一键成功（WSL2 实测）
- [ ] 重启 PC 后 broker 自动起来，浏览器直接访问 broker URL 200
- [ ] 单元 / 集成测试覆盖率不低于 0.6.x（≥ 399 tests）
- [ ] bundle size 增长 < 80KB（http-proxy + service-installer 模板）

---

## 14. 后续版本展望（不在 0.7.0 范围）

- 0.7.x：service install 加 Windows Service 支持（Windows 用户场景）
- 0.7.x：`atr broker --bind 0.0.0.0` 完整公网部署支持 + 额外 IP allowlist
- 0.8.0：sessions 改 instanceId 命名（去掉 settings/&lt;port&gt;.json 历史负债）
- 0.8.x：broker 支持 HTTPS 自管（内置 ACME 客户端 / 自签 CA mobileconfig 引导）
- 0.9.0：broker 集群（多机 broker 互相同步 worker registry，跨主机访问任意实例）

---

## 附录

- ADR-001 ~ ADR-010：每个决策的详细记录与替代方案对比，见 `adrs/`
- 进度文档：`progress/00-overview.md`、`progress/01-阶段1.md` …
- spike 代码（已踩坑）：`feat/path-routing-spike` git branch（保留参考，不合并）
