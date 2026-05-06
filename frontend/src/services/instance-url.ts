/**
 * 构造跨实例切换的 URL
 *
 * 跨端口 = 跨 origin，目标 origin 的 localStorage 没有 token —— AuthPage 会弹出。
 * 把当前 token 拼到 URL，新 origin 加载时由 useAuth 自动拿 token 登录 + 写入新
 * origin 的 localStorage（参见 hooks/useAuth.ts 内 URL ?token= 处理）。
 *
 * 共享 token 前提：所有实例读同一个 ~/.auvezy/terminal-remote/config.json
 * （由 backend 共享 token 设计保证），所以 token 值在所有实例间通用。
 *
 * Host 选取：registry 里记的 host 是 backend 自己挑的 displayIp（一般是 LAN 私网），
 * 但用户可能从 Tailscale / 其它接口访问。同一台机的 backend 通常 bind 在 0.0.0.0，
 * 所以"用当前页面 hostname + 目标 port"在多数情况下是用户能 reach 的路径；
 * 若当前 hostname 是 loopback（用户本机直接打开），才回退到 registry 的 host。
 */

import { loadToken } from './token-storage.js';

export function buildInstanceUrl(host: string, port: number): string {
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const isLocalhost =
    currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost === '::1' || currentHost === '';
  const targetHost = isLocalhost ? host : currentHost;
  // IPv6 字面量必须方括号包裹（除非已带）
  const hostPart =
    targetHost.includes(':') && !targetHost.startsWith('[') ? `[${targetHost}]` : targetHost;
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
  const token = loadToken();
  return `${proto}://${hostPart}:${port}/${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
