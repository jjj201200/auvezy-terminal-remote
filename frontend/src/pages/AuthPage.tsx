/**
 * AuthPage
 *
 * 认证页面：用户输入 token 后提交，成功跳到 ConsolePage。
 *
 * 设计：
 * - 居中卡片、深色面板、顶部 accent 渐变线
 * - 品牌标识：绿光呼吸点 + 大写小标题
 * - URL ?token=xxx 自动填充输入框（不自动提交）
 */

import { useEffect, useState, type JSX, type FormEvent } from 'react';
import { useT } from '../i18n/i18n-context.js';
import s from './AuthPage.module.scss';

export interface AuthPageProps {
  onLogin: (token: string) => Promise<string | null>;
}

export function AuthPage({ onLogin }: AuthPageProps): JSX.Element {
  const t = useT();
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      if (t) setToken(t);
    } catch {
      /* 解析失败忽略 */
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

  return (
    <main id="auth-page" className={s.root}>
      <div className={s.card}>
        <div className={s.brand}>
          <span className={s.brandDot} />
          <span className={s.brandName}>open-terminal-remote</span>
        </div>

        <h1 className={s.title}>{t('authPage.title')}</h1>
        <p className={s.subtitle}>{t('authPage.subtitle')}</p>

        <form className={s.form} onSubmit={handleSubmit}>
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
        <p className={s.hint}>{t('authPage.hint')}</p>
      </div>
    </main>
  );
}
