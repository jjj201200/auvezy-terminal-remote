/**
 * useScanCtaLabel
 *
 * 入口按钮文案按当前环境能力自适应：
 *  - live    → 默认文案（"扫描二维码" / "Scan QR code"）
 *  - capture → "拍照扫码" / "Take a photo"（iOS LAN HTTP 等场景）
 *  - none    → 仍用默认文案；点击进 pane 后会显示 fallback 引导
 *
 * 让用户在按钮上就看到当前环境实际会发生的事，避免"点了才发现是拍照"的违和。
 */

import { useMemo } from 'react';
import { detectQrCapability } from '../utils/qr-capability.js';
import { useT } from '../i18n/i18n-context.js';

export interface UseScanCtaLabelOptions {
  /** 默认文案 i18n key（live 模式 / none 模式都用此） */
  defaultKey: 'authPage.scanCta' | 'instance.scanCta';
}

export function useScanCtaLabel(opts: UseScanCtaLabelOptions): string {
  const t = useT();
  const cap = useMemo(() => detectQrCapability(), []);
  return cap.mode === 'capture' ? t('authPage.scanCaptureCta') : t(opts.defaultKey);
}
