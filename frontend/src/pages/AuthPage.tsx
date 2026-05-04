/**
 * AuthPage
 *
 * 认证页面：用户输入 token 后提交，成功跳到 ConsolePage。
 *
 * 设计：
 * - 受控 input + 显式 submit 按钮
 * - URL 参数 ?token=xxx（来自二维码扫码）自动填充输入框
 *   注意：自动填充但不自动提交——避免恶意链接绕过用户确认
 * - 错误信息红色显示在按钮上方
 */

import { useEffect, useState, type JSX, type FormEvent } from 'react';

export interface AuthPageProps {
  /** 提交 token；返回 null 成功，否则返回错误信息 */
  onLogin: (token: string) => Promise<string | null>;
}

export function AuthPage({ onLogin }: AuthPageProps): JSX.Element {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 从 URL 自动填充（扫码场景）：?token=xxx
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      if (t) setToken(t);
    } catch {
      // 解析失败忽略
    }
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const msg = await onLogin(token);
    setSubmitting(false);
    if (msg !== null) {
      setError(msg);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Open-Claude-Remote</h1>
        <p className="auth-card__subtitle">输入服务端启动时显示的 Token</p>

        <form className="auth-card__form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="auth-card__input"
            placeholder="64 位 Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />

          {error && <p className="auth-card__error">{error}</p>}

          <button
            type="submit"
            className="auth-card__submit"
            disabled={submitting || token.trim().length === 0}
          >
            {submitting ? '验证中…' : '登录'}
          </button>
        </form>

        <p className="auth-card__hint">
          扫描终端二维码或手动输入 Token；登录后 Token 会保存在本设备
        </p>
      </div>
    </main>
  );
}
