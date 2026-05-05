/**
 * StatusBar
 *
 * 状态条：连接状态 + 会话状态两个 Pill。无独立背景，由父容器（顶栏）提供。
 */

import type { JSX } from 'react';
import type { SessionStatus } from '@ocr/shared';
import type { ConnectionStatus } from '../../stores/app-store.js';
import { Pill, type PillTone } from '../ui/Pill.js';

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

const CONN_TONE: Record<ConnectionStatus, PillTone> = {
  connecting: 'warn',
  connected: 'ok',
  disconnected: 'error',
};

const SESSION_TONE: Record<SessionStatus, PillTone> = {
  idle: 'muted',
  running: 'ok',
  waiting_input: 'warn',
};

export function StatusBar({ connection, session }: StatusBarProps): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <Pill tone={CONN_TONE[connection]}>{CONN_LABEL[connection]}</Pill>
      <Pill tone={SESSION_TONE[session]}>{SESSION_LABEL[session]}</Pill>
    </div>
  );
}
