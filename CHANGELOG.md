# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号符合 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- **前端样式整体重写**：Tailwind v4 + Radix Primitives + vaul + lucide-react；
  删除 690 行手写 BEM；CSS token 走 `@theme` 注入
- **移动端布局根因修复**：`100dvh` + `useViewportFix` hook，
  键盘弹起时输入栏紧贴键盘上沿（不再被 100vh 挤出一屏）
- **快捷键设置乱码修复**：UI 编辑层 `\e \r \n \t \xHH` 双向编解码（28 个单测保护）；
  协议 / 落盘字段仍是真控制字节，跨端共享配置零兼容包袱
- **设置面板**：桌面 modal / 移动 sheet 自适应；新增"通知"分页（PushToggle 内嵌）
- **创建实例面板**：同样 sheet 化
- **InstanceTabs**：拆桌面（横向 tab）/ 移动（右上角按钮 + sheet 列表）两形态
- **顶栏合并**：原 InstanceTabs + StatusBar 两行合一行；PushToggle 移入设置；
  设置入口从 InputBar 移到顶栏
- **全局移除 emoji**（🔔 ⚙ ⚠）：改用 lucide 单色 stroke 图标
- **字号梯度收紧**：6 档（10/11/12/13/14/15px），默认 13px

### Removed

- `analysis/upstream/` 上游参考材料（clean-room 复刻已完成）

## [0.1.0] - 2026-05-05

首个可用版本。覆盖上游 `open-claude-remote@0.1.1` 主要功能（Clean-room 复刻），
裁剪 OnboardingGuide 与钉钉通知。

### Added

- **协议层（@ocr/shared）**：ServerMessage / ClientMessage union、
  ErrorCode 枚举、协议常量；frontend 与 backend 共用唯一来源
- **PTY 桥接**：node-pty + xterm.js 5 + 三阈值批合并（16ms / 32KB / 256KB）
- **重连回放**：OutputBuffer + history_sync（默认过滤 alt-screen 1049）
- **认证**：timingSafeEqual token + Session Cookie（端口名后缀绑定多实例）
- **限流**：令牌桶 / 分钟（默认 10）
- **配置体系**：`~/.claude-remote/config.json`（0o600 + 原子写）+ webapp Settings
- **审批 hook**：HookReceiver loopback-only + Web Push（VAPID 三优先级）+
  iOS Safari < 16.4 LocalNotification fallback
- **多实例**：port-finder 自动递增 + InstanceRegistry（mkdir-as-lock）+
  webapp 标签页 + 命令行 list/stop
- **attach 子命令**：命令行 stdin/stdout 接管 + 主从仲裁（webapp > attach > PC）
- **IP 漂移**：30s 轮询 + 稳定阈值 + ip_changed WS 广播 + 前端 toast
- **打磨**：install.sh 一键安装、README 用户视角、ARCHITECTURE 开发者视角

### Decisions（ADR）

详见 [`docs/plans/open-claude-remote-clone/adrs/`](./docs/plans/open-claude-remote-clone/adrs/)：

- 002 mkdir-as-lock 文件锁选型
- 003 Cookie 名后缀绑端口
- 004 webapp/attach 主从仲裁
- 007 启用 AlternateScreenFilter（与上游不同）
- 008 Web Push VAPID 三优先级
- 009 错误体系（AppError + ErrorCode）
- 010 裁剪 OnboardingGuide / 钉钉通知

### Tested

- 单元：284 backend / 15 shared / vitest
- 集成：每阶段独立 smoke（`backend/scripts/smoke-stage*.mjs`）
- 跨阶段：`backend/scripts/smoke-cross.mjs`（健康 → 登录 → WS 收发 →
  配置改写 → 实例列表 → VAPID）
