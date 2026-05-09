/**
 * 客户端偏好（仅本设备生效，不上报后端 UserConfig）
 *
 * 集中管理 localStorage key + 读 / 写。让设置面板可以走"草稿 → 保存"统一流程，
 * 避免每个设置组件直接 setItem 造成"实时生效"绕过保存按钮。
 */

export const ERUDA_KEY = 'atr.devtools.eruda';
export const CONSOLE_BRIDGE_KEY = 'atr.devtools.consoleBridge';

export interface ClientPrefs {
  /** Eruda 移动端 devtools（刷新生效） */
  eruda: boolean;
  /** 控制台桥接到 backend logger（刷新生效） */
  consoleBridge: boolean;
}

export function loadClientPrefs(): ClientPrefs {
  if (typeof localStorage === 'undefined') {
    return { eruda: false, consoleBridge: false };
  }
  return {
    eruda: localStorage.getItem(ERUDA_KEY) === '1',
    consoleBridge: localStorage.getItem(CONSOLE_BRIDGE_KEY) === '1',
  };
}

export function saveClientPrefs(prefs: ClientPrefs): void {
  if (typeof localStorage === 'undefined') return;
  if (prefs.eruda) localStorage.setItem(ERUDA_KEY, '1');
  else localStorage.removeItem(ERUDA_KEY);
  if (prefs.consoleBridge) localStorage.setItem(CONSOLE_BRIDGE_KEY, '1');
  else localStorage.removeItem(CONSOLE_BRIDGE_KEY);
}
