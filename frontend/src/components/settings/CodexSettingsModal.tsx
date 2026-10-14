/**
 * CodexSettingsModal
 *
 * Codex 集成模块的详细设置子 modal(与 ClaudeCodeSettingsModal 同构)。
 * 从"集成"tab 的 Codex 卡片"详细设置"进入,叠加在 SettingsModal 之上。
 *
 * 编辑模型:受控 value/onChange 写回父 draft;modal-stack entry 固化 props,
 * 编辑态在 modal 内部持有(见 ClaudeCodeSettingsModal 同款注释)。
 */

import { useState, type JSX } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { BoolToggleRow } from './BoolToggleRow.js';
import s from './GeneralSettings.module.scss';

/** Codex 模块事件开关(形态对齐 shared perModule['codex'].events) */
export interface CodexEvents {
  approvals: boolean;
  toolProgress: boolean;
  turnLifecycle: boolean;
  sessionLifecycle: boolean;
  userPrompts: boolean;
}

export interface CodexSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 当前事件开关值 */
  value: CodexEvents;
  /** 改动回调,直接写回父 draft */
  onChange: (next: CodexEvents) => void;
  /** 模块当前是否会被激活(总开关 + 识别策略派生) */
  active: boolean;
}

export function CodexSettingsModal({
  open,
  onClose,
  value,
  onChange,
  active,
}: CodexSettingsModalProps): JSX.Element {
  const t = useT();

  // modal-stack entry 固化 present() 时的 props —— 编辑态本地持有(同
  // ClaudeCodeSettingsModal 的冻结快照注释)
  const [local, setLocal] = useState<CodexEvents>(value);

  const setEvent = (key: keyof CodexEvents, next: boolean): void => {
    const nextEvents = { ...local, [key]: next };
    setLocal(nextEvents);
    onChange(nextEvents);
  };

  const eventsDisabled = !active;

  return (
    <Sheet
      id="codex-settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('integrations.codexModalTitle')}
    >
      <div className={s.root}>
        <p className={s.hint}>{t('integrations.codexDescription')}</p>

        {!active && (
          <p className={`${s.note} ${s.noteInfo}`}>
            {t('integrations.codexInactiveNote')}
          </p>
        )}

        <BoolToggleRow
          title={t('integrations.eventApprovals')}
          hint={t('integrations.eventApprovalsHint')}
          value={local.approvals}
          disabled={eventsDisabled}
          onChange={(v) => setEvent('approvals', v)}
        />
        <BoolToggleRow
          title={t('integrations.eventToolProgress')}
          hint={t('integrations.eventToolProgressHint')}
          value={local.toolProgress}
          disabled={eventsDisabled}
          onChange={(v) => setEvent('toolProgress', v)}
        />
        <BoolToggleRow
          title={t('integrations.eventTurnLifecycle')}
          hint={t('integrations.eventTurnLifecycleHint')}
          value={local.turnLifecycle}
          disabled={eventsDisabled}
          onChange={(v) => setEvent('turnLifecycle', v)}
        />
        <BoolToggleRow
          title={t('integrations.eventSessionLifecycle')}
          hint={t('integrations.eventSessionLifecycleHint')}
          value={local.sessionLifecycle}
          disabled={eventsDisabled}
          onChange={(v) => setEvent('sessionLifecycle', v)}
        />
        <BoolToggleRow
          title={t('integrations.eventUserPrompts')}
          hint={t('integrations.eventUserPromptsHint')}
          value={local.userPrompts}
          disabled={eventsDisabled}
          onChange={(v) => setEvent('userPrompts', v)}
          note={{ tone: 'warn', text: t('integrations.eventUserPromptsWarning') }}
        />
      </div>
    </Sheet>
  );
}
