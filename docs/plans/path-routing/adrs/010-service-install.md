# ADR-010: broker 一键 service install（systemd / launchd）

## 状态

已采纳（2026-05-09）

## 上下文

0.7.0 broker 永驻 + 是所有外部访问的唯一入口（ADR-001、ADR-002、ADR-009）。这意味着：

- 用户重启 PC 后必须有人把 broker 拉起来
- 0.7.0 之前用户跑 `atr claude` 自动 fork broker，但**前提是用户先打开终端跑命令**
- 期望：开机后浏览器直接访问 broker URL 就能看到 atr 入口

需要让 broker 可以注册为 OS service / 开机自启。

## 决策

提供 `atr broker service install` 命令一键写 OS service 配置：

| OS | 机制 | 默认级别 | 配置文件位置 |
|---|---|---|---|
| Linux (systemd) | systemd unit | user-level | `~/.config/systemd/user/atr-broker.service` |
| macOS | launchd plist | user agent | `~/Library/LaunchAgents/ke.kkjb.atr-broker.plist` |
| WSL2（systemd 启用） | 同 Linux user systemd | user-level | 同上 |
| Windows | TBD（0.7.x 跟进） | n/a | n/a |

子命令：

```
atr broker service install   [--system]    # --system 切换为 system-level（需 sudo）
atr broker service uninstall
atr broker service status
atr broker service logs
```

## 拒绝的替代方案

### 方案 A：用户自己写 systemd unit

只在文档里列示例，不提供 CLI。

**拒绝原因**：

- 用户复制粘贴 + 调路径出错率高
- 文档过时（unit 内容跟着 atr 版本变）
- "一键开机自启" 是核心 UX 卖点，不该靠手动配

### 方案 B：跨平台 daemon 库（`node-mac` / `node-linux` / `node-windows`）

或更老的 `pm2` / `forever`。

**拒绝原因**：

- node-mac / node-linux / node-windows 5+ 年没更新，issue 堆积
- pm2 / forever 引入巨大依赖（~10MB），与 atr 极简打包冲突
- atr 平台特定逻辑只是 service 文件模板 + `systemctl` / `launchctl` shell 调用，自己写 < 200 行
- 自己写更可控（uninstall 干净度、错误信息中文化）

### 方案 C：默认装到 system-level（开机就启，不需登录）

**拒绝原因**：

- system-level 需要 sudo，破坏"npm i 即可用"的 onboarding
- 多用户机器上一个用户的 atr 不该影响别的用户
- 大多数用户场景是"我的工作机"，user-level 启 = 我登录后 atr 可用，足够
- 提供 `--system` flag 给真有需要的高级用户

### 方案 D：用 `crontab @reboot`

**拒绝原因**：

- 不能监督进程（崩了不重启）
- 跨平台支持差（Windows 无 cron）
- 日志难查
- systemd `Restart=on-failure` 才是正经方案

## 实现要点

### 文件位置

- `backend/src/broker/service-installer.ts` —— 单文件，按 platform 分支
- 模板用 string template 内联，不引外部 template 引擎

### systemd user unit 模板

```ini
[Unit]
Description=Auvezy Terminal Remote broker
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node {{cliPath}} broker start
Restart=on-failure
RestartSec=5s
Environment=ATR_DATA_DIR=%h/.atr
{{#if extraEnv}}
Environment={{extraEnv}}
{{/if}}

[Install]
WantedBy=default.target
```

### launchd plist 模板

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ke.kkjb.atr-broker</string>
  <key>ProgramArguments</key>
  <array>
    <string>{{nodeBin}}</string>
    <string>{{cliPath}}</string>
    <string>broker</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{{logPath}}</string>
  <key>StandardErrorPath</key><string>{{logPath}}</string>
</dict>
</plist>
```

### CLI 流程

```
$ atr broker service install
[atr] 检测：Linux + systemd（user-level 可用）
[atr] node 路径：/usr/bin/node
[atr] cli 路径：/path/to/auvezy-terminal-remote/dist/cli.js
[atr] 写入 ~/.config/systemd/user/atr-broker.service
[atr] systemctl --user daemon-reload
[atr] systemctl --user enable atr-broker.service
[atr] 立即启动 broker？[Y/n] y
[atr] systemctl --user start atr-broker.service → ok
[atr] 验证：curl http://127.0.0.1:3000/api/health → 200
[atr] ✓ 安装完成。重启后自动启动。
```

### uninstall

```
$ atr broker service uninstall
[atr] systemctl --user stop atr-broker.service
[atr] systemctl --user disable atr-broker.service
[atr] rm ~/.config/systemd/user/atr-broker.service
[atr] systemctl --user daemon-reload
[atr] ✓ 已卸载。
```

## 后果

### 正面

- 开机直接可用，broker URL 永远活
- service `Restart=on-failure` 让 broker 崩溃后自动复活（与 ADR-002 永驻语义一致）
- 用户级 systemd 不需 sudo，npm 全局装的 atr 直接能装
- 卸载干净（service 文件 + enable 状态都清）

### 负面 / 取舍

- WSL 用户必须自己启 systemd（`/etc/wsl.conf` 设 `systemd=true`），但这跟用 atr 关系不大；guide 里明确写
- Windows 0.7.0 不支持，预期 0.7.x 跟进（用 `nssm` 或 `node-windows` 调研）
- macOS launchd 重启策略 `KeepAlive=true` 会导致 broker 无论怎么退都被拉起来；
  用户跑 `atr broker stop` 后 launchd 又拉起来 → 这是 unwanted 行为
  缓解：`atr broker stop --no-restart` 同时 launchd unload；或者 `atr broker service stop` 显式停 service

## 测试策略

- 单元测试 service-installer.ts：
  - 给定 platform / paths，输出预期 service 文件内容（snapshot）
  - 不实际写系统目录（用临时 dir 验证）
- 集成测试（可选，仅 Linux CI）：
  - 临时 user systemd（systemd-run --user）模拟 install 流程
- 手工测试：
  - WSL2 + systemd：完整跑一遍 install → 重启 → 自动启
  - macOS：launchctl bootstrap / bootout

## 安全考虑

- service 文件不含 secrets（token 仍在 ~/.atrrc，atr 启动时读）
- service 用当前用户身份运行（user-level），不需 root
- `--system` 模式时 atr CLI 会提示"需要 sudo"，用户主动确认

## 相关

- ADR-002（broker 永驻）
- design.md §5.5 broker CLI、§5.6 一键开机自启
