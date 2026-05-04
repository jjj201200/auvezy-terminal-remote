/**
 * useAuth
 *
 * 认证状态管理 hook。
 *
 * 职责：
 * - 读取本地缓存 token；有则尝试静默重认证（POST /api/auth 拿新 cookie）
 * - 提供 login(token) 函数：保存 token + POST /api/auth
 * - 提供 logout() 函数：清 token + 清 session cookie 后重置状态
 * - 暴露三态：'pending'（初次校验中）/ 'authenticated' / 'unauthenticated'
 *
 * 设计：
 * - mount 时若有缓存 token，乐观尝试静默 login——避免每次刷新都让用户重输
 * - 静默失败仅清 token，不显示错误（用户体验：直接看到 AuthPage 输入即可）
 * - 显式 login 失败返回错误对象，让 AuthPage 显示具体原因
 */

import { useEffect, useState, useCallback } from 'react';
import { authenticate } from '../services/api-client.js';
import { loadToken, saveToken, clearToken } from '../services/token-storage.js';

export type AuthStatus = 'pending' | 'authenticated' | 'unauthenticated';

export interface UseAuthReturn {
  status: AuthStatus;
  /** 用 token 登录；返回 null 表示成功，否则返回错误信息字符串 */
  login: (token: string) => Promise<string | null>;
  /** 注销并跳回认证页 */
  logout: () => void;
}

export function useAuth(): UseAuthReturn {
  const [status, setStatus] = useState<AuthStatus>('pending');

  // 静默重认证：mount 时若有缓存 token 直接试一次
  useEffect(() => {
    let cancelled = false;
    const cached = loadToken();
    if (!cached) {
      setStatus('unauthenticated');
      return;
    }

    void authenticate(cached).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setStatus('authenticated');
      } else {
        // 缓存 token 已失效（被改 / 后端重启）→ 清掉显式登录
        clearToken();
        setStatus('unauthenticated');
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (token: string): Promise<string | null> => {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return 'Token 不能为空';
    }
    const res = await authenticate(trimmed);
    if (res.ok) {
      saveToken(trimmed);
      setStatus('authenticated');
      return null;
    }
    // 仅显示用户友好的错误信息
    const msg = res.error?.message ?? `认证失败（HTTP ${res.status}）`;
    return msg;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setStatus('unauthenticated');
    // 注：服务端 session cookie 此时仍存在，但下次刷新没 token 也无所谓
    // 真正失效要等 sessionTtlMs 过期或服务重启
  }, []);

  return { status, login, logout };
}
