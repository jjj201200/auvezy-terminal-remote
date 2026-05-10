/**
 * broker 入口候选列表（0.7.0 阶段 7+）
 *
 * 从 `os.networkInterfaces()` 与 broker 状态推导出"用户可能用来访问 broker 的
 * URL"列表，按推荐度排序：Tailscale > LAN > IPv6 > Loopback > 其它。
 *
 * 注意：worker 进程本身（这里跑的代码）listen 在 loopback；broker 进程 listen
 * 在 0.0.0.0。所以列举的"对外可达"地址，一律拼 broker 的 host:port，**不用**
 * worker 端口。
 *
 * design.md §11 中 share endpoints 的归属本应是 broker（broker 才知道自己
 * listen 在什么 IP）；阶段 3 留 TODO 把 share-routes 迁到 broker。本模块属于
 * 折衷：worker 启动 banner 阶段直接复用 networkInterfaces 推算（worker 跟
 * broker 同 host，结果一致），免得 worker 还要 fetch broker /api/share。
 */

import { networkInterfaces } from 'node:os';
import {
  isLinkLocal,
  isLoopbackIp,
  isPrivateIp,
  isShareableIpv6,
  isTailscaleIp,
} from '../utils/network.js';
import { isWsl } from '../utils/wsl-detect.js';

/** 单个候选入口 */
export interface EntryCandidate {
  /** 用户可粘贴 / 扫码的完整 URL（含 instanceId 路径） */
  url: string;
  /** 显示用 host（IPv6 不带方括号；前端拼 URL 时已加） */
  host: string;
  /** broker 端口 */
  port: number;
  /** 网络分类 */
  kind: 'tailscale' | 'lan' | 'ipv6' | 'loopback' | 'other';
  /** 网卡名（'eth0' 等；loopback 没有） */
  iface?: string;
  /** 是否推荐为默认（列表里只有 1 个 isDefault=true） */
  isDefault?: boolean;
}

export interface DiscoverEntriesOptions {
  /** broker 监听端口 */
  brokerPort: number;
  /** 当前实例 id（拼 `/i/<id>/` 用） */
  instanceId: string;
  /**
   * worker 进程 detectDisplayIp 选出的"主入口" IP。
   *
   * 当列表中存在该 host 的候选时，标记为 isDefault；否则降级用第一个非 loopback。
   */
  preferredHost?: string;
  /**
   * 可选 token：传入则每个 URL 末尾带 `?token=<encoded>`，让二维码扫码 / 链接
   * 粘贴即登录（前端 useAuth 识别后会自动从 URL 删除）。
   */
  token?: string;
}

/**
 * 列出当前所有可用入口
 *
 * 排序优先级（普通 Linux/macOS）：tailscale → lan → ipv6 → other → loopback
 *
 * **WSL2 例外**：mirrored 模式下宿主 Windows 的所有网卡(含 Tailscale)会"漏"进
 * WSL 的 networkInterfaces；但这些 IP 上的监听器实际跑在 Windows 端,WSL 里的
 * broker 不一定能被这条链路连到。实测:WSL Tailscale IP 多数情况手机连不通,
 * LAN IP(物理网卡 mirrored 过来的)反而能连。所以 WSL 下把 Tailscale 降到 lan
 * 之后,避免"默认入口扫了连不上"的体验差。
 *
 *   WSL 排序: lan → ipv6 → tailscale → other → loopback
 *
 * 同 kind 内：preferredHost 命中的排第一。
 */
export function discoverEntries(opts: DiscoverEntriesOptions): EntryCandidate[] {
  const { brokerPort, instanceId, preferredHost, token } = opts;
  const urlOpts = token ? { token } : {};
  const out: EntryCandidate[] = [];
  const ifaces = networkInterfaces();

  for (const [ifname, list] of Object.entries(ifaces)) {
    if (!list) continue;
    let ipv6KeptForIface = false;
    for (const info of list) {
      if (info.internal) continue;
      const ip = info.address;
      if (info.family === 'IPv6') {
        if (!isShareableIpv6(ip, { scopeid: info.scopeid })) continue;
        if (ipv6KeptForIface) continue;
        ipv6KeptForIface = true;
      }
      const kind = classify(ip, info.family);
      out.push({
        host: ip,
        port: brokerPort,
        kind,
        iface: ifname,
        url: buildEntryUrl(ip, brokerPort, instanceId, urlOpts),
      });
    }
  }

  // 永远附带 loopback（开发 / 同机访问）
  if (!out.some((e) => e.kind === 'loopback')) {
    out.push({
      host: '127.0.0.1',
      port: brokerPort,
      kind: 'loopback',
      url: buildEntryUrl('127.0.0.1', brokerPort, instanceId, urlOpts),
    });
  }

  // WSL 下 Tailscale 不可信(往往是宿主 Windows 的 IP),降到 lan 之后
  const wsl = isWsl();
  const order: Record<EntryCandidate['kind'], number> = wsl
    ? { lan: 0, ipv6: 1, tailscale: 2, other: 3, loopback: 4 }
    : { tailscale: 0, lan: 1, ipv6: 2, other: 3, loopback: 4 };
  out.sort((a, b) => {
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
    if (preferredHost) {
      if (a.host === preferredHost) return -1;
      if (b.host === preferredHost) return 1;
    }
    return 0;
  });

  // 标记 isDefault：preferredHost 命中 / 否则第一个非 loopback / 否则第一个
  let defaultIdx = preferredHost
    ? out.findIndex((e) => e.host === preferredHost)
    : -1;
  if (defaultIdx === -1) {
    defaultIdx = out.findIndex((e) => e.kind !== 'loopback');
  }
  if (defaultIdx === -1 && out.length > 0) defaultIdx = 0;
  if (defaultIdx >= 0) out[defaultIdx]!.isDefault = true;

  return out;
}

/** Short label for each entry kind (used in prompt + status output). */
export function kindLabel(kind: EntryCandidate['kind']): string {
  switch (kind) {
    case 'tailscale':
      return 'Tailscale';
    case 'lan':
      return 'LAN';
    case 'ipv6':
      return 'IPv6';
    case 'loopback':
      return 'loopback';
    case 'other':
      return 'other';
  }
}

// ──────────────── 内部 ────────────────

function classify(ip: string, family: string): EntryCandidate['kind'] {
  if (isLoopbackIp(ip)) return 'loopback';
  if (family === 'IPv6') return 'ipv6';
  if (isTailscaleIp(ip)) return 'tailscale';
  if (isPrivateIp(ip)) return 'lan';
  if (isLinkLocal(ip)) return 'other';
  return 'other';
}

/**
 * 拼 entry URL：处理 IPv6 加方括号；instanceId 拼到 path 上；可选 ?token= 带上
 *
 * **关于 token 是否带在 URL**：
 *  - 用户扫码 / 拷贝链接登录时极不便要求"再手输 token"——所以 banner 二维码
 *    与入口列表里的 URL 默认带上 `?token=`（与 0.6.x 一致）
 *  - 前端 useAuth hook mount 时识别 `?token=` 自动登录并立即从 URL 删除（见
 *    frontend/src/hooks/useAuth.ts），cookie 落地后 token 不再随 URL 流转
 *  - **截图 / 历史泄露**：与 0.6.x 同等风险；用户主动分享行为已知含 token
 *    （ADR-005 当时的"URL 不再携带 token"主要针对 PWA start_url 持久化场景，
 *    那条仍由 manifest scope `/` 单 PWA 模型保证）
 *
 * @example
 * buildEntryUrl('192.168.1.4', 3000, 'abc')                === 'http://192.168.1.4:3000/i/abc/'
 * buildEntryUrl('192.168.1.4', 3000, 'abc', { token: 'T' }) === 'http://192.168.1.4:3000/i/abc/?token=T'
 * buildEntryUrl('fe80::1', 3000, 'abc')                    === 'http://[fe80::1]:3000/i/abc/'
 */
export function buildEntryUrl(
  host: string,
  port: number,
  instanceId: string,
  opts: { token?: string } = {},
): string {
  const isIpv6 = host.includes(':') && !host.startsWith('[');
  const hostPart = isIpv6 ? `[${host}]` : host;
  const base = `http://${hostPart}:${port}/i/${instanceId}/`;
  if (!opts.token) return base;
  return `${base}?token=${encodeURIComponent(opts.token)}`;
}
