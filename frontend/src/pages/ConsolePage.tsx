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
import { IconSearch, IconSettings, IconShare2 } from '@tabler/icons-react';
import type { ServerMessage, SessionStatus, ClientMessage } from 'auvezy-terminal-remote-shared';
import { useTerminal } from '../hooks/useTerminal.js';
import { isMouseReportingActive } from '../utils/xterm-internals.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useUserConfig } from '../hooks/useUserConfig.js';
import { useInstances } from '../hooks/useInstances.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useAppStore } from '../stores/app-store.js';
import { useT } from '../i18n/i18n-context.js';
import { TerminalView } from '../components/terminal/TerminalView.js';
import { ScrollNavButtons } from '../components/terminal/ScrollNavButtons.js';
import { SearchBar } from '../components/terminal/SearchBar.js';
import { InputBar, type InputBarHandle } from '../components/input/InputBar.js';
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
  const t = useT();
  const connectionStatus = useAppStore((st) => st.connectionStatus);
  const { config, save } = useUserConfig();
  const { instances, create: createInstance } = useInstances();
  const localNotify = useLocalNotification();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);
  // 让点击 terminal 区也能把焦点接到 InputBar 输入框
  const inputBarRef = useRef<InputBarHandle | null>(null);
  // 终端区 tap 检测：pointerdown 记起点，pointerup 时判定是 tap 还是 swipe
  const terminalTapRef = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  // 最近一次终端 pointerup 时间戳：focus hijack 在它之后 250ms 内不抢，给系统复制菜单留出现的时间
  const terminalReleaseTsRef = useRef<number>(0);

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
    terminal: termRef,
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
        case 'alt_screen_change':
          // 单实例 ConsolePage 暂未启用 touch swipe（功能在 MultiInstance 路径），
          // 但仍承认这个消息避免 exhaustive switch 漏 type。无副作用。
          break;
        case 'heartbeat':
          break;
      }
    },
    [write, adaptToPtySize, localNotify],
  );

  const { send, connect } = useWebSocket(
    handleMessage,
    undefined,
    config.network?.reconnectMaxAttempts,
  );
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
      // mouse reporting 激活（Claude TUI / vim / htop）：xterm 自己 focus
      // helper-textarea 是它内部需要——不要抢焦点弹 IME。tap 由 useTouchSwipeScroll
      // 的 SGR 路径处理，长按由 onLongPress 显式 focus InputBar 处理。
      if (isMouseReportingActive(termRef.current)) return;
      // 移动端长按选词时 xterm 需要 helper-textarea 保持焦点才能弹系统复制菜单。
      // 三种"不应该抢焦点"的情况：
      //  1. pointer 还按着（terminalTapRef !== null）→ 长按选词进行中
      //  2. 刚释放后 250ms 内 → 给系统复制菜单出现的时间
      //  3. 终端有选区 → 用户在做选区操作
      if (terminalTapRef.current !== null) return;
      if (performance.now() - terminalReleaseTsRef.current < 250) return;
      if (getSelection()) return;
      requestAnimationFrame(() => {
        inputBarRef.current?.focus({ preventScroll: true });
      });
    };
    target.addEventListener('focusin', handler);
    return () => target.removeEventListener('focusin', handler);
  }, [getSelection]);

  // Cmd+F / Ctrl+F 唤出终端搜索
  // Cmd+C / Ctrl+C 复制终端选区（仅当 InputBar 没有自身选区时；不抢系统复制行为）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'f') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === 'c' && !e.shiftKey) {
        // 输入框 / 文本元素已有选区时让浏览器走默认复制
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const text = getSelection();
        if (!text) return;
        e.preventDefault();
        void copyToClipboard(text);
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
          onClick={() => setSearchOpen((v) => !v)}
          aria-label={t('search.aria')}
          aria-pressed={searchOpen}
          title={t('search.aria')}
          variant={searchOpen ? 'accent' : undefined}
        >
          <IconSearch size={14} stroke={1.5} />
        </IconButton>
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
        // tap → 把焦点接到 InputBar 让软键盘弹起且能输入
        // swipe / 长按 → 视为查看历史 / 选词，不动焦点（也不弹键盘）
        // 用 pointerdown 记起点，pointerup 时按移动距离 + 时长判定是不是 tap
        onPointerDown={(e) => {
          // 浮层（SearchBar / ScrollNavButtons / idleCard）的事件会冒泡到这里，
          // 但它们的 tap 不应触发 InputBar 聚焦。检查 target 是否在 xterm 渲染层内。
          const el = e.target as HTMLElement | null;
          if (!el?.closest('.xterm')) return;
          terminalTapRef.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            t: e.timeStamp,
          };
        }}
        onPointerUp={(e) => {
          const start = terminalTapRef.current;
          terminalTapRef.current = null;
          terminalReleaseTsRef.current = e.timeStamp;
          if (!start || start.id !== e.pointerId) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          const dt = e.timeStamp - start.t;
          // tap 判定：移动 ≤ 8px 且时长 ≤ 400ms
          if (Math.hypot(dx, dy) > 8 || dt > 400) return;
          inputBarRef.current?.focus({ preventScroll: true });
        }}
        onPointerCancel={() => {
          terminalTapRef.current = null;
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
        <ScrollNavButtons visible={showScrollHint} onScrollToBottom={handleScrollToBottom} />
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
        onPrefillCommand={(text) => {
          inputBarRef.current?.setValue(text);
          inputBarRef.current?.focus({ preventScroll: true });
        }}
        disabled={connectionStatus !== 'connected'}
      />

      <InputBar
        ref={inputBarRef}
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
