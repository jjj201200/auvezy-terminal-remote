/**
 * api-client
 *
 * 包装 fetch 提供：
 * - JSON Content-Type 自动设置
 * - credentials: 'include' 让 cookie 跟随
 * - 401/403 时清除本地 token（让 useAuth 跳回认证页）
 * - 错误码统一为 ErrorPayload 形态
 *
 * 阶段 2 仅实现 authenticate() 一个端点；
 * 后续阶段会扩展 config / instances / push 等。
 */

import { ErrorCode, type ErrorPayload } from '@ocr/shared';
import { clearToken } from './token-storage.js';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: ErrorPayload;
}

/**
 * 用 token 调用 /api/auth 申请 session cookie
 *
 * @param token 用户输入或缓存中的 token
 * @returns true 表示已成功签发 session（cookie 已落到浏览器）
 */
export async function authenticate(token: string): Promise<ApiResult<{ ok: true }>> {
  return apiPost<{ ok: true }>('/api/auth', { token });
}

/**
 * 通用 POST 包装：内部用，也供后续扩展直接复用
 *
 * 401/403 时自动清 token——让 useAuth 监听到后跳回 AuthPage
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseResponse<T>(res);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : '网络请求失败',
      },
    };
  }
}

/** 通用 GET 包装 */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: 'GET',
      credentials: 'include',
    });
    return parseResponse<T>(res);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : '网络请求失败',
      },
    };
  }
}

/**
 * 解析 fetch Response 为 ApiResult；401/403 时自动清 token
 */
async function parseResponse<T>(res: Response): Promise<ApiResult<T>> {
  if (res.status === 401 || res.status === 403) {
    clearToken();
  }

  // 尝试解析 JSON；非 JSON 也不抛错
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 没 body 或非 JSON */
  }

  if (res.ok) {
    return { ok: true, status: res.status, data: body as T };
  }

  // 期望后端返回 { error: ErrorPayload } 形态
  const errorPayload =
    (body as { error?: ErrorPayload } | null)?.error ?? {
      code: ErrorCode.INTERNAL_ERROR,
      message: `HTTP ${res.status}`,
    };
  return { ok: false, status: res.status, error: errorPayload };
}
