/**
 * ClaudeCodeSettingsModal
 *
 * Claude Code 集成模块的详细设置子 modal。从"集成"tab 的模块卡片"详细设置"按钮
 * 进入,叠加在 SettingsModal 之上(走 ModalStack,zIndex / inert / 退场动画自动)。
 *
 * 编辑模型:
 *  - 受控 value/onChange,直接把值回写到父 SettingsModal 的 draft。父级的
 *    "应用 / 保存"按钮接管真正写盘,本 modal 只有"关闭"按钮,关闭不丢改动
 *    (因为改动早已经在父级 draft 里)
 *  - 这样跨多层 modal 的编辑流仍是单一 dirty 检测点
 *
 * UI:沿用 BoolToggleRow(标题 + hint + 双按钮 + 可选彩色 note),与 IntegrationsSettings
 * 视觉一致。
 */

import { useState, type JSX } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import { BoolToggleRow } from './BoolToggleRow.js';
import s from './GeneralSettings.module.scss';

/**
 * Claude Code 模块的事件子开关。形态与 backend 的 ClaudeCodeEventToggles 一致,
 * 但前后端不直接共享类型(shared 包是 schema 真相源,backend 那个 type 是实现细节)
 */
export interface ClaudeCodeEvents {
  approvals: boolean;
  toolProgress: boolean;
  turnLifecycle: boolean;
  sessionLifecycle: boolean;
  userPrompts: boolean;
}

export interface ClaudeCodeSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** 当前事件开关值 */
  value: ClaudeCodeEvents;
  /** 改动回调,直接写回父 draft */
  onChange: (next: ClaudeCodeEvents) => void;
  /** 模块当前是否会被激活(总开关 + 识别策略派生) */
  active: boolean;
}

export function ClaudeCodeSettingsModal({
  open,
  onClose,
  value,
  onChange,
  active,
}: ClaudeCodeSettingsModalProps): JSX.Element {
  const t = useT();

  // modal-stack entry 固化 present() 时的 props —— 受控 value 是打开瞬间的快照,
  // 连续切换多个开关会互相覆盖(每次都从快照 spread)。编辑态在 modal 内部持有:
  // mount 快照播种 + 本地累积 + 每次变更上报 onChange(父 draft 实时跟进的模型不变)。
  const [local, setLocal] = useState<ClaudeCodeEvents>(value);

  const setEvent = (key: keyof ClaudeCodeEvents, next: boolean): void => {
    const nextEvents = { ...local, [key]: next };
    setLocal(nextEvents);
    onChange(nextEvents);
  };

  const eventsDisabled = !active;

  return (
    <Sheet
      id="claude-code-settings-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('integrations.claudeCodeModalTitle')}
    >
      <div className={s.root}>
        <p className={s.hint}>{t('integrations.claudeCodeDescription')}</p>

        {!active && (
          <p className={`${s.note} ${s.noteInfo}`}>
            {t('integrations.claudeCodeInactiveNote')}
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
