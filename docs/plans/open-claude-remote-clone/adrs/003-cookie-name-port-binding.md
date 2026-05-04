# ADR-003: Cookie 名后缀绑端口（多实例 Cookie 隔离）

## 状态

已接受（阶段 2 实现，阶段 6a 验证）

## 背景

claude-remote 支持单机多实例。每个实例：

- 监听不同端口（3000、3001、3002…）
- 用同一个 LAN IP（如 192.168.1.10）作为 banner 上的 displayIp
- 共享同一个 token（来自 ~/.claude-remote/config.json）

如果所有实例都用相同的 Session Cookie 名（例如 `session_id`），浏览器对
`http://192.168.1.10:3000` 与 `http://192.168.1.10:3001` 会**共享**这一名 cookie
（端口不参与 cookie scope）。这造成：

1. 在 instance A 登录拿到 cookie，浏览器去 instance B 时把 cookie 带上 →
   B 校验时 session ID 不在 B 的内存里 → 401，但用户**已经验证过 token 了**，
   体验上像是登录失效
2. instance A 注销时清 cookie，浏览器对 B 的合法 session 也连带丢失
3. 跨实例 session 写入产生竞争（不同实例不知道对方维护的 session 状态）

## 决策

Session Cookie 名后缀绑端口：`session_id_p<port>`。

- 实例 3000 → `session_id_p3000`
- 实例 3001 → `session_id_p3001`

每个实例只读写自己的 cookie 名，浏览器侧自动隔离。

实现位置：`backend/src/auth/auth-middleware.ts` 中 `createSessionCookieName(port)`。

## 理由

1. **浏览器原生支持**：cookie 名是字符串，加端口后缀对 HTTP / 浏览器
   完全透明，不需要扩展协议
2. **零跨实例耦合**：每个 AuthModule 实例的 sessions Map 与 cookie name 绑定，
   互不干扰；实例崩溃不影响他人
3. **符合"端口=实例身份"心智**：用户在 banner 上看到端口、扫码 URL 含端口、
   cookie 名带端口，整套定位一致
4. **多 Tab 切换无摩擦**：前端 InstanceTabs 切实例 = 切端口，浏览器自动
   把对应 cookie 带上去（同 origin domain）
5. **与共享 token 设计正交**：token 共享让"凭 token 拿任一实例的 session"
   成立；cookie 隔离让"已拿到的 session 不会被错发到别的实例"

## 后果

- ✅ **正面**
  - 多实例并行使用零干扰
  - 注销 / TTL 过期局部化，不影响其它实例
  - cookie 名透明可观察（开发者工具 Application 面板里清晰对应每个实例）
- ⚠ **负面**
  - 用户切实例时需要重新走一次 /api/auth（拿新 cookie）
    —— 缓解：前端 useAuth 在 401 时用本地 token 自动重认证（已实现）
  - cookie 名空间膨胀：N 实例 = N 个 cookie 名；浏览器 cookie 数量有上限
    （单 domain 50 个），实际多实例场景远不到限制
- 🔵 **中性**
  - 跨实例统一登出需要遍历所有实例的 cookie 名清掉（阶段 10 打磨时再考虑）

## 备选方案

- **共享 cookie 名 + 跨实例 session 同步**：需要分布式 session store 或
  IPC，复杂度爆炸；与"每实例独立进程、零跨进程依赖"的设计哲学相左
- **cookie path 绑端口**：path 参数无法表达端口，浏览器仍按 host:domain 共享
- **用 SameSite=Strict + 各实例不同 domain**：单 IP 上无 domain 区分手段
