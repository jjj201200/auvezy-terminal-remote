/**
 * workdir-policy-api
 *
 * 拉当前 backend 的"生效白名单"。前端拿到后用于 cwd base 选择 + 提交前校验。
 *
 * 注：只有 allow 暴露给前端 —— deny 是安全防线，由后端拒绝时返回 reason 即可。
 */

import { apiGet, type ApiResult } from './api-client.js';

export interface WorkdirPolicyResponse {
  ok: true;
  /** 生效白名单（picomatch glob 列表）；空数组 = 用户没设白名单 */
  allow: string[];
}

export function fetchWorkdirPolicy(): Promise<ApiResult<WorkdirPolicyResponse>> {
  return apiGet<WorkdirPolicyResponse>('/api/workdir-policy');
}
