/**
 * GeneralSettings
 *
 * "通用" tab：只放语言切换。其它"输入方式 / TUI 滚动 / 滚动行数"已挪到
 * "操作"tab 的 ControlsSection 里（按用户语义"操作运行时行为"归类）。
 *
 * 受控：locale 由 SettingsModal 草稿持有，"保存"按钮按下后才真正切换。
 */

import { useEffect, useState, type JSX } from 'react';
import clsx from 'clsx';
import {
  DEFAULT_RECENT_FILES_LIMIT,
  RECENT_FILES_LIMIT_DISABLED,
  RECENT_FILES_LIMIT_UNLIMITED,
} from 'auvezy-terminal-remote-shared';
import { LanguageSwitch } from '../../i18n/LanguageSwitch.js';
import { useT } from '../../i18n/i18n-context.js';
import type { Locale } from '../../i18n/messages.js';
import s from './GeneralSettings.module.scss';
import sdisp from './DisplaySettings.module.scss';

export interface GeneralSettingsProps {
  value: Locale;
  onChange: (next: Locale) => void;
  /** 最近文件记录上限(0=不记录、-1=不限、正数=条数);缺省 20 */
  recentFilesLimit?: number;
  onRecentFilesLimitChange?: (next: number) => void;
}

export function GeneralSettings({
  value,
  onChange,
  recentFilesLimit,
  onRecentFilesLimitChange,
}: GeneralSettingsProps): JSX.Element {
  const t = useT();
  const limit = recentFilesLimit ?? DEFAULT_RECENT_FILES_LIMIT;
  const setLimit = onRecentFilesLimitChange ?? (() => {});

  // 输入框本地草稿:失焦/回车时 clamp(-1..∞,截整)提交,避免逐键写 draft
  const [limitDraft, setLimitDraft] = useState<string>(String(limit));
  useEffect(() => {
    setLimitDraft(String(limit));
  }, [limit]);
  const commitLimit = (): void => {
    const n = Number.parseInt(limitDraft, 10);
    if (Number.isFinite(n)) setLimit(Math.max(-1, Math.trunc(n)));
    else setLimitDraft(String(limit)); // 非法 → 回退当前值
  };

  return (
    <div className={s.root}>
      <LanguageSwitch value={value} onChange={onChange} />

      {/* 最近文件上限:数字输入 + 快捷预设(不记录 / 20 / 不限) */}
      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('general.recentFilesTitle')}</h3>
          <p className={s.hint}>{t('general.recentFilesHint')}</p>
        </header>
        <div className={s.row}>
          <input
            type="number"
            inputMode="numeric"
            min={-1}
            className={sdisp.numInput}
            aria-label={t('general.recentFilesTitle')}
            value={limitDraft}
            onChange={(e) => setLimitDraft(e.target.value)}
            onBlur={commitLimit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLimit();
            }}
          />
          {(
            [
              { v: RECENT_FILES_LIMIT_DISABLED, label: t('general.recentFilesOff') },
              { v: DEFAULT_RECENT_FILES_LIMIT, label: '20' },
              { v: RECENT_FILES_LIMIT_UNLIMITED, label: t('general.recentFilesUnlimited') },
            ] as const
          ).map(({ v, label }) => (
            <button
              key={v}
              type="button"
              className={clsx(s.btn, limit === v && s.btnActive)}
              onClick={() => setLimit(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
