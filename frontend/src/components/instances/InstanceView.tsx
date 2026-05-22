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
import type {
  ServerMessage,
  SessionStatus,
  SessionStatusExtras,
  ClientMessage,
  UserConfig,
} from 'auvezy-terminal-remote-shared';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useTouchSwipeScroll } from '../../hooks/useTouchSwipeScroll.js';
import { isMouseReportingActive } from '../../utils/xterm-internals.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import { LongPressIndicator } from '../input/LongPressIndicator.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import type { ConnectionStatus } from '../../stores/app-store.js';
import { useT } from '../../i18n/i18n-context.js';
import { useLocalNotification } from '../../hooks/useLocalNotification.js';
import { TerminalView } from '../terminal/TerminalView.js';
import { ScrollNavButtons } from '../terminal/ScrollNavButtons.js';
import { SearchBar } from '../terminal/SearchBar.js';
import { InputBar, type InputBarHandle } from '../input/InputBar.js';
import { DirectInputCapture } from '../input/DirectInputCapture.js';
import { Toolbar } from '../input/Toolbar.js';
import { IpChangeToast, type IpChangeInfo } from '../common/IpChangeToast.js';
import s from '../../pages/ConsolePage.module.scss';

/**
 * 从 status_update / history_sync 消息里抽出 SessionStatusExtras 字段
 *
 * 旧后端没有这些字段,统一返回空对象;新后端会把 extras 平铺在消息上(协议层
 * 设计为 extends SessionStatusExtras),这里只挑感兴趣的字段。
 */
function extractExtras(msg: SessionStatusExtras): SessionStatusExtras {
  return {
    integrationId: msg.integrationId,
    activeTool: msg.activeTool,
    pendingApprovals: msg.pendingApprovals,
    pendingApprovalTools: msg.pendingApprovalTools,
    lastError: msg.lastError,
    lastAssistantMessage: msg.lastAssistantMessage,
  };
}

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
    s: {
      connection: ConnectionStatus;
      session: SessionStatus;
      /** 富状态:integration 模块上报的活跃工具 / 审批计数 / 失败信息等 */
      extras?: SessionStatusExtras;
    },
  ) => void;
  /** 上层提供 reconnect 回调；第一参数也是 instanceId（同上） */
  registerReconnect?: (instanceId: string, fn: () => void) => void;
  /**
   * active 实例向上层注册 adaptToDevice：上层顶栏的"按当前设备适配"按钮调它。
   * 跟 registerReconnect 同模式：上层只用一个稳定回调注册，避免每次 InstanceView
   * 内部 effect 重跑触发死循环
   */
  registerAdapt?: (instanceId: string, fn: () => void) => void;
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
  registerAdapt,
  searchOpen,
  onSearchClose,
  disabled = false,
  onReconnect,
}: InstanceViewProps): JSX.Element {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // InputBar 是非受控组件，通过 imperative ref 操作 buffer（focus / setValue / clear）
  const inputBarRef = useRef<InputBarHandle | null>(null);
  // 直接输入模式专用：自挂的透明 textarea（替代 xterm helper-textarea，绕开 iOS bug）
  const directCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const useInputBar = config.input?.useInputBar !== false;
  // 长按视觉反馈：触摸点屏幕坐标（fixed 定位用 viewport 坐标）；null = 不显示
  const [longPressFx, setLongPressFx] = useState<{ x: number; y: number } | null>(null);
  const LONG_PRESS_MS = 600;
  // 进度条延迟出现 200ms 防止短按 / 滑动闪一下；剩余时长走完到 LONG_PRESS_MS
  const PROGRESS_BAR_DELAY_MS = 200;
  const PROGRESS_BAR_DURATION_MS = LONG_PRESS_MS - PROGRESS_BAR_DELAY_MS;
  const sendRef = useRef<((msg: ClientMessage) => boolean) | null>(null);

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [sessionExtras, setSessionExtras] = useState<SessionStatusExtras>({});
  const [hasPtyOutput, setHasPtyOutput] = useState(false);
  const [ipChange, setIpChange] = useState<IpChangeInfo | null>(null);
  // 由 backend pty-manager 监听 DECSET 1049/1047/47 推送
  // 移动端 touch swipe → 方向键的开关：alt-screen 时启用，否则让 xterm 走原生滚动
  const [inAltScreen, setInAltScreen] = useState(false);

  const localNotify = useLocalNotification();

  const handleResize = useCallback((cols: number, rows: number, master?: boolean): boolean => {
    return sendRef.current?.({
      type: 'resize',
      cols,
      rows,
      ...(master ? { master: true } : {}),
    }) ?? false;
  }, []);

  const {
    write,
    scrollToBottom,
    setAutoFollow,
    showScrollHint,
    adaptToPtySize,
    adaptToDevice,
    searchNext,
    searchPrev,
    clearSearch,
    getSelection,
    setOnData,
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
          setSessionExtras(extractExtras(msg));
          break;
        case 'status_update':
          setSessionStatus(msg.status);
          setSessionExtras(extractExtras(msg));
          if (msg.status === 'waiting_input') {
            localNotify.notify('Claude 等待审批', msg.detail ?? '请在 Claude 中确认');
          }
          break;
        case 'terminal_resize':
          // PTY 主动 resize 通知（如 attach CLI 调用 stty / backend 的
          // double-pulse hack 触发的两次 SIGWINCH）。这里**不要** fit() —— 否则
          // 会让 xterm 跟着 PTY 缩，跟键盘期间 CSS 容器小尺寸叠加 → xterm
          // 错误缩小。PTY 尺寸跟 xterm 物理尺寸是单向同步（前端 → PTY），
          // 反向通知仅作记录用，不动 xterm
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
          setInAltScreen(msg.inAltScreen);
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

  // 移动端 touch swipe / 桌面 wheel → PgUp/PgDn（仅 alt-screen TUI 内）
  // termRef 让 hook 内部能实时检查 buffer 类型，比 backend alt_screen_change
  // 消息更可靠（重连 / 消息丢失场景）
  useTouchSwipeScroll({
    containerRef,
    altScreen: inAltScreen,
    termRef,
    enabled: config.input?.tuiScrollEnabled !== false,
    scrollLines: config.input?.scrollLines ?? 3,
    tuiTapEnabled: config.input?.tuiTapEnabled !== false,
    // 移动端长按 = 弹 IME（focus 输入框）：方案 1+2 的第 2 部分，让用户在
    // mouse-reporting TUI 内能明确表达"我要打字"意图，避免短 tap 同时弹 IME
    onLongPress: () => {
      if (useInputBar) {
        inputBarRef.current?.focus({ preventScroll: true });
      } else {
        directCaptureRef.current?.focus({ preventScroll: true });
      }
    },
    longPressMs: LONG_PRESS_MS,
    // 长按视觉反馈：在触摸点上方显示倒计时进度条
    onLongPressStart: (x, y) => setLongPressFx({ x, y }),
    onLongPressCancel: () => setLongPressFx(null),
    onSendKey: (data) => {
      sendRef.current?.({ type: 'user_input', data });
    },
  });

  // 把状态变化上报给父组件（active 时父组件会显示）
  useEffect(() => {
    onStatusChange?.(instanceId, {
      connection: connectionStatus,
      session: sessionStatus,
      extras: sessionExtras,
    });
  }, [instanceId, connectionStatus, sessionStatus, sessionExtras, onStatusChange]);

  // active 时把 reconnect 函数注册给父组件
  useEffect(() => {
    if (active) registerReconnect?.(instanceId, connect);
  }, [instanceId, active, connect, registerReconnect]);

  // active 时把 adaptToDevice 注册给父组件（顶栏按钮用）
  useEffect(() => {
    if (active) registerAdapt?.(instanceId, adaptToDevice);
  }, [instanceId, active, adaptToDevice, registerAdapt]);

  // active 时把当前实例端口写入 console-bridge tag —— 多端共连同一 backend
  // 看日志时能区分来源（[iPhone-Chrome-A3F2:3001]）
  useEffect(() => {
    if (!active) return;
    // 从 wsUrl 抠端口（同源时 wsUrl=undefined，回退用 location.port 或 'self'）
    let port = window.location.port || 'self';
    if (wsUrl) {
      try {
        port = new URL(wsUrl).port || port;
      } catch { /* invalid url */ }
    }
    void import('../../utils/console-bridge.js').then(({ setConsoleBridgeInstance }) => {
      setConsoleBridgeInstance(port);
    });
  }, [active, wsUrl]);

  const handleUserInput = useCallback(
    (data: string): boolean => send({ type: 'user_input', data }),
    [send],
  );

  // 直接输入模式不再依赖 xterm.onData —— 桌面端能用，但 iOS WebKit 下 xterm
  // 的 helper-textarea input 事件不可靠（仅退格 keydown 有效）。改成自挂
  // DirectInputCapture，所有按键 / IME 经过我们自己的 textarea，事件可靠。
  // 因此 onData 永远置空，不再注册回调
  useEffect(() => {
    setOnData(null);
  }, [setOnData]);

  const sendDirect = useCallback(
    (data: string): void => {
      // eslint-disable-next-line no-console
      console.log('[IV] sendDirect', JSON.stringify({ data, len: data.length, codes: [...data].map((c) => c.charCodeAt(0)) }));
      send({ type: 'user_input', data });
    },
    [send],
  );

  const handleScrollToBottom = useCallback(() => {
    setAutoFollow(true);
    scrollToBottom();
  }, [scrollToBottom, setAutoFollow]);

  // useInputBar=true 时通过 CSS 让 xterm helper-textarea 不接收点击
  // （pointer-events: none），点击穿透到 .terminalWrap → 走下面 onClick 转
  // focus 到 InputBar。helper-textarea 永远不获焦 → 没有焦点抢夺 / 闪烁。
  // useInputBar=false 时不加这个 class，xterm 自己处理 focus + IME（中文也走它）

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
        void copyToClipboard(text);
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
      {/*
        SearchBar：active 实例可见时挂在终端区上方，作为 flex 容器一项占行高。
        open 时挤压 terminalWrap → xterm ResizeObserver 触发 fit() 自适应行数；
        close 时不渲染（不留空行高，flex 自然收回）。这样不再悬浮遮挡终端内容。
      */}
      {active && searchOpen && (
        <SearchBar
          open
          onClose={onSearchClose}
          onNext={searchNext}
          onPrev={searchPrev}
          onClear={clearSearch}
        />
      )}
      <div
        id="console-terminal-wrap"
        className={s.terminalWrap}
        // 焦点接管：useInputBar=true → InputBar；false → DirectInputCapture。
        //
        // 仅在 **mouse reporting 未激活** 时让 click 弹 IME（普通 shell 场景，
        // 用户 tap 终端就是想打字）。Claude / vim / htop 等启用 mouse reporting
        // 的 TUI 内：短 tap = SGR 点击（hook 处理），长按 = IME（hook onLongPress
        // 调 focus），点击不再额外弹 IME，避免双触发。
        //
        // 用 onClick 而不是 onPointerDown：避免滚动手势的 pointerdown 也触发
        // focus（click 只在 tap 完成且非滚动时才合成）。iOS 上 click 保留
        // user gesture 资格 → 软键盘正常弹起。
        onClick={(e) => {
          // 文本选区场景跳过：让用户能选择/复制
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) return;
          if (!(e.target as HTMLElement | null)?.closest?.('.xterm')) return;
          // mouse reporting 激活 + InputBar 模式（移动端）：不 focus，避免 click 弹 IME。
          // 长按时 hook onLongPress 才显式 focus InputBar（user-gesture 同步链路）。
          // 其他组合（PC / 非 InputBar / 非 mouse-active）正常 focus。
          if (isMouseReportingActive(termRef.current) && useInputBar) return;
          if (useInputBar) {
            inputBarRef.current?.focus({ preventScroll: true });
          } else {
            directCaptureRef.current?.focus({ preventScroll: true });
          }
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
        <ScrollNavButtons visible={showScrollHint} onScrollToBottom={handleScrollToBottom} />
        {!useInputBar && <DirectInputCapture ref={directCaptureRef} onSend={sendDirect} />}
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
        disabled={disabled || connectionStatus !== 'connected'}
      />

      {useInputBar && (
        <InputBar
          ref={inputBarRef}
          onSubmit={handleUserInput}
          disabled={disabled || connectionStatus !== 'connected'}
        />
      )}

      {active && <IpChangeToast info={ipChange} onDismiss={() => setIpChange(null)} />}

      {longPressFx && (
        <LongPressIndicator
          x={longPressFx.x}
          y={longPressFx.y}
          durationMs={PROGRESS_BAR_DURATION_MS}
        />
      )}
    </div>
  );
}
