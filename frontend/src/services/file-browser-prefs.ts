/**
 * 文件浏览面板偏好(localStorage 持久化)
 *
 * 与 client-prefs.ts 分开维护:那个是 dev/调试类全局偏好(eruda /
 * consoleBridge),这里是 file-browser 局部 UI 状态(showHidden / wrapLines)。
 *
 * 命名空间:`atr.fileBrowser.*`,与全局 prefs 隔离。
 */

const KEY_SHOW_HIDDEN = 'atr.fileBrowser.showHidden';
const KEY_WRAP_LINES = 'atr.fileBrowser.wrapLines';

export interface FileBrowserPrefs {
  /** 显示 dotfile / 隐藏文件 */
  showHidden: boolean;
  /** 预览自动换行(`white-space: pre-wrap` vs `pre`) */
  wrapLines: boolean;
}

export function loadFileBrowserPrefs(): FileBrowserPrefs {
  if (typeof localStorage === 'undefined') {
    return { showHidden: false, wrapLines: false };
  }
  return {
    showHidden: localStorage.getItem(KEY_SHOW_HIDDEN) === '1',
    wrapLines: localStorage.getItem(KEY_WRAP_LINES) === '1',
  };
}

export function saveShowHidden(v: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (v) localStorage.setItem(KEY_SHOW_HIDDEN, '1');
  else localStorage.removeItem(KEY_SHOW_HIDDEN);
}

export function saveWrapLines(v: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (v) localStorage.setItem(KEY_WRAP_LINES, '1');
  else localStorage.removeItem(KEY_WRAP_LINES);
}
