/**
 * ConsolePage
 *
 * 控制台主页：把 useTerminal + useWebSocket + 输入相关组件 + 状态显示串起来。
 *
 * 布局（移动优先）：
 *  - 顶栏：[桌面] InstanceTabs + StatusBar + Settings 图标按钮
 *         [移动] MobileInstanceSwitcher + StatusBar + Settings
 *  - 终端区（flex-1）
 *  - 快捷键栏（移动端单行横向滚动）
 *  - InputBar（含 safe-bottom padding）
 *
 * 数据流：
 *  - WS server message → onMessage → 分发至 terminal / 状态 / Toast
 *  - useTerminal onResize → ws.send resize
 *  - InputBar onSend / ShortcutsBar onShortcut → ws.send user_input
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import { Settings } from 'lucide-react';
import type { ServerMessage, SessionStatus, ClientMessage } from '@ocr/shared';
import { useTerminal } from '../hooks/useTerminal.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useAppStore } from '../stores/app-store.js';
import { TerminalView } from '../components/terminal/TerminalView.js';
import { ScrollToBottomButton } from '../components/terminal/ScrollToBottomButton.js';
import { InputBar, ShortcutsBar } from '../components/input/InputBar.js';
import { StatusBar } from '../components/status/StatusBar.js';
import { SettingsModal } from '../components/settings/SettingsModal.js';
import { InstanceTabs } from '../components/instances/InstanceTabs.js';
import { MobileInstanceSwitcher } from '../components/instances/MobileInstanceSwitcher.js';
import { CreateInstanceModal } from '../components/instances/CreateInstanceModal.js';
import { IpChangeToast, type IpChangeInfo } from '../components/common/IpChangeToast.js';
import { IconButton } from '../components/ui/IconButton.js';
import { useLocalNotification } from '../hooks/useLocalNotification.js';

export function ConsolePage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [ipChange, setIpChange] = useState<IpChangeInfo | null>(null);
  /**
   * 是否已经收到过任何 PTY 输出。用于在 connection 已连上但 PTY 还没启动
   * （--wait-confirm 等场景）时，告诉用户去服务端按 Enter，避免「页面空白」误解。
   */
  const [hasPtyOutput, setHasPtyOutput] = useState(false);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const { config, save } = useUserConfig();
  const { instances, create: createInstance } = useInstances();
  const localNotify = useLocalNotification();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);

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

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'terminal_output':
          write(msg.data);
          if (msg.data.length > 0) setHasPtyOutput(true);
          break;
        case 'history_sync':
          write(msg.data);
          if (msg.data.length > 0) setHasPtyOutput(true);
          if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
            adaptToPtySize(msg.cols, msg.rows);
          }
          setSessionStatus(msg.status);
          break;
        case 'status_update':
          setSessionStatus(msg.status);
          if (msg.status === 'waiting_input') {
            localNotify.notify('Claude 等待审批', msg.detail ?? '请在 Claude 中确认');
          }
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
          setIpChange({ oldIp: msg.oldIp, newIp: msg.newIp, newUrl: msg.newUrl });
          break;
        case 'heartbeat':
          break;
      }
    },
    [write, adaptToPtySize, localNotify],
  );

  const { send } = useWebSocket(handleMessage);
  sendRef.current = send;

  const handleUserInput = useCallback(
    (data: string): boolean => send({ type: 'user_input', data }),
    [send],
  );

  const handleScrollToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom, setAutoFollow]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 pt-[calc(env(safe-area-inset-top)+6px)]">
        <div className="min-w-0 flex-1 overflow-hidden">
          {isMobile ? (
            <MobileInstanceSwitcher
              instances={instances}
              onCreateClick={() => setCreateOpen(true)}
            />
          ) : (
            <InstanceTabs
              instances={instances}
              onCreateClick={() => setCreateOpen(true)}
            />
          )}
        </div>
        <StatusBar connection={connectionStatus} session={sessionStatus} />
        <IconButton
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
          title="设置"
        >
          <Settings size={14} strokeWidth={1.5} />
        </IconButton>
      </header>

      <div className="relative min-h-0 flex-1 bg-[var(--color-bg)]">
        <TerminalView ref={containerRef} className="absolute inset-0 p-2" />
        {connectionStatus === 'connected' && !hasPtyOutput && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto max-w-[420px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-5 py-4 text-center text-sm text-[var(--color-fg-muted)] shadow-lg">
              <div className="mb-1 text-[var(--color-fg)] font-medium">等待终端启动</div>
              <p className="m-0 leading-relaxed">
                浏览器已连接，但服务端还没产生任何输出。
                <br />
                如果服务端用了 <code className="font-mono text-[var(--color-accent)]">--wait-confirm</code>，请回到启动 otr 的终端按一下 Enter。
              </p>
            </div>
          </div>
        )}
        <ScrollToBottomButton visible={showScrollHint} onClick={handleScrollToBottom} />
      </div>

      <ShortcutsBar
        shortcuts={config.shortcuts}
        onShortcut={(data) => send({ type: 'user_input', data })}
        disabled={connectionStatus !== 'connected'}
      />

      <InputBar
        onSend={handleUserInput}
        disabled={connectionStatus !== 'connected'}
      />

      <SettingsModal
        open={settingsOpen}
        current={config}
        onSave={save}
        onClose={() => setSettingsOpen(false)}
      />
      <CreateInstanceModal
        open={createOpen}
        onSubmit={createInstance}
        onClose={() => setCreateOpen(false)}
      />
      <IpChangeToast info={ipChange} onDismiss={() => setIpChange(null)} />
    </div>
  );
}
