/**
 * 前端运行时常量
 *
 * 与 backend/src/constants.ts 类似，集中管理前端调优类常量。
 * 协议常量请去 @otr/shared/constants.ts。
 */

// ──────────────── xterm 写入批合并 ────────────────

/** xterm.write 批合并时间窗（ms）：用 RAF + setTimeout 双保险 */
export const XTERM_WRITE_FLUSH_INTERVAL_MS = 16;

/** xterm.write 累计字节阈值：超过即立即 flush */
export const XTERM_WRITE_MAX_QUEUED_BYTES = 256 * 1024;

// ──────────────── resize 节流 ────────────────

/** resize 节流间隔（ms）：阻止拖拽窗口时的 resize 风暴 */
export const RESIZE_THROTTLE_MS = 50;

// ──────────────── WS 重连退避 ────────────────

/** WS 重连退避序列（ms），按尝试次数递增，超出索引后封顶最后一个 */
export const WS_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30_000];

// ──────────────── xterm 显示 ────────────────

/** xterm 滚回行数（与后端 OutputBuffer 上限保持对齐） */
export const XTERM_SCROLLBACK_LINES = 10_000;

/** xterm 字号（px） */
export const XTERM_FONT_SIZE = 14;
