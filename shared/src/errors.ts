/**
 * 错误码枚举（前后端共享）
 *
 * 设计目的：
 * - 让 WS error 消息和 HTTP 错误响应使用统一码表
 * - 让前端能根据 code 做差异化处理（如 SESSION_EXPIRED 自动跳认证页）
 * - 让日志能聚合同类错误（按 code 分组）
 *
 * 命名规范：
 * - 全大写 + 下划线
 * - 字符串值用 "<分类>_<细节>" 形式，便于日志阅读
 * - 分类前缀对应错误来源域，分类内顺序无所谓
 *
 * 修改要求：
 * - 只增不删（已用 code 不能改值，否则前端老版本会失配）
 * - 新增 code 必须同步更新 backend/src/errors.ts 的 AppError 子类
 */

export enum ErrorCode {
  // ──────────────── 认证类 ────────────────
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
  AUTH_RATE_LIMITED = 'AUTH_RATE_LIMITED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING',

  // ──────────────── PTY 类 ────────────────
  PTY_SPAWN_FAILED = 'PTY_SPAWN_FAILED',
  PTY_NOT_RUNNING = 'PTY_NOT_RUNNING',
  PTY_RESIZE_FAILED = 'PTY_RESIZE_FAILED',
  PTY_WRITE_FAILED = 'PTY_WRITE_FAILED',

  // ──────────────── WebSocket 类 ────────────────
  WS_INVALID_MESSAGE = 'WS_INVALID_MESSAGE',
  WS_PAYLOAD_TOO_LARGE = 'WS_PAYLOAD_TOO_LARGE',
  WS_CONNECTION_CLOSED = 'WS_CONNECTION_CLOSED',

  // ──────────────── 配置类 ────────────────
  CONFIG_PARSE_ERROR = 'CONFIG_PARSE_ERROR',
  CONFIG_VALIDATION_FAIL = 'CONFIG_VALIDATION_FAIL',
  CONFIG_WRITE_FAILED = 'CONFIG_WRITE_FAILED',

  // ──────────────── 实例类 ────────────────
  INSTANCE_NOT_FOUND = 'INSTANCE_NOT_FOUND',
  INSTANCE_ALREADY_RUNNING = 'INSTANCE_ALREADY_RUNNING',
  PORT_UNAVAILABLE = 'PORT_UNAVAILABLE',
  WORKSPACE_FORBIDDEN = 'WORKSPACE_FORBIDDEN',
  CWD_NOT_EXIST = 'CWD_NOT_EXIST',

  // ──────────────── 文件锁类 ────────────────
  LOCK_TIMEOUT = 'LOCK_TIMEOUT',
  LOCK_RELEASE_FAILED = 'LOCK_RELEASE_FAILED',

  // ──────────────── Web Push 类 ────────────────
  PUSH_VAPID_NOT_READY = 'PUSH_VAPID_NOT_READY',
  PUSH_SUBSCRIPTION_INVALID = 'PUSH_SUBSCRIPTION_INVALID',
  PUSH_SEND_FAILED = 'PUSH_SEND_FAILED',

  // ──────────────── Hook 类 ────────────────
  HOOK_INVALID_PAYLOAD = 'HOOK_INVALID_PAYLOAD',
  HOOK_NON_LOCALHOST = 'HOOK_NON_LOCALHOST',

  // ──────────────── 内部类 ────────────────
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

/**
 * 错误响应体（HTTP 与 WS error 消息共用）
 *
 * 前端 api-client 与 WS handler 都解析此结构。
 */
export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** 可选的额外上下文（如限流剩余秒数、字段名等） */
  details?: Record<string, unknown>;
}
