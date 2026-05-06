/**
 * PtyManager
 *
 * 用 node-pty 包装 Claude Code 子进程，对外暴露 EventEmitter 风格的 4 事件
 * （data / exit / error / resize）和 4 个动词方法（spawn / write / resize / destroy）。
 *
 * 关键设计：
 * - resize 去重：同尺寸跳过，避免 webapp→PTY→broadcast→client→webapp 无限回环
 * - exit 后状态置位 `_exited`，后续 write/resize 静默失败（避免崩溃）
 * - 错误处理：spawn 失败时 emit 'error' 而非抛异常，让上层有机会平滑处理
 * - 终端类型固定为 xterm-256color（影响 ANSI 渲染能力）
 *
 * 实现 IPtyManager 接口，与 VirtualPtyManager 多态共用 SessionController。
 */

import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import type { IPtyManager } from './types.js';
import {
  PTY_DEFAULT_COLS,
  PTY_DEFAULT_ROWS,
  PTY_TERM_NAME,
} from '../constants.js';
import { PtyError } from '../errors.js';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { logger } from '../logger/logger.js';

/** spawn 时的入参 */
export interface PtyManagerSpawnOptions {
  /** 启动命令，默认场景为 'claude' */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录，默认 process.cwd() */
  cwd?: string;
  /** 初始列数，默认取 process.stdout.columns ?? PTY_DEFAULT_COLS */
  cols?: number;
  /** 初始行数 */
  rows?: number;
  /** 额外环境变量（与 process.env 合并，后者优先级低） */
  env?: Record<string, string>;
}

export class PtyManager extends EventEmitter implements IPtyManager {
  private process: pty.IPty | null = null;
  private _exited = false;
  private _cols = PTY_DEFAULT_COLS;
  private _rows = PTY_DEFAULT_ROWS;

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  /** 进程是否已退出（exit 事件后置 true） */
  get exited(): boolean {
    return this._exited;
  }

  /**
   * 启动 PTY 进程
   *
   * @throws {PtyError} 已经有进程在运行时（避免一个 manager spawn 两次）
   *
   * spawn 失败不抛错，而是 emit 'error' 事件——便于上层用一致方式处理
   */
  spawn(opts: PtyManagerSpawnOptions): void {
    if (this.process) {
      throw new PtyError(
        ErrorCode.INSTANCE_ALREADY_RUNNING,
        'PTY 已经在运行，不能重复 spawn',
      );
    }

    const cols = opts.cols ?? process.stdout.columns ?? PTY_DEFAULT_COLS;
    const rows = opts.rows ?? process.stdout.rows ?? PTY_DEFAULT_ROWS;
    this._cols = cols;
    this._rows = rows;

    logger.info(
      { command: opts.command, args: opts.args, cwd: opts.cwd, cols, rows },
      '正在启动 PTY 进程',
    );

    try {
      this.process = pty.spawn(opts.command, opts.args ?? [], {
        name: PTY_TERM_NAME,
        cols,
        rows,
        cwd: opts.cwd ?? process.cwd(),
        env: { ...process.env, ...opts.env } as Record<string, string>,
      });

      this.process.onData((data: string) => {
        this.emit('data', data);
      });

      this.process.onExit(({ exitCode, signal }) => {
        this._exited = true;
        logger.info({ exitCode, signal }, 'PTY 进程退出');
        this.emit('exit', exitCode, signal);
        this.process = null;
      });

      logger.info({ pid: this.process.pid, cols, rows }, 'PTY 进程已启动');
    } catch (err) {
      logger.error({ err }, 'spawn PTY 进程失败');
      const wrapped = new PtyError(
        ErrorCode.PTY_SPAWN_FAILED,
        err instanceof Error ? err.message : 'spawn 失败',
        500,
        err,
      );
      // 异步 emit，让监听器有机会先注册
      queueMicrotask(() => this.emit('error', wrapped));
    }
  }

  /**
   * 写入数据到 PTY stdin
   *
   * 进程未启动或已退出时静默丢弃（写日志），不抛错——
   * 因为客户端可能在 exit 通知到达前发出 user_input，硬抛会让代理崩溃
   */
  write(data: string): void {
    if (!this.process) {
      logger.warn({ dataLength: data.length }, '尝试写入 PTY 但进程未运行');
      return;
    }
    this.process.write(data);
  }

  /**
   * 调整 PTY 尺寸
   *
   * 同尺寸跳过——这是避免 resize 回环的关键
   *
   * 回环路径示例：
   *   webapp resize → ws → PTY.resize → emit 'resize' → broadcast →
   *   webapp 收到 terminal_resize → 触发 fit → 又算出同尺寸 → 再发 resize → ...
   * 同尺寸跳过让链路在第二步就断掉
   */
  resize(cols: number, rows: number): void {
    if (!this.process || this._exited) return;
    if (cols === this._cols && rows === this._rows) {
      logger.debug({ cols, rows }, 'PTY resize 跳过（同尺寸）');
      return;
    }
    logger.info(
      { cols, rows, prevCols: this._cols, prevRows: this._rows },
      'PTY resize 执行',
    );
    try {
      this.process.resize(cols, rows);
      this._cols = cols;
      this._rows = rows;
      this.emit('resize', cols, rows);
    } catch (err) {
      logger.error({ err, cols, rows }, 'PTY resize 失败');
      // 不抛错——尺寸调整失败不至于让整个会话崩溃
    }
  }

  /**
   * 销毁 PTY 进程
   *
   * 幂等：多次调用安全
   */
  destroy(): void {
    if (!this.process) return;
    try {
      this.process.kill();
      logger.info('PTY 进程已 kill');
    } catch (err) {
      logger.error({ err }, 'kill PTY 进程失败');
    }
    this.process = null;
  }
}
