# ADR-003: URL 用 `/i/<instanceId>/...` 形式

## 状态

已采纳（2026-05-09）

## 上下文

broker 需要按 URL 路由把请求送到对应 worker。URL 形态决定了：

- 用户分享给同事的 URL 长什么样
- 浏览器地址栏 URL 长什么样
- 书签 / PWA 主屏图标的 URL 是否稳定（实例重启后仍指向"它"）
- broker 反代解析复杂度

## 决策

URL 形式：`/i/<instanceId>/<rest>`

- `/i/` 是固定 namespace prefix（`i` for "instance"）
- `<instanceId>` 是 UUID（atr 0.6.x 已经有这个字段：worker 启动时 `randomUUID()` 生成，写入 instances.json）
- `<rest>` 是要反代到 worker 的 path（含 query string）

例：

```
https://wsl.tail3e456b.ts.net/i/cb79b701-0d3c-49d7-a14e-3403db0f8d1c/api/health
                              └────── path prefix ──────┘ └─── rest ───┘
```

## 拒绝的替代方案

### 方案 A：`/i/<port>/...`

用 worker 监听端口当 path 段。

**拒绝原因**：

- worker 端口由 OS 动态分配（每次启动可能变），URL 不稳定
- 暴露内部实现细节
- 实例重启后用户书签失效

### 方案 B：`/<slug>/...`（用户自定义短名）

`/claude-1/`、`/vim/` 这种好记的名字。

**拒绝原因**：

- 重名冲突要处理（用户先开 `/claude-1`，关掉再开新的，命名复用 vs 重新分配？）
- 命令变更后 slug 应该跟着变还是不变？语义模糊
- 没有命名 namespace 容易跟其它 path 撞（`/api`、`/assets` 之类）

### 方案 C：subdomain `<instanceId>.atr.example.com`

每个实例独立 subdomain。

**拒绝原因**：

- 所有 cookie / SW / push 又重新跨 origin（违背我们集中化的初衷）
- 通配符证书要求（每个实例新 subdomain 都要有效 cert）
- DNS 通配符在 LAN 自托管场景几乎不可用

### 方案 D：`/api/i/<id>/...` 或 `/instance/<id>/...`

更长的 prefix。

**拒绝原因**：

- 没有实质价值（`/i/` 已经够辨识）
- URL 越长用户分享时越烦

## 设计要点

- `/i/` prefix 不会与现有 path 冲突（atr 0.6.x 没有 `/i/` 路由）
- instanceId 用 UUID 不是 slug：保证唯一、不可猜、与 0.6.x registry 直接兼容
- URL 末尾通常带 `/`，访问 `/i/<id>` 应自动 308 redirect 到 `/i/<id>/`（避免相对 URL 歧义）
- 反代器内部正则：`^/i/([^/]+)(/.*)?$`

## 后果

### 正面

- URL 稳定（instanceId 跟着实例进程身份，重启 PID 变但 ID 不变）
- 跨实例同 origin（cookie / SW / push 全局共享）
- 用户分享 URL 给同事，对方仍指向同一实例（前提：实例还在跑）
- broker 反代逻辑简单（一个正则匹配）

### 负面 / 取舍

- UUID URL 不"好记"（`/i/cb79b701-0d3c-49d7-a14e-3403db0f8d1c/`）
  缓解：用户加书签 / 主屏图标即可，看不到 URL；前端 UI 用 `name` 字段显示友好名
- 实例重启分配新 instanceId 后旧 URL 失效
  缓解：未来可加"实例 alias"字段（用户给同一 cwd 起稳定别名），0.7.0 暂不做

## 相关

- ADR-007（base href 注入）—— `<base href="/i/<id>/">` 让前端相对路径正确解析
- design.md §4.1 进程拓扑、§7.1 反代头
