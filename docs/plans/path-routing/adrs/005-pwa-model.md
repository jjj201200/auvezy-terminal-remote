# ADR-005: 单 PWA 单 origin，实例切换是 SPA 内部路由

## 状态

已采纳（2026-05-09）

## 上下文

broker + path-routing 让所有实例落在同一个 origin。但浏览器视角下，"同 origin" 不等于 "同 PWA / 同 SW scope"——这取决于：

- manifest 里 `scope` / `start_url`
- SW 注册时的 `scope` 选项
- 用户从哪个 URL "添加到主屏"

设计上有两种相反走向：

- **A. 单 PWA**：scope = `/`，整个 atr 是一个 PWA；实例是 SPA 内部 tab；SW 全局唯一
- **B. 多 PWA**：scope = `/i/<id>/`，每个实例是独立 PWA；用户可以分别加多个主屏图标；SW 各管各

## 决策

**单 PWA 单 origin，实例切换是 SPA 内部路由**。

具体：

- manifest：`start_url: "/"`，`scope: "/"`
- SW 注册：`scope: "/"`
- 浏览器视角：访问 `/` 看到首页，访问 `/i/<id>/` 看到带选中实例的同一首页
- SPA 内部用 `history.pushState` 切实例，URL 变但 React 树不重挂载
- push subscription 全局唯一，所有实例的 push 通知发到这一个 endpoint

## 拒绝的替代方案

### 方案 B：每实例独立 PWA

每实例 scope 限制在 `/i/<id>/`，加多个主屏图标。

**拒绝原因**：

- iOS PWA push 是按 PWA 实例订阅的：用户开 5 个实例 = 5 次"是否允许通知"弹窗 = 用户大概率拒
- 用户切实例时 PWA 切换重新加载（每个 PWA 独立 SW / cookie）
- 多主屏图标 UX 杂乱（用户实例数变化，图标动来动去）
- 优势"每实例独立 SW 缓存"在我们场景下没价值（atr 资源体积小，全局 SW 缓存就够）

### 方案 C：单 PWA 但实例切换走 hash 路由（`/#/i/<id>`）

**拒绝原因**：

- broker 反代要按 path 路由，hash 不会发到服务端 → 永远命不中 broker
- `/#/i/<id>` 实际上还是访问 `/`，broker 看不到 instanceId
- hash 路由 SEO / share 都比 path 差

## 后果

### 正面

- iOS push：用户只需"允许 PWA 通知"一次，订阅一次 endpoint，所有实例通知到
- SW 全局唯一，缓存策略 / push handler / install 提示都简单
- 切实例不重新加载 SPA，状态保留（xterm / WS / scrollback 全部活着）
- 用户加主屏图标只加一个，干净

### 负面 / 取舍

- broker 收到 `/i/<id>/` 访问时返回的 HTML 跟 `/` 是同一份（前端启动后通过 `window.location.pathname` 自识别"激活哪个实例 tab"）
- 用户没办法"为某个实例单独加图标"（如果未来真有需求再扩展，0.7.0 不做）

## 实现要点

- vite `base: './'`：让 `<script src>` 相对路径，从 `/` 或 `/i/<id>/` 加载都能命中正确 asset URL
- SW scope 永远 `/`，SW 内路由判断用 `self.registration.scope` 解析 base path
- frontend 启动时：
  ```ts
  function getActiveInstanceId(): string | null {
    const m = window.location.pathname.match(/^\/i\/([^/]+)/);
    return m?.[1] ?? null;
  }
  ```
  传给 MultiInstanceConsole 当初始 activeId
- 切实例：`history.pushState(null, '', `/i/${targetId}/`)` + 触发 SPA 内部状态更新

## 相关

- ADR-003（URL scheme）
- ADR-007（base href 注入）
- design.md §7.2.2 单 PWA 模型下的 manifest 处理、§8.5 SPA 切实例
