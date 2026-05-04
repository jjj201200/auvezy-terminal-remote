/**
 * ConsolePage
 *
 * 控制台主页：把 useTerminal + useWebSocket + InputBar + StatusBar 串起来。
 * 阶段 1 最简版：无认证、无多实例、无设置页、无审批 UI。
 *
 * 数据流：
 *  - WS server message → onMessage → 分发：
 *    - terminal_output / history_sync.data → terminal.write
 *    - history_sync.cols/rows → terminal.adaptToPtySize
 *    - status_update → 本地 sessionStatus state
 *    - terminal_resize → terminal.adaptToPtySize（让 xterm 跟随 PTY 真实尺寸）
 *    - error / session_ended → 写到 xterm 显示告警行
 *  - useTerminal onResize → ws.send resize message
 *  - InputBar onSend → ws.send user_input
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import type { ServerMessage, SessionStatus, ClientMessage } from '@ocr/shared';
import { useTerminal } from '../hooks/useTerminal.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useAppStore } from '../stores/app-store.js';
import { TerminalView } from '../components/terminal/TerminalView.js';
import { ScrollToBottomButton } from '../components/terminal/ScrollToBottomButton.js';
import { InputBar } from '../components/input/InputBar.js';
import { StatusBar } from '../components/status/StatusBar.js';
import { SettingsModal } from '../components/settings/SettingsModal.js';

export function ConsolePage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const { config, save } = useUserConfig();

  // useWebSocket 的 send 函数稍后赋值；用 ClientMessage union 作为 forward ref 类型
  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);

  /** xterm resize → 上报到服务端；离线时返回 false 让 useTerminal 重发 */
  const handleResize = useCallback((cols: number, rows: number): boolean => {
    return sendRef.current?.({ type: 'resize', cols, rows }) ?? false;
  }, []);

  const {
    write,
    scrollToBottom,
    setAutoFollow,
    showScrollHint,
    adaptToPtySize,
  } = useTerminal(containerRef, handleResize);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'terminal_output':
        write(msg.data);
        break;

      case 'history_sync':
        write(msg.data);
        if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          adaptToPtySize(msg.cols, msg.rows);
        }
        setSessionStatus(msg.status);
        break;

      case 'status_update':
        setSessionStatus(msg.status);
        break;

      case 'terminal_resize':
        adaptToPtySize(msg.cols, msg.rows);
        break;

      case 'session_ended':
        write(`\r\n\x1b[33m[会话结束 · exit ${msg.exitCode} · ${msg.reason}]\x1b[0m\r\n`);
        setSessionStatus('idle');
        break;

      case 'error':
        write(`\r\n\x1b[31m[错误 ${msg.code}: ${msg.message}]\x1b[0m\r\n`);
        break;

      case 'ip_changed':
      case 'heartbeat':
        // 阶段 1 暂不处理
        break;
    }
  }, [write, adaptToPtySize]);

  const { send } = useWebSocket(handleMessage);
  // 把 send 暴露给 handleResize（避免 useWebSocket 在 useTerminal 构造之前未就绪）
  sendRef.current = send;

  const handleUserInput = useCallback((data: string): boolean => {
    return send({ type: 'user_input', data });
  }, [send]);

  const handleScrollToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom, setAutoFollow]);

  return (
    <div className="console-page">
      <StatusBar connection={connectionStatus} session={sessionStatus} />
      <div className="console-page__terminal-wrap">
        <TerminalView ref={containerRef} className="console-page__terminal" />
        <ScrollToBottomButton
          visible={showScrollHint}
          onClick={handleScrollToBottom}
        />
      </div>
      <InputBar
        onSend={handleUserInput}
        disabled={connectionStatus !== 'connected'}
        shortcuts={config.shortcuts}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsModal
        open={settingsOpen}
        current={config}
        onSave={save}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
