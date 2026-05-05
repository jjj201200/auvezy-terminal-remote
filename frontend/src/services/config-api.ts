/**
 * config-api：与 /api/config 通信
 *
 * 设计：
 *  - GET /api/config 返回 { ok: true, config: UserConfig }
 *  - PUT /api/config 同上
 *  - 服务层只做传输；默认值合并由 hooks/useUserConfig 在内存里再做一次
 *    （后端虽然也会兜底，但前端组件常需要立刻读到默认值，无法等网络回来）
 */

import type { UserConfig } from '@otr/shared';
import { apiGet, apiPut, type ApiResult } from './api-client.js';

interface ConfigEnvelope {
  ok: boolean;
  config: UserConfig;
}

/** 拉取当前配置 */
export async function fetchUserConfig(): Promise<ApiResult<ConfigEnvelope>> {
  return apiGet<ConfigEnvelope>('/api/config');
}

/** 整体替换写盘 */
export async function saveUserConfigRemote(
  value: UserConfig,
): Promise<ApiResult<ConfigEnvelope>> {
  return apiPut<ConfigEnvelope>('/api/config', value);
}
