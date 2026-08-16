# ADR-001: claude hooks 注入通道从 `--settings` 参数改为 CLAUDE_CONFIG_DIR 镜像

## 状态

已采纳（2026-08-16，随 0.12.2 shell 函数 fallback 一同落地）

## 背景

用户把 claude 启动器写成 shell 函数（如 `.zshrc` 里的 `zclaude`：export 一组
`ANTHROPIC_*` 网关变量后 `command claude`）。`atr zclaude` 经 shell 函数
fallback（`$SHELL -ic 'zclaude'`）启动后，旧注入通道失效：

- 旧通道把 `--settings <path>` 追加到 claude 的命令行参数——依赖参数经
  函数 `"$@"` 转发，且 detect 靠命令名 basename 认 claude（fallback 后
  command 是 `$SHELL`，两者全部落空）
- 曾考虑 `--claude` 强制 flag 方案（用户显式声明），被否决：要求用户记住
  flag 不够无感

## 决策

hooks 改走 **PTY env 通道**：`CLAUDE_CONFIG_DIR`（Claude Code 官方文档化的
配置目录重定向变量）指向 atr 构建的镜像目录：

```
~/.atr/claude-config/<port>/
├── settings.json   ← 真文件：用户 ~/.claude/settings.json 合并 + atr hooks
└── 其余 entry      ← symlink → ~/.claude 对应 entry（凭据/历史/项目零拷贝共享）
```

- 实例启动时构建（幂等），shutdown 时删除（hooks URL 绑定实例端口，过期无用）
- `detect` 命中条件扩展为 `isClaudeCommand(command) || viaShellFallback`
- `prepareSpawn` 返回 `{ extraEnv: { CLAUDE_CONFIG_DIR: dir } }`，不再返回
  `--settings` 参数；index.ts 把 extraEnv 传给 `pty.spawn({ env })`

## 理由

- **无感**：settings 读取与命令名/参数转发完全解耦——`atr claude`、
  `atr zclaude`（函数）、wrapper 脚本全部统一生效，零 flag 零配置
- **不侵入**：不改 `~/.claude` 任何文件；不经 atr 的会话 env 不存在，零影响
- **登录态保留**：凭据等经 symlink 共享（实测验证）
- 实测证据：镜像 settings 的 SessionStart hook 在函数场景下触发；
  claude 运行期往镜像写 `.claude.json`（行为级证明 CONFIG_DIR 生效）

## 后果

- 已知限制：claude 运行期新建的顶层文件落在镜像内随实例删除（不进
  `~/.claude`）；用户在 atr 终端里 `/login` 且 `~/.claude` 无凭据时凭据
  会随镜像删除（已登录用户无此问题）
- `atr bash` 里手动敲 claude 不注入（viaShellFallback=false 且 bash 不含
  claude——保守避免登录分叉）
- `--settings` 参数注入路径删除；用户手动传 `--settings` 仍被提取并合并进
  镜像（hooks 合并语义不变）
- Windows 无 symlink 权限保障的场景未验证（本项目主打 WSL/Linux/macOS）
