/**
 * QrScanPane
 *
 * 共享扫码面板：根据当前环境的能力检测，**只显示能用的入口**，避免试错。
 *
 * 三种模式（QrCapability.mode）：
 *  - 'live'    实时摄像头取景 + jsQR 帧解码 → 桌面 / Android / iOS HTTPS
 *  - 'capture' 拍照解码（<input capture> + jsQR 静态图） → iOS LAN HTTP / 微信
 *  - 'none'    引导用户用系统相机直接扫终端 banner 二维码
 *
 * 视觉跟 AuthPage 既有设计一致（精致工业极客风 + accent green）。
 */

import { useEffect, useMemo, useRef, useState, type JSX, type ChangeEvent } from 'react';
import { IconCamera, IconRefresh } from '@tabler/icons-react';
import { useT } from '../../i18n/i18n-context.js';
import { useQrScanner } from '../../hooks/useQrScanner.js';
import { detectQrCapability, type QrCapability } from '../../utils/qr-capability.js';
import { decodeQrFromFile } from '../../utils/decode-qr-image.js';
import s from './QrScanPane.module.scss';

export interface QrScanPaneProps {
  title: string;
  subtitle: string;
  cancelLabel: string;
  /**
   * 扫到合法内容时回调：
   *   返回 true / undefined = 已处理（live 模式停扫）
   *   返回 false = 内容不合法，live 模式继续扫；capture 模式让用户重拍
   */
  onResult: (text: string) => boolean | void;
  onCancel: () => void;
  /** 调用方判定为非法时显示的一行提示 */
  invalidNotice?: string | null;
  /**
   * 隐藏 pane 内置的取消按钮（容器接管，如 Sheet footer）
   */
  hideActions?: boolean;
}

export function QrScanPane(props: QrScanPaneProps): JSX.Element {
  // useMemo 让 capability 在组件生命周期内稳定（detectQrCapability 没副作用，
  // 但每次重新算会让下面 useQrScanner 的 enabled 抖动）
  const capability = useMemo<QrCapability>(detectQrCapability, []);

  if (capability.mode === 'live') {
    return <LivePane {...props} />;
  }
  if (capability.mode === 'capture') {
    return <CapturePane {...props} />;
  }
  return <FallbackPane {...props} />;
}

// ────────────────── live：实时摄像头扫码（原行为） ──────────────────

function LivePane(props: QrScanPaneProps): JSX.Element {
  const t = useT();
  const { title, subtitle, cancelLabel, onResult, onCancel, invalidNotice, hideActions = false } = props;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { videoRef, status, retry } = useQrScanner({
    enabled: true,
    onResult,
  });

  useEffect(() => {
    if (status === 'permission-denied') setErrorMsg(t('authPage.scanPermissionDenied'));
    else if (status === 'unsupported') setErrorMsg(t('authPage.scanUnsupported'));
    else if (status === 'error') setErrorMsg(t('authPage.scanError'));
    else setErrorMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const showVideo = status === 'scanning' || status === 'initializing';

  return (
    <div className={s.scanPane}>
      <h1 className={s.title}>{title}</h1>
      <p className={s.subtitle}>{subtitle}</p>

      <div className={s.scanFrame}>
        {showVideo ? (
          <>
            <video ref={videoRef} className={s.scanVideo} playsInline muted />
            <div className={s.scanReticle} aria-hidden="true">
              <span className={s.reticleCorner} data-corner="tl" />
              <span className={s.reticleCorner} data-corner="tr" />
              <span className={s.reticleCorner} data-corner="bl" />
              <span className={s.reticleCorner} data-corner="br" />
              <span className={s.reticleScan} />
            </div>
            {status === 'initializing' && (
              <p className={s.scanStatus}>{t('authPage.scanInitializing')}</p>
            )}
          </>
        ) : (
          <div className={s.scanFallback}>
            <p className={s.error}>{errorMsg ?? t('authPage.scanError')}</p>
            {(status === 'permission-denied' || status === 'error') && (
              <button type="button" className={s.iconBtn} onClick={retry}>
                <IconRefresh size={14} stroke={1.5} />
                <span>retry</span>
              </button>
            )}
          </div>
        )}
      </div>

      {invalidNotice && <p className={s.error}>{invalidNotice}</p>}

      {!hideActions && (
        <button type="button" className={s.ghostBtn} onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
    </div>
  );
}

// ────────────────── capture：拍照后用 jsQR 解静态图 ──────────────────

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'decoding' }
  | { kind: 'no-code' /* 用户拍的照片识别失败，提示重拍 */ };

function CapturePane(props: QrScanPaneProps): JSX.Element {
  const t = useT();
  const { title, subtitle, cancelLabel, onResult, onCancel, invalidNotice, hideActions = false } = props;
  const [state, setState] = useState<CaptureState>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const triggerCapture = (): void => fileRef.current?.click();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    // 清空 input value，让用户能重选同一张照片（File 名字相同时 onChange 不会再触发）
    e.target.value = '';
    if (!file) return;

    setState({ kind: 'decoding' });
    const decoded = await decodeQrFromFile(file).catch(() => null);
    if (!decoded) {
      setState({ kind: 'no-code' });
      return;
    }

    const handled = onResult(decoded);
    if (handled === false) {
      // 调用方说"内容不合法"——让用户重拍（invalidNotice 由调用方设置后由父组件传下来）
      setState({ kind: 'no-code' });
      return;
    }
    // handled = true / undefined：默认调用方会 location.assign 跳走 —— 不需要再处理状态
  };

  return (
    <div className={s.scanPane}>
      <h1 className={s.title}>{title}</h1>
      <p className={s.subtitle}>{subtitle}</p>

      <div className={s.captureBox}>
        <p className={s.captureHint}>{t('authPage.scanCaptureHint')}</p>

        {state.kind === 'decoding' && (
          <p className={s.captureStatus}>{t('authPage.scanCaptureDecoding')}</p>
        )}
        {state.kind === 'no-code' && (
          <p className={s.error}>{t('authPage.scanCaptureNoCode')}</p>
        )}
        {invalidNotice && <p className={s.error}>{invalidNotice}</p>}

        <button
          type="button"
          className={s.captureBtn}
          onClick={triggerCapture}
          disabled={state.kind === 'decoding'}
        >
          <IconCamera size={16} stroke={1.5} />
          <span>
            {state.kind === 'no-code'
              ? t('authPage.scanCaptureRetry')
              : t('authPage.scanCaptureCta')}
          </span>
        </button>

        {/* 隐藏的 input：accept=image/* + capture=environment 让 iOS 直接调起后置摄像头 */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // capture 属性必须以非空字符串形式存在；'environment' 优先后置摄像头
          // React 类型对 capture 的 union 比较挑剔，用 attribute 而不是 prop 传
          {...{ capture: 'environment' }}
          onChange={handleFile}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      </div>

      {!hideActions && (
        <button type="button" className={s.ghostBtn} onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
    </div>
  );
}

// ────────────────── none：完全不支持，引导用系统相机 ──────────────────

function FallbackPane(props: QrScanPaneProps): JSX.Element {
  const t = useT();
  const { cancelLabel, onCancel, hideActions = false } = props;
  return (
    <div className={s.scanPane}>
      <h1 className={s.title}>{t('authPage.scanFallbackTitle')}</h1>
      <p className={s.subtitle}>{t('authPage.scanFallbackHint')}</p>
      {!hideActions && (
        <button type="button" className={s.ghostBtn} onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
    </div>
  );
}
