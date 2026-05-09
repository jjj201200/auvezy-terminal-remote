# ADR-002: broker 自动 fork + 永驻

## 状态

已采纳（2026-05-09）

## 上下文

ADR-001 决定 broker 与 worker 分离。接下来的问题是：**谁负责启动 broker？什么时候退出？**

候选触发点：
- 用户 `atr claude` 时自动 ensure broker
- 用户显式 `atr broker start`
- 系统服务（systemd / launchd）开机拉起

候选退出点：
- 最后一个 worker 退出 → broker 退
- 闲置 N 分钟（无 worker、无 client 连接）→ broker 退
- 显式 `atr broker stop` → broker 退
- 永驻直到 OS 杀

## 决策

**启动**：用户跑 `atr <cmd>` 时 worker 自动 ensure broker（已有则复用，没有则 fork）。
**退出**：broker **永驻**——除非用户显式 `atr broker stop` 或 OS 杀。

具体：

- worker 启动时读 `~/.atr/broker.json`，pid 健康则跳过；否则文件锁 + 二次检查 + `spawn(detached:true).unref()` fork broker
- worker 等 broker.json 出现 + health 200，最多 5s；超时 worker 自己抛 BrokerStartError 退出
- 最后一个 worker 退出后 broker 不退；继续提供 UI（实例列表为空，引导用户"+ 创建新实例"）
- broker 闲置不退（资源占用低）
- `atr broker stop` 优雅退（SIGTERM）；不影响在跑的 worker
- 系统重启 broker 自然死；如果用户启用了 `atr broker service install` 会被 OS 自动拉起

## 拒绝的替代方案

### 方案 A：用户显式 `atr broker start`，不自动 fork

**拒绝原因**：onboarding 多一步骤。0.6.x 用户对"`atr claude` 一条命令搞定"已经形成肌肉记忆，让他们多跑一步是 UX 退步。

### 方案 B：最后一个 worker 退出时 broker 跟着退

**拒绝原因**：

- 用户把 broker URL 设为浏览器书签 / PWA 主屏图标，再访问发现"找不到服务"是糟糕体验
- 启用了 service 自启时，"自动退" 与 service 语义冲突（用户期望开机就活）
- broker 资源占用低（< 30MB），没必要省

### 方案 C：闲置 30min 自动退

**拒绝原因**：

- "闲置"定义模糊（client 是浏览器后台标签也算？SW 心跳算不算？）
- 与 service 自启冲突
- 闲置后用户访问发现要等几秒重启更糟糕

## 后果

### 正面

- 用户体验和 0.6.x 一致：跑 `atr claude` 立刻能用
- broker URL 永远稳定（除非用户主动 stop 或重启 PC）
- service install 与永驻语义一致

### 负面 / 取舍

- broker 进程留在那里"看不见"，用户可能困惑"明明 atr 退了为什么端口还占着"。
  解决：banner 启动时打印"broker 已就绪 / 已复用"，`atr broker status` 命令可查
- 用户想完全清理时多一步：`atr broker stop`
- broker 崩溃时所有 worker 同时失联（缓解：worker loopback 仍在跑，前端 WS 重连退避会在 broker 重启后自动恢复）

## 实现要点

- `~/.atr/broker.json` 含 pid / port / startedAt 字段（schema 见 design.md §5.1.4）
- 文件锁防多 worker 同时 fork 多个 broker
- broker 启动期 banner 写到 stderr，便于用户排查启动失败
- `atr broker status` 输出 broker 当前状态 + worker 数

## 相关

- ADR-001（broker / worker 分离）
- ADR-010（service install）
- design.md §4.2 启动流程、§4.3 关闭流程、§11.1 + §11.2
