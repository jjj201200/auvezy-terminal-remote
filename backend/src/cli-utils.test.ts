/**
 * cli-utils 单测
 */

import { describe, it, expect } from 'vitest';
import { parseCliArgs } from './cli-utils.js';
import { ConfigError } from './errors.js';

describe('parseCliArgs', () => {
  it('空 argv → start 子命令 + 默认空 claudeArgs', () => {
    const r = parseCliArgs([]);
    expect(r.subcommand).toBe('start');
    expect(r.claudeArgs).toEqual([]);
  });

  it('--port 3001 解析为数值', () => {
    const r = parseCliArgs(['--port', '3001']);
    expect(r.port).toBe(3001);
  });

  it('--port=3001 等号形式', () => {
    const r = parseCliArgs(['--port=3001']);
    expect(r.port).toBe(3001);
  });

  it('--no-terminal boolean flag', () => {
    const r = parseCliArgs(['--no-terminal']);
    expect(r.noTerminal).toBe(true);
  });

  it('-- 之后透传给 claudeArgs', () => {
    const r = parseCliArgs(['--port', '3001', '--', '--settings', '/path']);
    expect(r.port).toBe(3001);
    expect(r.claudeArgs).toEqual(['--settings', '/path']);
  });

  it('-- 之后 dash 也透传', () => {
    const r = parseCliArgs(['--', '-x', '--y', 'z']);
    expect(r.claudeArgs).toEqual(['-x', '--y', 'z']);
  });

  it('attach <url> 子命令', () => {
    const r = parseCliArgs(['attach', 'http://192.168.1.10:3000?token=abc']);
    expect(r.subcommand).toBe('attach');
    expect(r.attachUrl).toBe('http://192.168.1.10:3000?token=abc');
  });

  it('attach 缺 URL → ConfigError', () => {
    expect(() => parseCliArgs(['attach'])).toThrow(ConfigError);
  });

  it('list 子命令', () => {
    expect(parseCliArgs(['list']).subcommand).toBe('list');
  });

  it('首位置参数非保留子命令 → 视为 PTY program', () => {
    const r = parseCliArgs(['zsh']);
    expect(r.subcommand).toBe('start');
    expect(r.command).toBe('zsh');
    expect(r.claudeArgs).toEqual([]);
  });

  it('otr <prog> [args...] → command + 透传位置参数', () => {
    const r = parseCliArgs(['claude', '--resume', 'task1']);
    expect(r.command).toBe('claude');
    expect(r.claudeArgs).toEqual(['--resume', 'task1']);
  });

  it('otr <prog> 与 --port 混用', () => {
    const r = parseCliArgs(['claude', '--port', '3002']);
    expect(r.command).toBe('claude');
    expect(r.port).toBe(3002);
    expect(r.claudeArgs).toEqual([]);
  });

  it('otr <prog> -- 后位置参数', () => {
    const r = parseCliArgs(['zsh', '--', '-l']);
    expect(r.command).toBe('zsh');
    expect(r.claudeArgs).toEqual(['-l']);
  });

  it('未指定 program 时位置参数仍报错', () => {
    // 没首位置参数 program，中间冒出来一个非 flag 字符串 → 报错防误触
    expect(() => parseCliArgs(['--port', '3001', 'oops'])).toThrow(/未知参数/);
  });

  it('未知 flag → ConfigError', () => {
    expect(() => parseCliArgs(['--what'])).toThrow(/未知参数/);
  });

  it('--port 缺值 → ConfigError', () => {
    expect(() => parseCliArgs(['--port'])).toThrow(/缺少值/);
  });

  it('--port 非法 → ConfigError', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/--port 非法/);
    expect(() => parseCliArgs(['--port', '0'])).toThrow();
    expect(() => parseCliArgs(['--port', '99999'])).toThrow();
  });

  it('多个参数组合', () => {
    const r = parseCliArgs([
      '--port',
      '3001',
      '--token',
      'abc',
      '--workdir',
      '/tmp',
      '--no-terminal',
      '--instance-name',
      'foo',
      '--',
      '--dangerously',
    ]);
    expect(r).toMatchObject({
      port: 3001,
      token: 'abc',
      workdir: '/tmp',
      noTerminal: true,
      instanceName: 'foo',
      claudeArgs: ['--dangerously'],
    });
  });

  it('--max-buffer-lines 非正整数 → ConfigError', () => {
    expect(() => parseCliArgs(['--max-buffer-lines', '-5'])).toThrow();
    expect(() => parseCliArgs(['--max-buffer-lines', '0'])).toThrow();
    expect(parseCliArgs(['--max-buffer-lines', '500']).maxBufferLines).toBe(500);
  });

  it('--help / --version 仅置 flag', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
  });
});
