/**
 * wsl-port-hint
 *
 * 当 backend 跑在 WSL2 默认 NAT 网络模式下时，Windows 宿主浏览器无法用
 * `localhost:<port>` 直连 WSL 内的 backend——除非配 netsh portproxy。
 *
 * 本模块的两件事：
 *  1. 判断当前 IP 是不是 WSL2 NAT 段（172.16/12 私网）
 *  2. 生成一段可粘贴到 Windows 管理员 PowerShell 的 portproxy 命令
 *
 * 不做的事：
 *  - 不直接 spawn netsh：跨虚拟机边界操作宿主机不应由 backend 发起，
 *    那需要 UAC 弹窗 + 跨进程通信，不优雅。
 *  - 不假设 mirrored 模式一定无需转发：检测策略只是启发式
 *    （192.168.x / 10.x 多数情况下能直连）。
 */

/**
 * 判断 IP 是否落在 WSL2 NAT 段（172.16.0.0/12）
 *
 * WSL2 默认 NAT 模式下分配给 WSL 的 IP 都在这个段。
 * 192.168.x / 10.x / 真公网 IP 通常意味着 mirrored / bridged 模式，
 * Windows 浏览器一般能直连。
 */
export function isWslNatIp(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return a === 172 && b >= 16 && b <= 31;
}

/**
 * 生成端口转发提示。
 *
 * @param ports 需要转发的端口列表（通常就是 backend 监听端口）
 * @param wslIp WSL 端 IP（detectDisplayIp 已选好的）
 * @returns 三段：标题、PowerShell 命令、清理命令
 */
export interface PortForwardHint {
  /** 提示标题（会带上原因解释） */
  title: string;
  /** 需要在管理员 PowerShell 里粘贴执行的命令 */
  setupCommands: string[];
  /** 清理命令（可选） */
  resetCommand: string;
  /** 一行说明放在最末 */
  footer: string;
}

export function buildPortForwardHint(
  ports: number[],
  wslIp: string,
): PortForwardHint {
  const setup = [
    `$wsl_ip = "${wslIp}"`,
    ...ports.map(
      (p) =>
        `netsh interface portproxy add v4tov4 listenport=${p} listenaddress=0.0.0.0 connectport=${p} connectaddress=$wsl_ip`,
    ),
  ];
  return {
    title:
      `检测到 WSL2 NAT 网络模式（${wslIp}）。Windows 浏览器若用 localhost 连不上，` +
      `请在【管理员 PowerShell】里粘贴执行以下命令配置端口转发：`,
    setupCommands: setup,
    resetCommand: 'netsh interface portproxy reset',
    footer:
      'WSL 重启后 IP 可能变化，需要重新执行（或运行 scripts/wsl-port-forward.ps1 自动化）。' +
      '清理：netsh interface portproxy reset',
  };
}
