/**
 * ws-protocol 类型守卫单测
 *
 * 覆盖：
 * - 合法 ServerMessage 全部 8 种 type 都能识别
 * - 合法 ClientMessage 全部 3 种 type 都能识别
 * - 非对象 / 缺 type / 未知 type 一律返回 false
 */

import { describe, it, expect } from 'vitest';
import { isServerMessage, isClientMessage } from './ws-protocol.js';

describe('isServerMessage', () => {
  it('识别 8 种合法服务端消息类型', () => {
    const validTypes = [
      'terminal_output',
      'status_update',
      'history_sync',
      'heartbeat',
      'error',
      'session_ended',
      'terminal_resize',
      'ip_changed',
    ];
    for (const type of validTypes) {
      expect(isServerMessage({ type })).toBe(true);
    }
  });

  it('拒绝未知 type', () => {
    expect(isServerMessage({ type: 'unknown_msg' })).toBe(false);
  });

  it('拒绝缺 type 字段', () => {
    expect(isServerMessage({ data: 'x' })).toBe(false);
  });

  it('拒绝非对象输入', () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage(undefined)).toBe(false);
    expect(isServerMessage('string')).toBe(false);
    expect(isServerMessage(42)).toBe(false);
    expect(isServerMessage([])).toBe(false);
  });

  it('拒绝客户端消息类型混入', () => {
    // user_input 是 ClientMessage，不能被识别为 ServerMessage
    expect(isServerMessage({ type: 'user_input', data: 'x' })).toBe(false);
  });
});

describe('isClientMessage', () => {
  it('识别 3 种合法客户端消息类型', () => {
    expect(isClientMessage({ type: 'user_input', data: 'x' })).toBe(true);
    expect(isClientMessage({ type: 'resize', cols: 80, rows: 24 })).toBe(true);
    expect(isClientMessage({ type: 'heartbeat', timestamp: 1 })).toBe(true);
  });

  it('拒绝服务端消息类型混入', () => {
    expect(isClientMessage({ type: 'terminal_output', data: 'x', seq: 0 })).toBe(false);
  });

  it('拒绝非对象输入', () => {
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage(undefined)).toBe(false);
    expect(isClientMessage(123)).toBe(false);
  });
});
