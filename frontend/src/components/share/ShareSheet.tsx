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
import { loadToken } from '../../services/token-storage.js';
import { fetchShareEndpoints, type ShareEndpoint } from '../../services/share-api.js';
import s from './ShareSheet.module.scss';

export interface ShareSheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

const KIND_LABEL: Record<ShareEndpoint['kind'], string> = {
  lan: 'LAN',
  tailscale: 'Tailscale',
  loopback: 'Loopback',
  ipv6: 'IPv6',
  other: '其它',
};

export function ShareSheet({ open, onOpenChange }: ShareSheetProps): JSX.Element {
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
        setLoadError(res.error?.message ?? '加载入口失败');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
        setLoadError(res.error?.message ?? '加载入口失败');
      }
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="分享此实例"
      id="share-sheet"
      className={s.sheet}
    >
      <div className={s.body}>
        <p className={s.intro}>
          扫码或复制链接让其它设备直接登录此实例
        </p>

        {devPortHint && (
          <div className={s.devHint}>
            当前页面在 dev 代理 :{devPortHint.winPort}，分享链接指向真后端 :{devPortHint.realPort}
          </div>
        )}

        {/* 入口选择 */}
        <div className={s.endpointSection}>
          <div className={s.sectionLabelRow}>
            <span className={s.sectionLabel}>选择入口</span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className={s.refreshBtn}
              title="刷新入口列表"
              aria-label="刷新入口列表"
            >
              <IconRefresh size={14} stroke={1.5} />
            </button>
          </div>
          {loading && <div className={s.loading}>加载入口…</div>}
          {loadError && <div className={s.error}>{loadError}</div>}
          {!loading && !loadError && endpoints.length > 0 && (
            <div className={s.endpointList} role="radiogroup" aria-label="可用入口">
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
                    <span className={s.endpointKind}>{KIND_LABEL[ep.kind]}</span>
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
            <div className={s.qrEmpty}>选择入口后生成二维码</div>
          )}
        </div>

        {/* URL + 操作 */}
        <div className={s.urlRow}>
          <input
            type="text"
            readOnly
            value={displayUrl}
            placeholder="选择入口后显示链接"
            className={s.urlInput}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="实例链接"
          />
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => setRevealed((v) => !v)}
            disabled={!fullUrl}
            title={revealed ? '隐藏 token' : '显示 token'}
            aria-label={revealed ? '隐藏 token' : '显示 token'}
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
            title="复制完整链接（含 token）"
            aria-label="复制完整链接"
          >
            {copied ? (
              <IconCheck size={16} stroke={1.5} />
            ) : (
              <IconCopy size={16} stroke={1.5} />
            )}
          </button>
        </div>

        <p className={s.hint}>
          token 自带于链接中，扫码 / 打开后无需再次输入。
          <br />
          切换入口可针对不同网络（局域网 / Tailscale / 本机回环）生成对应二维码。
        </p>
      </div>
    </Sheet>
  );
}
