/**
 * ShareSheet
 *
 * 分享当前实例：可选入口（LAN/Tailscale/Loopback/IPv6 等）+ URL（含 token）+
 * 二维码 + 一键复制。
 *
 * 入口列表来自 GET /api/share/endpoints（鉴权）；token 来自前端 localStorage，
 * 在前端拼成完整 URL。后端不返回 token，避免接口意外泄露。
 *
 * URL 形态：http://<host>:<port>/?token=<hex>（IPv6 自动加方括号）
 *
 * 安全：token 默认隐藏 ••••；用户主动点"显示"才以明文展示在输入框
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  IconEye,
  IconEyeOff,
  IconCopy,
  IconCheck,
  IconRefresh,
} from '@tabler/icons-react';
import QRCode from 'qrcode';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { loadToken } from '../../services/token-storage.js';
import { fetchShareEndpoints, type ShareEndpoint } from '../../services/share-api.js';
import s from './ShareSheet.module.scss';

export interface ShareSheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

/** kind → i18n key 映射，运行时通过 t() 解码（避免编译期就锁死中文/英文） */
const KIND_KEY: Record<ShareEndpoint['kind'], string> = {
  lan: 'share.kindLan',
  tailscale: 'share.kindTailscale',
  loopback: 'share.kindLoopback',
  ipv6: 'share.kindIpv6',
  other: 'share.kindOther',
};

export function ShareSheet({ open, onOpenChange }: ShareSheetProps): JSX.Element {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [endpoints, setEndpoints] = useState<ShareEndpoint[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // 拉入口列表：open 切到 true 时触发
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchShareEndpoints().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.data) {
        const list = res.data.endpoints;
        setEndpoints(list);
        // 默认选 isDefault=true 项；没有则取第一个
        const defaultIdx = list.findIndex((e) => e.isDefault);
        setSelectedIdx(defaultIdx !== -1 ? defaultIdx : list.length > 0 ? 0 : -1);
      } else {
        setLoadError(res.error?.message ?? t('share.loadError'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  // 当前选中的入口
  const selected: ShareEndpoint | null =
    selectedIdx >= 0 && selectedIdx < endpoints.length ? endpoints[selectedIdx]! : null;

  // dev 模式提示：webapp 跑在 vite dev (5173)，分享链接是真后端端口（3000）
  // 让开发者一眼看明白「为什么端口不一样」，不至于以为是 bug
  const devPortHint = useMemo(() => {
    if (!selected) return null;
    const winPort = Number(window.location.port || (window.location.protocol === 'https:' ? 443 : 80));
    if (winPort === selected.port) return null;
    return { winPort, realPort: selected.port };
  }, [selected]);

  // 完整 URL（host + token），IPv6 自动加方括号
  const fullUrl = useMemo(() => {
    if (!selected) return '';
    const token = loadToken();
    const hostPart = selected.kind === 'ipv6' ? `[${selected.host}]` : selected.host;
    const base = `http://${hostPart}:${selected.port}/`;
    if (!token) return base;
    return `${base}?token=${encodeURIComponent(token)}`;
  }, [selected]);

  // 隐藏态展示用：把 token 替换成 •••••• 但保留 URL 形态
  const displayUrl = useMemo(() => {
    if (revealed) return fullUrl;
    return fullUrl.replace(/token=[^&]*/, 'token=••••••••');
  }, [fullUrl, revealed]);

  /**
   * 触发 QR 渲染。Sheet 是 Radix Portal 异步挂载，第一次 open=true 时 canvas DOM
   * 可能还没出现，普通 useEffect 拿到的 ref 会是 null —— 改用 ref callback 让
   * canvas 一挂上立即触发渲染，避开"先 effect 后 mount"的时序问题。
   */
  const renderQr = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasElRef.current = canvas;
      if (!canvas || !fullUrl) return;
      void QRCode.toCanvas(canvas, fullUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 200,
        color: {
          dark: '#b6f09c',
          light: '#0e120e',
        },
      }).catch(() => {
        // 渲染失败：QR 区域留空，不影响 URL 复制功能
      });
    },
    [fullUrl],
  );

  // 切换入口 / fullUrl 变化时重渲 QR
  useEffect(() => {
    if (open && canvasElRef.current && fullUrl) {
      renderQr(canvasElRef.current);
    }
  }, [open, fullUrl, renderQr]);

  // open 切换时重置临时态
  useEffect(() => {
    if (!open) {
      setRevealed(false);
      setCopied(false);
    }
  }, [open]);

  const handleCopy = async (): Promise<void> => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 老浏览器 / 非 secure context：不支持 Clipboard API
    }
  };

  const handleRefresh = (): void => {
    // 重拉一次入口（用户可能切了 VPN / 接了新网卡）
    setLoading(true);
    setLoadError(null);
    void fetchShareEndpoints().then((res) => {
      setLoading(false);
      if (res.ok && res.data) {
        const list = res.data.endpoints;
        setEndpoints(list);
        const defaultIdx = list.findIndex((e) => e.isDefault);
        setSelectedIdx(defaultIdx !== -1 ? defaultIdx : list.length > 0 ? 0 : -1);
      } else {
        setLoadError(res.error?.message ?? t('share.loadError'));
      }
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title')}
      id="share-sheet"
      className={s.sheet}
    >
      <div className={s.body}>
        <p className={s.intro}>{t('share.intro')}</p>

        {devPortHint && (
          <div className={s.devHint}>
            {t('share.devHint', { win: devPortHint.winPort, real: devPortHint.realPort })}
          </div>
        )}

        {/* 入口选择 */}
        <div className={s.endpointSection}>
          <div className={s.sectionLabelRow}>
            <span className={s.sectionLabel}>{t('share.sectionLabel')}</span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className={s.refreshBtn}
              title={t('share.refreshTooltip')}
              aria-label={t('share.refreshTooltip')}
            >
              <IconRefresh size={14} stroke={1.5} />
            </button>
          </div>
          {loading && <div className={s.loading}>{t('share.loading')}</div>}
          {loadError && <div className={s.error}>{loadError}</div>}
          {!loading && !loadError && endpoints.length > 0 && (
            <div className={s.endpointList} role="radiogroup" aria-label={t('share.endpointListAria')}>
              {endpoints.map((ep, idx) => {
                const active = idx === selectedIdx;
                return (
                  <button
                    key={`${ep.host}-${ep.port}-${idx}`}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedIdx(idx)}
                    className={`${s.endpointItem} ${active ? s.endpointItemActive : ''}`}
                  >
                    <span className={s.endpointKind}>{t(KIND_KEY[ep.kind])}</span>
                    <span className={s.endpointHost}>
                      {ep.host}:{ep.port}
                    </span>
                    {ep.interface && (
                      <span className={s.endpointIface}>{ep.interface}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* QR */}
        <div className={s.qrWrap}>
          {fullUrl ? (
            <canvas ref={renderQr} className={s.qr} />
          ) : (
            <div className={s.qrEmpty}>{t('share.qrEmpty')}</div>
          )}
        </div>

        {/* URL + 操作 */}
        <div className={s.urlRow}>
          <input
            type="text"
            readOnly
            value={displayUrl}
            placeholder={t('share.qrEmpty')}
            className={s.urlInput}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('share.urlAriaLabel')}
          />
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => setRevealed((v) => !v)}
            disabled={!fullUrl}
            title={revealed ? t('share.hideTooltip') : t('share.revealTooltip')}
            aria-label={revealed ? t('share.hideTooltip') : t('share.revealTooltip')}
          >
            {revealed ? (
              <IconEyeOff size={16} stroke={1.5} />
            ) : (
              <IconEye size={16} stroke={1.5} />
            )}
          </button>
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => void handleCopy()}
            disabled={!fullUrl}
            title={t('share.copyTooltip')}
            aria-label={t('share.copyAriaLabel')}
          >
            {copied ? (
              <IconCheck size={16} stroke={1.5} />
            ) : (
              <IconCopy size={16} stroke={1.5} />
            )}
          </button>
        </div>

        <p className={s.hint} style={{ whiteSpace: 'pre-line' }}>{t('share.hint')}</p>
      </div>
    </Sheet>
  );
}
