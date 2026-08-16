/**
 * ~/.claude 镜像目录构建
 *
 * Claude Code 支持 env `CLAUDE_CONFIG_DIR` 重定向配置目录(官方文档化行为)。
 * 本模块在 atr 数据目录下构建镜像:
 *
 *   ~/.atr/claude-config/<port>/
 *   ├── settings.json     ← 真文件:用户 ~/.claude/settings.json 合并 + atr hooks
 *   └── <其余 entry>      ← 全部 symlink → ~/.claude 对应 entry
 *                           (凭据/历史/projects/skills 零拷贝共享,登录态不丢)
 *
 * PTY spawn 时注入 env CLAUDE_CONFIG_DIR=<镜像>,claude 无论以何种方式被启动
 * (直接 atr claude / zshrc 函数 zclaude / wrapper 脚本 / bash 里手动敲)都会
 * 读到 atr 的 hooks——取代旧的 `--settings` 参数注入(依赖命令名 detect +
 * 参数经函数 "$@" 转发,两条假设在函数场景全部失效)。
 *
 * 已知限制(接受):
 *  - claude 运行期新建的顶层文件落在镜像目录(实例退出即删,不进 ~/.claude)
 *  - 用户在 atr 终端里 /login 且 ~/.claude 尚无凭据时,凭据写进镜像并在实例
 *    退出时随之删除(需重新登录);已登录用户凭据经 symlink 共享,无此问题
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logger/logger.js';
import {
  buildClaudeSettings,
  type ClaudeCodeEventToggles,
} from './settings-builder.js';

/** 镜像构建参数 */
export interface ConfigDirMirrorOptions {
  /** 镜像根目录(每端口一个子目录);如 ~/.atr/claude-config */
  mirrorBaseDir: string;
  /** 真实配置目录(如 ~/.claude);不存在时降级为只写 settings */
  realConfigDir: string;
  /** 当前实例端口(hooks 回调地址 + 镜像子目录名) */
  port: number;
  /** 事件子开关 */
  toggles: ClaudeCodeEventToggles;
  /** 额外合并进 settings 的既有配置(如用户 --settings 参数提取值);默认读 realConfigDir/settings.json */
  existingSettings?: Record<string, unknown>;
}

/**
 * 构建(或幂等更新)端口专属的镜像目录
 *
 * @returns 镜像目录绝对路径(settings.json 已就位,可直接作为 CLAUDE_CONFIG_DIR)
 */
export function buildConfigDirMirror(opts: ConfigDirMirrorOptions): string {
  const dir = join(opts.mirrorBaseDir, String(opts.port));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync 的 mode 受 umask 影响且已存在目录不生效,显式校准(幂等)
  chmodSync(dir, 0o700);

  // 1. symlink 透传:~/.claude 的每个 entry(除 settings.json)→ 镜像
  if (existsSync(opts.realConfigDir)) {
    for (const entry of readdirSync(opts.realConfigDir)) {
      if (entry === 'settings.json') continue; // 由镜像版顶替

      const target = join(opts.realConfigDir, entry);
      const linkPath = join(dir, entry);
      if (existsSync(linkPath)) continue; // 幂等:已透传(含 symlink 悬挂时 existsSync=false 会重建)

      try {
        symlinkSync(target, linkPath);
      } catch (err) {
        // 单个 entry 失败(权限/平台限制)只降级该 entry,不阻断镜像整体
        logger.warn({ entry, err }, 'claude-config 镜像:entry symlink 失败,已跳过');
      }
    }
  } else {
    logger.info(
      { realConfigDir: opts.realConfigDir },
      'claude-config 镜像:真实配置目录不存在,仅写 settings(claude 首跑会在镜像内初始化)',
    );
  }

  // 2. settings.json:用户原配置(默认读 realConfigDir/settings.json)+ atr hooks
  const existing =
    opts.existingSettings ??
    readUserSettings(opts.realConfigDir);
  const settings = buildClaudeSettings(opts.port, opts.toggles, existing);
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  return dir;
}

/**
 * 删除端口镜像目录(实例 shutdown 清理)。
 * rm 不 follow symlink——~/.claude 侧真实文件不受影响。
 */
export function cleanupConfigDirMirror(mirrorBaseDir: string, port: number): void {
  const dir = join(mirrorBaseDir, String(port));
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
    logger.debug({ dir }, 'claude-config 镜像已清理');
  } catch (err) {
    logger.warn({ err, dir }, 'claude-config 镜像清理失败(残留无害,下次启动幂等覆盖)');
  }
}

/** 读用户 ~/.claude/settings.json;不存在/损坏返回 undefined(按全新生成) */
function readUserSettings(realConfigDir: string): Record<string, unknown> | undefined {
  const path = join(realConfigDir, 'settings.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, path }, '用户 claude settings.json 解析失败,按无既有配置处理');
    return undefined;
  }
}
