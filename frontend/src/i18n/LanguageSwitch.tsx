/**
 * 语言切换控件（用于设置面板「常规」tab）
 *
 * 风格：与 DisplaySettings 的 presetBtn 保持一致——单色按钮组，active 用 accent
 */

import type { JSX } from 'react';
import clsx from 'clsx';
import { SUPPORTED_LOCALES, type Locale } from './messages.js';
import { useI18n } from './i18n-context.js';
import s from './LanguageSwitch.module.scss';

export function LanguageSwitch(): JSX.Element {
  const { locale, setLocale, t } = useI18n();

  return (
    <section className={s.root}>
      <header className={s.header}>
        <h3 className={s.title}>{t('general.languageTitle')}</h3>
        <p className={s.hint}>{t('general.languageHint')}</p>
      </header>
      <div className={s.row} role="radiogroup" aria-label={t('general.languageTitle')}>
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={locale === l.code}
            onClick={() => setLocale(l.code as Locale)}
            className={clsx(s.btn, locale === l.code && s.btnActive)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </section>
  );
}
