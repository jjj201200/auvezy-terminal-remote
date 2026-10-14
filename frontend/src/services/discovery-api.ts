/**
 * discovery-api：与 /api/discovery 通信
 *
 * GET /api/discovery?instanceId=<id> 返回扫描到的 claude / codex
 * skills 与 MCP servers（见 shared/src/discovery.ts 协议注释）。
 */

import type { DiscoveryResponse } from 'auvezy-terminal-remote-shared';
import { apiGet, type ApiResult } from './api-client.js';

/**
 * 拉取某实例的 skill / MCP 发现结果
 *
 * @param instanceId 实例 id（backend 按其 cwd 扫描项目级目录）
 */
export function fetchDiscovery(instanceId: string): Promise<ApiResult<DiscoveryResponse>> {
  return apiGet<DiscoveryResponse>(`/api/discovery?instanceId=${encodeURIComponent(instanceId)}`);
}
