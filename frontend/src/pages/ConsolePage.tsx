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

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { IconSettings, IconShare2 } from '@tabler/icons-react';
import type { ServerMessage, SessionStatus, ClientMessage } from '@otr/shared';
import { useTerminal } from '../hooks/useTerminal.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useAppStore } from '../stores/app-store.js';
import { useT } from '../i18n/i18n-context.js';
import { TerminalView } from '../components/terminal/TerminalView.js';
import { ScrollToBottomButton } from '../components/terminal/ScrollToBottomButton.js';
import { SearchBar } from '../components/terminal/SearchBar.js';
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
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * InputBar 的输入值。受控提到这里，是因为 Toolbar 中"非自动发送"的命令
   * 需要把命令文本灌进输入框等用户编辑。
   */
  const [inputValue, setInputValue] = useState('');
  const t = useT();
  const connectionStatus = useAppStore((st) => st.connectionStatus);
  const { config, save } = useUserConfig();
  const { instances, create: createInstance } = useInstances();
  const localNotify = useLocalNotification();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);
  // 让点击 terminal 区也能把焦点接到 InputBar 输入框
  const inputBarRef = useRef<HTMLInputElement | null>(null);

  const handleResize = useCallback((cols: number, rows: number): boolean => {
    return sendRef.current?.({ type: 'resize', cols, rows }) ?? false;
  }, []);

  const {
    write,
    scrollToBottom,
    setAutoFollow,
    showScrollHint,
    adaptToPtySize,
    searchNext,
    searchPrev,
    clearSearch,
    getSelection,
  } = useTerminal(containerRef, handleResize, config.display);

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

  /**
   * 焦点劫持：xterm 的 .xterm-helper-textarea 被聚焦时立即把焦点让给 InputBar
   *
   * 背景：disableStdin=true 但 xterm 5 仍渲染 helper-textarea 用于剪贴板 / a11y。
   * 移动端触摸 terminal 会触发它聚焦 → 软键盘弹起但输入到达不了任何地方。
   * 即使在 pointerdown 时主动 focus(InputBar)，浏览器在 pointerup 完成手势链时
   * 还会再 focus 一次 helper-textarea，把焦点又夺走（用户描述：按住时输入框获焦、
   * 松手后失焦）。
   *
   * 在 helper-textarea 的 focusin 事件上无条件转移，覆盖所有时序。
   * 用 rAF 跳出当前事件循环再 focus，命中率最高。
   */
  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const handler = (e: FocusEvent): void => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.classList.contains('xterm-helper-textarea')) return;
      requestAnimationFrame(() => {
        inputBarRef.current?.focus({ preventScroll: true });
      });
    };
    target.addEventListener('focusin', handler);
    return () => target.removeEventListener('focusin', handler);
  }, []);

  // Cmd+F / Ctrl+F 唤出终端搜索
  // Cmd+C / Ctrl+C 复制终端选区（仅当 InputBar 没有自身选区时；不抢系统复制行为）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === 'c' && !e.shiftKey) {
        // 输入框 / 文本元素已有选区时让浏览器走默认复制
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const text = getSelection();
        if (!text) return;
        e.preventDefault();
        void navigator.clipboard.writeText(text).catch(() => {
          // 不支持 Clipboard API：静默
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getSelection]);

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
          aria-label={t('topBar.share')}
          title={t('topBar.shareTooltip')}
        >
          <IconShare2 size={14} stroke={1.5} />
        </IconButton>
        <IconButton
          onClick={() => setSettingsOpen(true)}
          aria-label={t('topBar.settings')}
          title={t('topBar.settingsTooltip')}
        >
          <IconSettings size={14} stroke={1.5} />
        </IconButton>
      </header>

      <div
        id="console-terminal-wrap"
        className={s.terminalWrap}
        // 触摸 / 点击终端区时把焦点接到 InputBar：
        // 移动端 xterm 会因 helper-textarea 触发软键盘，但输入到达不了任何地方
        // 这里在 pointerdown 阶段把焦点抢过来，键盘弹起后就直接落在输入框
        // 桌面：用户拖选文字会触发 pointerdown，但 input.focus() 不影响选区
        onPointerDown={() => {
          inputBarRef.current?.focus({ preventScroll: true });
        }}
      >
        <TerminalView ref={containerRef} className={s.terminalView} />
        {connectionStatus === 'connected' && sessionStatus === 'pty_pending' && (
          <div className={s.idleOverlay}>
            <div className={s.idleCard}>
              <div className={s.idleTitle}>{t('console.startingTitle')}</div>
              <p className={s.idleBody} style={{ whiteSpace: 'pre-line' }}>
                {t('console.startingBody')}
              </p>
            </div>
          </div>
        )}
        {connectionStatus === 'connected' &&
          sessionStatus !== 'pty_pending' &&
          !hasPtyOutput && (
            <div className={s.idleOverlay}>
              <div className={s.idleCard}>
                <div className={s.idleTitle}>{t('console.awaitingTitle')}</div>
                <p className={s.idleBody}>{t('console.awaitingBody')}</p>
              </div>
            </div>
          )}
        <ScrollToBottomButton visible={showScrollHint} onClick={handleScrollToBottom} />
        <SearchBar
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onNext={searchNext}
          onPrev={searchPrev}
          onClear={clearSearch}
        />
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
        ref={inputBarRef}
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
