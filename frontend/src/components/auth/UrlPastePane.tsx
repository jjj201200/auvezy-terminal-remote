/**
 * UrlPastePane
 *
 * 共享 URL 输入面板：用户粘贴一个 http(s) URL，submit 后由调用方决定是否跳转。
 *
 * 用 form 而非纯 onClick：iOS 软键盘"前往"按钮会触发 form submit，
 * 用户体验更顺滑。校验规则由 parseAccessUrl 统一（仅接受 http/https，必须有 host）。
 *
 * 视觉：跟 AuthPage 既有设计完全一致（精致工业极客风 + accent green）。
 */

import { useEffect, useRef, useState, type JSX, type FormEvent } from 'react';
import { useT } from '../../i18n/i18n-context.js';
import s from './UrlPastePane.module.scss';

export interface UrlPastePaneProps {
  /** 标题 */
  title: string;
  /** 副标 / placeholder 提示 */
  subtitle: string;
  /** 提交按钮文案（一般是"前往" / "Go"） */
  submitLabel: string;
  /** 取消按钮文案 */
  cancelLabel: string;
  /**
   * 用户提交了 URL 时回调：
   *   返回 null = 合法，调用方负责跳转 / 关闭
   *   返回字符串 = 不合法，作为错误信息显示
   */
  onSubmit: (url: string) => string | null;
  /** 取消 */
  onCancel: () => void;
  /** placeholder 文案 */
  placeholder: string;
  /**
   * 隐藏 pane 内置的"取消 / 提交"按钮，把按钮交给容器（如 Sheet footer）。
   * 容器可通过 form 的 id 让外部 submit 按钮触发提交（见 formId）
   */
  hideActions?: boolean;
  /** form 元素的 id；外部 submit 按钮通过 `form={formId}` 关联触发 */
  formId?: string;
}

export function UrlPastePane(props: UrlPastePaneProps): JSX.Element {
  const t = useT();
  const {
    title,
    subtitle,
    submitLabel,
    cancelLabel,
    onSubmit,
    onCancel,
    placeholder,
    hideActions = false,
    formId,
  } = props;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const errMsg = onSubmit(value.trim());
    if (errMsg !== null) setError(errMsg);
  };

  return (
    <form id={formId} className={s.urlPane} onSubmit={handleSubmit}>
      <h1 className={s.title}>{title}</h1>
      <p className={s.subtitle}>{subtitle}</p>

      <span className={s.fieldLabel}>{t('authPage.urlLabel')}</span>
      <input
        ref={inputRef}
        type="url"
        className={s.input}
        placeholder={placeholder}
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

      {!hideActions && (
        <div className={s.urlActions}>
          <button type="button" className={s.ghostBtn} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={s.submit}
            disabled={value.trim().length === 0}
          >
            {submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}

/** 校验并规范化访问 URL：仅接受 http/https，必须有 host。其它返回 null */
export function parseAccessUrl(raw: string): string | null {
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
