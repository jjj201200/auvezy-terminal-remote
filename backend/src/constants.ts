/**
 * Backend 运行时常量
 *
 * 这里放"调优类"常量——影响性能/行为但不属于协议契约。
 * 协议契约常量请改 shared/src/constants.ts。
 *
 * 命名约定：常量分组用 ── 注释分隔，方便快速定位。
 */

// ──────────────── WS 输出批合并 ────────────────

/** 批合并时间窗（ms）：未达大小阈值时也按此时间间隔 flush */
export const WS_FLUSH_INTERVAL_MS = 16;

/** 批合并大小阈值（字节）：累计达到此值立即 flush */
export const WS_MAX_CHUNK_BYTES = 32 * 1024;

/** 高水位线（字节）：超过此值认为发生背压，强制 flush 并计数 */
export const WS_HIGH_WATERMARK_BYTES = 256 * 1024;

// ──────────────── 文件锁 ────────────────

/** 文件锁默认重试次数 */
export const FILE_LOCK_RETRIES = 50;

/** 文件锁重试间隔（ms） */
export const FILE_LOCK_RETRY_INTERVAL_MS = 50;

/** 僵尸锁判定阈值（ms）：超过此时长的锁视为崩溃残留，强制清理 */
export const FILE_LOCK_STALE_MS = 10_000;

// ──────────────── IP 监控 ────────────────

/** IP 检测轮询间隔（ms） */
export const IP_MONITOR_INTERVAL_MS = 30_000;

/** 稳定性阈值：连续 N 次检测到相同新 IP 才触发回调，避免抖动 */
export const IP_MONITOR_STABILITY_THRESHOLD = 2;

// ──────────────── 文件浏览速率限制 ────────────────
// Why 600/60:限流是兜底反爬,不是反正常用户 —— 取远高于真实浏览速率的阈值
// (人手不可能 10 次/秒),但能拦自动化滥用。搜索独立 60/min(=1/s)因深度
// 遍历 + grep 成本远高于一次 stat。

export const FILE_RATE_LIMIT_PER_MIN = 600;
export const SEARCH_RATE_LIMIT_PER_MIN = 60;

// ──────────────── PTY ────────────────

/** PTY 默认列数（PC 终端尺寸不可用时的兜底） */
export const PTY_DEFAULT_COLS = 80;

/** PTY 默认行数 */
export const PTY_DEFAULT_ROWS = 24;

/** PTY 终端类型（影响 ANSI 渲染能力） */
export const PTY_TERM_NAME = 'xterm-256color';

/**
 * Double-pulse resize 的两次脉冲间隔（ms）。
 *
 * 针对 Claude Code (Ink) 等增量重画 TUI 的"变宽不 reflow"架构限制：
 * 先 resize(cols-1) 让 Ink 的 width-shrink 分支触发整屏清屏 + 重新 layout，
 * 再 resize(cols) 回到目标。两次必须有间隔，让 Ink 完成 render cycle。
 *
 * 40-60ms 经验值：足够 React 完成一次 commit + Ink renderer flush；太短
 * 第二次 SIGWINCH 可能跟第一次合并。
 */
export const DOUBLE_PULSE_DELAY_MS = 50;

// ──────────────── 关闭流程 ────────────────

/** PTY exit 后等待 WS flush 的延迟（ms） */
export const SHUTDOWN_WS_FLUSH_DELAY_MS = 500;

/** 强制 exit 兜底超时（ms）：httpServer.close 卡住时的最后手段 */
export const SHUTDOWN_FORCE_EXIT_MS = 2_000;

/** 双 Ctrl+C 检测窗口（ms）：两次 Ctrl+C 间隔小于此值视为退出代理 */
export const DOUBLE_CTRL_C_WINDOW_MS = 500;

// ──────────────── 端口探测 ────────────────

/** 自动递增端口的最大尝试次数 */
export const PORT_FINDER_MAX_ATTEMPTS = 100;

// ──────────────── 实例停止 ────────────────

/** 停止实例时 SIGTERM 后等待退出的宽限期（ms） */
export const STOP_INSTANCE_GRACE_MS = 3_000;

/** 停止实例时轮询进程退出的间隔（ms） */
export const STOP_INSTANCE_POLL_INTERVAL_MS = 100;

// ──────────────── attach 客户端 ────────────────

/**
 * attach WS 重连退避序列（ms）；用尽后保持最大值
 * 与前端 frontend/src/config/constants.ts 的 WS_RECONNECT_DELAYS_MS 同步
 */
export const ATTACH_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30_000];
