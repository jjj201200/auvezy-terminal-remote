# 阶段 2 进度：认证与安全

## 目标

在阶段 1 的数据通路基础上加 Token 认证、Session Cookie、限流、CORS 白名单。
未认证浏览器看不到内容；扫码或手动输入 token 后正常工作；连续错 token 触发限流。

## 验收标准

- 启动时打印 token（前 8 + 后 8 字符预览）
- 浏览器首次访问 → AuthPage 输入 token → POST /api/auth → 设置 Session Cookie → 跳到 ConsolePage
- WS upgrade 校验 Cookie，未认证拒绝（401）
- /api/auth 触发限流（默认 20/min/IP）
- token 用 timingSafeEqual 比较防时序攻击
- token 在 localStorage 持久化，刷新页面不丢失
- CORS 白名单：同源 / displayIp / localhost / 127.0.0.1

## 步骤清单

- [x] **2.1** token-generator + RateLimiter + 单测
- [x] **2.2** AuthModule（timingSafeEqual + Session 管理 + cookie）+ 单测
- [x] **2.3** auth-routes（POST /api/auth）
- [x] **2.4** WsServer 接 AuthModule（upgrade 校验 Cookie 或 URL token）
- [x] **2.5** index.ts 集成 AuthModule + CORS 白名单 + 启动 token 打印
- [x] **2.6** frontend token-storage（localStorage 持久化）
- [x] **2.7** frontend api-client（fetch 包装 + 401 处理）
- [x] **2.8** frontend useAuth hook
- [x] **2.9** frontend AuthPage（输入 token 提交）
- [x] **2.10** frontend App 路由切换（未认证 → AuthPage，已认证 → ConsolePage）
- [x] **2.11** 阶段 2 收尾：端到端 smoke + typecheck/test 全通 + overview 同步

## 实施日志

### 2.1 token-generator + RateLimiter · 完成 2026-05-05

- `auth/token-generator.ts`（randomBytes 32 字节 → 64 hex）
- `auth/rate-limiter.ts`（per-IP 1min 滑窗 + cleanup unref + reset 重置）
- `auth/rate-limiter.test.ts`（9 测试覆盖窗口/重置/多 IP/destroy）

### 2.2 AuthModule · 完成 2026-05-05

- `auth/auth-middleware.ts`（timingSafeEqual + Session Map + Express middleware + handleAuth + createSessionCookieName）
- `auth/auth-middleware.test.ts`（21 测试覆盖 verifyToken/Session 生命周期/cookie 解析/requireAuth/handleAuth 限流）

### 2.3 auth-routes · 完成 2026-05-05

- `api/auth-routes.ts`（仅 POST /auth）
- `api/router.ts` 增量：opts.authModule 注入挂 /auth

### 2.4 WsServer 接 AuthModule · 完成 2026-05-05

- `auth/ws-authenticate.ts`（适配器：URL ?token= 路径优先 → attach；否则 Cookie → webapp；任一失败返回 null）
- WsServer 在阶段 1 已经预留 `WsServerOptions.authenticate` 钩子，本步只需注入

### 2.5 index.ts 集成 · 完成 2026-05-05

- token 三优先级：CLI override > AUTH_TOKEN env > 现场生成
- cookieName = createSessionCookieName(port)（多实例预留）
- CORS 白名单：同源 / localhost / 127.0.0.1（阶段 5 加 displayIp）
- 启动 banner：Token 预览（前 8...后 8）；首次生成时分两行显示完整 64 字符
- shutdown 时调 authModule.destroy() 释放 RateLimiter 定时器

### 2.6 token-storage · 完成 2026-05-05

- `services/token-storage.ts`（loadToken / saveToken / clearToken，localStorage try/catch 降级）

### 2.7 api-client · 完成 2026-05-05

- `services/api-client.ts`（apiPost/apiGet 通用包装 + ErrorCode 统一）
- 401/403 自动 clearToken
- credentials: 'include' 让 cookie 跟随
- 网络错误也走 ApiResult 形态，调用方不需 try/catch

### 2.8 useAuth · 完成 2026-05-05

- `hooks/useAuth.ts`（pending/authenticated/unauthenticated 三态）
- mount 时若有缓存 token 静默重认证；失败清 token 跳认证页
- login 返回错误 message 让 UI 显示

### 2.9 AuthPage · 完成 2026-05-05

- `pages/AuthPage.tsx`（受控 input + URL ?token= 自动填充但不自动提交）
- `styles/global.css` 增加 .auth-page / .auth-card 样式

### 2.10 App 路由切换 · 完成 2026-05-05

- `App.tsx` 重写：根据 useAuth 三态切换 loading / AuthPage / ConsolePage

### 2.11 阶段收尾 · 完成 2026-05-05

**typecheck**：全 workspace 通过
**测试**：shared 8 + backend 126 + frontend 0 = 134/134

**端到端 smoke**（`backend/scripts/smoke-stage2.mjs`）：
- ✓ 未认证 WS upgrade 被拒（HTTP 401）
- ✓ 错 token POST /auth → 401 + AUTH_INVALID_TOKEN
- ✓ 正确 token POST /auth → 200 + Set-Cookie session_id_p3000
- ✓ 带 cookie WS upgrade 通过
- ✓ URL ?token= WS upgrade 通过（attach 路径预留）
- ✓ 限流：成功认证后计数清零（合法用户不会被自己历史卡死）

**收尾清单**：
- ✓ 端口释放
- ✓ logs/ 清理
- ✓ 临时文件清理（CLAUDE.md 第 1 条规则）

## 验证结果

✅ pnpm typecheck 全通
✅ pnpm test 全通（134/134）
✅ pnpm build 全链路通过
✅ 端到端 smoke：未认证拒绝 / 正确认证签发 cookie / cookie 与 URL token 双路径 WS 通过
✅ 测试结束所有进程与端口已释放

## 阶段完成对照（与原项目自检）

- [x] timingSafeEqual + 长度先比 ← 一致
- [x] 32 字节 random + hex 编码 → 64 字符 ← 一致
- [x] Session HttpOnly + SameSite=Lax + secure 自适应 ← 一致
- [x] cookieName 后缀绑端口（多实例预留）← 一致
- [x] WS 双重认证（URL token + Cookie Session）← 一致
- [x] 限流 per-IP 1min 滑窗 + 成功后重置 ← 一致
- [x] 限流 cleanup timer + unref ← 一致
- [x] CORS 白名单（同源 / localhost / 127.0.0.1）← 一致；displayIp 留给阶段 5
- [x] 401/403 前端自动清 token ← 一致
- [x] 启动 banner 显示 Token 预览 ← 一致

## 仍未实现（后续阶段补）

- 共享 Token 文件（阶段 5）
- displayIp + LAN IP 检测加入 CORS 白名单（阶段 5）
- 二维码扫码自动认证（阶段 5）
- WS 重连时自动重认证（阶段 2 已有 onclose 静默重认证逻辑预留接口；完整实现归入阶段 2 后续小修）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
