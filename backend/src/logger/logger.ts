/**
 * 日志模块（基于 pino）
 *
 * 设计目标：
 * - 同时输出到 stderr（开发友好）和 logs/app.log（持久化）
 * - 错误级别单独再写一份到 logs/error.log（便于排错时只看错误）
 * - 测试环境（NODE_ENV=test 或 VITEST）静默
 * - CLI 模式下不污染 stdout（PTY 输出独占 stdout）
 * - 支持注入 instance 上下文（多实例时按 port 区分日志来源）
 *
 * 模块加载时机注意：
 * - 本模块在顶层读取 process.env.CLI_MODE 等环境变量
 * - 因此 cli.ts 必须先设置环境变量再用动态 import 加载本模块
 * - 详见 cli.ts 的注释
 */

import pino, { type Logger } from 'pino';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

// ──────────────── 路径计算 ────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
// logger.ts 位于 backend/src/logger/，向上 3 级到项目根
const projectRoot = resolve(__dirname, '..', '..', '..');
const logDir = process.env['LOG_DIR'] ?? resolve(projectRoot, 'logs');

// ──────────────── 环境检测 ────────────────

const isTest = process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true';
const isCli = process.env['CLI_MODE'] === 'true';
const isStderrTty = process.stderr.isTTY === true;

// ──────────────── 日志目录 ────────────────

// 确保日志目录存在；测试环境可能没写权限，捕获后忽略
try {
  mkdirSync(logDir, { recursive: true });
} catch {
  // 测试或只读文件系统下静默失败
}

const appLogPath = resolve(logDir, 'app.log');
const errorLogPath = resolve(logDir, 'error.log');

// ──────────────── instance 上下文 ────────────────

/**
 * 当前实例的端口号
 * 由 setInstanceContext 注入，pino mixin 用它给所有日志加 instancePort 字段
 */
let currentInstancePort: number | null = null;

/**
 * 设置当前实例上下文，使后续日志自动携带 instancePort 字段
 *
 * @param port 实际监听端口（由 findAvailablePort 决定后传入）
 */
export function setInstanceContext(port: number): void {
  currentInstancePort = port;
}

// ──────────────── logger 创建 ────────────────

function createLogger(): Logger {
  // 测试环境：完全静默
  if (isTest) {
    return pino({ level: 'silent' });
  }

  // 正常环境：多目标输出
  // - stderr：开发时实时观察（CLI 模式下也用 stderr，因为 stdout 被 PTY 占用）
  // - app.log：所有 INFO+ 日志
  // - error.log：仅 ERROR+ 日志
  const transport = pino.transport({
    targets: [
      {
        target: 'pino/file',
        level: isCli ? 'warn' : 'info',
        options: {
          destination: 2, // fd 2 = stderr
          colorize: isStderrTty,
        },
      },
      {
        target: 'pino/file',
        level: 'info',
        options: { destination: appLogPath, mkdir: true },
      },
      {
        target: 'pino/file',
        level: 'error',
        options: { destination: errorLogPath, mkdir: true },
      },
    ],
  });

  return pino(
    {
      level: 'debug',
      mixin() {
        // 每条日志自动挂上当前实例端口（如果已设置）
        return currentInstancePort !== null ? { instancePort: currentInstancePort } : {};
      },
    },
    transport,
  );
}

/**
 * 全局 logger 实例
 *
 * 用法：
 * ```ts
 * logger.info({ port: 3000 }, '服务启动');
 * logger.error({ err }, '错误描述');
 * ```
 *
 * 字段约定：
 * - 第一个参数是上下文对象（含 err、关键变量）
 * - 第二个参数是消息字符串（人类可读）
 * - 错误对象用 `err` 字段（pino 默认序列化 err.stack）
 */
export const logger: Logger = createLogger();
