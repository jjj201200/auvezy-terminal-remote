/**
 * instance-api：与 /api/instances 通信
 *
 * 端点：
 *   GET  /api/instances                 → 列出实例
 *   POST /api/instances { cwd, name? }  → 派生 headless 实例
 */

import type { InstanceListItem } from 'auvezy-terminal-remote-shared';
import { apiGet, apiPost, apiDelete, type ApiResult } from './api-client.js';

interface ListEnvelope {
  ok: boolean;
  instances: InstanceListItem[];
}

interface CreateEnvelope {
  ok: boolean;
  /**
   * 0.7.0 v2 起 broker 异步 spawn —— 返回 202 + status:'pending'。
   * 真正"实例就绪"由 SSE /api/instances/stream 推送（list 里出现 instanceId）。
   * 旧字段 pid/cwd/name 仍返回，让前端可以拿 expectedPid 做 pending 命中判定。
   */
  status?: 'pending';
  instance: {
    instanceId: string;
    pid: number;
    cwd: string;
    name: string;
  };
}

interface DeleteEnvelope {
  ok: boolean;
  outcome: 'sigterm' | 'sigkill' | 'gone' | 'failed' | 'already-dead';
}

export async function fetchInstances(): Promise<ApiResult<ListEnvelope>> {
  return apiGet<ListEnvelope>('/api/instances');
}

export async function createInstance(input: {
  cwd: string;
  name?: string;
}): Promise<ApiResult<CreateEnvelope>> {
  return apiPost<CreateEnvelope>('/api/instances', input);
}

export async function deleteInstance(instanceId: string): Promise<ApiResult<DeleteEnvelope>> {
  return apiDelete<DeleteEnvelope>(`/api/instances/${encodeURIComponent(instanceId)}`);
}
