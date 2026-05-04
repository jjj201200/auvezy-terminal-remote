/**
 * instance-api：与 /api/instances 通信
 *
 * 端点：
 *   GET  /api/instances                 → 列出实例
 *   POST /api/instances { cwd, name? }  → 派生 headless 实例
 */

import type { InstanceListItem } from '@ocr/shared';
import { apiGet, apiPost, type ApiResult } from './api-client.js';

interface ListEnvelope {
  ok: boolean;
  instances: InstanceListItem[];
}

interface CreateEnvelope {
  ok: boolean;
  instance: { pid: number; cwd: string; name: string };
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
