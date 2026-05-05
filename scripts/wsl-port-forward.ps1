<#
.SYNOPSIS
  为 WSL 内运行的 open-claude-remote 自动配置 Windows 端口转发。

.DESCRIPTION
  WSL2 默认 NAT 网络模式下，Windows 浏览器无法用 localhost 直连
  WSL 内监听的端口。此脚本：
    1. 检测当前 WSL 实例 IP
    2. 清掉旧 portproxy 规则（同端口）
    3. 添加新规则：localhost:<port> → <wsl_ip>:<port>
    4. （可选）注册到 Windows 启动计划任务，WSL IP 变化后自动重配

  必须以管理员身份运行。

.PARAMETER Ports
  要转发的端口列表，默认 3000-3010。

.PARAMETER Persist
  附加 -Persist 时把脚本注册为登录时自动执行的任务计划，
  WSL 重启后 IP 变了无需手动跑。

.EXAMPLE
  PS> .\wsl-port-forward.ps1
  默认转发 3000-3010

.EXAMPLE
  PS> .\wsl-port-forward.ps1 -Ports 3000,3001
  仅转发 3000 / 3001

.EXAMPLE
  PS> .\wsl-port-forward.ps1 -Persist
  转发 + 登录时自动重新执行

.EXAMPLE
  PS> .\wsl-port-forward.ps1 -Reset
  清掉所有 portproxy 规则
#>

param(
    [int[]]$Ports = @(3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010),
    [switch]$Persist,
    [switch]$Reset
)

# ──────────────── 自检管理员权限 ────────────────
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ 必须以管理员身份运行此脚本。" -ForegroundColor Red
    Write-Host "   按 Win 键 → 输入 powershell → 右键 → 以管理员身份运行" -ForegroundColor Yellow
    exit 1
}

# ──────────────── -Reset 分支 ────────────────
if ($Reset) {
    Write-Host "→ 清除所有 portproxy 规则..." -ForegroundColor Cyan
    netsh interface portproxy reset
    Write-Host "✓ 完成" -ForegroundColor Green
    exit 0
}

# ──────────────── 探测 WSL IP ────────────────
Write-Host "→ 探测 WSL IP..." -ForegroundColor Cyan
try {
    $wsl_ip = (wsl hostname -I).Trim().Split()[0]
} catch {
    Write-Host "❌ wsl hostname -I 失败。WSL 是否已安装并启动？" -ForegroundColor Red
    exit 1
}

if (-not $wsl_ip -or $wsl_ip -eq "") {
    Write-Host "❌ WSL IP 为空。先在另一窗口跑 'wsl' 启动 distro 再重试。" -ForegroundColor Red
    exit 1
}
Write-Host "  WSL IP = $wsl_ip" -ForegroundColor Gray

# ──────────────── 配规则 ────────────────
Write-Host "→ 配置端口转发（$($Ports.Count) 个端口）..." -ForegroundColor Cyan
foreach ($p in $Ports) {
    # 同端口先删（幂等）
    netsh interface portproxy delete v4tov4 listenport=$p listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenport=$p listenaddress=0.0.0.0 connectport=$p connectaddress=$wsl_ip | Out-Null
    Write-Host "  ✓ localhost:$p → ${wsl_ip}:$p" -ForegroundColor Green
}

Write-Host ""
Write-Host "→ 当前所有规则：" -ForegroundColor Cyan
netsh interface portproxy show all

# ──────────────── -Persist 分支 ────────────────
if ($Persist) {
    Write-Host ""
    Write-Host "→ 注册登录时自动重配（任务计划）..." -ForegroundColor Cyan
    $scriptPath = $MyInvocation.MyCommand.Path
    $taskName = "OcrWslPortForward"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
        -RunLevel Highest -LogonType Interactive
    Register-ScheduledTask -TaskName $taskName `
        -Action $action -Trigger $trigger -Principal $principal `
        -Description "WSL2 NAT 模式下 open-claude-remote 端口转发" `
        -Force | Out-Null
    Write-Host "  ✓ 任务计划 '$taskName' 已注册" -ForegroundColor Green
    Write-Host "  下次登录 Windows 时自动重新执行；删除：" -ForegroundColor Gray
    Write-Host "    Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor Gray
}

Write-Host ""
Write-Host "✅ 全部完成。Windows 浏览器现在应能用 localhost:<port> 访问 WSL 内的 backend。" -ForegroundColor Green
Write-Host "   清理：.\wsl-port-forward.ps1 -Reset" -ForegroundColor Gray
