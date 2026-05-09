/**
 * ClaudeCodeIntegration
 *
 * 第一个具体 Integration 实现。把 Claude Code 的全部 hook 事件翻译成
 * 通用 IntegrationEvent。
 *
 * 职责拆分:
 *  - detect.ts          → 命令名识别
 *  - settings-builder.ts → 生成并落盘 settings JSON
 *  - hook-mapper.ts      → payload → events
 *  - tool-summary.ts     → tool_input → 一行摘要
 *
 * 此处只做组合 + 实现 Integration 接口。
 */

import { unlinkSync, existsSync } from 'node:fs';
import type {
  Integration,
  IntegrationEvent,
  SpawnAugmentation,
  SpawnContext,
} from '../types.js';
import { logger } from '../../logger/logger.js';
import { isClaudeCommand } from './detect.js';
import {
  buildClaudeSettings,
  saveSettingsFile,
  DEFAULT_CLAUDE_CODE_EVENTS,
  type ClaudeCodeEventToggles,
} from './settings-builder.js';
import { mapHookPayload } from './hook-mapper.js';

/**
 * 模块构造选项
 *
 * @param events           事件子开关(对应 UserConfig.integrations.perModule['claude-code'].events)
 * @param existingSettings 用户已有 settings(从 --settings <path> 提取的内容)
 * @param settingsBaseDir  写盘根目录(测试时可注入,默认 ~/.atr)
 * @param cleanupOnShutdown 关闭时是否删除生成的 settings 文件(默认 false,
 *   方便用户手动 `claude --settings <path>` 复用同一份)
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

  /** prepareSpawn 后记录,shutdown 时按需清理 */
  private writtenSettingsPath: string | null = null;

  constructor(opts: ClaudeCodeIntegrationOptions = {}) {
    this.events = opts.events ?? DEFAULT_CLAUDE_CODE_EVENTS;
    this.existingSettings = opts.existingSettings;
    this.settingsBaseDir = opts.settingsBaseDir;
    this.cleanupOnShutdown = opts.cleanupOnShutdown ?? false;
  }

  detect(ctx: SpawnContext): boolean {
    return isClaudeCommand(ctx.command);
  }

  prepareSpawn(ctx: SpawnContext): SpawnAugmentation | null {
    const settings = buildClaudeSettings(ctx.port, this.events, this.existingSettings);
    const path = saveSettingsFile(settings, ctx.port, this.settingsBaseDir);
    this.writtenSettingsPath = path;
    // 注入 --settings <path>;若用户原命令里已有此参数,Claude 会用最后一个,
    // 我们的覆盖在 args 末尾追加 = 优先级最高(原参数已被 extractSettingsFromArgs 剥)
    return { extraArgs: ['--settings', path] };
  }

  onHookPayload(payload: unknown): IntegrationEvent[] {
    return mapHookPayload(payload);
  }

  shutdown(): void {
    if (
      this.cleanupOnShutdown &&
      this.writtenSettingsPath &&
      existsSync(this.writtenSettingsPath)
    ) {
      try {
        unlinkSync(this.writtenSettingsPath);
        logger.debug({ path: this.writtenSettingsPath }, 'ClaudeCode: 已清理 settings 文件');
      } catch (err) {
        logger.warn({ err, path: this.writtenSettingsPath }, 'ClaudeCode: 清理 settings 失败');
      }
    }
    this.writtenSettingsPath = null;
  }
}

export type { ClaudeCodeEventToggles } from './settings-builder.js';
export { DEFAULT_CLAUDE_CODE_EVENTS } from './settings-builder.js';
