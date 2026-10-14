/**
 * integrations-api:与 /api/integrations/codex/trust 通信
 *
 * Codex hook 一键授权:GET 查询状态(横幅显隐)、POST 写入授权
 * (backend 复现 codex 的 trusted_hash 写进 ~/.codex/config.toml)。
 */

import { apiGet, apiPost, type ApiResult } from './api-client.js';

/** GET/POST 共用响应体 */
export interface CodexTrustState {
  ok: true;
  status: 'trusted' | 'untrusted';
  matched: number;
  total: number;
  /** 实例镜像 hooks.json 是否已生成(未跑过 codex 时 false) */
  mirrorReady: boolean;
}

/** 查询某实例的 codex hook 授权状态 */
export function fetchCodexTrustStatus(instanceId: string): Promise<ApiResult<CodexTrustState>> {
  return apiGet<CodexTrustState>(
    `/api/integrations/codex/trust?instanceId=${encodeURIComponent(instanceId)}`,
  );
}

/** 一键授权:写入全部注入事件的 trusted_hash(重启 codex 后生效) */
export function grantCodexTrustRemote(instanceId: string): Promise<ApiResult<CodexTrustState>> {
  return apiPost<CodexTrustState>('/api/integrations/codex/trust', { instanceId });
}
