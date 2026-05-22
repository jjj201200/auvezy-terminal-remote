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
// 'gave_up'   :达到最大重试次数后停止自动重连，等用户手动点 / 网络事件触发重置
// 'no_instance':当前没有 active 实例(实例列表空)。区别于 'disconnected' —— 后者暗示
//              "断开",而 no_instance 是"没有任何要连接的目标"。MultiInstanceConsole
//              在 activeId 为 null 时传该值给 StatusBar。
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'gave_up'
  | 'no_instance';

interface AppState {
  /** 默认实例的 WS 状态（多实例时各实例状态另存） */
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (s: ConnectionStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'connecting',
  setConnectionStatus: (s) => set({ connectionStatus: s }),
}));
