/**
 * ClaudeCodeIntegration
 *
 * 第一个具体 Integration 实现。把 Claude Code 的全部 hook 事件翻译成
 * 通用 IntegrationEvent。
 *
 * 职责拆分:
 *  - detect.ts            → 命令名识别
 *  - config-dir-mirror.ts → ~/.claude 镜像 + CLAUDE_CONFIG_DIR env 注入
 *  - settings-builder.ts  → 生成 settings JSON(镜像内使用)
 *  - hook-mapper.ts       → payload → events
 *  - tool-summary.ts      → tool_input → 一行摘要
 *
 * 注入通道(0.12.2 起):PTY env `CLAUDE_CONFIG_DIR=<镜像目录>`。claude 无论以
 * 何种方式被启动(直接 atr claude / zshrc 函数 zclaude / wrapper)都会读到
 * 镜像 settings 里的 atr hooks——取代旧的 `--settings` 参数注入(依赖参数
 * 经函数 "$@" 转发,在 shell 函数场景失效)。
 *
 * 此处只做组合 + 实现 Integration 接口。
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { ATR_DATA_DIR } from 'auvezy-terminal-remote-shared';
import type {
  Integration,
  IntegrationEvent,
  SpawnAugmentation,
  SpawnContext,
} from '../types.js';
import { logger } from '../../logger/logger.js';
import { isClaudeCommand } from './detect.js';
import { DEFAULT_CLAUDE_CODE_EVENTS, type ClaudeCodeEventToggles } from './settings-builder.js';
import { buildConfigDirMirror, cleanupConfigDirMirror } from './config-dir-mirror.js';
import { mapHookPayload } from './hook-mapper.js';

/** PTY env 注入的 claude 配置目录变量名(Claude Code 官方支持) */
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';

/**
 * 模块构造选项
 *
 * @param events           事件子开关(对应 UserConfig.integrations.perModule['claude-code'].events)
 * @param existingSettings 用户已有 settings(从 --settings <path> 提取的内容;
 *   不传时镜像自动读 ~/.claude/settings.json 合并)
 * @param settingsBaseDir  镜像根目录的父目录(测试时可注入,默认 ~/.atr;
 *   镜像实际位于 <baseDir>/claude-config/<port>/)
 * @param cleanupOnShutdown 关闭时是否删除本实例镜像目录(默认 true——镜像含
 *   指向本实例端口的 hooks,实例退出即失效,留着无用)
 */
export interface ClaudeCodeIntegrationOptions {
  events?: ClaudeCodeEventToggles;
  existingSettings?: Record<string, unknown>;
  settingsBaseDir?: string;
  cleanupOnShutdown?: boolean;
}

export class ClaudeCodeIntegration implements Integration {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Claude Code';

  private readonly events: ClaudeCodeEventToggles;
  private readonly existingSettings: Record<string, unknown> | undefined;
  private readonly settingsBaseDir: string | undefined;
  private readonly cleanupOnShutdown: boolean;

  /** prepareSpawn 后记录(镜像根目录 + 端口),shutdown 时按需清理 */
  private writtenMirror: { baseDir: string; port: number } | null = null;

  constructor(opts: ClaudeCodeIntegrationOptions = {}) {
    this.events = opts.events ?? DEFAULT_CLAUDE_CODE_EVENTS;
    this.existingSettings = opts.existingSettings;
    this.settingsBaseDir = opts.settingsBaseDir;
    this.cleanupOnShutdown = opts.cleanupOnShutdown ?? true;
  }

  detect(ctx: SpawnContext): boolean {
    // viaShellFallback:program 经 $SHELL -ic fallback(shell 函数/alias 场景,
    // 如 zshrc 里的 zclaude)。函数名不含 'claude' 无法静态确认,但用户特意
    // 写函数启动的程序值得注入——误报后果只是 claude 没跑时无人消费镜像。
    return isClaudeCommand(ctx.command) || ctx.viaShellFallback === true;
  }

  prepareSpawn(ctx: SpawnContext): SpawnAugmentation | null {
    const baseDir = this.settingsBaseDir ?? resolve(homedir(), ATR_DATA_DIR);
    const mirrorBaseDir = resolve(baseDir, 'claude-config');
    const dir = buildConfigDirMirror({
      mirrorBaseDir,
      realConfigDir: resolve(homedir(), '.claude'),
      port: ctx.port,
      toggles: this.events,
      ...(this.existingSettings ? { existingSettings: this.existingSettings } : {}),
    });
    this.writtenMirror = { baseDir: mirrorBaseDir, port: ctx.port };
    logger.info({ dir, port: ctx.port }, 'ClaudeCode: CLAUDE_CONFIG_DIR 镜像已构建');
    return { extraEnv: { [CLAUDE_CONFIG_DIR_ENV]: dir } };
  }

  onHookPayload(payload: unknown): IntegrationEvent[] {
    return mapHookPayload(payload);
  }

  shutdown(): void {
    if (this.cleanupOnShutdown && this.writtenMirror) {
      cleanupConfigDirMirror(this.writtenMirror.baseDir, this.writtenMirror.port);
    }
    this.writtenMirror = null;
  }
}

export type { ClaudeCodeEventToggles } from './settings-builder.js';
export { DEFAULT_CLAUDE_CODE_EVENTS } from './settings-builder.js';
