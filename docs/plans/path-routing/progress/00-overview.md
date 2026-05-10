# Path-routing 0.7.0 进度总览

> 最后更新：2026-05-10（**0.7.0 阶段 1-7 已完成**；阶段 8 v2 / API 归属重划分
> 完成；发布动作待用户触发）

## 阶段速查

| # | 阶段 | 状态 | 关键产物 | 阻塞 / 风险 |
|---|---|---|---|---|
| 1 | 基础设施 | ✅ 已完成 | broker 模块骨架、共享 sessions store、broker.json 状态文件 | 无 |
| 2 | worker 改造 | ✅ 已完成（2D/2E 待 commit） | worker loopback only、ensure broker、cookie 统一、entry URL 切换、清死代码 | 阶段 1 完成 |
| 3 | broker HTTP 反代 | ✅ 已完成（待 commit） | http-proxy 接入、`/i/<id>/*` 路由、WS upgrade 反代、broker 静态资源 | 阶段 1 完成 |
| 4 | HTML / asset 改造 | ✅ 已完成（待 commit） | `<base href>` 注入、vite base 相对路径、fetch/WS/SW 改相对 | 阶段 3 完成 |
| 5 | SPA 内部路由切实例 | ✅ 已完成（待 commit） | history.pushState、popstate listener、删跨 port 跳转、buildWsUrl 简化 | 阶段 4 完成 |
| 6 | service install | ✅ 已完成（待 commit） | systemd / launchd 模板、CLI 子命令（broker stop/status + service install/uninstall/status） | 阶段 2 完成（broker 能启） |
| 7 | 迁移文档 + release | ✅ 文档完成（待 commit + publish） | CHANGELOG 0.7.0 entry / progress 07 | 全部完成 |
| 8 | API 归属重划分（v2） | ✅ 实施完成（待 commit） | broker 持系统级 API；worker 收窄到 PTY/hook；POST /api/instances 异步语义 + SSE 等 ready；broker daily-rotate log；前端 fetch 绝对路径；ADR-011 落档 | 阶段 7 实测发现根本问题 |

## 时间线（粗估）

| 阶段 | 工作量 | 备注 |
|---|---|---|
| 1 | 1d | 基础设施：sessions store + broker.json + 单测 |
| 2 | 1.5d | worker 改造涉及 cookie + bind host + ensure broker，扩散面广 |
| 3 | 1d | http-proxy 集成；SSE / WS 反代要小心，加测试 |
| 4 | 0.5d | base href 注入是 broker 端单点；前端 base path 一刀切删 |
| 5 | 0.5d | SPA 路由相对简单（已有挂载策略不变） |
| 6 | 1d | 跨 platform 测试 + 模板调试 |
| 7 | 0.5d | 文档 + 发布流程 |
| **总计** | **6d** | 不含 review 时间 |

## 决策一览

详见 `../design.md` §3 与 `../adrs/` 子目录。

| ADR | 主题 |
|---|---|
| [001](../adrs/001-broker-worker-split.md) | broker 与 worker 严格进程分离 |
| [002](../adrs/002-broker-lifecycle.md) | broker 自动 fork + 永驻 |
| [003](../adrs/003-url-scheme.md) | URL 用 `/i/<instanceId>/...` |
| [004](../adrs/004-proxy-library.md) | 用 `http-proxy` 库 |
| [005](../adrs/005-pwa-model.md) | 单 PWA 单 origin |
| [006](../adrs/006-shared-sessions.md) | 共享 sessions store |
| [007](../adrs/007-base-href-injection.md) | 服务端注入 `<base href>` |
| [008](../adrs/008-forwarded-headers.md) | X-ATR-Forwarded-* 协议 |
| [009](../adrs/009-worker-loopback-only.md) | worker 只听 127.0.0.1 |
| [010](../adrs/010-service-install.md) | service install 一键自启 |
| [011](../adrs/011-api-ownership.md) | API 归属重划分：broker = 系统级 / worker = 实例级 |

## 关键约束 checklist

来自 design.md §11，实施时不能违反：

- [ ] broker ensure 走 `withFileLock` 防多 fork
- [ ] broker 永驻（除非显式 stop / 信号 / service 控制）
- [ ] sessions 不缓存（每次直读）
- [ ] 多实例全挂载（沿用 0.6.x）
- [ ] broker 重启不做 grace period（前端重连退避兜底）

## 成功标准 checklist

来自 design.md §13。0.7.0 release 必须全部 ✓：

- [ ] `atr claude` 后浏览器访问 broker URL 看到 atr 主界面
- [ ] web 界面"+ 新实例"创建第二个 worker，URL 自动切到 `/i/<new>/`
- [ ] Tailscale Serve 反代下 push 通知能订阅 + 触发
- [ ] F5 刷新 `/i/<id>/` 不丢实例 / 不丢 cookie
- [ ] 切实例不重新加载 SPA
- [ ] broker 重启后所有 worker 仍可用
- [ ] `atr broker service install` Linux systemd 一键成功（WSL2 实测）
- [ ] 重启 PC 后 broker 自启，浏览器直接 200
- [ ] 单元 / 集成测试 ≥ 399 tests
- [ ] bundle size 增长 < 80KB

## 文档结构

```
docs/plans/path-routing/
├── design.md                         # 主设计（721 行）
├── adrs/
│   ├── 001-broker-worker-split.md
│   ├── 002-broker-lifecycle.md
│   ├── 003-url-scheme.md
│   ├── 004-proxy-library.md
│   ├── 005-pwa-model.md
│   ├── 006-shared-sessions.md
│   ├── 007-base-href-injection.md
│   ├── 008-forwarded-headers.md
│   ├── 009-worker-loopback-only.md
│   └── 010-service-install.md
└── progress/
    ├── 00-overview.md                # 本文件
    ├── 01-阶段1-基础设施.md          # 阶段开工时新建
    ├── 02-阶段2-worker改造.md
    └── ...
```

## 进度文档约定

每个阶段开工时新建一个 progress 文件（`NN-阶段X-名称.md`），含：

- **目标**：本阶段要做什么、不做什么
- **任务清单**：具体 commit 粒度的 todo
- **进度日志**：每次工作 session 后追加（日期、commit、状态）
- **完成标准**：明确"什么时候算结束"
- **遗留问题**：未解决但不阻塞下阶段的事

## 参考资料

- 0.6.x spike 代码：git branch `feat/path-routing-spike`
- spike 踩过的坑总结：design.md §1.2 历史负债
- npm 发布流程：CLAUDE.md "发布原则"
