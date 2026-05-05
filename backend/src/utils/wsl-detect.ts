/**
 * wsl-detect
 *
 * 检测当前进程是否跑在 WSL（任意版本）里。
 *
 * 判定规则：
 *  - 仅 Linux 平台才可能是 WSL
 *  - /proc/version 文件内容（小写）含 'microsoft' 或 'wsl'
 *  - 满足任一即认为是 WSL
 *
 * 用途：
 *  - banner 上给 Windows 宿主用户额外打印 PowerShell 端口转发提示
 *  - 仅显示提示，不主动调用 netsh（跨边界操作宿主机不应由 backend 做）
 */

import { readFileSync } from 'node:fs';

/** 缓存结果（每进程探测一次即可） */
let cached: boolean | undefined;

/**
 * 是否运行在 WSL 中。
 *
 * @param deps 测试可注入：自定义 platform / proc 文件读取器
 */
export function isWsl(deps?: {
  platform?: string;
  readProcVersion?: () => string;
}): boolean {
  if (cached !== undefined && deps === undefined) return cached;

  const platform = deps?.platform ?? process.platform;
  if (platform !== 'linux') {
    if (deps === undefined) cached = false;
    return false;
  }

  let content: string;
  try {
    content = (deps?.readProcVersion ?? defaultReadProcVersion)();
  } catch {
    if (deps === undefined) cached = false;
    return false;
  }

  const lower = content.toLowerCase();
  const result = lower.includes('microsoft') || lower.includes('wsl');
  if (deps === undefined) cached = result;
  return result;
}

/** 仅测试用：清缓存 */
export function _resetWslCache(): void {
  cached = undefined;
}

function defaultReadProcVersion(): string {
  return readFileSync('/proc/version', 'utf-8');
}
