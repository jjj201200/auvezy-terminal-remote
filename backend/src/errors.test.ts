/**
 * errors 模块单测
 *
 * 覆盖：
 * - AppError 基类字段保留
 * - 子类自动设置默认 httpStatus
 * - cause 链保留原始 stack
 * - toAppError 规范化各类输入
 * - toPayload 输出形状正确
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import {
  AppError,
  AuthError,
  PtyError,
  WsError,
  ConfigError,
  InstanceError,
  LockError,
  HookError,
  PushError,
  toAppError,
} from './errors.js';

describe('AppError 基类', () => {
  it('保留 code / message / httpStatus / cause', () => {
    const cause = new Error('原始错误');
    const err = new AppError(ErrorCode.INTERNAL_ERROR, '消息', 500, cause);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.message).toBe('消息');
    expect(err.httpStatus).toBe(500);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('AppError');
  });

  it('cause 是 Error 时拼接到 stack 末尾', () => {
    const cause = new Error('底层错');
    const err = new AppError(ErrorCode.INTERNAL_ERROR, '上层错', 500, cause);
    expect(err.stack).toContain('Caused by:');
    expect(err.stack).toContain('底层错');
  });

  it('未传 cause 时 stack 不含 Caused by', () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, '消息');
    expect(err.stack).not.toContain('Caused by:');
  });

  it('toPayload 仅输出 code 和 message', () => {
    const err = new AppError(ErrorCode.INTERNAL_ERROR, '消息', 500);
    expect(err.toPayload()).toEqual({
      code: ErrorCode.INTERNAL_ERROR,
      message: '消息',
    });
  });
});

describe('子类默认 httpStatus', () => {
  it('AuthError 默认 401', () => {
    expect(new AuthError(ErrorCode.AUTH_INVALID_TOKEN, 'x').httpStatus).toBe(401);
  });

  it('PtyError 默认 500', () => {
    expect(new PtyError(ErrorCode.PTY_NOT_RUNNING, 'x').httpStatus).toBe(500);
  });

  it('WsError 默认 400', () => {
    expect(new WsError(ErrorCode.WS_INVALID_MESSAGE, 'x').httpStatus).toBe(400);
  });

  it('ConfigError 默认 500', () => {
    expect(new ConfigError(ErrorCode.CONFIG_PARSE_ERROR, 'x').httpStatus).toBe(500);
  });

  it('InstanceError 默认 400', () => {
    expect(new InstanceError(ErrorCode.INSTANCE_NOT_FOUND, 'x').httpStatus).toBe(400);
  });

  it('LockError 默认 503', () => {
    expect(new LockError(ErrorCode.LOCK_TIMEOUT, 'x').httpStatus).toBe(503);
  });

  it('HookError 默认 400', () => {
    expect(new HookError(ErrorCode.HOOK_NON_LOCALHOST, 'x').httpStatus).toBe(400);
  });

  it('PushError 默认 500', () => {
    expect(new PushError(ErrorCode.PUSH_VAPID_NOT_READY, 'x').httpStatus).toBe(500);
  });

  it('子类的 name 字段是子类名', () => {
    expect(new AuthError(ErrorCode.AUTH_INVALID_TOKEN, 'x').name).toBe('AuthError');
    expect(new PtyError(ErrorCode.PTY_NOT_RUNNING, 'x').name).toBe('PtyError');
  });

  it('显式覆盖 httpStatus 生效', () => {
    expect(new AuthError(ErrorCode.AUTH_RATE_LIMITED, 'x', 429).httpStatus).toBe(429);
  });
});

describe('toAppError 规范化', () => {
  it('AppError 直接透传', () => {
    const original = new PtyError(ErrorCode.PTY_NOT_RUNNING, 'x');
    expect(toAppError(original)).toBe(original);
  });

  it('Error 包成 INTERNAL_ERROR', () => {
    const result = toAppError(new Error('普通错误'));
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('普通错误');
  });

  it('字符串包成 INTERNAL_ERROR', () => {
    const result = toAppError('字符串错误');
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('字符串错误');
  });

  it('其它类型用通用兜底文案', () => {
    const result = toAppError({ weird: true });
    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.message).toBe('未知错误');
  });

  it('null/undefined 也包装', () => {
    expect(toAppError(null).code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(toAppError(undefined).code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
