/**
 * PTY 抽象接口
 *
 * 设计目的：让 SessionController 不区分"本地 PTY"与"远程 PTY 代理"。
 *
 * - 本地 PTY：PtyManager 用 node-pty spawn 一个真实 Claude Code 进程
 * - 远程 PTY：VirtualPtyManager 通过 WS 转发到远程实例（attach 命令使用）
 *
 * 两者都实现 IPtyManager，SessionController 只依赖此接口。
 *
 * 事件约定（继承自 EventEmitter）：
 *  - 'data'           (data: string)             — PTY 输出片段
 *  - 'exit'           (exitCode: number, signal?) — 进程退出
 *  - 'error'          (err: Error)                — 异常（spawn 失败 / 运行时错误）
 *  - 'resize'         (cols: number, rows: number) — PTY 尺寸已应用
 *  - 'altScreenChange' (inAltScreen: boolean)     — alt-screen 切换（前端 touch 滚动行为依赖）
 */

export interface IPtyManager {
  /** 当前 PTY 列数（cols） */
  readonly cols: number;

  /** 当前 PTY 行数（rows） */
  readonly rows: number;

  /** 写入数据到 PTY stdin（用户输入透传） */
  write(data: string): void;

  /** 调整 PTY 尺寸（同尺寸应跳过以避免回环） */
  resize(cols: number, rows: number): void;
}
