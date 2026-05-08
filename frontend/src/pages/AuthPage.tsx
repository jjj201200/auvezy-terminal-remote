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

import { useEffect, useState, type JSX, type FormEvent } from 'react';
import { IconArrowLeft, IconQrcode, IconLink } from '@tabler/icons-react';
import { useT } from '../i18n/i18n-context.js';
import { QrScanPane } from '../components/auth/QrScanPane.js';
import { UrlPastePane, parseAccessUrl } from '../components/auth/UrlPastePane.js';
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
  const [scanInvalid, setScanInvalid] = useState<string | null>(null);

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
              setScanInvalid(null);
              setMode('scan');
            }}
            onSwitchUrl={() => setMode('url')}
          />
        )}

        {mode === 'scan' && (
          <QrScanPane
            title={t('authPage.scanLabel')}
            subtitle={t('authPage.scanSubtitle')}
            cancelLabel={t('authPage.scanCancel')}
            onCancel={() => setMode('token')}
            onResult={(text) => {
              const parsed = parseAccessUrl(text);
              if (!parsed) {
                setScanInvalid(t('authPage.scanInvalidQr', { value: trim(text, 40) }));
                return false; // 继续扫
              }
              window.location.assign(parsed);
              return true;
            }}
            invalidNotice={scanInvalid}
          />
        )}

        {mode === 'url' && (
          <UrlPastePane
            title={t('authPage.urlLabel')}
            subtitle={t('authPage.urlPlaceholder')}
            placeholder={t('authPage.urlPlaceholder')}
            submitLabel={t('authPage.urlSubmit')}
            cancelLabel={t('authPage.scanCancel')}
            onCancel={() => setMode('token')}
            onSubmit={(url) => {
              const parsed = parseAccessUrl(url);
              if (!parsed) return t('authPage.urlInvalid');
              window.location.assign(parsed);
              return null;
            }}
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

// ────────────────── helpers ──────────────────

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
