/**
 * useWebSocket
 *
 * 前端 WS 连接的生命周期管理 + 重连 + 离线检测。
 *
 * 责任：
 *  1. 自动连接 /ws（同源默认；支持显式 wsUrl 用于跨实例）
 *  2. 自动重连：1s → 2s → 4s → 8s → 16s → 30s 退避封顶
 *  3. connectionToken 防 race：异步回调先校验自己是不是当前最新连接
 *  4. dispose 标记：卸载后回调静默失败
 *  5. offline 事件：浏览器从 wifi 切到蜂窝时主动 close 让重连接管
 *  6. send 严格检查 readyState=OPEN，否则返回 false（让上层重发）
 *
 * 阶段 1：不做认证（直接连）。阶段 2 加 token-storage + 自动重认证。
 *
 * 关键设计：
 * - onMessage 用 useRef 镜像，避免父组件回调变化导致整个连接重建
 * - 4 个 ws 事件回调（open/message/close/error）入口都校验 token + 当前 ref
 * - dispose 时自增 token 让所有在飞回调静默失败
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ServerMessage, ClientMessage } from '@otr/shared';
import { useAppStore } from '../stores/app-store.js';
import { WS_RECONNECT_DELAYS_MS, WS_RECONNECT_MAX_ATTEMPTS } from '../config/constants.js';

export interface UseWebSocketReturn {
  /** 立即发起连接（首次 mount 自动调用一次） */
  connect: () => void;
  /** 主动断开（卸载时自动调用） */
  disconnect: () => void;
  /** 发送一条消息；OPEN 才发，非 OPEN 返回 false */
  send: (msg: ClientMessage) => boolean;
}

/**
 * @param onMessage 收到服务端消息的回调
 * @param wsUrl 可选显式 URL；默认根据 window.location 同源 ws://host/ws
 * @param maxAttempts 自动重连硬上限；默认走 constants 里的 WS_RECONNECT_MAX_ATTEMPTS
 */
export function useWebSocket(
  onMessage: (msg: ServerMessage) => void,
  wsUrl?: string,
  maxAttempts?: number,
): UseWebSocketReturn {
  // ──────────────── refs ────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDisposedRef = useRef(false);
  /** 单调递增的连接版本号——异步回调用它判断自己是否过时 */
  const connectionTokenRef = useRef(0);
  /** 镜像 onMessage 避免父组件 prop 变化触发重连 */
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  // 镜像 maxAttempts 让用户改设置后立即生效，而不必重连
  const maxAttemptsRef = useRef(maxAttempts ?? WS_RECONNECT_MAX_ATTEMPTS);
  maxAttemptsRef.current = maxAttempts ?? WS_RECONNECT_MAX_ATTEMPTS;

  // store setter（zustand 的 setter 是稳定引用，不会触发 re-render）
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const setConnectionStatusRef = useRef(setConnectionStatus);
  setConnectionStatusRef.current = setConnectionStatus;

  /** 只让 connectRef 持有最新 connect 函数（避免依赖循环） */
  const connectRef = useRef<(() => void) | null>(null);

  // ──────────────── 内部：调度重连 ────────────────

  const scheduleReconnect = useCallback((token: number) => {
    if (isDisposedRef.current) return;
    // 硬上限：超过最大次数停手，标记 gave_up 等用户手动点重连
    if (reconnectAttemptRef.current >= maxAttemptsRef.current) {
      setConnectionStatusRef.current('gave_up');
      return;
    }
    const idx = Math.min(reconnectAttemptRef.current, WS_RECONNECT_DELAYS_MS.length - 1);
    const delay = WS_RECONNECT_DELAYS_MS[idx] ?? 30_000;
    reconnectAttemptRef.current++;

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (isDisposedRef.current || token !== connectionTokenRef.current) return;
      connectRef.current?.();
    }, delay);
  }, []);

  // ──────────────── 内部：建立连接 ────────────────

  /**
   * 真正发起 WS 连接。不重置 attempt 计数，由调用方决定。
   * - 来自 scheduleReconnect timer：保留计数（继续退避）
   * - 来自公开 connect()（用户主动）：调用前先归零
   */
  const doConnect = useCallback((): void => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const url = wsUrl ?? (() => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/ws`;
    })();

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    isDisposedRef.current = false;
    const myToken = ++connectionTokenRef.current;

    setConnectionStatusRef.current('connecting');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isDisposedRef.current || myToken !== connectionTokenRef.current || wsRef.current !== ws) return;
      setConnectionStatusRef.current('connected');
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (isDisposedRef.current || myToken !== connectionTokenRef.current || wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        onMessageRef.current(msg);
      } catch {
        // 非法 JSON 静默忽略
      }
    };

    ws.onclose = () => {
      if (isDisposedRef.current || myToken !== connectionTokenRef.current || wsRef.current !== ws) return;
      wsRef.current = null;
      setConnectionStatusRef.current('disconnected');
      scheduleReconnect(myToken);
    };

    ws.onerror = () => {
      // onclose 会跟着触发，这里不做额外处理
    };
  }, [wsUrl, scheduleReconnect]);

  /**
   * 公开 API：用户主动重连。归零 attempt 计数 → 跳出 gave_up 状态。
   * 也是首次 mount 自动触发的入口。
   */
  const connect = useCallback((): void => {
    reconnectAttemptRef.current = 0;
    doConnect();
  }, [doConnect]);

  // 同步最新 doConnect 到 connectRef（scheduleReconnect timer 用它，不重置计数）
  useEffect(() => {
    connectRef.current = doConnect;
  }, [doConnect]);

  // ──────────────── 公共 API ────────────────

  const send = useCallback((msg: ClientMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const disconnect = useCallback((): void => {
    isDisposedRef.current = true;
    connectionTokenRef.current++;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
  }, []);

  // ──────────────── 自动启动 + 离线监听 ────────────────

  useEffect(() => {
    // 浏览器从 wifi 切到蜂窝时会触发 offline，主动 close 让重连接管
    const handleOffline = (): void => {
      wsRef.current?.close();
    };
    // 切回网络时立即重连，不等指数退避 timer
    // gave_up 状态下不自动重连，等用户手动点重连按钮
    const handleOnline = (): void => {
      if (isDisposedRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      if (useAppStore.getState().connectionStatus === 'gave_up') return;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      doConnect();
    };
    // tab 从后台切回时也尝试一次（手机锁屏后 ws 可能被系统 kill 但事件未触达）
    const handleVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      handleOnline();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisible);

    // 首次 mount 自动连
    connect();

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisible);
      isDisposedRef.current = true;
      connectionTokenRef.current++;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
    // 仅在 wsUrl 变化时重建连接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return { connect, disconnect, send };
}
