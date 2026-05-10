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

  it('--list 服务级 flag → service / list', () => {
    const r = parseCliArgs(['--list']);
    expect(r.subcommand).toBe('service');
    expect(r.serviceAction).toBe('list');
  });

  it('--start / --stop / --status / --install / --uninstall / --logs 都映射到 service', () => {
    const cases: Array<[string, string]> = [
      ['--start', 'start'],
      ['--stop', 'stop'],
      ['--status', 'status'],
      ['--install', 'install'],
      ['--uninstall', 'uninstall'],
      ['--logs', 'logs'],
    ];
    for (const [flag, action] of cases) {
      const r = parseCliArgs([flag]);
      expect(r.subcommand).toBe('service');
      expect(r.serviceAction).toBe(action);
    }
  });

  it('服务级 flag 互斥：--start --stop 同时 → ConfigError', () => {
    expect(() => parseCliArgs(['--start', '--stop'])).toThrow(ConfigError);
  });

  it('服务级 flag 不能与 program 共存：--start claude → ConfigError', () => {
    expect(() => parseCliArgs(['--start', 'claude'])).toThrow(ConfigError);
  });

  it('服务级 flag 必须紧跟 atr：claude --start → 透传给 program（视作 program 的参数）', () => {
    const r = parseCliArgs(['claude', '--start']);
    expect(r.subcommand).toBe('start');
    expect(r.command).toBe('claude');
    expect(r.claudeArgs).toEqual(['--start']);
  });

  it('服务级 flag 不在位置 0 且无 program → ConfigError 提示放第一位', () => {
    expect(() => parseCliArgs(['--port', '3001', '--start'])).toThrow(/must come right after atr/);
  });

  it('atr list 不再是子命令 → 视为 PTY program 名 list', () => {
    const r = parseCliArgs(['list']);
    expect(r.subcommand).toBe('start');
    expect(r.command).toBe('list');
  });

  it('首位置参数非保留子命令 → 视为 PTY program', () => {
    const r = parseCliArgs(['zsh']);
    expect(r.subcommand).toBe('start');
    expect(r.command).toBe('zsh');
    expect(r.claudeArgs).toEqual([]);
  });

  it('atr <prog> [args...] → command + 透传位置参数', () => {
    const r = parseCliArgs(['claude', '--resume', 'task1']);
    expect(r.command).toBe('claude');
    expect(r.claudeArgs).toEqual(['--resume', 'task1']);
  });

  it('atr <prog> 与 --port 混用', () => {
    const r = parseCliArgs(['claude', '--port', '3002']);
    expect(r.command).toBe('claude');
    expect(r.port).toBe(3002);
    expect(r.claudeArgs).toEqual([]);
  });

  it('atr <prog> -- 后位置参数', () => {
    const r = parseCliArgs(['zsh', '--', '-l']);
    expect(r.command).toBe('zsh');
    expect(r.claudeArgs).toEqual(['-l']);
  });

  it('未指定 program 时位置参数仍报错', () => {
    // 没首位置参数 program，中间冒出来一个非 flag 字符串 → 报错防误触
    expect(() => parseCliArgs(['--port', '3001', 'oops'])).toThrow(/unknown argument/);
  });

  it('未知 flag → ConfigError', () => {
    expect(() => parseCliArgs(['--what'])).toThrow(/unknown argument/);
  });

  it('--port 缺值 → ConfigError', () => {
    expect(() => parseCliArgs(['--port'])).toThrow(/requires a value/);
  });

  it('--port 非法 → ConfigError', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/invalid --port/);
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

  it('--strict-port → strictPort=true', () => {
    expect(parseCliArgs(['--strict-port']).strictPort).toBe(true);
    // 默认未指定 → undefined（loadConfig 兜底为 false）
    expect(parseCliArgs([]).strictPort).toBeUndefined();
  });

  it('短选项 -p / -h / -v / -S → 规范化为长选项', () => {
    expect(parseCliArgs(['-p', '4567']).port).toBe(4567);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
    expect(parseCliArgs(['-S']).strictPort).toBe(true);
  });

  it('短选项 + 长选项混用', () => {
    const r = parseCliArgs(['-p', '4321', '-S', '--no-terminal']);
    expect(r.port).toBe(4321);
    expect(r.strictPort).toBe(true);
    expect(r.noTerminal).toBe(true);
  });

  it('program 后的未知短选项透传给子进程，不报错', () => {
    // -x 不在 SHORT_TO_LONG 里 → 当成子进程参数透传
    const r = parseCliArgs(['claude', '-x', '--abc']);
    expect(r.command).toBe('claude');
    expect(r.claudeArgs).toEqual(['-x', '--abc']);
  });

  it('program 前的未知短选项 → ConfigError', () => {
    expect(() => parseCliArgs(['-x'])).toThrow();
  });

  it('--spawn-timeout 接受非负整数（含 0）', () => {
    expect(parseCliArgs(['--spawn-timeout', '60']).spawnTimeoutSec).toBe(60);
    expect(parseCliArgs(['--spawn-timeout', '0']).spawnTimeoutSec).toBe(0);
  });

  it('--spawn-timeout 拒绝负数 / 非数值', () => {
    expect(() => parseCliArgs(['--spawn-timeout', '-1'])).toThrow();
    expect(() => parseCliArgs(['--spawn-timeout', 'abc'])).toThrow();
  });
});
