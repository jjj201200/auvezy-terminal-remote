/**
 * QrScanPane
 *
 * 共享扫码面板组件：相机取景器 + 工业风扫描线 + 三态错误回退（权限/不支持/通用）。
 *
 * 由 AuthPage 与 CreateInstanceModal 共用 —— 都需要"识别一个 http(s) URL 然后跳转"
 * 的同款交互。视觉跟 AuthPage 既有设计完全一致（accent green + reticle 工业风）。
 *
 * 调用方负责：
 *  - 扫到的内容是否 valid（onResult 回调由调用方决定 valid → window.location.assign）
 *  - 取消按钮点击行为（onCancel 回调）
 */

import { useEffect, useState, type JSX } from 'react';
import { IconRefresh } from '@tabler/icons-react';
import { useT } from '../../i18n/i18n-context.js';
import { useQrScanner } from '../../hooks/useQrScanner.js';
import s from './QrScanPane.module.scss';

export interface QrScanPaneProps {
  /** 标题（"对准终端二维码" / "对准其它实例的二维码"） */
  title: string;
  /** 副标（描述对什么扫） */
  subtitle: string;
  /** 取消按钮文案 */
  cancelLabel: string;
  /**
   * 扫到合法二维码内容时回调：
   *   返回 true（或 undefined）= 已处理，hook 自动停止扫描
   *   返回 false = 内容不合法，继续扫
   */
  onResult: (text: string) => boolean | void;
  /** 用户点取消 */
  onCancel: () => void;
  /**
   * 当扫到了二维码但内容被调用方判为非法时，调用方可以 setState 让此组件
   * 显示一行提示。null 表示无提示
   */
  invalidNotice?: string | null;
}

export function QrScanPane(props: QrScanPaneProps): JSX.Element {
  const t = useT();
  const { title, subtitle, cancelLabel, onResult, onCancel, invalidNotice } = props;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { videoRef, status, retry } = useQrScanner({
    enabled: true,
    onResult,
  });

  // 把 hook 状态映射成本地 i18n 错误文案
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

      <button type="button" className={s.ghostBtn} onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  );
}
