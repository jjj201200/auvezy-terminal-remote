/**
 * IntegrationsSettings
 *
 * 设置面板的"集成"tab。控制 UserConfig.integrations 的总开关 / 识别策略 /
 * 各模块事件细分。当前内置的模块只有 ClaudeCode。
 *
 * 编辑模型:value/onChange 形态(与其它 settings panel 一致),由 SettingsModal
 * 注入草稿 + apply 按钮统一保存。
 */

import { type JSX } from 'react';
import {
  DEFAULT_INTEGRATIONS,
  type IntegrationsPrefs,
} from 'auvezy-terminal-remote-shared';
import { useT } from '../../i18n/i18n-context.js';
import s from './DisplaySettings.module.scss';

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
  const setEvent = (
    key: keyof typeof DEFAULT_INTEGRATIONS.perModule['claude-code']['events'],
    next: boolean,
  ): void => {
    onChange({
      ...value,
      perModule: {
        ...value?.perModule,
        'claude-code': {
          ...value?.perModule?.['claude-code'],
          events: { ...ccEvents, [key]: next },
        },
      },
    });
  };

  // 模块视为"激活"的条件:总开关开 + (forceModule='auto' 或 forceModule='claude-code')
  // 注:这里只是 UI 显示,实际 detect 在 backend spawn 时跑;这里只反映"会不会被激活"
  const ccActive = enabled && (forceModule === 'auto' || forceModule === 'claude-code');

  return (
    <div className={s.root}>
      {/* ──── 总开关 ──── */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('integrations.sectionGlobal')}</h3>
        </header>

        <div className={s.row}>
          <h4 style={{ flex: 1, margin: 0, fontSize: 'var(--fs-sm, 13px)' }}>
            {t('integrations.enabledTitle')}
          </h4>
          <ToggleButton
            on={enabled}
            onClick={() => setEnabled(!enabled)}
            ariaLabel={t('integrations.enabledTitle')}
          />
        </div>
        <p className={s.sectionHint}>{t('integrations.enabledHint')}</p>

        <h4 style={{ marginTop: 'var(--sp-4, 12px)', marginBottom: 0, fontSize: 'var(--fs-sm, 13px)' }}>
          {t('integrations.forceModuleTitle')}
        </h4>
        <p className={s.sectionHint}>{t('integrations.forceModuleHint')}</p>
        <div className={s.row}>
          {FORCE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={[s.presetBtn, forceModule === opt && s.presetBtnActive]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setForceModule(opt)}
              disabled={!enabled}
            >
              {opt === 'auto'
                ? t('integrations.forceModuleAuto')
                : opt === 'none'
                  ? t('integrations.forceModuleNone')
                  : 'Claude Code'}
            </button>
          ))}
        </div>
      </section>

      {/* ──── ClaudeCode 模块 ──── */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>
            {t('integrations.sectionClaudeCode')}
            <span
              style={{
                marginLeft: 8,
                fontSize: 'var(--fs-2xs, 10px)',
                fontWeight: 400,
                color: ccActive ? 'var(--ok, #3fb950)' : 'var(--fg-low, #6e7681)',
              }}
            >
              {ccActive ? t('integrations.activeBadge') : t('integrations.inactiveBadge')}
            </span>
          </h3>
          <p className={s.sectionHint}>{t('integrations.claudeCodeDescription')}</p>
        </header>

        <h4 style={{ marginTop: 0, marginBottom: 0, fontSize: 'var(--fs-sm, 13px)' }}>
          {t('integrations.eventsTitle')}
        </h4>
        <p className={s.sectionHint}>{t('integrations.eventsHint')}</p>

        <EventToggleRow
          title={t('integrations.eventApprovals')}
          hint={t('integrations.eventApprovalsHint')}
          on={ccEvents.approvals}
          disabled={!enabled || !ccActive}
          onToggle={(v) => setEvent('approvals', v)}
        />
        <EventToggleRow
          title={t('integrations.eventToolProgress')}
          hint={t('integrations.eventToolProgressHint')}
          on={ccEvents.toolProgress}
          disabled={!enabled || !ccActive}
          onToggle={(v) => setEvent('toolProgress', v)}
        />
        <EventToggleRow
          title={t('integrations.eventTurnLifecycle')}
          hint={t('integrations.eventTurnLifecycleHint')}
          on={ccEvents.turnLifecycle}
          disabled={!enabled || !ccActive}
          onToggle={(v) => setEvent('turnLifecycle', v)}
        />
        <EventToggleRow
          title={t('integrations.eventSessionLifecycle')}
          hint={t('integrations.eventSessionLifecycleHint')}
          on={ccEvents.sessionLifecycle}
          disabled={!enabled || !ccActive}
          onToggle={(v) => setEvent('sessionLifecycle', v)}
        />
        <EventToggleRow
          title={t('integrations.eventUserPrompts')}
          hint={t('integrations.eventUserPromptsHint')}
          warning={t('integrations.eventUserPromptsWarning')}
          on={ccEvents.userPrompts}
          disabled={!enabled || !ccActive}
          onToggle={(v) => setEvent('userPrompts', v)}
        />
      </section>
    </div>
  );
}

// ──────── 内联辅助组件 ────────

function ToggleButton({
  on,
  onClick,
  ariaLabel,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={[s.presetBtn, on && s.presetBtnActive].filter(Boolean).join(' ')}
      onClick={onClick}
      style={{ minWidth: 56 }}
    >
      {on ? 'ON' : 'OFF'}
    </button>
  );
}

function EventToggleRow({
  title,
  hint,
  warning,
  on,
  disabled,
  onToggle,
}: {
  title: string;
  hint: string;
  warning?: string;
  on: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}): JSX.Element {
  return (
    <div style={{ marginTop: 'var(--sp-3, 8px)' }}>
      <div className={s.row}>
        <span style={{ flex: 1, fontSize: 'var(--fs-sm, 13px)', color: 'var(--fg)' }}>{title}</span>
        <ToggleButton on={on} onClick={() => onToggle(!on)} ariaLabel={title} disabled={disabled} />
      </div>
      <p className={s.sectionHint}>{hint}</p>
      {warning && (
        <p
          className={s.sectionHint}
          style={{ color: 'var(--warn, #d29922)', marginTop: 'var(--sp-1, 4px)' }}
        >
          {warning}
        </p>
      )}
    </div>
  );
}
