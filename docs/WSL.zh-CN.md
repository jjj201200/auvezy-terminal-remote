# 在 WSL 中跑，从 Windows 浏览器访问

[English](./WSL.md) · [简体中文](./WSL.zh-CN.md)

WSL2 的两种网络模式行为不同：

- **mirrored 模式**（Win11 22H2+ 默认）：WSL 直接拿 Windows LAN IP（如 `192.168.x.x`），
  Windows 浏览器可以直接用 banner 上的 IP 访问，无需任何额外配置
- **NAT 模式**（旧版 Windows 默认）：WSL 在 `172.x.x.x` 私网，Windows 浏览器无法直连。
  backend 启动时会自动检测并在 banner 末尾打印 PowerShell 配置命令

## 一键自动配置（管理员 PowerShell）

```powershell
# 转发常用端口范围（默认 3000-3010）
.\scripts\wsl-port-forward.ps1

# 仅转发指定端口
.\scripts\wsl-port-forward.ps1 -Ports 3000,3001

# 注册到登录时自动重配（WSL 重启后 IP 变了无需手动跑）
.\scripts\wsl-port-forward.ps1 -Persist

# 清理
.\scripts\wsl-port-forward.ps1 -Reset
```

## backend 如何检测 WSL

`backend/src/utils/wsl-detect.ts` 检查 `/proc/version` 里有没有 `microsoft` /
`WSL` 标记。命中后，`wsl-port-hint.ts` 通过对比 WSL IP 与 Windows 宿主机
IP 决定当前是 mirrored 还是 NAT 模式。Banner 末尾会追加：

- "WSL2 mirrored 模式 —— banner IP 可从 Windows 直接访问。"
- "WSL2 NAT 模式 —— 复制下面 PowerShell 片段到管理员终端跑一次，
  即可从 Windows 浏览器访问该端口。"

## WSL 上的构建依赖

`node-pty` 安装时要编译 native 模块，需要：

```bash
sudo apt install build-essential python3
```

如果 `pnpm install` 报 "make: not found" 或 "Python not found"，装上这些再 retry。
