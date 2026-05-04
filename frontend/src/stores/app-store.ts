/**
 * 应用全局状态（zustand）
 *
 * 阶段 1：仅放 WS 连接状态。后续阶段加：
 * - 当前实例 id（多实例切换）
 * - 各实例连接状态映射
 * - 推送权限状态等
 */

import { create } from 'zustand';

/** WS 连接状态 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface AppState {
  /** 默认实例的 WS 状态（多实例时各实例状态另存） */
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (s: ConnectionStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'connecting',
  setConnectionStatus: (s) => set({ connectionStatus: s }),
}));
