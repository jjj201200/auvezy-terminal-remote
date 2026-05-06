/**
 * useDisconnected
 *
 * 包装 disconnected-instances 给 React 用:
 *  - 返回 set + check + 操作函数
 *  - 跨 tab/组件状态同步(window 'storage' 事件 + 进程内 ref count)
 *
 * 没用 useSyncExternalStore 是因为我们这个集合的写者就 1-2 个组件,
 * 简单 useState + 小广播就够。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  clearDisconnected,
  getDisconnected,
  markDisconnected,
} from '../services/disconnected-instances.js';

const EVENT_NAME = 'ocr:disconnected-changed';

function emit(): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export interface UseDisconnectedResult {
  disconnected: ReadonlySet<string>;
  isDisconnected: (id: string) => boolean;
  /** 标记断开(同时本地持久化 + 通知所有订阅者) */
  disconnect: (id: string) => void;
  /** 取消断开标记 */
  reconnect: (id: string) => void;
}

/** 两个集合内容是否一致（顺序无关） */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function useDisconnected(): UseDisconnectedResult {
  const [set, setSet] = useState<Set<string>>(() => new Set(getDisconnected()));

  useEffect(() => {
    const refresh = (): void => {
      const next = new Set(getDisconnected());
      // 内容没变就不更新引用，避免 isDisconnected 的依赖跟着变 → 父组件重 render
      setSet((prev) => (setsEqual(prev, next) ? prev : next));
    };
    window.addEventListener(EVENT_NAME, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT_NAME, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const disconnect = useCallback((id: string): void => {
    markDisconnected(id);
    emit();
  }, []);

  const reconnect = useCallback((id: string): void => {
    clearDisconnected(id);
    emit();
  }, []);

  const isDisconnectedFn = useCallback((id: string): boolean => set.has(id), [set]);

  return { disconnected: set, isDisconnected: isDisconnectedFn, disconnect, reconnect };
}
