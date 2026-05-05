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
// 'gave_up'：达到最大重试次数后停止自动重连，等用户手动点 / 网络事件触发重置
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'gave_up';

interface AppState {
  /** 默认实例的 WS 状态（多实例时各实例状态另存） */
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (s: ConnectionStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'connecting',
  setConnectionStatus: (s) => set({ connectionStatus: s }),
}));
