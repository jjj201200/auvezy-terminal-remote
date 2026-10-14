/**
 * CodexIntegration
 *
 * Codex CLI 的 Integration 实现,与 ClaudeCodeIntegration 同构。
 *
 * 职责拆分:
 *  - detect.ts             → 命令名识别(codex 无入口 env,detect 只能靠命令名)
 *  - codex-home-mirror.ts  → ~/.codex 镜像(按项目 cwd 命名)+ CODEX_HOME env 注入
 *  - hooks-builder.ts      → 生成 hooks.json(镜像内使用)
 *  - hook-mapper.ts        → payload → events(含事件子开关运行时过滤)
 *  - trust.ts              → hook trust 一键授权(前端横幅触发,写 ~/.codex/config.toml)
 *
 * 注入通道:PTY env `CODEX_HOME=<镜像目录>`(官方支持;目录必须真实存在且
 * 不能本身是 symlink——见 codex-home-mirror.ts 注释)+ `ATR_HOOK_PORT`
 * (hooks 命令 URL 写死 ${ATR_HOOK_PORT:-1},运行期 shell 展开)。
 *
 * 与 claude 集成的关键差异:codex 对非托管 hooks 有 trust 审查——注入的
 * hooks.json 默认 Untrusted 静默跳过,需要前端"一键授权"(trust.ts 写
 * trusted_hash)后才生效;生效时机是 codex 启动时(授权后需重启实例)。
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
import { isCodexCommand } from './detect.js';
import { DEFAULT_CODEX_EVENTS, type CodexEventToggles } from './hooks-builder.js';
import { buildCodexHomeMirror } from './codex-home-mirror.js';
import { mapCodexHookPayload, filterCodexEventsByToggles } from './hook-mapper.js';

/** PTY env 注入的 codex 主目录变量名(官方支持,镜像目录) */
export const CODEX_HOME_ENV = 'CODEX_HOME';

/** PTY env 注入的 hooks 回调端口变量名(atr 自有约定,与 claude 集成共用) */
export const ATR_HOOK_PORT_ENV = 'ATR_HOOK_PORT';

/**
 * 模块构造选项
 *
 * @param events        事件子开关(UserConfig.integrations.perModule['codex'].events)
 * @param mirrorBaseDir 镜像根目录父目录(测试注入;默认 ~/.auvezy/terminal-remote)
 */
export interface CodexIntegrationOptions {
  events?: CodexEventToggles;
  mirrorBaseDir?: string;
}

export class CodexIntegration implements Integration {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';

  private readonly events: CodexEventToggles;
  private readonly mirrorBaseDir: string | undefined;

  constructor(opts: CodexIntegrationOptions = {}) {
    this.events = opts.events ?? DEFAULT_CODEX_EVENTS;
    this.mirrorBaseDir = opts.mirrorBaseDir;
  }

  detect(ctx: SpawnContext): boolean {
    // viaShellFallback 同 claude:shell 函数场景无法静态确认,值得注入
    return isCodexCommand(ctx.command) || ctx.viaShellFallback === true;
  }

  prepareSpawn(ctx: SpawnContext): SpawnAugmentation | null {
    const mirrorBaseDir = resolve(
      this.mirrorBaseDir ?? resolve(homedir(), ATR_DATA_DIR),
      this.id,
    );
    const dir = buildCodexHomeMirror({
      mirrorBaseDir,
      realCodexHome: resolve(homedir(), '.codex'),
      cwd: ctx.cwd,
    });
    logger.info({ dir, port: ctx.port, cwd: ctx.cwd }, 'Codex: 镜像已构建(按项目共享)');
    return {
      extraEnv: {
        [CODEX_HOME_ENV]: dir,
        [ATR_HOOK_PORT_ENV]: String(ctx.port),
      },
    };
  }

  onHookPayload(payload: unknown): IntegrationEvent[] {
    // 镜像 hooks.json 固定全事件注册,实例级开关翻译后过滤(同 claude 集成)
    return filterCodexEventsByToggles(mapCodexHookPayload(payload), this.events);
  }

  /** 空操作:镜像按项目共享、实例退出不删,启动时幂等重建 */
  shutdown(): void {
    // no-op
  }
}

export type { CodexEventToggles } from './hooks-builder.js';
export { DEFAULT_CODEX_EVENTS } from './hooks-builder.js';
