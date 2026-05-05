/**
 * 网络工具：私有 IP 判定 + 显示用 IP 自动检测
 *
 * 用途：
 *  - banner 上需要打印一个手机能扫的 URL，要求是局域网可达的 IP
 *  - 多网卡机器（VPN、Docker bridge、物理 NIC）需要选最合适的一个
 *
 * 选择策略（优先级从高到低）：
 *  1. 用户显式指定 host（如果不是 0.0.0.0）→ 直接用
 *  2. RFC1918 私有段（10/8、172.16/12、192.168/16）的 IPv4
 *  3. link-local（169.254/16）作为兜底（一般是 Wi-Fi 直连/dhcp 抢救态）
 *  4. 都没找到 → 127.0.0.1
 *
 * 排除：
 *  - 127.0.0.0/8 loopback（127.0.0.1 仅作最后兜底）
 *  - IPv6（手机扫码 + 浏览器对 v6 link-local 支持差，跳过）
 *  - 接口 internal=true（loopback / docker0 等被 os.networkInterfaces 标记）
 *
 * 命名（"display IP"）：
 *  这个值仅作 banner / 二维码显示，HTTP server 实际监听仍然是
 *  --host（默认 0.0.0.0），让所有接口都能进。
 */

import { networkInterfaces } from 'node:os';

/**
 * 是否落在 RFC1918 私有段
 *
 * - 10.0.0.0/8
 * - 172.16.0.0/12  （172.16.0.0 — 172.31.255.255）
 * - 192.168.0.0/16
 *
 * 不在私有段内的：公网 / loopback / link-local。
 */
export function isPrivateIp(ip: string): boolean {
  // 仅处理 IPv4 字符串；含 ":" 视为 IPv6，统一返回 false
  if (ip.includes(':')) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((s) => Number(s));
  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a === undefined ||
    b === undefined
  ) {
    return false;
  }
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** 是否 link-local（169.254/16） */
export function isLinkLocal(ip: string): boolean {
  if (ip.includes(':')) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((s) => Number(s));
  return a === 169 && b === 254;
}

/**
 * 是否 Tailscale IP（CGNAT 100.64.0.0/10，即 100.64.0.0 – 100.127.255.255）
 *
 * Tailscale 默认给每个节点分配一个这个段内的 IPv4。检测它用来在 banner
 * 上单独打一个二维码并标注，方便用户区分 LAN / Tailscale 两个入口。
 */
export function isTailscaleIp(ip: string): boolean {
  if (ip.includes(':')) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((s) => Number(s));
  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a === undefined ||
    b === undefined
  ) {
    return false;
  }
  return a === 100 && b >= 64 && b <= 127;
}

/** 是否 IPv4 loopback（127.0.0.0/8） */
export function isLoopbackIp(ip: string): boolean {
  if (ip.includes(':')) {
    // ::1 也是 loopback；其它 v6 仍按 false（我们不返回 v6）
    return ip === '::1';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return Number(parts[0]) === 127;
}

/**
 * detectDisplayIp：选一个最适合写到 banner / 二维码上的 IPv4
 *
 * @param hostHint 用户显式指定的 --host；如果不是 0.0.0.0 / 空 / loopback
 *                 视作"用户已指定"直接返回（即便它不是私有段，也尊重用户）
 */
export function detectDisplayIp(hostHint?: string): string {
  if (
    hostHint &&
    hostHint !== '0.0.0.0' &&
    hostHint !== '::' &&
    !isLoopbackIp(hostHint)
  ) {
    return hostHint;
  }

  const ifaces = networkInterfaces();
  const privates: string[] = [];
  const linkLocals: string[] = [];

  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.internal) continue;
      if (info.family !== 'IPv4') continue;
      const ip = info.address;
      if (isPrivateIp(ip)) {
        privates.push(ip);
      } else if (isLinkLocal(ip)) {
        linkLocals.push(ip);
      }
    }
  }

  // 私有优先；link-local 兜底；最差 fallback 127.0.0.1
  return privates[0] ?? linkLocals[0] ?? '127.0.0.1';
}

/**
 * 是否「可分享」的 IPv6 地址
 *
 * 排除：
 *  - link-local（fe80::/10）：跨网段不可达，扫码后手机连不上
 *  - 临时地址 / 已弃用 / secondary（隐私扩展，几小时轮换一次）
 *  - 多播 / unspecified
 *
 * 保留：
 *  - GUA（2000::/3）：全球可达
 *  - ULA（fc00::/7）：私有但稳定
 */
export function isShareableIpv6(ip: string, info?: { scopeid?: number }): boolean {
  if (!ip.includes(':')) return false;
  const lower = ip.toLowerCase();
  // link-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return false;
  // loopback / unspecified / 多播
  if (lower === '::1' || lower === '::' || lower.startsWith('ff')) return false;
  // 带 scopeid 的（fe80%eth0 这类，已经被前面 fe8 拦截，但兜底）
  if (info?.scopeid !== undefined && info.scopeid !== 0) return false;
  return true;
}

/**
 * 把 displayIp + port + token 拼成扫码用的 URL
 *
 * 形如：http://192.168.1.10:3000/?token=<hex>
 *
 * 不带 token：http://192.168.1.10:3000/
 */
export function buildPublicUrl(
  displayIp: string,
  port: number,
  token?: string,
): string {
  const base = `http://${displayIp}:${port}/`;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
}
