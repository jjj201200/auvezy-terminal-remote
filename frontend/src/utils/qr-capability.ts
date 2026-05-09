/**
 * QR 扫码能力检测
 *
 * 在调用 getUserMedia 之前就静态判定走哪条路，避免"先尝试再 fallback"的试错体验。
 *
 * 三档：
 *  - 'live'    实时视频流扫码（getUserMedia + jsQR 帧解码）
 *              桌面、Android Chrome、iOS Safari (HTTPS) 都可用
 *  - 'capture' 拍照扫码（<input type=file capture=environment> + jsQR 静态图）
 *              iOS Safari LAN HTTP / 微信 / 其他不给 mediaDevices 的环境
 *  - 'none'    不支持网页内扫码（极端情况，比如某些桌面 UA 不给 capture）
 *              这时引导用户走系统相机 app 直接扫终端 banner 二维码
 *
 * 关键判定：iOS LAN HTTP 下 getUserMedia 会被 secure context 拒绝；我们在调
 * getUserMedia 前就识别这种情况（isSecureContext === false），直接走 capture
 * 路径而不让用户先点"扫码"再看到权限拒绝弹窗。
 */

export type QrMode = 'live' | 'capture' | 'none';

export interface QrCapability {
  mode: QrMode;
  /** 是否 iOS（含 iPad —— iPadOS 13+ 把 UA 改成 MacIntel + 触屏） */
  isIOS: boolean;
  /** 是否 secure context（HTTPS / localhost / file://） */
  isSecure: boolean;
  /** 调试 / UI 文案用：解释为什么走当前 mode */
  reason: string;
}

export function detectQrCapability(): QrCapability {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { mode: 'none', isIOS: false, isSecure: false, reason: 'no-navigator' };
  }

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ 默认 desktop UA：MacIntel 平台 + 多点触控
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isSecure = window.isSecureContext;

  const hasGetUserMedia =
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  // iOS Safari LAN HTTP：mediaDevices 可能存在但 getUserMedia 调用必拒
  // 不要赌——只要 isSecure=false 就直接走 capture 路径
  const canUseLiveCam = isSecure && hasGetUserMedia;

  // <input capture> 检测：所有移动浏览器都支持，桌面 Chrome / Safari / Firefox
  // 也都把它当 type=file 的别名（弹文件选择器而非相机），仍然能拍照后选图
  const canUseCapture = supportsCapture();

  if (canUseLiveCam) {
    return { mode: 'live', isIOS, isSecure, reason: 'getUserMedia available' };
  }
  if (canUseCapture) {
    return {
      mode: 'capture',
      isIOS,
      isSecure,
      reason: isIOS && !isSecure
        ? 'iOS LAN HTTP — getUserMedia blocked, using camera capture'
        : 'no getUserMedia, falling back to file capture',
    };
  }
  return {
    mode: 'none',
    isIOS,
    isSecure,
    reason: 'neither getUserMedia nor file capture supported',
  };
}

function supportsCapture(): boolean {
  try {
    const el = document.createElement('input');
    el.type = 'file';
    return 'capture' in el;
  } catch {
    return false;
  }
}
