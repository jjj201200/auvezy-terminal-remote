/**
 * StatusBar
 *
 * 状态条：连接状态 + 会话状态两个 Pill。无独立背景，由父容器（顶栏）提供。
 *
 * 交互：disconnected 时连接 Pill 变成"立即重连"按钮——
 * 默认指数退避最长 30s 才会重试一次，用户主动点击可立即重连，省掉等待。
 */

import type { JSX } from 'react';
import type { SessionStatus } from '@otr/shared';
import type { ConnectionStatus } from '../../stores/app-store.js';
import { Pill, type PillTone } from '../ui/Pill.js';
import s from './StatusBar.module.scss';

export interface StatusBarProps {
  connection: ConnectionStatus;
  session: SessionStatus;
  /** 用户点击 disconnected Pill 时触发；不传则不可点击 */
  onReconnect?: () => void;
}

const CONN_LABEL: Record<ConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
};

const SESSION_LABEL: Record<SessionStatus, string> = {
  pty_pending: '等待启动',
  idle: '空闲',
  running: '运行中',
  waiting_input: '等待审批',
};

const CONN_TONE: Record<ConnectionStatus, PillTone> = {
  connecting: 'warn',
  connected: 'ok',
  disconnected: 'error',
};

const SESSION_TONE: Record<SessionStatus, PillTone> = {
  pty_pending: 'warn',
  idle: 'muted',
  running: 'ok',
  waiting_input: 'warn',
};

export function StatusBar({ connection, session, onReconnect }: StatusBarProps): JSX.Element {
  // disconnected + 提供了 onReconnect → 渲染按钮（语义可访问）；其它状态仍是静态 Pill
  const canReconnect = connection === 'disconnected' && typeof onReconnect === 'function';
  const connectionLabel = canReconnect ? '已断开 · 重连' : CONN_LABEL[connection];

  return (
    <div id="status-bar" className={s.root}>
      {canReconnect ? (
        <button
          type="button"
          className={s.reconnectBtn}
          onClick={onReconnect}
          title="立即重新连接"
          aria-label="立即重新连接"
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
        {SESSION_LABEL[session]}
      </Pill>
    </div>
  );
}
