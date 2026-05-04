/**
 * Token 持久化（localStorage）
 *
 * 用途：
 * - 用户输入 token 后存到 localStorage，刷新页面不丢
 * - WS 断线重连时优先用缓存 token 自动重认证
 * - 跨实例 Tab 切换时复用同一 token（阶段 6b 启用）
 *
 * 安全权衡：
 * - localStorage 同源访问，没有 HttpOnly 保护，理论上 XSS 可窃取
 * - 但本应用无第三方脚本注入面（局域网内自用 + CSP 严格），可接受
 * - 后端 cookie 仍是 HttpOnly+SameSite=Lax，是真正的会话凭证；
 *   localStorage 只是"重连方便"的副本
 */

const STORAGE_KEY = 'ocr.token';

/** 读取已保存的 token；不存在返回 null */
export function loadToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // 隐私模式可能禁用 localStorage
    return null;
  }
}

/** 保存 token（覆盖） */
export function saveToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // 配额满或隐私模式静默失败
  }
}

/** 清除已保存的 token */
export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 静默失败
  }
}
