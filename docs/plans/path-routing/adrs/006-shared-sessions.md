# ADR-006: 共享 sessions store（`~/.atr/sessions.json`）

## 状态

已采纳（2026-05-09）

## 上下文

0.6.x：每个 atr 进程内存里有一个独立的 `sessions: Map<sessionId, {createdAt, ip}>`。Cookie name 用 port 后缀（`session_id_p<port>`）防同 hostname cookie 串扰。

0.7.0 path-routing 后：

- 浏览器对所有实例发的请求是同 origin → 浏览器只会发一份 cookie 给所有 path
- 但每个 worker 进程有自己的 sessions Map → A 创建的 session B 不认 → broker 反代到 B 时 401

要么：
1. cookie name 仍 port-suffixed，broker 反代时改 cookie name —— 但 session value 是 A 的，B 不认，等于没改
2. 共享 sessions store —— 任何 worker 都能 verify 任何 cookie

## 决策

**所有 worker 共享 `~/.atr/sessions.json`**，cookie name 统一 `session_id`。

文件 schema：

```jsonc
{
  "version": 1,
  "sessions": {
    "<sessionId>": { "createdAt": <ms>, "ip": "...", "lastSeenAt": <ms> }
  }
}
```

读写规则：
- 写：`withFileLock(.lock)` 串行化 `create` / `delete` / `lastSeenAt 更新`
- 读：每次 `validateSession` 直接读文件（**不缓存**，详见 ADR 后果章节）
- 过期：lazy 清理；validate 时若 `lastSeenAt + ttl < now` 删除并报失效

## 拒绝的替代方案

### 方案 A：保持每实例独立 sessions Map，前端 401 后用 token 自动重 auth

**拒绝原因**：

- 用户切实例多一个 RTT 延迟（401 → POST /auth → 重试）
- token 在前端 / 网络上多一次流转，攻击面增加
- "靠客户端兜底"掩盖服务端架构缺陷，长期债

### 方案 B：JWT / 自验证 cookie（cookie 内含签名，不需要服务端 store）

cookie 用 HMAC(token, sessionId, exp) 签名；任何 worker 持有同 token 都能验。

**拒绝原因**：

- 改动大：现有 sessions API（rate limit 计数、createSession、validateSession）全要重写
- JWT 撤销复杂（不能"删除"已签发的 cookie，只能等过期）；用户主动 logout 体验差
- 0.7.0 已经有大量改动，再叠 cookie 模型重写不合理；可作为未来优化

### 方案 C：用 SQLite 替代 JSON 文件

**拒绝原因**：

- atr 一直无外部依赖（除运行时必须）；引入 sqlite3 native 模块要 npm postinstall 编译，破坏 npm i 体验
- sessions 读写量级小（< 100 条 / < 5 次每秒）—— JSON 完全够，sqlite 是过度工程

### 方案 D：共享 store 但加进程内 30s LRU 缓存

我最初提议的方案。

**拒绝原因**：

- sessions 文件 < 10KB，读取 < 1ms；5 个进程每秒 50 次读 = 50ms/s IO，瓶颈不存在
- 缓存引入"logout 后其它进程 N 秒内仍可用"的不一致
- 复杂度（缓存失效、TTL）vs 性能收益（不存在）—— 不值
- 真有性能问题时再加；YAGNI

## 后果

### 正面

- 任何 worker 都能 verify 任何 session cookie，broker 反代后无需"重 auth"
- Cookie name 统一 `session_id`，符合用户直觉（不再有 `_p3001` 这种后缀）
- 文件锁机制沿用现有 `withFileLock`（instances.json 已用），无新依赖
- 简单：每次直读文件，无缓存逻辑

### 负面 / 取舍

- 文件 IO 成本：每次 API 请求都读一次 sessions.json
  - 量级：< 1ms / 次，可接受
  - 监控：实施时加 p99 延迟埋点，超 50ms 再考虑批量优化
- 文件锁竞态：写时其它读会等
  - 量级：写频率 < 5/s，每次锁 < 5ms，等待时间可忽略
- 多机集群（未来）：sessions store 是单机文件，不能跨主机共享
  - 当前不在范围；0.9.0 broker 集群再考虑

## 性能数字（实施时验证）

- 一台 PC 同时活跃 sessions：< 100
- 文件大小：< 10KB
- 读取延迟：< 1ms
- 写入延迟：< 5ms（含锁等待）
- 每秒读次数：~50（5 进程 × 10 req/s）
- 每秒写次数：< 5

## 相关

- ADR-001（broker / worker 分离）
- design.md §5.3 共享 sessions store、§11.3 不缓存的理由
