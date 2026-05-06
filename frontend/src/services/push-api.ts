/**
 * push-api：与 /api/push 通信
 */

import { ErrorCode, type ErrorPayload } from '@auvezy/terminal-remote-shared';
import { apiGet, apiPost, type ApiResult } from './api-client.js';

interface VapidEnvelope {
  ok: boolean;
  publicKey: string;
}

export async function fetchVapidPublicKey(): Promise<ApiResult<VapidEnvelope>> {
  return apiGet<VapidEnvelope>('/api/push/vapid');
}

export interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function postSubscription(
  body: SubscribeBody,
): Promise<ApiResult<{ ok: boolean }>> {
  return apiPost<{ ok: boolean }>('/api/push/subscriptions', body);
}

export async function deleteSubscription(
  endpoint: string,
): Promise<ApiResult<{ ok: boolean; removed: boolean }>> {
  // DELETE 我们用 POST + body 实现以避开浏览器对 DELETE body 的限制
  // 不行——backend 路由用 DELETE。fetch 直接发 DELETE 是允许的
  try {
    const res = await fetch('/api/push/subscriptions', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; removed: boolean };
      return { ok: true, status: res.status, data };
    }
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      /* */
    }
    return {
      ok: false,
      status: res.status,
      error:
        (errBody as { error?: ErrorPayload } | null)?.error ?? {
          code: ErrorCode.INTERNAL_ERROR,
          message: `HTTP ${res.status}`,
        },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : '网络错误',
      },
    };
  }
}
