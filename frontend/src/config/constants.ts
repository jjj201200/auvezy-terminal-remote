/**
 * 前端运行时常量
 *
 * 与 backend/src/constants.ts 类似，集中管理前端调优类常量。
 * 协议常量请去 auvezy-terminal-remote-shared/constants.ts。
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

/**
 * 自动重连的硬上限。达到后停止自动重试，等用户手动点 / online / visibilitychange 触发重置。
 *
 * 为什么要上限：移动端一直请求会消耗流量（即便对方不响应，TCP SYN / 握手包也走流量）。
 * 60 次配合上面退避序列：1+2+4+8+16+30×55 ≈ 27.5 分钟后停手，相对保守。
 */
export const WS_RECONNECT_MAX_ATTEMPTS = 60;

// ──────────────── xterm 显示 ────────────────

/** xterm 滚回行数（与后端 OutputBuffer 上限保持对齐） */
export const XTERM_SCROLLBACK_LINES = 10_000;

/** 移动端 / 桌面端的默认字号(px)。
 *  移动端 8px:窄屏 390px 上 Auto ≈ 81 列,接近"塞满屏";代价是字小,看不清
 *  的可在"显示 → 最大列数"选具体值用更大字号反推。
 *  桌面端 14px:常见尺寸下视觉舒适,与 0.7.x 之前的行为一致。 */
export const XTERM_FONT_SIZE_MOBILE = 8;
export const XTERM_FONT_SIZE_DESKTOP = 14;

/** 移动端断点(与 _mixins.scss 的 @mixin mobile 同源,UA 检测不可靠用宽度) */
export const MOBILE_BREAKPOINT_PX = 768;

/** 根据当前 viewport 宽度返回默认 xterm 字号。窄屏给 8,宽屏给 14。
 *  在没 React 上下文的地方(constants 计算 / 非 hook 调用)也能用。 */
export function getDefaultXtermFontSize(): number {
  if (typeof window === 'undefined') return XTERM_FONT_SIZE_DESKTOP;
  return window.innerWidth < MOBILE_BREAKPOINT_PX
    ? XTERM_FONT_SIZE_MOBILE
    : XTERM_FONT_SIZE_DESKTOP;
}

/** Markdown 预览 Auto 模式的正文字号(px)。
 *  与 _tokens.scss 的 --fs-md($fs-md: 13px)同源——运行时从 :root 读取而非
 *  硬编码,token 改动后设置面板 "Auto · 13" 的显示自动跟随,无漂移。
 *  读不到(异常环境)返回 0,调用方隐藏 "· xx" 后缀即可。 */
export function getDefaultMarkdownFontSize(): number {
  if (typeof window === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--fs-md')
    .trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
