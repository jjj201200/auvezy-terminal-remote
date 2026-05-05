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
 *  - InputBar onSubmit / Toolbar onSendData / onSubmitCommand → ws.send user_input
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import { IconSettings, IconShare2 } from '@tabler/icons-react';
import type { ServerMessage, SessionStatus, ClientMessage } from '@otr/shared';
import { useTerminal } from '../hooks/useTerminal.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useAppStore } from '../stores/app-store.js';
import { TerminalView } from '../components/terminal/TerminalView.js';
import { ScrollToBottomButton } from '../components/terminal/ScrollToBottomButton.js';
import { InputBar } from '../components/input/InputBar.js';
import { Toolbar } from '../components/input/Toolbar.js';
import { StatusBar } from '../components/status/StatusBar.js';
import { SettingsModal } from '../components/settings/SettingsModal.js';
import { InstanceTabs } from '../components/instances/InstanceTabs.js';
import { MobileInstanceSwitcher } from '../components/instances/MobileInstanceSwitcher.js';
import { CreateInstanceModal } from '../components/instances/CreateInstanceModal.js';
import { ShareSheet } from '../components/share/ShareSheet.js';
import { IpChangeToast, type IpChangeInfo } from '../components/common/IpChangeToast.js';
import { IconButton } from '../components/ui/IconButton.js';
import { useLocalNotification } from '../hooks/useLocalNotification.js';
import s from './ConsolePage.module.scss';

export function ConsolePage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [ipChange, setIpChange] = useState<IpChangeInfo | null>(null);
  /**
   * 是否已经收到过任何 PTY 输出。用于在 connection 已连上但 PTY 还没启动
   * （--wait-confirm 等场景）时，告诉用户去服务端按 Enter，避免「页面空白」误解。
   */
  const [hasPtyOutput, setHasPtyOutput] = useState(false);
  /**
   * InputBar 的输入值。受控提到这里，是因为 Toolbar 中"非自动发送"的命令
   * 需要把命令文本灌进输入框等用户编辑。
   */
  const [inputValue, setInputValue] = useState('');
  const connectionStatus = useAppStore((st) => st.connectionStatus);
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

  const { send, connect } = useWebSocket(handleMessage);
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
    <div id="console-page" className={s.root}>
      <header id="console-header" className={s.header}>
        <div className={s.headerLeft}>
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
        <StatusBar
          connection={connectionStatus}
          session={sessionStatus}
          onReconnect={connect}
        />
        <IconButton
          onClick={() => setShareOpen(true)}
          aria-label="分享此实例"
          title="分享此实例（含二维码）"
        >
          <IconShare2 size={14} stroke={1.5} />
        </IconButton>
        <IconButton
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
          title="设置"
        >
          <IconSettings size={14} stroke={1.5} />
        </IconButton>
      </header>

      <div id="console-terminal-wrap" className={s.terminalWrap}>
        <TerminalView ref={containerRef} className={s.terminalView} />
        {connectionStatus === 'connected' && sessionStatus === 'pty_pending' && (
          <div className={s.idleOverlay}>
            <div className={s.idleCard}>
              <div className={s.idleTitle}>正在启动终端</div>
              <p className={s.idleBody}>
                浏览器已连接，PTY 子进程正在启动…
                <br />
                若长时间无响应，请回到 otr 启动终端按一下 Enter。
              </p>
            </div>
          </div>
        )}
        {connectionStatus === 'connected' &&
          sessionStatus !== 'pty_pending' &&
          !hasPtyOutput && (
            <div className={s.idleOverlay}>
              <div className={s.idleCard}>
                <div className={s.idleTitle}>等待终端输出</div>
                <p className={s.idleBody}>
                  PTY 已启动但暂无输出。如果使用了{' '}
                  <code className={s.idleCode}>--wait-confirm</code>，
                  请回到启动 otr 的终端按一下 Enter。
                </p>
              </div>
            </div>
          )}
        <ScrollToBottomButton visible={showScrollHint} onClick={handleScrollToBottom} />
      </div>

      <Toolbar
        shortcuts={config.shortcuts}
        commands={config.commands}
        onSendData={(data) => send({ type: 'user_input', data })}
        onSubmitCommand={(text) => send({ type: 'user_input', data: text + '\r' })}
        onPrefillCommand={(text) => setInputValue(text)}
        disabled={connectionStatus !== 'connected'}
      />

      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleUserInput}
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
      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} />
      <IpChangeToast info={ipChange} onDismiss={() => setIpChange(null)} />
    </div>
  );
}
