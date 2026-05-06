/**
 * InstanceView
 *
 * 单实例的完整终端 UI：xterm + WS 连接 + Toolbar + InputBar + 各浮层。
 * 多个 InstanceView 同时挂在 MultiInstanceConsole 里，通过 active 控制可见。
 *
 * 关键设计：
 * - 即使 hidden 也保持挂载——WS 持续接收数据，xterm 持续 write，
 *   切回来时无 history_sync 等待，直接看到最新状态
 * - 所有"共享"控件（顶栏 / settings modal）由 MultiInstanceConsole 渲染，
 *   InstanceView 只负责实例内的内容 + 把状态报给上层（active 时上层用它的状态）
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { ServerMessage, SessionStatus, ClientMessage, UserConfig } from 'auvezy-terminal-remote-shared';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useT } from '../../i18n/i18n-context.js';
import { useLocalNotification } from '../../hooks/useLocalNotification.js';
import { TerminalView } from '../terminal/TerminalView.js';
import { ScrollToBottomButton } from '../terminal/ScrollToBottomButton.js';
import { SearchBar } from '../terminal/SearchBar.js';
import { InputBar } from '../input/InputBar.js';
import { Toolbar } from '../input/Toolbar.js';
import { IpChangeToast, type IpChangeInfo } from '../common/IpChangeToast.js';
import s from '../../pages/ConsolePage.module.scss';

export interface InstanceViewProps {
  /** 实例标识，仅用于 React key 与日志，不影响连接 */
  instanceId: string;
  /** WS 完整 URL（含 token query）；当前实例传 undefined → 同源默认连 /ws */
  wsUrl: string | undefined;
  /** 用户配置 */
  config: UserConfig;
  /** 是否当前激活：决定 SearchBar / 全局快捷键监听是否在本实例上生效 */
  active: boolean;
  /**
   * 状态变化时上报。第一参数是 instanceId，让父组件用同一个回调处理多实例
   * （回调对所有实例稳定 → 不会因 instanceId 不同而生成新闭包 → 不触发死循环）
   */
  onStatusChange?: (
    instanceId: string,
    s: { connection: 'connecting' | 'connected' | 'disconnected' | 'gave_up'; session: SessionStatus },
  ) => void;
  /** 上层提供 reconnect 回调；第一参数也是 instanceId（同上） */
  registerReconnect?: (instanceId: string, fn: () => void) => void;
  /** SearchBar 的 open 状态由上层控制（顶栏搜索按钮 + Cmd+F 全局快捷键） */
  searchOpen: boolean;
  onSearchClose: () => void;
  /**
   * 本设备主动断开（不影响其他设备 / backend 进程仍在）。
   * - true：useWebSocket 不开 WS，渲染"已断开 — 点击重连"覆盖层
   * - false（默认）：正常自动连
   */
  disabled?: boolean;
  /** 用户点覆盖层重连按钮的回调（清掉 disabled 状态由父组件做） */
  onReconnect?: (instanceId: string) => void;
}

/**
 * 暴露 ref 让上层（MultiInstanceConsole）能调实例内的方法：
 *  - getSelection / clearSearch：被 Cmd+C / Cmd+F 上层 handler 调用
 */
export interface InstanceViewHandle {
  getSelection: () => string;
  clearSearch: () => void;
  searchNext: (q: string) => boolean;
  searchPrev: (q: string) => boolean;
}

export function InstanceView({
  instanceId,
  wsUrl,
  config,
  active,
  onStatusChange,
  registerReconnect,
  searchOpen,
  onSearchClose,
  disabled = false,
  onReconnect,
}: InstanceViewProps): JSX.Element {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputBarRef = useRef<HTMLInputElement | null>(null);
  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);
  const terminalTapRef = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const terminalReleaseTsRef = useRef<number>(0);

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [hasPtyOutput, setHasPtyOutput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [ipChange, setIpChange] = useState<IpChangeInfo | null>(null);

  const localNotify = useLocalNotification();

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

  const { send, connect, connectionStatus } = useWebSocket(
    handleMessage,
    wsUrl,
    config.network?.reconnectMaxAttempts,
    disabled,
  );
  sendRef.current = send;

  // 把状态变化上报给父组件（active 时父组件会显示）
  useEffect(() => {
    onStatusChange?.(instanceId, { connection: connectionStatus, session: sessionStatus });
  }, [instanceId, connectionStatus, sessionStatus, onStatusChange]);

  // active 时把 reconnect 函数注册给父组件
  useEffect(() => {
    if (active) registerReconnect?.(instanceId, connect);
  }, [instanceId, active, connect, registerReconnect]);

  const handleUserInput = useCallback(
    (data: string): boolean => send({ type: 'user_input', data }),
    [send],
  );

  const handleScrollToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom, setAutoFollow]);

  // 焦点劫持：xterm helper-textarea 抢焦点 → 回 InputBar
  useEffect(() => {
    if (!active) return; // 非 active 不抢焦点
    const target = containerRef.current;
    if (!target) return;
    const handler = (e: FocusEvent): void => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.classList.contains('xterm-helper-textarea')) return;
      if (terminalTapRef.current !== null) return;
      if (performance.now() - terminalReleaseTsRef.current < 250) return;
      if (getSelection()) return;
      requestAnimationFrame(() => {
        inputBarRef.current?.focus({ preventScroll: true });
      });
    };
    target.addEventListener('focusin', handler);
    return () => target.removeEventListener('focusin', handler);
  }, [active, getSelection]);

  // Cmd+C 复制选区（仅 active 实例）
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !e.shiftKey) {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const text = getSelection();
        if (!text) return;
        e.preventDefault();
        void navigator.clipboard.writeText(text).catch(() => {
          /* 老浏览器或非 secure context：静默 */
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, getSelection]);

  return (
    <div
      id={`instance-view-${instanceId}`}
      className={s.instanceContent}
      style={{ display: active ? 'flex' : 'none' }}
      aria-hidden={!active}
    >
      <div
        id="console-terminal-wrap"
        className={s.terminalWrap}
        onPointerDown={(e) => {
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
          if (Math.hypot(dx, dy) > 8 || dt > 400) return;
          inputBarRef.current?.focus({ preventScroll: true });
        }}
        onPointerCancel={() => {
          terminalTapRef.current = null;
        }}
      >
        <TerminalView ref={containerRef} className={s.terminalView} />
        {disabled && (
          <div className={s.idleOverlay}>
            <div className={s.idleCard}>
              <div className={s.idleTitle}>{t('instance.disconnectedTitle')}</div>
              <p className={s.idleBody}>{t('instance.disconnectedBody')}</p>
              <button
                type="button"
                onClick={() => onReconnect?.(instanceId)}
                className={s.idleAction}
              >
                {t('instance.reconnect')}
              </button>
            </div>
          </div>
        )}
        {!disabled && connectionStatus === 'connected' && sessionStatus === 'pty_pending' && (
          <div className={s.idleOverlay}>
            <div className={s.idleCard}>
              <div className={s.idleTitle}>{t('console.startingTitle')}</div>
              <p className={s.idleBody} style={{ whiteSpace: 'pre-line' }}>
                {t('console.startingBody')}
              </p>
            </div>
          </div>
        )}
        {!disabled && connectionStatus === 'connected' &&
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
        {active && (
          <SearchBar
            open={searchOpen}
            onClose={onSearchClose}
            onNext={searchNext}
            onPrev={searchPrev}
            onClear={clearSearch}
          />
        )}
      </div>

      <Toolbar
        shortcuts={config.shortcuts}
        commands={config.commands}
        onSendData={(data) => send({ type: 'user_input', data })}
        onSubmitCommand={(text) => send({ type: 'user_input', data: text + '\r' })}
        onPrefillCommand={(text) => setInputValue(text)}
        disabled={disabled || connectionStatus !== 'connected'}
      />

      <InputBar
        ref={inputBarRef}
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleUserInput}
        disabled={disabled || connectionStatus !== 'connected'}
      />

      {active && <IpChangeToast info={ipChange} onDismiss={() => setIpChange(null)} />}
    </div>
  );
}
