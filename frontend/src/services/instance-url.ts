/**
 * 构造跨实例切换的 URL
 *
 * 跨端口 = 跨 origin，目标 origin 的 localStorage 没有 token —— AuthPage 会弹出。
 * 把当前 token 拼到 URL，新 origin 加载时由 useAuth 自动拿 token 登录 + 写入新
 * origin 的 localStorage（参见 hooks/useAuth.ts 内 URL ?token= 处理）。
 *
 * 共享 token 前提：所有实例读同一个 ~/.auvezy/terminal-remote/config.json
 * （由 backend 共享 token 设计保证），所以 token 值在所有实例间通用。
 */

import { loadToken } from './token-storage.js';

export function buildInstanceUrl(host: string, port: number): string {
  // IPv6 字面量必须方括号包裹（除非已带）
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const token = loadToken();
  return `http://${hostPart}:${port}/${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
