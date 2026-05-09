# ADR-009: worker 只监听 `127.0.0.1`

## 状态

已采纳（2026-05-09）

## 上下文

0.6.x：worker 监听 `0.0.0.0:<port>`，LAN 内任意设备可直连。这是早期"`atr <cmd>` + 扫码进入"的核心 UX。

0.7.0 引入 broker 后：

- broker 是新的 LAN 入口，反代到 worker
- worker 是否仍然 LAN 监听？

如果保留 LAN 监听 → 同时存在两条访问路径：
- 通过 broker：`https://host/i/<id>/` （新）
- 直连 worker：`http://lan-ip:port/` （旧）

这就是 0.6.x spike 踩过的"双轨地狱"——cookie / SW / WS / push 都要支持双形态。

## 决策

**worker 只监听 `127.0.0.1`，0.7.0 起彻底废弃 LAN 直连**。

具体：
- `httpServer.listen(port, '127.0.0.1')`，端口由 OS 自动分配
- worker 只接受 broker 发来的 loopback 连接
- 不再生成"扫码 LAN URL"banner（改成 broker 入口 URL）
- ShareSheet 改为分享 broker URL（未实现的需要更新）

## 拒绝的替代方案

### 方案 A：双轨（worker 同时听 `0.0.0.0` 和 broker）

**拒绝原因**：

- cookie name 双标准（broker 路径用 `session_id`，直连用 `session_id_p<port>`？）
- SW scope 双轨（哪个 origin 注册哪个？）
- 无法统一 push subscription（每条访问路径一份订阅）
- 用户教育成本高："你应该用哪个 URL？"
- 双轨设计债 = 永久维护成本

### 方案 B：保留 `--legacy-bind-lan` flag 给逃生口

允许用户显式开 LAN 直连，作为 0.7.x 期间的 escape hatch，0.8.0 删除。

**评估**：

- 优点：万一 broker 挂了用户能临时用
- 缺点：维护双轨代码，违背我们"breaking 就一刀切"的原则
- 用户的真实需求是"broker 挂了怎么办" → 这个问题应该通过 service install + auto-restart 解决，而不是双轨备份

**最终决定**：不保留这个 flag。broker 出问题就修 broker，不靠 worker 兜底。

### 方案 C：worker 直连保留但只允许 `127.0.0.1` + 显式 token

worker 监听 `0.0.0.0` 但只放过 token 验证通过 + 来自 LAN（IP allowlist）的请求。

**拒绝原因**：相当于在 worker 里嵌入第二个鉴权层 + IP filter，增加 worker 代码复杂度，与"worker 专注 PTY"原则冲突。

## 后果

### 正面

- 攻击面缩小：worker 不暴露 LAN，外部完全不可达
- 单一入口：所有访问通过 broker，统一 cookie / SW / push / log
- 代码简化：所有"LAN URL 形态"的代码可以删（buildPublicUrl 大量分支、扫码 URL 多 IP 候选 banner、share LAN URL 等）

### 负面 / 取舍

- breaking change：0.6.x 用户分享出去的 `http://192.168.x.x:3001/?token=` URL 全部失效
  缓解：CHANGELOG 明确告知；release notes 提示"重新分享 broker URL"
- broker 死了 worker 不可达
  缓解：service install 让 broker auto-restart；service install 的 `Restart=on-failure` 保证 broker 崩溃后 5s 内复活
- "我家里没装 Tailscale，外出时怎么办" —— 0.7.0 范围内不解决，需要用户自己上反代 / 0.7.x 加内置隧道支持

## 实现要点

- `bindAvailablePort` 调用改用 `'127.0.0.1'` 替代 `cfg.host`
- worker banner 不再列出"扫码可用入口"列表，改为指向 broker URL
- `buildPublicUrl` 函数删除（用 `getEntryUrl` 反推自 X-ATR-Forwarded-* 头，见 ADR-008）
- 测试：所有 `127.0.0.1` 监听 + broker 反代的集成测试

## 监控

worker 启动时若发现 `--host 0.0.0.0` 等 LAN 标识被显式传入，warn + 强制改 `127.0.0.1`：

```
[atr] 警告：--host 0.0.0.0 在 0.7.0 不再生效，worker 强制 loopback；
      LAN 访问请通过 broker（默认 http://<lan-ip>:3000/）
```

## 相关

- ADR-001（broker / worker 分离）
- ADR-008（forwarded headers）
- design.md §5.2 worker 改造、§10 迁移
