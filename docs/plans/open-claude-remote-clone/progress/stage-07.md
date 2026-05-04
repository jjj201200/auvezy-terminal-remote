# 阶段 7 进度：attach 子命令

## 目标

让用户在另一台 PC 用 `claude-remote attach <url>` 接管远程实例：终端实时同步、键盘输入透传、resize 跟随。

## 验收标准

- attach 子命令解析 URL（http(s)://host:port[?token=...]）
- 启动 raw mode stdin → WS user_input；WS terminal_output → stdout
- WS 重连退避序列与前端一致
- 主从仲裁：webapp 在线时 attach 仅显示输出 + 输入透传，但 resize 跟随；
  attach 单独时由 attach 控制 resize；webapp 上线后再切回 webapp 主控

## 步骤清单

- [ ] **7.1** backend/pty/virtual-pty.ts（IPtyManager 接口实现）+ 单测
- [ ] **7.2** backend/attach.ts（CLI 子命令实现）+ 单测
- [ ] **7.3** cli.ts 接 attach 分发 + URL 解析（小工具）
- [ ] **7.4** SessionController 主从仲裁（webapp 优先 resize）
- [ ] **7.5** 端到端 smoke
- [ ] **7.6** ADR 004 + 收尾

## 实施日志

### 7.1 virtual-pty
（待开始）

### 7.2 attach.ts
（待开始）

### 7.3 cli 分发
（待开始）

### 7.4 主从仲裁
（待开始）

### 7.5 smoke
（待开始）

### 7.6 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
