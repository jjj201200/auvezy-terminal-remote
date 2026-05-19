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
import { updateManifestWithToken } from '../pwa/manifest-token.js';

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

  // 静默重认证：mount 时优先用 URL ?token=（如二维码/链接登录场景），
  // 没有 URL token 才回退到 localStorage 缓存。
  //
  // 为什么 URL token 必须优先：
  //  - 用户从二维码进来时 URL 上挂的就是当前 backend 的新 token
  //  - 如果先用 localStorage 旧 token（可能是别的实例 / 重启前的 token），会：
  //    (1) 后端打 warn 噪音 (2) 清掉旧 token 跳 AuthPage 让用户重输（多余的一步）
  //  - URL 优先后：新 token 一次成功，旧 token 自然被覆盖；后端不再有 401 噪音
  //
  // 拿到 URL token 即认证：成功后写缓存并清 URL（避免历史/书签里裸露 token）
  useEffect(() => {
    let cancelled = false;

    const urlToken = readUrlToken();
    if (urlToken) {
      void authenticate(urlToken).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          saveToken(urlToken);
          // 把 token 写入 <link rel=manifest> 的 href,让"添加到主屏幕"创建出
          // 的 PWA 启动快捷方式带 token —— iOS WebKit 把 PWA 视作独立沙箱,
          // 不与浏览器共享 localStorage,启动时只能靠 start_url 上的 token 走
          // useAuth URL token 路径首认证
          updateManifestWithToken(urlToken);
          // 不再 stripTokenFromUrl：手机端某些「扫码器内置浏览器」/隐私会话不持久化
          // localStorage，抹掉 URL token 后刷新就回到 AuthPage。LAN 自用场景下保留
          // URL token 的便利性 > 浏览历史隐私风险（用户主动通过二维码分享，已知会含 token）
          setStatus('authenticated');
        } else {
          // URL 上的 token 也无效（用户复制错了 / 后端重启了）→ 跳认证页让用户重输
          // 注意：不动 localStorage 缓存，让用户至少能看到上次缓存的 token
          setStatus('unauthenticated');
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const cached = loadToken();
    if (!cached) {
      setStatus('unauthenticated');
      return;
    }
    void authenticate(cached).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        updateManifestWithToken(cached);
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
      updateManifestWithToken(trimmed);
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

/** 从 window.location.search 读取 token query 参数；不存在返回 null */
function readUrlToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (t && t.trim().length > 0) return t.trim();
  } catch {
    /* 解析失败：忽略 */
  }
  return null;
}

