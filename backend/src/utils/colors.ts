/**
 * 终端配色 helper —— 包一层 picocolors,集中处理"该不该上色"。
 *
 * 优先级（从高到低）:
 *  1. 显式 disable(`--no-color` flag / `disableColors()` 调用) → 永远关
 *  2. `NO_COLOR` 环境变量(任意非空值) → 永远关(https://no-color.org/)
 *  3. `FORCE_COLOR` 环境变量(任意非空值) → 永远开(常用于 CI 强制保色)
 *  4. stdout 不是 TTY → 关(管道 / 重定向 / nohup / systemd 接管)
 *  5. 否则 → 开
 *
 * picocolors 自身也做 1/2/3,但它判定的是模块加载时的环境,我们要支持 CLI
 * `--no-color` 在运行期翻转,所以包一层 stable boolean。
 *
 * 不缓存彩色字符串:每次调用 `c.green('...')` 自身已极轻量(纯字符串拼接),
 * 缓存反而引入失效问题。
 */

import pc from 'picocolors';

// 让 picocolors 内部的"是否上色"始终为 true,把决定权完全交给本模块的
// colorsEnabled() —— 否则 picocolors 会按模块加载时的 stdout TTY 状态做静态
// 判断,vitest / pipe / nohup 一律返回 plain,我们的 wrap() 拿到的也只是 plain,
// 后期再开 FORCE_COLOR 也救不回来。
const pcForced = pc.createColors(true);

let forceDisabled = false;

/** 显式关闭(供 --no-color 在 cli.ts 里调用,优先级最高) */
export function disableColors(): void {
  forceDisabled = true;
}

/** 显式复位(测试用) */
export function resetColorsForTest(): void {
  forceDisabled = false;
}

/** 当前是否启用彩色 */
export function colorsEnabled(): boolean {
  if (forceDisabled) return false;
  // NO_COLOR: 任意非空值都禁用(规范要求)
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') {
    return false;
  }
  if (process.env['FORCE_COLOR'] !== undefined && process.env['FORCE_COLOR'] !== '') {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

/** identity 包装:禁用时直接返回原字符串,启用时走 picocolors */
function wrap(fn: (s: string) => string): (s: string) => string {
  return (s) => (colorsEnabled() ? fn(s) : s);
}

/**
 * 颜色调用入口。命名与 picocolors 对齐,语义包一层 colorsEnabled() 检测。
 *
 * 用法:
 *   import { c } from '../utils/colors.js';
 *   console.log(c.green('OK'));
 *
 * 设计上故意只暴露我们实际用到的子集 —— 后续要加再补,避免无序蔓延。
 */
export const c = {
  bold: wrap(pcForced.bold),
  dim: wrap(pcForced.dim),
  red: wrap(pcForced.red),
  green: wrap(pcForced.green),
  yellow: wrap(pcForced.yellow),
  blue: wrap(pcForced.blue),
  cyan: wrap(pcForced.cyan),
  gray: wrap(pcForced.gray),
};
