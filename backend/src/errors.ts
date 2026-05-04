/**
 * 错误体系（AppError 基类 + 分类子类）
 *
 * 设计目标：
 * - 业务模块抛 AppError 子类，不抛裸 Error 或字符串
 * - Express 路由层 catch 后统一转换为 JSON 响应
 * - WS 层 catch 后转换为 ErrorMessage 广播
 * - 日志层按 code 字段聚合统计
 *
 * 与上游差异：上游使用裸 Error + 字符串字面量，我们体系化。
 *
 * 用法示例：
 * ```ts
 * if (!process) {
 *   throw new PtyError(ErrorCode.PTY_NOT_RUNNING, 'PTY 未启动');
 * }
 *
 * try {
 *   await something();
 * } catch (err) {
 *   throw new ConfigError(
 *     ErrorCode.CONFIG_PARSE_ERROR,
 *     'config.json 解析失败',
 *     500,
 *     err,
 *   );
 * }
 * ```
 */

import { ErrorCode, type ErrorPayload } from '@ocr/shared';

/**
 * 应用错误基类
 *
 * 所有领域错误必须继承此类（或其子类）。
 *
 * @field code      ErrorCode 枚举值，用于跨进程识别错误类别
 * @field httpStatus  对应的 HTTP 状态码（默认 500）
 * @field cause     可选的原始错误（来自第三方库或下层），便于栈追踪
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public override readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number = 500,
    cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.cause = cause;

    // 保留原始错误的 stack（cause 链），便于调试
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }

  /**
   * 转换为协议层 ErrorPayload，用于 HTTP 响应或 WS error 消息
   */
  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

// ============================================================
// 分类子类（仅起类型标识与默认 httpStatus 作用，无附加行为）
// ============================================================

/** 认证 / 授权错误（默认 401） */
export class AuthError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 401, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** PTY 进程相关错误（默认 500） */
export class PtyError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 500, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** WebSocket 协议错误（默认 400） */
export class WsError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 400, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** 配置加载/写入错误（默认 500） */
export class ConfigError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 500, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** 实例管理错误（默认 400） */
export class InstanceError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 400, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** 文件锁错误（默认 503，调用方可重试） */
export class LockError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 503, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** Hook 接收错误（默认 400） */
export class HookError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 400, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

/** Web Push 错误（默认 500） */
export class PushError extends AppError {
  constructor(code: ErrorCode, message: string, httpStatus = 500, cause?: unknown) {
    super(code, message, httpStatus, cause);
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 把任意 unknown 错误规范化为 AppError
 *
 * 用于 catch 块入口的统一处理：
 * - 已经是 AppError 直接返回
 * - 是 Error 包成 INTERNAL_ERROR
 * - 其它（字符串、对象、null）也包成 INTERNAL_ERROR
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError(ErrorCode.INTERNAL_ERROR, err.message, 500, err);
  }
  const message = typeof err === 'string' ? err : '未知错误';
  return new AppError(ErrorCode.INTERNAL_ERROR, message, 500, err);
}
