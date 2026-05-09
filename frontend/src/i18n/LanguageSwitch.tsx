/**
 * 语言切换控件（用于设置面板「常规」tab）
 *
 * 风格：与 DisplaySettings 的 presetBtn 保持一致——单色按钮组，active 用 accent
 *
 * 受控模式（推荐）：外部传 value/onChange，按钮只更新草稿，不立即写 localStorage。
 * 非受控模式（向后兼容）：不传 value/onChange，回退到内部 useI18n() 直接 setLocale。
 */

import type { JSX } from 'react';
import clsx from 'clsx';
import { SUPPORTED_LOCALES, type Locale } from './messages.js';
import { useI18n } from './i18n-context.js';
import s from './LanguageSwitch.module.scss';

export interface LanguageSwitchProps {
  /** 受控值（不传 = 直接读 i18n context 的当前 locale） */
  value?: Locale;
  /** 受控 change（不传 = 直接调 setLocale，走老的"立即生效"路径） */
  onChange?: (next: Locale) => void;
}

export function LanguageSwitch({ value, onChange }: LanguageSwitchProps = {}): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const current = value ?? locale;
  const handlePick = (next: Locale): void => {
    if (onChange) onChange(next);
    else setLocale(next);
  };

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
            aria-checked={current === l.code}
            onClick={() => handlePick(l.code as Locale)}
            className={clsx(s.btn, current === l.code && s.btnActive)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </section>
  );
}
