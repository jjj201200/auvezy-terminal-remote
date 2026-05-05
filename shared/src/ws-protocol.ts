/**
 * WebSocket 消息协议（前后端共享）
 *
 * 这是整个系统的协议真相源。所有 WS 消息必须包含 `type` 字段，
 * TypeScript 通过 type 字段缩窄派生类型，handler 只需 switch on type。
 *
 * 设计原则：
 * - 服务端只发 ServerMessage 中定义的 8 种类型
 * - 客户端只发 ClientMessage 中定义的 3 种类型
 * - 任何新增字段必须保持向前兼容（旧客户端忽略未知字段）
 * - seq 单调递增，仅作版本戳，不支持差量恢复（详见 ADR-006）
 *
 * 修改本文件等于修改协议契约——前后端必须同步重新构建并联调。
 */

// ============================================================
// 通用枚举
// ============================================================

/**
 * 会话状态
 *
 * - pty_pending：backend 已 listen，但 PTY 子进程尚未 spawn
 *   （等待第一个 webapp 连入 / 用户按 Enter / 兜底超时）
 * - idle：PTY 已启动后又退出 / 早期会话尚未 spawn 的兼容状态
 * - running：进程运行中，无审批等待
 * - waiting_input：Claude 触发了 Notification hook，等待人工审批
 */
export type SessionStatus = 'pty_pending' | 'idle' | 'running' | 'waiting_input';

// ============================================================
// 服务端 → 客户端
// ============================================================

/**
 * 终端输出片段（PTY 实时输出经批合并后下发）
 *
 * data 是原始 ANSI 字符串，xterm.js 直接渲染（含颜色、控制序列）。
 * seq 是单调递增的版本戳——客户端可用它判断是否漏收（不支持差量重传，
 * 漏收时通过 history_sync 全量恢复）。
 */
export interface TerminalOutputMessage {
  type: 'terminal_output';
  data: string;
  seq: number;
}

/**
 * 状态更新（idle / running / waiting_input 三态切换）
 *
 * detail 是可选的人类可读说明（如 "Waiting for input: Bash"）。
 */
export interface StatusUpdateMessage {
  type: 'status_update';
  status: SessionStatus;
  detail?: string;
}

/**
 * 历史同步（重连或新客户端连入时一次性回放）
 *
 * data 是 OutputBuffer 当前完整内容（最多 maxBufferLines 行）。
 * seq 是当前最新版本戳，cols/rows 是当前 PTY 尺寸（让前端 xterm 与 PTY 对齐）。
 */
export interface HistorySyncMessage {
  type: 'history_sync';
  data: string;
  seq: number;
  status: SessionStatus;
  cols?: number;
  rows?: number;
}

/**
 * 心跳（服务端→客户端方向）
 *
 * 服务端通过原生 WS ping/pong 帧维持连接活性，业务层 heartbeat
 * 仅在客户端主动发起 heartbeat 时回包响应（由 ws-handler 处理）。
 */
export interface ServerHeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}

/**
 * 错误消息
 *
 * code 使用 errors.ts 定义的 ErrorCode 枚举值。
 * message 是面向最终用户的人类可读说明。
 */
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * 会话结束（PTY 进程退出）
 *
 * exitCode 0 表示正常退出，非 0 表示异常。
 * reason 给前端展示（如 "Process exited normally"）。
 */
export interface SessionEndedMessage {
  type: 'session_ended';
  exitCode: number;
  reason: string;
}

/**
 * 终端尺寸变更通知
 *
 * 服务端通知客户端"PTY 实际尺寸已变化"。客户端用此对齐 xterm 显示。
 *
 * 触发场景：
 * - PC 端 SIGWINCH（无 webapp 时）
 * - webapp 调整尺寸后（让 attach 跟随）
 * - webapp 全断开 attach 仍在时（让 attach 重新自纠正）
 */
export interface TerminalResizeMessage {
  type: 'terminal_resize';
  cols: number;
  rows: number;
}

/**
 * IP 变化通知
 *
 * PC 局域网 IP 漂移（如 wifi 切换）时广播，让前端展示新 URL，
 * 提示用户记下新地址或重新扫码。
 */
export interface IpChangedMessage {
  type: 'ip_changed';
  oldIp: string;
  newIp: string;
  newUrl: string;
}

/** 服务端可发送的所有消息类型（union） */
export type ServerMessage =
  | TerminalOutputMessage
  | StatusUpdateMessage
  | HistorySyncMessage
  | ServerHeartbeatMessage
  | ErrorMessage
  | SessionEndedMessage
  | TerminalResizeMessage
  | IpChangedMessage;

// ============================================================
// 客户端 → 服务端
// ============================================================

/**
 * 用户输入
 *
 * data 是原始字符串，可包含 ANSI 控制序列（如方向键、Esc）。
 * 服务端不解析，直接 PTY.write(data) 透传。
 */
export interface UserInputMessage {
  type: 'user_input';
  data: string;
}

/**
 * 终端尺寸调整请求
 *
 * 服务端的 SessionController 会按主从仲裁规则决定是否真正应用：
 * - webapp 在线时，attach 的 resize 被忽略（webapp 是主控）
 * - 其它情况按收到顺序应用到 PTY
 */
export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

/**
 * 心跳（客户端→服务端方向）
 *
 * 服务端收到后回包 ServerHeartbeatMessage 用于 RTT 估算。
 */
export interface ClientHeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}

/** 客户端可发送的所有消息类型（union） */
export type ClientMessage =
  | UserInputMessage
  | ResizeMessage
  | ClientHeartbeatMessage;

// ============================================================
// 类型守卫
// ============================================================

/**
 * 判断未知值是否为合法的 ServerMessage
 *
 * 仅做最小类型校验：是对象 + 有 type 字段 + type 在已知集合内。
 * 字段细节由 handler 自己再次校验（避免重复劳动）。
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'terminal_output' ||
    type === 'status_update' ||
    type === 'history_sync' ||
    type === 'heartbeat' ||
    type === 'error' ||
    type === 'session_ended' ||
    type === 'terminal_resize' ||
    type === 'ip_changed'
  );
}

/** 判断未知值是否为合法的 ClientMessage */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'user_input' || type === 'resize' || type === 'heartbeat';
}
