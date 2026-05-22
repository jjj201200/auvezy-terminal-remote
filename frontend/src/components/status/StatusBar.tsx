/**
 * StatusBar
 *
 * 状态条：连接状态 + 会话状态两个 Pill。无独立背景，由父容器（顶栏）提供。
 *
 * 交互：disconnected 时连接 Pill 变成"立即重连"按钮——
 * 默认指数退避最长 30s 才会重试一次，用户主动点击可立即重连，省掉等待。
 */

import { type JSX } from 'react';
import type { SessionStatus, SessionStatusExtras } from 'auvezy-terminal-remote-shared';
import type { ConnectionStatus } from '../../stores/app-store.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import { useConfirm } from '../ui/ConfirmProvider.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './StatusBar.module.scss';

export interface StatusBarProps {
  connection: ConnectionStatus;
  session: SessionStatus;
  /** 富状态(integration 模块产生的 activeTool / 审批列表 / 失败信息等) */
  extras?: SessionStatusExtras;
  /** 用户点击 disconnected Pill 时触发；不传则不可点击 */
  onReconnect?: () => void;
}

const CONN_KEY: Record<ConnectionStatus, string> = {
  connecting: 'status.connecting',
  connected: 'status.connected',
  disconnected: 'status.disconnected',
  gave_up: 'status.gaveUp',
  no_instance: 'status.noInstance',
};

const SESSION_KEY: Record<SessionStatus, string> = {
  pty_pending: 'status.ptyPending',
  idle: 'status.idle',
  running: 'status.running',
  waiting_input: 'status.waitingInput',
};

const CONN_TONE: Record<ConnectionStatus, PillTone> = {
  connecting: 'warn',
  connected: 'ok',
  disconnected: 'error',
  gave_up: 'error',
  no_instance: 'muted',
};

const SESSION_TONE: Record<SessionStatus, PillTone> = {
  pty_pending: 'warn',
  idle: 'muted',
  running: 'ok',
  waiting_input: 'warn',
};

const CONN_DESC_KEY: Record<ConnectionStatus, string> = {
  connecting: 'status.descConnecting',
  connected: 'status.descConnected',
  disconnected: 'status.descDisconnected',
  gave_up: 'status.descGaveUp',
  no_instance: 'status.descNoInstance',
};

const SESSION_DESC_KEY: Record<SessionStatus, string> = {
  pty_pending: 'status.descPtyPending',
  idle: 'status.descIdle',
  running: 'status.descRunning',
  waiting_input: 'status.descWaitingInput',
};

export function StatusBar({
  connection,
  session,
  extras,
  onReconnect,
}: StatusBarProps): JSX.Element {
  const t = useT();
  const confirm = useConfirm();
  // 窄屏切紧凑模式：只显示圆点,状态含义靠 title / 点击弹 modal 暴露
  const compact = useMediaQuery('(max-width: 640px)');

  const canReconnect =
    (connection === 'disconnected' || connection === 'gave_up') &&
    typeof onReconnect === 'function';
  const connectionLabel = canReconnect
    ? connection === 'gave_up'
      ? t('status.gaveUpReconnect')
      : t('status.disconnectedReconnect')
    : t(CONN_KEY[connection]);

  // 会话标签:派生自 session + extras
  // - waiting_input + pendingCancelRequested → "已请求跳过,等待确认..."(2 阶段取消)
  // - waiting_input + 多个 pending → "等待审批: Bash, Edit"
  // - running + activeTool → "Bash: npm test"
  // - 否则 → 标准 i18n 文案
  const pendingTools = extras?.pendingApprovalTools ?? [];
  const sessionLabel = ((): string => {
    if (session === 'waiting_input') {
      if (extras?.pendingCancelRequested) return t('status.cancelRequested');
      if (pendingTools.length > 0) {
        const head = pendingTools.slice(0, 3).join(', ');
        const ellipsis = pendingTools.length > 3 ? '…' : '';
        return `${t(SESSION_KEY.waiting_input)}: ${head}${ellipsis}`;
      }
    }
    if (session === 'running' && extras?.activeTool) return extras.activeTool;
    return t(SESSION_KEY[session]);
  })();

  // session pill tone:lastError 存在时升级为 error 色;否则按基本派生
  const sessionTone: PillTone = extras?.lastError ? 'error' : SESSION_TONE[session];

  const showConnectionInfo = (): void => {
    void confirm({
      title: t('status.connectionDialogTitle'),
      message: `${connectionLabel}\n\n${t(CONN_DESC_KEY[connection])}`,
      singleButton: true,
    });
  };
  const showSessionInfo = (): void => {
    // 拼接 extras 信息让 modal 也能查看富状态
    const lines: string[] = [sessionLabel, '', t(SESSION_DESC_KEY[session])];
    if (extras?.lastError) {
      lines.push('', `Error: ${extras.lastError.kind}${extras.lastError.detail ? ` — ${extras.lastError.detail}` : ''}`);
    }
    if (extras?.integrationId) {
      lines.push('', `Integration: ${extras.integrationId}`);
    }
    void confirm({
      title: t('status.sessionDialogTitle'),
      message: lines.join('\n'),
      singleButton: true,
    });
  };

  return (
    <div id="status-bar" className={s.root}>
      {/*
        连接状态 pill：disconnected/gaveUp 时点击立即重连（语义 = 重试）；
        其它状态点击弹说明 modal（让用户理解每个状态含义）
      */}
      <button
        type="button"
        className={s.reconnectBtn}
        onClick={() => {
          if (canReconnect) onReconnect?.();
          else showConnectionInfo();
        }}
        title={canReconnect ? t('status.reconnectTooltip') : connectionLabel}
        aria-label={canReconnect ? t('status.reconnectTooltip') : connectionLabel}
      >
        <Pill tone={CONN_TONE[connection]} className={s.statusConnection} compact={compact}>
          {connectionLabel}
        </Pill>
      </button>

      {/* 会话状态 pill：点击弹说明 modal（每个状态对应不同含义） */}
      <button
        type="button"
        className={s.reconnectBtn}
        onClick={showSessionInfo}
        title={sessionLabel}
        aria-label={sessionLabel}
      >
        <Pill tone={sessionTone} className={s.statusSession} compact={compact}>
          {sessionLabel}
        </Pill>
      </button>
    </div>
  );
}
