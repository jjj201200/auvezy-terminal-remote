/**
 * 三种复制能力档位：
 *  - 'clipboard'：navigator.clipboard.writeText + secure context → 100% 可靠
 *  - 'execCommand'：fallback 到 execCommand('copy')，**但 iOS 上著名的"返回 true
 *    但 silent fail"** —— 桌面浏览器（Chrome/Firefox/Edge）下可靠
 *  - 'selectOnly'：iOS + 非 secure context → execCommand 不可信，**根本不要假装复制**，
 *    改成 click = 选中文本，让用户长按系统拷贝
 *
 * 业界共识（WebKit bug 156529 / clipboard.js #587 / clipboard-polyfill #42）：
 *   iOS LAN HTTP 下没有可靠的程序化复制 API，唯一干净的 UX 是引导用户系统拷贝。
 */
export type CopyCapability = 'clipboard' | 'execCommand' | 'selectOnly';

export function detectCopyCapability(): CopyCapability {
  // 路径 1：现代 API + secure context（HTTPS / localhost）
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function' &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    return 'clipboard';
  }
  // 路径 3：iOS + 非 secure → execCommand 不可信，降级 select-only
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ 把 UA 报成 Mac，用 maxTouchPoints 兜底
      ((navigator as unknown as { platform?: string }).platform === 'MacIntel' &&
        navigator.maxTouchPoints > 1) ||
      // iOS 上的 Chrome 用 CriOS UA 标识
      /CriOS/.test(ua);
    if (isIOS) return 'selectOnly';
  }
  // 路径 2：桌面 / Android 非 secure → execCommand 可用（仍然不 100% 但远比 iOS 好）
  if (typeof document === 'undefined') return 'selectOnly';
  try {
    if (document.queryCommandSupported('copy')) return 'execCommand';
  } catch {
    /* 一些极端浏览器抛错 */
  }
  return 'selectOnly';
}

/** 旧 API 保留兼容：只问"能不能直接 copy"。selectOnly 算不可直接 copy */
export function canCopyToClipboard(): boolean {
  const cap = detectCopyCapability();
  return cap === 'clipboard' || cap === 'execCommand';
}

/**
 * 把指定 DOM 元素的文本内容选中（不复制）。
 * 用 Range + Selection API，iOS Safari / Chrome 都支持。
 * 用户接下来长按选区，系统弹"拷贝/查找/分享"菜单。
 */
export function selectElementText(el: Element): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

/**
 * 复制到剪贴板（带降级）
 *
 * 现代 navigator.clipboard.writeText 要求 secure context（HTTPS / localhost）。
 * 我们的 LAN HTTP（http://100.x.x.x:3000）在浏览器看是 insecure context，
 * clipboard API 直接 reject —— 移动端用户原地点没反馈就是这个原因。
 *
 * 降级路径：
 *  1. 优先 navigator.clipboard.writeText（HTTPS / localhost 走这里）
 *  2. fallback 用 document.execCommand('copy') + 隐藏 textarea（虽然
 *     deprecated 但所有浏览器仍支持，且不要求 secure context）
 *  3. 都失败 → 返回 false，调用方提示用户手动长按复制
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 路径 1：现代 API（secure context）
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 继续尝试 fallback */
    }
  }

  // 路径 2：execCommand fallback（LAN HTTP 必经路径）
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 必须挂到 body 才能 select；放屏幕外避免视觉干扰
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    // iOS Safari 要求 contentEditable 才能选中
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    // iOS 还要 setSelectionRange 才能真正选中
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
