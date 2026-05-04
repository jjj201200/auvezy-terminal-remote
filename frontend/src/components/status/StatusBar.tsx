/**
 * StatusBar
 *
 * 顶部状态条：显示连接状态 + 会话状态（idle / running / waiting_input）。
 *
 * 设计：根据两个状态各取一个色块，让用户一眼看到"是否在线"以及"Claude 在干嘛"。
 */

import type { JSX } from 'react';
import type { SessionStatus } from '@ocr/shared';
import type { ConnectionStatus } from '../../stores/app-store.js';

export interface StatusBarProps {
  connection: ConnectionStatus;
  session: SessionStatus;
}

const CONN_LABEL: Record<ConnectionStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  disconnected: '已断开',
};

const SESSION_LABEL: Record<SessionStatus, string> = {
  idle: '空闲',
  running: '运行中',
  waiting_input: '等待审批',
};

const CONN_TONE: Record<ConnectionStatus, string> = {
  connecting: 'tone-warn',
  connected: 'tone-ok',
  disconnected: 'tone-error',
};

const SESSION_TONE: Record<SessionStatus, string> = {
  idle: 'tone-muted',
  running: 'tone-ok',
  waiting_input: 'tone-warn',
};

export function StatusBar({ connection, session }: StatusBarProps): JSX.Element {
  return (
    <div className="status-bar">
      <span className={`status-bar__pill ${CONN_TONE[connection]}`}>
        {CONN_LABEL[connection]}
      </span>
      <span className={`status-bar__pill ${SESSION_TONE[session]}`}>
        {SESSION_LABEL[session]}
      </span>
    </div>
  );
}
