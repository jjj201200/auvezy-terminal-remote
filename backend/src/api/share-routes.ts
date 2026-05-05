/**
 * Share 路由
 *
 * 暴露当前实例的所有可访问入口给前端 ShareSheet，让用户在 webapp 里选不同
 * 网络地址生成对应二维码（LAN / Tailscale / Loopback / IPv6 / VPN 等）。
 *
 * 端点：
 *   GET /api/share/endpoints  → 列出可用的 host:port 入口（不含 token）
 *
 * 设计：
 *  - 鉴权（auth cookie 必须）：本来就只有已登录用户才看 ShareSheet
 *  - **不返回 token**：token 由前端从自己的 storage 拼接，避免接口意外泄露
 *  - 列表来自 os.networkInterfaces()，与 banner 打印的入口列表口径一致
 *  - 每个入口标注 kind（lan/tailscale/loopback/ipv6/other）便于前端排序与展示
 */

import { Router, type Request, type Response } from 'express';
import { networkInterfaces } from 'node:os';
import type { AuthModule } from '../auth/auth-middleware.js';
import {
  isLinkLocal,
  isLoopbackIp,
  isPrivateIp,
  isShareableIpv6,
  isTailscaleIp,
} from '../utils/network.js';

/** 单个可访问入口 */
export interface ShareEndpoint {
  /** 主机地址（IPv6 地址不带方括号；前端拼 URL 时按需加） */
  host: string;
  /** 监听端口（与当前实例一致） */
  port: number;
  /** 网络类型分类，前端用来排序 / 显示 label */
  kind: 'lan' | 'tailscale' | 'loopback' | 'ipv6' | 'other';
  /** 网卡名（便于前端展示，如 'eth0'/'en0'） */
  interface?: string;
  /** 默认推荐项标记：列表里只有一个 isDefault=true */
  isDefault?: boolean;
}

export interface ShareRoutesOptions {
  authModule: AuthModule;
  /** 当前实例监听端口 */
  port: number;
  /** 当前实例展示用 IP（detectDisplayIp 的结果），用于决定 isDefault */
  displayIp: string;
}

export function createShareRoutes(opts: ShareRoutesOptions): Router {
  const router = Router();
  const { authModule, port, displayIp } = opts;

  router.get('/share/endpoints', authModule.requireAuth, (_req: Request, res: Response) => {
    const endpoints = collectEndpoints(port, displayIp);
    res.json({ ok: true, endpoints });
  });

  return router;
}

/**
 * 收集所有可访问入口。
 *
 * 排序：lan → tailscale → ipv6（含 IPv4 link-local 单独标 other）→ other → loopback。
 * 同 kind 内按 displayIp 优先（让 banner 里的"主入口"排第一并 isDefault=true）。
 */
function collectEndpoints(port: number, displayIp: string): ShareEndpoint[] {
  const out: ShareEndpoint[] = [];
  const ifaces = networkInterfaces();

  for (const [ifname, list] of Object.entries(ifaces)) {
    if (!list) continue;
    // 同一网卡内 IPv6 只保留第一个可分享的（避免临时地址 / deprecated 一堆刷屏）
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
      out.push({ host: ip, port, kind, interface: ifname });
    }
  }

  // 永远附带 loopback（即便 networkInterfaces 没列）
  if (!out.some((e) => e.kind === 'loopback')) {
    out.push({ host: '127.0.0.1', port, kind: 'loopback' });
  }

  // 排序优先级
  const order: Record<ShareEndpoint['kind'], number> = {
    lan: 0,
    tailscale: 1,
    other: 2,
    ipv6: 3,
    loopback: 4,
  };
  out.sort((a, b) => {
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
    // 同 kind 下：displayIp 优先
    if (a.host === displayIp) return -1;
    if (b.host === displayIp) return 1;
    return 0;
  });

  // 标记默认：与 displayIp 完全相同的；找不到则取第一个非 loopback
  let defaultIdx = out.findIndex((e) => e.host === displayIp);
  if (defaultIdx === -1) {
    defaultIdx = out.findIndex((e) => e.kind !== 'loopback');
  }
  if (defaultIdx === -1 && out.length > 0) defaultIdx = 0;
  if (defaultIdx >= 0) out[defaultIdx]!.isDefault = true;

  return out;
}

function classify(ip: string, family: string): ShareEndpoint['kind'] {
  if (isLoopbackIp(ip)) return 'loopback';
  if (family === 'IPv6') return 'ipv6';
  if (isTailscaleIp(ip)) return 'tailscale';
  if (isPrivateIp(ip)) return 'lan';
  if (isLinkLocal(ip)) return 'other'; // IPv4 link-local
  return 'other';
}
