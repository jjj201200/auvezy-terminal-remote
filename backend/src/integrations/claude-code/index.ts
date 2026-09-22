/**
 * ClaudeCodeIntegration
 *
 * 第一个具体 Integration 实现。把 Claude Code 的全部 hook 事件翻译成
 * 通用 IntegrationEvent。
 *
 * 职责拆分:
 *  - detect.ts            → 命令名识别
 *  - config-dir-mirror.ts → ~/.claude 镜像(按项目 cwd 命名)+ CLAUDE_CONFIG_DIR env 注入
 *  - settings-builder.ts  → 生成 settings JSON(镜像内使用)
 *  - hook-mapper.ts       → payload → events(含事件子开关运行时过滤)
 *  - tool-summary.ts      → tool_input → 一行摘要
 *
 * 注入通道(0.12.2 起):PTY env `CLAUDE_CONFIG_DIR=<镜像目录>`。claude 无论以
 * 何种方式被启动(直接 atr claude / zshrc 函数 zclaude / wrapper)都会读到
 * 镜像 settings 里的 atr hooks——取代旧的 `--settings` 参数注入(依赖参数
 * 经函数 "$@" 转发,在 shell 函数场景失效)。
 *
 * 0.18 起(ADR-002)注入两个 env:
 *  - `CLAUDE_CONFIG_DIR` → <ATR_DATA_DIR>/claude-code/<escapedCwd>/(按项目
 *    命名,同项目多实例共享,实例退出不删)
 *  - `ATR_HOOK_PORT`     → 实例端口;镜像 settings 的 hooks URL 写死
 *    `${ATR_HOOK_PORT:-1}`,运行期经 PTY env 解引用——settings 内容因此
 *    与实例无关,共享才成为可能
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
import { buildConfigDirMirror } from './config-dir-mirror.js';
import { mapHookPayload, filterEventsByToggles } from './hook-mapper.js';

/** PTY env 注入的 claude 配置目录变量名(Claude Code 官方支持) */
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';

/**
 * PTY env 注入的 hooks 回调端口变量名(atr 自有约定)
 *
 * 镜像 settings 的 hook 命令 URL 写 `${ATR_HOOK_PORT:-1}`,sh 执行时从环境
 * 解引用;未注入(不经 atr 的普通终端)时打 127.0.0.1:1 即刻拒绝,无感开销。
 */
export const ATR_HOOK_PORT_ENV = 'ATR_HOOK_PORT';

/**
 * 模块构造选项
 *
 * @param events           事件子开关(对应 UserConfig.integrations.perModule['claude-code'].events);
 *   0.18 起为运行时过滤开关(镜像 settings 固定全事件注册)
 * @param existingSettings 用户已有 settings(从 --settings <path> 提取的内容;
 *   不传时镜像自动读 ~/.claude/settings.json 合并)
 * @param settingsBaseDir  镜像根目录的父目录(测试时可注入,默认 ~/.auvezy/…;
 *   镜像实际位于 <baseDir>/claude-code/<escapedCwd>/)
 */
export interface ClaudeCodeIntegrationOptions {
  events?: ClaudeCodeEventToggles;
  existingSettings?: Record<string, unknown>;
  settingsBaseDir?: string;
}

export class ClaudeCodeIntegration implements Integration {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Claude Code';

  private readonly events: ClaudeCodeEventToggles;
  private readonly existingSettings: Record<string, unknown> | undefined;
  private readonly settingsBaseDir: string | undefined;

  constructor(opts: ClaudeCodeIntegrationOptions = {}) {
    this.events = opts.events ?? DEFAULT_CLAUDE_CODE_EVENTS;
    this.existingSettings = opts.existingSettings;
    this.settingsBaseDir = opts.settingsBaseDir;
  }

  detect(ctx: SpawnContext): boolean {
    // viaShellFallback:program 经 $SHELL -ic fallback(shell 函数/alias 场景,
    // 如 zshrc 里的 zclaude)。函数名不含 'claude' 无法静态确认,但用户特意
    // 写函数启动的程序值得注入——误报后果只是 claude 没跑时无人消费镜像。
    return isClaudeCommand(ctx.command) || ctx.viaShellFallback === true;
  }

  prepareSpawn(ctx: SpawnContext): SpawnAugmentation | null {
    // 镜像顶层按 integration id 分(<dataDir>/claude-code/...),将来接新集成
    // 各占一个顶层目录;子目录按项目 cwd 命名,同项目多实例共享
    const mirrorBaseDir = resolve(this.settingsBaseDir ?? resolve(homedir(), ATR_DATA_DIR), this.id);
    const dir = buildConfigDirMirror({
      mirrorBaseDir,
      realConfigDir: resolve(homedir(), '.claude'),
      cwd: ctx.cwd,
      ...(this.existingSettings ? { existingSettings: this.existingSettings } : {}),
    });
    logger.info({ dir, port: ctx.port, cwd: ctx.cwd }, 'ClaudeCode: 镜像已构建(按项目共享)');
    return {
      extraEnv: {
        [CLAUDE_CONFIG_DIR_ENV]: dir,
        [ATR_HOOK_PORT_ENV]: String(ctx.port),
      },
    };
  }

  onHookPayload(payload: unknown): IntegrationEvent[] {
    // 镜像 settings 固定全事件注册,实例级开关在翻译后过滤(见 ADR-002)
    return filterEventsByToggles(mapHookPayload(payload), this.events);
  }

  /**
   * 空操作(0.18 起):镜像按项目共享、实例退出不删,启动时幂等重建
   */
  shutdown(): void {
    // no-op——保留接口满足 Integration 契约
  }
}

export type { ClaudeCodeEventToggles } from './settings-builder.js';
export { DEFAULT_CLAUDE_CODE_EVENTS } from './settings-builder.js';
