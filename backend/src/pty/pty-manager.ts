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
  DOUBLE_PULSE_DELAY_MS,
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

/**
 * 需要从 process.env 继承中剥离的 Claude Code 父会话运行时标记
 *
 * 场景：用户在 claude 会话内（`!` 前缀 / AI 代跑 / 嵌套终端）启动
 * `atr claude`——worker 会原样继承父 claude 注入的环境。若不剥离：
 *  - `CHILD_SESSION` 让子 claude 认为自己是嵌套会话，**静默关闭 transcript
 *    落盘**（提示 "Transcript saving is off"）
 *  - `SESSION_ID` / `MESSAGING_*` / `SSE_PORT` 与父会话同名，子 claude 可能
 *    误连父会话的消息总线或串扰会话状态
 *  - `ENTRYPOINT` / `EXECPATH` 是父 claude 的启动形态，与子实例无关
 *
 * 只剥"父子实例串扰"类标记；用户显式配置类（如
 * `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`、`CLAUDE_CODE_NO_FLICKER`）不在此列。
 * atr 的语义是"像在干净 shell 里直接跑 claude"。
 */
const PTY_ENV_STRIP = new Set([
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
]);

/** 复制 env 并剥掉父会话运行时标记（opts.env 显式注入的值不受影响） */
export function stripParentSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of PTY_ENV_STRIP) delete out[key];
  return out;
}

export class PtyManager extends EventEmitter implements IPtyManager {
  private process: pty.IPty | null = null;
  private _exited = false;
  private _cols = PTY_DEFAULT_COLS;
  private _rows = PTY_DEFAULT_ROWS;
  /**
   * 当前是否处于 alt-screen（DECSET 1049 / 1047 / 47）。
   * 通过扫描 PTY 输出序列实时维护：
   *  - vim/htop/tmux/less 等全屏 TUI 进入时切 true（它们自己整屏重画，对
   *    resize 反应正常，不需要 double-pulse hack）
   *  - claude/zsh prompt 等增量重画 TUI 始终为 false → 需要 double-pulse
   */
  private _inAltScreen = false;
  /** double-pulse resize 的中间帧定时器 */
  private _doublePulseTimer: ReturnType<typeof setTimeout> | null = null;

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
        // 先剥父会话标记再合并 opts.env——显式注入的值始终保留
        env: {
          ...stripParentSessionEnv(process.env),
          ...opts.env,
        } as Record<string, string>,
      });

      this.process.onData((data: string) => {
        this.scanAltScreenToggle(data);
        this.emit('data', data);
      });

      this.process.onExit(({ exitCode, signal }) => {
        this._exited = true;
        logger.info({ exitCode, signal }, 'PTY 进程退出');
        this.emit('exit', exitCode, signal);
        this.process = null;
      });

      logger.info({ pid: this.process.pid, cols, rows }, 'PTY 进程已启动');

      // 尺寸事实变化（默认值 → 实际 TTY 尺寸）时通知上层——SessionController
      // 需要同步 TerminalState 的 grid 尺寸，否则重连回放的 wrap 排列错位
      this.emit('resize', cols, rows);
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
      // debug：注释里讲的预期竞态——客户端在 exit 通知到达前发出 user_input。
      // 不是异常，且每次 PTY 退出后客户端如果还没察觉就会反复触发，刷屏污染 PTY。
      logger.debug({ dataLength: data.length }, '尝试写入 PTY 但进程未运行');
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
   *
   * Double-pulse hack（仅 normal-screen / 增量重画 TUI）：
   *   Claude Code (Ink) / blessed / prompt-toolkit / readline REPL 等用相对
   *   坐标增量重画的程序，收到 SIGWINCH 后只对"宽度变窄"分支才会清屏 +
   *   重新 layout（Ink 源码：`if (currentWidth < lastTerminalWidth) clear()`）。
   *   宽度变宽时既不清前帧也不重排已渲染历史 → 视觉上"没响应"。
   *
   *   workaround：先 resize(cols-1) 让 Ink 走 width-shrink 分支强制清屏，
   *   50ms 后再 resize(cols) 回到目标尺寸。代价是程序会多一帧重画。
   *
   *   alt-screen 程序（vim/tmux/htop/less）自己会在 SIGWINCH 时整屏重画，
   *   不需要也不应该 double-pulse（多余 SIGWINCH 让它们闪一下）→ 短路。
   */
  resize(cols: number, rows: number): void {
    if (!this.process || this._exited) return;
    if (cols === this._cols && rows === this._rows) {
      logger.debug({ cols, rows }, 'PTY resize 跳过（同尺寸）');
      return;
    }
    logger.info(
      { cols, rows, prevCols: this._cols, prevRows: this._rows, alt: this._inAltScreen },
      'PTY resize 执行',
    );
    try {
      // 取消上一次未完成的 double-pulse（用户连续 resize 不应叠加多个定时器）
      if (this._doublePulseTimer) {
        clearTimeout(this._doublePulseTimer);
        this._doublePulseTimer = null;
      }

      // alt-screen 内 / 缩窄场景 / cols 太小（<= 2）：单次 resize
      const shouldDoublePulse =
        !this._inAltScreen && cols > this._cols && cols > 2;

      if (shouldDoublePulse) {
        // 第一脉冲：cols-1 触发 Ink 的 width-shrink 分支（清屏 + 重排）
        this.process.resize(cols - 1, rows);
        this._doublePulseTimer = setTimeout(() => {
          this._doublePulseTimer = null;
          if (!this.process || this._exited) return;
          try {
            this.process.resize(cols, rows);
            this._cols = cols;
            this._rows = rows;
            this.emit('resize', cols, rows);
          } catch (err) {
            logger.error({ err, cols, rows }, 'PTY resize 第二脉冲失败');
          }
        }, DOUBLE_PULSE_DELAY_MS);
        return;
      }

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
    if (this._doublePulseTimer) {
      clearTimeout(this._doublePulseTimer);
      this._doublePulseTimer = null;
    }
    if (!this.process) return;
    try {
      this.process.kill();
      logger.info('PTY 进程已 kill');
    } catch (err) {
      logger.error({ err }, 'kill PTY 进程失败');
    }
    this.process = null;
  }

  /**
   * 当前是否处于 alt-screen（仅供 resize 决策用，不暴露给上层）
   */
  get inAltScreen(): boolean {
    return this._inAltScreen;
  }

  /**
   * 扫描 PTY 输出，识别 alt-screen 切换序列：
   *  - DECSET 1049（最常用，xterm 标准 + 保存光标位置）：进入 / 退出
   *  - DECSET 1047（仅 alt buffer 切换）：进入 / 退出
   *  - DECSET 47（最老的 alt-buffer，无光标保存）：进入 / 退出
   *
   * 不需要完整 ANSI 解析器——这三个序列形态固定，正则简单匹配即可。
   * 同一 chunk 内可能既有 enter 又有 exit（罕见，但可能），按顺序处理。
   */
  private scanAltScreenToggle(data: string): void {
    // 用全局正则一次找出所有 alt-screen 切换序列，按出现顺序更新状态
    const re = /\x1b\[\?(1049|1047|47)([hl])/g;
    let m;
    while ((m = re.exec(data)) !== null) {
      const isEnter = m[2] === 'h';
      if (this._inAltScreen !== isEnter) {
        this._inAltScreen = isEnter;
        logger.debug({ inAltScreen: isEnter }, 'PTY alt-screen 状态切换');
        // 广播给上层 → SessionController → WS → 前端
        // 前端用此状态决定 touch 滚动是"翻方向键"还是让 xterm 走原生 scrollback
        this.emit('altScreenChange', isEnter);
      }
    }
  }
}
