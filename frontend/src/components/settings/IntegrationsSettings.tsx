/**
 * IntegrationsSettings
 *
 * 设置面板的"集成"tab。两段式结构:
 *  1. 顶层(适用所有模块):总开关 + 识别策略
 *  2. 模块列表:每个具体模块一行(名称 + 状态 + 详细设置按钮)。点击按钮推一层
 *     子 modal 编辑该模块的细节(走 ModalStack)
 *
 * 这样未来加 gemini-cli / aider / codex 时只需在模块列表里多一行,顶层不变。
 *
 * 编辑模型与其它 settings panel 一致:value/onChange,父 SettingsModal 接管 dirty
 * 检测与保存。子 modal 编辑结果直接写回这里的 value,不另起一套保存路径。
 */

import { type JSX } from 'react';
import clsx from 'clsx';
import {
  DEFAULT_INTEGRATIONS,
  type IntegrationsPrefs,
} from 'auvezy-terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import { BoolToggleRow } from './BoolToggleRow.js';
import {
  useClaudeCodeSettingsPresenter,
  useObsidianSettingsPresenter,
} from '../ui/modal-stack/presenters.js';
import type { ObsidianSubToggles } from './ObsidianSettingsModal.js';
import s from './GeneralSettings.module.scss';

export interface IntegrationsSettingsProps {
  value: IntegrationsPrefs | undefined;
  onChange: (next: IntegrationsPrefs) => void;
}

const FORCE_OPTIONS: ReadonlyArray<'auto' | 'claude-code' | 'none'> = [
  'auto',
  'claude-code',
  'none',
];

export function IntegrationsSettings({ value, onChange }: IntegrationsSettingsProps): JSX.Element {
  const t = useT();
  const presentClaudeCode = useClaudeCodeSettingsPresenter();

  const enabled = value?.enabled ?? DEFAULT_INTEGRATIONS.enabled;
  const forceModule = value?.forceModule ?? DEFAULT_INTEGRATIONS.forceModule;

  // 逐字段 fallback;value 的 events 是 Partial,defaults 是完整结构
  const userCcEvents = value?.perModule?.['claude-code']?.events;
  const ccDefaults = DEFAULT_INTEGRATIONS.perModule['claude-code'].events;
  const ccEvents = {
    approvals: userCcEvents?.approvals ?? ccDefaults.approvals,
    toolProgress: userCcEvents?.toolProgress ?? ccDefaults.toolProgress,
    turnLifecycle: userCcEvents?.turnLifecycle ?? ccDefaults.turnLifecycle,
    sessionLifecycle: userCcEvents?.sessionLifecycle ?? ccDefaults.sessionLifecycle,
    userPrompts: userCcEvents?.userPrompts ?? ccDefaults.userPrompts,
  };

  const setEnabled = (next: boolean): void => {
    onChange({ ...value, enabled: next });
  };
  const setForceModule = (next: 'auto' | 'claude-code' | 'none'): void => {
    onChange({ ...value, forceModule: next });
  };
  const setCcEvents = (next: typeof ccEvents): void => {
    onChange({
      ...value,
      perModule: {
        ...value?.perModule,
        'claude-code': {
          ...value?.perModule?.['claude-code'],
          events: next,
        },
      },
    });
  };

  // 当前会被激活的模块判定:总开关 + 识别策略派生
  const ccActive = enabled && (forceModule === 'auto' || forceModule === 'claude-code');

  const openClaudeCodeSettings = (): void => {
    presentClaudeCode({
      value: ccEvents,
      onChange: setCcEvents,
      active: ccActive,
    });
  };

  // ─── 渲染集成(Markdown / Obsidian)— 与 forceModule 单选无关,各自独立 enabled ───
  const presentObsidian = useObsidianSettingsPresenter();

  const mdDefaults = DEFAULT_INTEGRATIONS.rendering.markdown;
  const renderingMdEnabled = value?.rendering?.markdown?.enabled ?? mdDefaults.enabled;

  const userObsidian = value?.rendering?.obsidian;
  const obsDefaults = DEFAULT_INTEGRATIONS.rendering.obsidian;
  const obsidianEnabled = userObsidian?.enabled ?? obsDefaults.enabled;
  /** Obsidian 强依赖 Markdown(ADR-002):effective = md && obs */
  const obsidianActive = renderingMdEnabled && obsidianEnabled;
  const obsidianSubToggles: ObsidianSubToggles = {
    frontmatter: userObsidian?.frontmatter ?? obsDefaults.frontmatter,
    wikilink: userObsidian?.wikilink ?? obsDefaults.wikilink,
    embed: userObsidian?.embed ?? obsDefaults.embed,
    callout: userObsidian?.callout ?? obsDefaults.callout,
    inlineSyntax: userObsidian?.inlineSyntax ?? obsDefaults.inlineSyntax,
  };

  const setRenderingMd = (next: boolean): void => {
    onChange({
      ...value,
      rendering: {
        ...value?.rendering,
        markdown: { enabled: next },
      },
    });
  };
  const setObsidianEnabled = (next: boolean): void => {
    onChange({
      ...value,
      rendering: {
        ...value?.rendering,
        obsidian: { ...value?.rendering?.obsidian, enabled: next },
      },
    });
  };
  const setObsidianSubToggles = (next: ObsidianSubToggles): void => {
    onChange({
      ...value,
      rendering: {
        ...value?.rendering,
        obsidian: { ...value?.rendering?.obsidian, ...next },
      },
    });
  };

  const openObsidianSettings = (): void => {
    presentObsidian({
      enabled: obsidianEnabled,
      onEnabledChange: setObsidianEnabled,
      value: obsidianSubToggles,
      onChange: setObsidianSubToggles,
      markdownEnabled: renderingMdEnabled,
    });
  };

  return (
    <div className={s.root}>
      {/* ──── 顶层:总开关 ──── */}
      <BoolToggleRow
        title={t('integrations.enabledTitle')}
        hint={t('integrations.enabledHint')}
        value={enabled}
        onChange={setEnabled}
      />

      {/* ──── 顶层:识别策略 ──── */}
      <section className={s.section} aria-disabled={!enabled || undefined}>
        <header className={s.header}>
          <h3 className={s.title}>{t('integrations.forceModuleTitle')}</h3>
          <p className={s.hint}>{t('integrations.forceModuleHint')}</p>
        </header>
        <div
          className={s.row}
          role="radiogroup"
          aria-label={t('integrations.forceModuleTitle')}
          style={!enabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
        >
          {FORCE_OPTIONS.map((opt) => {
            const active = forceModule === opt;
            const label =
              opt === 'auto'
                ? t('integrations.forceModuleAuto')
                : opt === 'none'
                  ? t('integrations.forceModuleNone')
                  : 'Claude Code';
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!enabled}
                onClick={() => setForceModule(opt)}
                className={clsx(s.btn, active && s.btnActive)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ──── 运行时集成分组 ──── */}
      <header className={s.groupHeader}>
        <h2 className={s.groupTitle}>{t('obsidian.sectionRuntime')}</h2>
      </header>

      {/* ClaudeCode */}
      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>
            {t('integrations.sectionClaudeCode')}
            <span
              className={s.titleStatus}
              data-tone={ccActive ? 'info' : 'muted'}
            >
              {ccActive ? t('integrations.activeBadge') : t('integrations.inactiveBadge')}
            </span>
          </h3>
          <p className={s.hint}>{t('integrations.claudeCodeDescription')}</p>
        </header>
        <div className={s.row}>
          <button type="button" onClick={openClaudeCodeSettings} className={s.btn}>
            {t('integrations.openDetails')}
          </button>
        </div>
      </section>

      {/* ──── 渲染集成分组 ──── */}
      <header className={s.groupHeader}>
        <h2 className={s.groupTitle}>{t('obsidian.sectionRendering')}</h2>
      </header>

      {/* Markdown */}
      <BoolToggleRow
        title={t('obsidian.markdownTitle')}
        hint={t('obsidian.markdownDescription')}
        value={renderingMdEnabled}
        onChange={setRenderingMd}
      />

      {/* Obsidian — 强依赖 Markdown;形态与 ClaudeCode 对称:section header 显示
          标题 + 状态徽章 + 描述,row 里只放「详细」按钮。enabled 开关在子 modal 顶部。 */}
      <section className={s.section} aria-disabled={!renderingMdEnabled || undefined}>
        <header className={s.header}>
          <h3 className={s.title}>
            {t('obsidian.obsidianTitle')}
            <span
              className={s.titleStatus}
              data-tone={obsidianActive ? 'info' : 'muted'}
            >
              {obsidianActive ? t('integrations.activeBadge') : t('integrations.inactiveBadge')}
            </span>
          </h3>
          <p className={s.hint}>
            {t('obsidian.obsidianDescription')}
            {!renderingMdEnabled && (
              <>
                {' '}
                <span className={s.requirement}>{t('obsidian.obsidianRequiresMarkdown')}</span>
              </>
            )}
          </p>
        </header>
        <div className={s.row}>
          <button
            type="button"
            onClick={openObsidianSettings}
            className={s.btn}
            disabled={!renderingMdEnabled}
          >
            {t('integrations.openDetails')}
          </button>
        </div>
      </section>
    </div>
  );
}
