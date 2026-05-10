# 阶段 6 — service install + broker CLI 完整化

> 状态：✅ 已完成（2026-05-10）；未 commit

## 目标

1. broker CLI 完整化：`atr broker {start,stop,status}`
2. service install：`atr broker service {install,uninstall,status,logs}`
3. 跨平台模板（详见 ADR-010）：
   - Linux/WSL2：systemd user unit
   - macOS：launchd user agent
   - Windows：暂留 "0.7.x 跟进" 提示

## 切片

| Sub | 内容 | 风险 |
|---|---|---|
| 6A | `service-installer.ts`：模板 + writeFile + exec systemctl/launchctl 包装 | 中 |
| 6B | broker stop / status 子命令实现 | 低 |
| 6C | broker service install CLI dispatch | 低 |
| 6D | 单测（snapshot 模板）+ smoke（不实际写系统目录） | 中 |

## 任务清单

### 6A — service-installer 核心

- [ ] `backend/src/broker/service-installer.ts`
  - `detectPlatform()`: 'linux' | 'macos' | 'wsl2' | 'windows' | 'unsupported'
  - `renderSystemdUnit(opts)`: 字符串模板，含 ExecStart / Restart=on-failure / Environment
  - `renderLaunchdPlist(opts)`: XML 字符串模板
  - `installLinux({ system?, dryRun? })`: 写 unit 文件 → daemon-reload → enable
  - `installMacOS()`: 写 plist → launchctl bootstrap
  - `uninstall*()`: 反向；不存在不报错
  - `status*()`: 调用 systemctl status / launchctl list 解析返回
  - 注入 `fs` / `child_process.exec` 便于单测
- [ ] 错误：用 `BrokerServiceError`（新 AppError 子类，code 加 SERVICE_INSTALL_FAILED）

### 6B — broker stop / status

- [ ] cli-utils：`brokerAction` 加 'stop' / 'status'
- [ ] broker/cli.ts dispatch 到新函数：
  - `runBrokerStop()`：读 broker.json → process.kill(pid, 'SIGTERM') → 等 5s →
    若仍活强 SIGKILL → 清 broker.json
  - `runBrokerStatus()`：读 broker.json + isBrokerAlive + HTTP probe；输出
    人话格式 + JSON（--json）

### 6C — service install CLI

- [ ] cli-utils：`brokerAction` 加 'service'，二级动作 'install'/'uninstall'/'status'/'logs'
- [ ] broker/cli.ts dispatch 到 service-installer 对应方法
- [ ] CLI flag：`--system`（system-level systemd，需 sudo）；交互式提示用户
      "立即启动 broker？[Y/n]"

### 6D — 测试

- [ ] service-installer 单测：
  - renderSystemdUnit / renderLaunchdPlist snapshot
  - install 写到临时目录（注入 baseDir）；不实际跑 systemctl
  - uninstall 幂等
- [ ] smoke：
  - `atr broker status` 显示 broker.json 内容 + alive
  - `atr broker stop`（已有进程时）→ 进程退出 + broker.json 清

## 不做

- ❌ Windows service（0.7.x 跟进；本阶段只在 detectPlatform 报"unsupported"）
- ❌ system-level（--system flag 提示但不深度实现，0.7.x 完善 sudo 流程）

## 进度日志

### 2026-05-10 — 开工

写本文档；准备 6A。

### 2026-05-10 — 6A 完成

`broker/service-installer.ts` 落地：detectPlatform / renderSystemdUnit /
renderLaunchdPlist / install / uninstall / getInstalledPath。**故意不调
systemctl/launchctl 实际命令**——只写/删 service 文件，nextSteps 字符串
让 CLI 打印；测试不污染系统。17 个单测全绿（覆盖 4 平台 / 模板内容 /
临时目录 install + 幂等 uninstall）。

### 2026-05-10 — 6B + 6C 完成

- cli-utils：`BrokerAction` 扩展为 'start' / 'stop' / 'status' /
  'service-install' / 'service-uninstall' / 'service-status'；`atr broker service install`
  二级动作解析
- broker/cli.ts：runBrokerCli(action) 分发；新增 runBrokerStop / runBrokerStatus /
  runServiceInstall / runServiceUninstall / runServiceStatus
- runBrokerStop：SIGTERM → 5s 优雅期 → SIGKILL 兜底 + 清 broker.json
- runBrokerStatus：读 broker.json + isBrokerAlive + HTTP /api/health probe
- runServiceStatus：调 systemctl --user is-active / launchctl list（best effort）
- cli.ts dispatch：透传 brokerAction 给 runBrokerCli

### 2026-05-10 — 6D smoke 通

- backend 498/498 全绿（+17 service-installer）；build 零错
- smoke broker start → broker status 显示 PID/端口/health 200 → broker stop
  → SIGTERM → broker.json 清 → 端口释放 ✓
- smoke service install (wsl2 平台)：unit 写到 `~/.config/systemd/user/`
  正确路径；ExecStart 是绝对 node + cli.js；wsl2 平台提示 `/etc/wsl.conf` ✓
- service status 调用 `systemctl --user is-active` 显示 inactive（未 enable）✓
- service uninstall 幂等删除 ✓

阶段 6 整体完成（未 commit）。
