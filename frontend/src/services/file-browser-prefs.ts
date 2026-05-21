/**
 * 文件浏览面板偏好(localStorage 持久化)。
 *
 * Why 独立模块:与 client-prefs.ts 的全局 dev/调试偏好命名空间隔离,
 * 避免文件浏览的局部 UI 状态污染全局 prefs。
 */

const KEY_SHOW_HIDDEN = 'atr.fileBrowser.showHidden';
const KEY_WRAP_LINES = 'atr.fileBrowser.wrapLines';

export interface FileBrowserPrefs {
  showHidden: boolean;
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
