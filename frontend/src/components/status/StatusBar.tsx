/**
 * StatusBar
 *
 * 状态条：连接状态 + 会话状态两个 Pill。无独立背景，由父容器（顶栏）提供。
 *
 * 交互：disconnected 时连接 Pill 变成"立即重连"按钮——
 * 默认指数退避最长 30s 才会重试一次，用户主动点击可立即重连，省掉等待。
 */

import type { JSX } from 'react';
import type { SessionStatus } from 'auvezy-terminal-remote-shared';
import type { ConnectionStatus } from '../../stores/app-store.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './StatusBar.module.scss';

export interface StatusBarProps {
  connection: ConnectionStatus;
  session: SessionStatus;
  /** 用户点击 disconnected Pill 时触发；不传则不可点击 */
  onReconnect?: () => void;
}

const CONN_KEY: Record<ConnectionStatus, string> = {
  connecting: 'status.connecting',
  connected: 'status.connected',
  disconnected: 'status.disconnected',
  gave_up: 'status.gaveUp',
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
};

const SESSION_TONE: Record<SessionStatus, PillTone> = {
  pty_pending: 'warn',
  idle: 'muted',
  running: 'ok',
  waiting_input: 'warn',
};

export function StatusBar({ connection, session, onReconnect }: StatusBarProps): JSX.Element {
  const t = useT();
  const canReconnect =
    (connection === 'disconnected' || connection === 'gave_up') &&
    typeof onReconnect === 'function';
  const connectionLabel = canReconnect
    ? connection === 'gave_up'
      ? t('status.gaveUpReconnect')
      : t('status.disconnectedReconnect')
    : t(CONN_KEY[connection]);

  return (
    <div id="status-bar" className={s.root}>
      {canReconnect ? (
        <button
          type="button"
          className={s.reconnectBtn}
          onClick={onReconnect}
          title={t('status.reconnectTooltip')}
          aria-label={t('status.reconnectTooltip')}
        >
          <Pill tone={CONN_TONE[connection]} className={s.statusConnection}>
            {connectionLabel}
          </Pill>
        </button>
      ) : (
        <Pill tone={CONN_TONE[connection]} className={s.statusConnection}>
          {connectionLabel}
        </Pill>
      )}
      <Pill tone={SESSION_TONE[session]} className={s.statusSession}>
        {t(SESSION_KEY[session])}
      </Pill>
    </div>
  );
}
