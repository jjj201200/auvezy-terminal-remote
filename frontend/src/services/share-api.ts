/**
 * share-api
 *
 * 拉取当前实例的可访问入口列表（不含 token）。
 * token 由 ShareSheet 从 localStorage 拿到再拼到 URL 上。
 */

import { apiGet, type ApiResult } from './api-client.js';

export interface ShareEndpoint {
  /** 主机地址（IPv6 不含方括号） */
  host: string;
  /** 端口 */
  port: number;
  /** 网络类型 */
  kind: 'lan' | 'tailscale' | 'loopback' | 'ipv6' | 'other';
  /** 网卡名 */
  interface?: string;
  /** 默认推荐项；列表里至多一个 */
  isDefault?: boolean;
}

export interface ShareEndpointsResponse {
  ok: true;
  endpoints: ShareEndpoint[];
}

export function fetchShareEndpoints(): Promise<ApiResult<ShareEndpointsResponse>> {
  return apiGet<ShareEndpointsResponse>('/api/share/endpoints');
}
