/**
 * cli-utils 单测
 *
 * 0.7.x 起 service-level 命令从 `--start` / `--stop` / ... flag 改为
 * `atr start` / `atr stop` / ... subcommand；旧 `atr stop <pattern>` 停实例
 * 的语义迁到 `atr kill <pattern>`。本测试已对齐新模型。
 */

import { describe, it, expect } from 'vitest';
import { parseCliArgs } from './cli-utils.js';
import { ConfigError } from './errors.js';

describe('parseCliArgs', () => {
  it('空 argv → pty 子命令 + 默认空 claudeArgs', () => {
    const r = parseCliArgs([]);
    expect(r.subcommand).toBe('pty');
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

  it('atr list → service / list', () => {
    const r = parseCliArgs(['list']);
    expect(r.subcommand).toBe('service');
    expect(r.serviceAction).toBe('list');
  });

  it('start / stop / status / install / uninstall / logs 都映射到 service', () => {
    const cases: Array<[string, string]> = [
      ['start', 'start'],
      ['stop', 'stop'],
      ['status', 'status'],
      ['install', 'install'],
      ['uninstall', 'uninstall'],
      ['logs', 'logs'],
    ];
    for (const [word, action] of cases) {
      const r = parseCliArgs([word]);
      expect(r.subcommand).toBe('service');
      expect(r.serviceAction).toBe(action);
    }
  });

  it('atr start 接受配置 flag --port / --host', () => {
    const r1 = parseCliArgs(['start', '--port', '3010']);
    expect(r1.subcommand).toBe('service');
    expect(r1.serviceAction).toBe('start');
    expect(r1.port).toBe(3010);

    const r2 = parseCliArgs(['start', '--port=4000', '--host', '127.0.0.1']);
    expect(r2.serviceAction).toBe('start');
    expect(r2.port).toBe(4000);
    expect(r2.host).toBe('127.0.0.1');
  });

  it('其它服务子命令不接受配置：atr stop --port / atr status --port → ConfigError', () => {
    expect(() => parseCliArgs(['stop', '--port', '3010'])).toThrow(/takes no extra arguments/);
    expect(() => parseCliArgs(['status', '--port', '3010'])).toThrow(/takes no extra arguments/);
  });

  it('保留 subcommand 必须在位置 0：atr --port 3001 start → start 视为 program 隐式分隔点', () => {
    // --port 3001 之后的 'start' 不在位置 0，按隐式 program 处理；其后 token 全部透传
    const r = parseCliArgs(['--port', '3001', 'start']);
    expect(r.subcommand).toBe('pty');
    expect(r.command).toBe('start');
    expect(r.port).toBe(3001);
    expect(r.claudeArgs).toEqual([]);
  });

  it('保留词在 program 之后透传给子进程：claude start → program=claude, args=[start]', () => {
    const r = parseCliArgs(['claude', 'start']);
    expect(r.subcommand).toBe('pty');
    expect(r.command).toBe('claude');
    expect(r.claudeArgs).toEqual(['start']);
  });

  it('atr kill [pattern] 子命令(parser 不强制必填,落到 cli-stop 报错)', () => {
    const r1 = parseCliArgs(['kill']);
    expect(r1.subcommand).toBe('kill');
    expect(r1.killPattern).toBeUndefined();

    const r2 = parseCliArgs(['kill', 'foo']);
    expect(r2.subcommand).toBe('kill');
    expect(r2.killPattern).toBe('foo');

    const r3 = parseCliArgs(['kill', 'all']);
    expect(r3.subcommand).toBe('kill');
    expect(r3.killPattern).toBe('all');
  });

  it('atr kill 多余参数 → ConfigError', () => {
    expect(() => parseCliArgs(['kill', 'foo', 'bar'])).toThrow(ConfigError);
  });

  it('atr kill --x → ConfigError（kill 不接 flag）', () => {
    expect(() => parseCliArgs(['kill', '--something'])).toThrow(ConfigError);
  });

  it('atr completion <shell> 子命令', () => {
    const r = parseCliArgs(['completion', 'zsh']);
    expect(r.subcommand).toBe('completion');
    expect(r.completionShell).toBe('zsh');
  });

  it('atr completion 缺 shell → ConfigError', () => {
    expect(() => parseCliArgs(['completion'])).toThrow(/requires a shell/);
  });

  it('atr completion 多余参数 → ConfigError', () => {
    expect(() => parseCliArgs(['completion', 'zsh', 'extra'])).toThrow(ConfigError);
  });

  it('首位置参数非保留 subcommand → 视为 PTY program', () => {
    const r = parseCliArgs(['zsh']);
    expect(r.subcommand).toBe('pty');
    expect(r.command).toBe('zsh');
    expect(r.claudeArgs).toEqual([]);
  });

  it('atr <prog> [args...] → command + 透传位置参数', () => {
    const r = parseCliArgs(['claude', '--resume', 'task1']);
    expect(r.command).toBe('claude');
    expect(r.claudeArgs).toEqual(['--resume', 'task1']);
  });

  it('严格规则：program 之后所有 token 都透传给子进程，不被 atr 解析', () => {
    const r = parseCliArgs(['claude', '--port', '3002']);
    expect(r.command).toBe('claude');
    expect(r.port).toBeUndefined();
    expect(r.claudeArgs).toEqual(['--port', '3002']);
  });

  it('严格规则：atr-flag 必须在 program 前；atr -p 3001 claude 才生效', () => {
    const r = parseCliArgs(['-p', '3001', 'claude', '--port', '3002']);
    expect(r.command).toBe('claude');
    expect(r.port).toBe(3001);
    expect(r.claudeArgs).toEqual(['--port', '3002']);
  });

  it('-- 显式分隔点：atr -- 后所有 token 透传', () => {
    const r = parseCliArgs(['zsh', '--', '-l']);
    expect(r.command).toBe('zsh');
    expect(r.claudeArgs).toEqual(['--', '-l']);
  });

  it('atr -p 3001 -- -x：在 atr-flag 段用 -- 强制分隔，程序为默认 shell', () => {
    const r = parseCliArgs(['-p', '3001', '--', '-x']);
    expect(r.command).toBeUndefined();
    expect(r.port).toBe(3001);
    expect(r.claudeArgs).toEqual(['-x']);
  });

  it('atr-flag 段中冒出非 flag token → 视为 program 隐式分隔点（之后透传）', () => {
    const r = parseCliArgs(['--port', '3001', 'oops', '--foo']);
    expect(r.command).toBe('oops');
    expect(r.port).toBe(3001);
    expect(r.claudeArgs).toEqual(['--foo']);
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
