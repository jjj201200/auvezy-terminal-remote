/**
 * AuthPage
 *
 * 认证页：三种登录入口（同一张卡片内分层呈现，不引入 modal）。
 *
 * 入口：
 *  1. token 输入（主路径，PC 用户 / URL 已带 token 的场景）
 *  2. 扫码（手机最快路径 —— 摄像头预览覆盖在卡片内，不开新层）
 *  3. 粘贴链接（fallback —— 用户从聊天/邮件里拷到完整 URL）
 *
 * 设计动机：
 *  - 现有视觉系统是「精致工业级极客风」单点聚焦感很强，加 tab/segmented 会破坏这种感觉
 *  - 扫码 / 链接两个入口走"内联展开"风格：点击次入口按钮 → 卡片内容部分替换为对应面板
 *    取消后 → 回到默认 token 输入态。整个过程在同一张卡片内完成
 *
 * 状态机：mode = 'token' | 'scan' | 'url'
 */

import { useEffect, useRef, useState, type JSX, type FormEvent } from 'react';
import { IconArrowLeft, IconQrcode, IconLink, IconRefresh } from '@tabler/icons-react';
import { useT } from '../i18n/i18n-context.js';
import { useQrScanner } from '../hooks/useQrScanner.js';
import s from './AuthPage.module.scss';

export interface AuthPageProps {
  onLogin: (token: string) => Promise<string | null>;
}

type Mode = 'token' | 'scan' | 'url';

export function AuthPage({ onLogin }: AuthPageProps): JSX.Element {
  const t = useT();
  const [mode, setMode] = useState<Mode>('token');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  // URL ?token=xxx 自动填充（不自动提交）
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      if (t) setToken(t);
    } catch {
      /* 忽略 */
    }
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const msg = await onLogin(token);
    setSubmitting(false);
    if (msg !== null) setError(msg);
  };

  // 是否从其它实例 tab 跳过来 —— 同主机不同端口 referrer
  const referrerUrl = (() => {
    try {
      if (!document.referrer) return null;
      const ref = new URL(document.referrer);
      if (ref.hostname !== window.location.hostname) return null;
      if (ref.port === window.location.port) return null;
      return ref.toString();
    } catch {
      return null;
    }
  })();

  return (
    <main id="auth-page" className={s.root}>
      <div className={s.card} data-mode={mode}>
        <div className={s.brand}>
          <span className={s.brandDot} />
          <span className={s.brandName}>auvezy/terminal-remote</span>
        </div>

        {referrerUrl && mode === 'token' && (
          <button
            type="button"
            className={s.backBtn}
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else window.location.assign(referrerUrl);
            }}
          >
            <IconArrowLeft size={14} stroke={1.5} />
            {t('authPage.back')}
          </button>
        )}

        {mode === 'token' && (
          <TokenPane
            token={token}
            setToken={setToken}
            error={error}
            submitting={submitting}
            onSubmit={handleSubmit}
            onSwitchScan={() => {
              setScanError(null);
              setMode('scan');
            }}
            onSwitchUrl={() => {
              setUrlError(null);
              setMode('url');
            }}
          />
        )}

        {mode === 'scan' && (
          <ScanPane
            onCancel={() => setMode('token')}
            onError={(msg) => {
              setScanError(msg);
            }}
            scanError={scanError}
          />
        )}

        {mode === 'url' && (
          <UrlPane
            value={urlValue}
            setValue={setUrlValue}
            error={urlError}
            setError={setUrlError}
            onCancel={() => setMode('token')}
          />
        )}

        {mode === 'token' && (
          <p className={s.hint}>{t('authPage.hint')}</p>
        )}
      </div>
    </main>
  );
}

// ────────────────── token 主面板 ──────────────────

interface TokenPaneProps {
  token: string;
  setToken: (v: string) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onSwitchScan: () => void;
  onSwitchUrl: () => void;
}

function TokenPane(props: TokenPaneProps): JSX.Element {
  const t = useT();
  const { token, setToken, error, submitting, onSubmit, onSwitchScan, onSwitchUrl } = props;
  return (
    <>
      <h1 className={s.title}>{t('authPage.title')}</h1>
      <p className={s.subtitle}>{t('authPage.subtitle')}</p>

      <form className={s.form} onSubmit={onSubmit}>
        <span className={s.fieldLabel}>{t('authPage.fieldLabel')}</span>
        <input
          type="password"
          className={s.input}
          placeholder={t('authPage.placeholder')}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={submitting}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
        />

        {error && <p className={s.error}>{error}</p>}

        <button
          type="submit"
          disabled={submitting || token.trim().length === 0}
          className={s.submit}
        >
          {submitting ? t('authPage.submitting') : t('authPage.submit')}
        </button>
      </form>

      <div className={s.divider} />

      <div className={s.altActions}>
        <button type="button" className={s.altBtn} onClick={onSwitchScan}>
          <IconQrcode size={16} stroke={1.5} />
          <span>{t('authPage.scanCta')}</span>
        </button>
        <button type="button" className={s.altBtn} onClick={onSwitchUrl}>
          <IconLink size={16} stroke={1.5} />
          <span>{t('authPage.urlCta')}</span>
        </button>
      </div>
    </>
  );
}

// ────────────────── 扫码面板 ──────────────────

interface ScanPaneProps {
  onCancel: () => void;
  onError: (msg: string) => void;
  scanError: string | null;
}

function ScanPane(props: ScanPaneProps): JSX.Element {
  const t = useT();
  const { onCancel, onError, scanError } = props;
  const [invalid, setInvalid] = useState<string | null>(null);

  const { videoRef, status, retry } = useQrScanner({
    enabled: true,
    onResult: (text) => {
      // 收到二维码：必须是合法 http(s) URL，并且和当前 origin 同主机或允许跨主机？
      // 设计：扫码内容应该是其它 backend 实例的访问 URL，允许跨 origin 跳转
      const parsed = parseAccessUrl(text);
      if (!parsed) {
        setInvalid(text);
        return false; // 继续扫
      }
      window.location.assign(parsed);
      return true;
    },
  });

  // 把 hook 状态映射成本地 i18n 错误文案
  useEffect(() => {
    if (status === 'permission-denied') onError(t('authPage.scanPermissionDenied'));
    else if (status === 'unsupported') onError(t('authPage.scanUnsupported'));
    else if (status === 'error') onError(t('authPage.scanError'));
    else if (status === 'scanning' || status === 'initializing') onError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const showVideo = status === 'scanning' || status === 'initializing';

  return (
    <div className={s.scanPane}>
      <h1 className={s.title}>{t('authPage.scanLabel')}</h1>
      <p className={s.subtitle}>{t('authPage.scanSubtitle')}</p>

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
            <p className={s.error}>{scanError ?? t('authPage.scanError')}</p>
            {(status === 'permission-denied' || status === 'error') && (
              <button type="button" className={s.iconBtn} onClick={retry}>
                <IconRefresh size={14} stroke={1.5} />
                <span>retry</span>
              </button>
            )}
          </div>
        )}
      </div>

      {invalid && (
        <p className={s.error}>
          {t('authPage.scanInvalidQr', { value: trim(invalid, 40) })}
        </p>
      )}

      <button type="button" className={s.ghostBtn} onClick={onCancel}>
        {t('authPage.scanCancel')}
      </button>
    </div>
  );
}

// ────────────────── URL 输入面板 ──────────────────

interface UrlPaneProps {
  value: string;
  setValue: (v: string) => void;
  error: string | null;
  setError: (v: string | null) => void;
  onCancel: () => void;
}

function UrlPane(props: UrlPaneProps): JSX.Element {
  const t = useT();
  const { value, setValue, error, setError, onCancel } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入 url 模式自动 focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const parsed = parseAccessUrl(value.trim());
    if (!parsed) {
      setError(t('authPage.urlInvalid'));
      return;
    }
    window.location.assign(parsed);
  };

  return (
    <form className={s.urlPane} onSubmit={handleSubmit}>
      <h1 className={s.title}>{t('authPage.urlLabel')}</h1>
      <p className={s.subtitle}>{t('authPage.urlPlaceholder')}</p>

      <span className={s.fieldLabel}>URL</span>
      <input
        ref={inputRef}
        type="url"
        className={s.input}
        placeholder={t('authPage.urlPlaceholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="url"
      />

      {error && <p className={s.error}>{error}</p>}

      <div className={s.urlActions}>
        <button type="button" className={s.ghostBtn} onClick={onCancel}>
          {t('authPage.scanCancel')}
        </button>
        <button
          type="submit"
          className={s.submit}
          disabled={value.trim().length === 0}
        >
          {t('authPage.urlSubmit')}
        </button>
      </div>
    </form>
  );
}

// ────────────────── helpers ──────────────────

/** 校验并规范化访问 URL：仅接受 http / https，必须有 host。其它返回 null */
function parseAccessUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.host) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
