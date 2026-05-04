# 阶段 3 进度：审批通知

## 目标

Claude 调用工具时弹出审批，手机能在 xterm 里看到 prompt 并响应。

## 验收标准

- POST /api/hook 仅接收 loopback（127.0.0.1 / ::1 / ::ffff:127.0.0.1）
- HookReceiver 仅处理 Notification.permission_prompt 事件
- SessionController 收到 hook → status='waiting_input' + 广播 status_update
- 启动时把 hook 配置写入 ~/.claude-remote/settings/<port>.json，通过 --settings 透传给 claude
- 用户在 xterm 里输入 y/Esc → 透传到 PTY → 完成审批
- 前端 StatusBar 在 waiting_input 时显示警告色

## 步骤清单

- [x] **3.1** HookReceiver（EventEmitter，permission_prompt 过滤）+ 单测
- [x] **3.2** hook-routes（仅 localhost）+ 单测
- [x] **3.3** SessionController 接 HookReceiver → status_update 广播
- [x] **3.4** config 模块：createClaudeSettings + saveClaudeSettings + extractSettingsFromArgs + 单测
- [x] **3.5** index.ts 启动序列：合并 settings 写文件 + --settings 透传
- [x] **3.6** router.ts 注入 hookReceiver
- [x] **3.7** 端到端 smoke：模拟 POST /api/hook + 验证 WS 收到 waiting_input
- [x] **3.8** 阶段 3 收尾

## 实施日志

### 3.1 HookReceiver
新增 `backend/src/hooks/hook-receiver.ts`：基于 EventEmitter 的 `processHook(payload)`，
仅在 `notification_type === 'permission_prompt'` 时 emit `'notification'` 事件。
工具名提取优先级：payload.tool_name → message 正则匹配 → 兜底 'unknown_tool'。
PreToolUse 与其他 notification_type 一律 `{ type: 'ignored' }`，便于 hook-routes 返回原因。
单测 7 个全过。

### 3.2 hook-routes
新增 `backend/src/api/hook-routes.ts`：POST /api/hook，先做 `isLoopback(ip)` 校验，
非 loopback 直接 403 + `HookError(HOOK_NON_LOCALHOST)`；非对象 payload 400 + `HOOK_INVALID_PAYLOAD`。
其余交给 receiver.processHook 并把结果回写为 `{ ok: true, tool? | ignored }`。
对应单测 4 个，覆盖：loopback 通过 / PreToolUse ignored / 非法 payload / 非 loopback 拒绝（伪造 X-Forwarded-For）。

### 3.3 SessionController 接 hook
为 SessionController 增加 `setHookReceiver(receiver)`。监听 'notification' 事件后：
- 内部 _status 切到 'waiting_input'
- 广播 `{ type: 'status_update', status: 'waiting_input', detail: '等待审批：<tool>' }`
不直接广播文本提示——审批 prompt 已经在 PTY 输出里。重复调用打 warn 日志覆盖旧 receiver。

### 3.4 config 模块
新增 `backend/src/config.ts`，三个函数：
- `createClaudeSettings(port, existing?)`：生成 Notification.permission_prompt + PreToolUse.AskUserQuestion 两个 hook，
  command 为 `curl -s -X POST http://127.0.0.1:<port>/api/hook -H 'Content-Type: application/json' -d @-`，
  与用户原 settings 合并时同名字段覆盖并 warn。
- `saveClaudeSettings(settings, port, baseDir?)`：写入 `<baseDir>/settings/<port>.json`，目录权限 0o700、文件权限 0o600。
- `extractSettingsFromArgs(args)`：解析 `--settings <value>` / `--settings=<value>`，value 可以是文件路径或 inline JSON。
  解析失败时返回 null（保留原参数交给 claude 自行处理）。
单测 12 个全过，覆盖合并、覆盖告警、文件路径、inline JSON、解析失败、多次出现取最后等。

### 3.5 index.ts 集成
在配置加载后插入 1.5 步：调用 extractSettingsFromArgs → createClaudeSettings → saveClaudeSettings，
把 `--settings <path>` append 到 `finalClaudeArgs`，在 spawn 时使用合并后的 args。
新增 `const hookReceiver = new HookReceiver()`，在 SessionController 构造后立即 `ctrl.setHookReceiver(hookReceiver)`。

### 3.6 router 注入
`createApiRouter` 的 options 增加 `hookReceiver?: HookReceiver` 字段，
存在时挂 `createHookRoutes(hookReceiver)`。loopback 校验在路由层完成，不需要鉴权中间件。

### 3.7 端到端 smoke
新增 `backend/scripts/smoke-stage3.mjs`，对照运行中的 backend 完成：
1. POST /api/auth → 200 + Cookie
2. WS 用 Cookie upgrade 成功
3. history_sync 收到，确认初始 status
4. POST /api/hook (notification_type=permission_prompt, tool_name=Bash) → 200 + tool=Bash
5. WS 在 2s 内收到 `status_update.waiting_input`，detail 含 'Bash'
6. POST /api/hook (notification_type=idle) → ignored=true 且不再触发额外广播

为绕开 PTY 进程被 `--settings <path>` 干扰退出的问题，smoke 使用 `bash -c "tail -f /dev/null" --` 让 bash 吞掉
后续位置参数。结果：6 项全 ✅，端口与 settings 文件已清理。

### 3.8 阶段收尾
- typecheck（shared/backend/frontend）干净
- 单测 149/149 通过（含本阶段新增 hook-receiver:7 + hook-routes:4 + config:12）
- 共享 ws-protocol 单测 8/8 通过
- smoke-stage3 6/6 通过

## 当前阻塞

无。

## 验证结果

- ✅ 全量 typecheck 通过
- ✅ 全量单测 149 + 8 通过
- ✅ stage-03 端到端 smoke 全过：hook → WS waiting_input 链路打通
