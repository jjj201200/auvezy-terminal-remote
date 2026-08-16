/**
 * ~/.claude 镜像目录构建
 *
 * Claude Code 支持 env `CLAUDE_CONFIG_DIR` 重定向配置目录(官方文档化行为)。
 * 本模块在 atr 数据目录下构建镜像:
 *
 *   ~/.atr/claude-config/<port>/
 *   ├── settings.json     ← 真文件:用户 ~/.claude/settings.json 合并 + atr hooks
 *   ├── .claude.json      ← symlink → ~/.claude.json(顶级状态文件,官方语义随目录迁移)
 *   ├── plugins           ← 真目录:官方 ~/.claude/plugins 深拷贝副本(路径注册表
 *   │                       须每实例独立,见 syncPluginsCopy)
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
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
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

  // 1. symlink 透传:~/.claude 的每个 entry(除 settings.json/plugins)→ 镜像
  if (existsSync(opts.realConfigDir)) {
    for (const entry of readdirSync(opts.realConfigDir)) {
      if (entry === 'settings.json') continue; // 由镜像版顶替
      if (entry === 'plugins') continue; // 注册表含绝对路径,须独立副本(见 syncPluginsCopy)

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
    // plugins 独立副本:市场/插件注册表(known_marketplaces.json /
    // installed_plugins.json)以绝对路径记录 installLocation/installPath,
    // Claude Code 强校验其位于当前 CLAUDE_CONFIG_DIR 内——多实例 symlink
    // 共享一份注册表时,任一实例的写入都会让其它实例(含官方 ~/.claude
    // 环境)报 marketplace corrupted。深拷贝一份并把路径归一到本镜像。
    syncPluginsCopy(opts.realConfigDir, dir);
    // 顶级状态文件 ~/.claude.json:CLAUDE_CONFIG_DIR 的官方语义是整个配置目录
    // 迁移,Claude 会改读 $CLAUDE_CONFIG_DIR/.claude.json(引导完成标记/项目
    // 历史/账号绑定都在里面)。它躺在 realConfigDir 的父目录,readdir 看不到,
    // 不透传的话 atr 里跑 claude 每次都当全新用户(重新引导、丢历史)。
    const topLevelState = join(dirname(opts.realConfigDir), '.claude.json');
    if (existsSync(topLevelState)) {
      const linkPath = join(dir, '.claude.json');
      if (!existsSync(linkPath)) {
        try {
          symlinkSync(topLevelState, linkPath);
        } catch (err) {
          logger.warn({ err }, 'claude-config 镜像:.claude.json symlink 失败,已跳过');
        }
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

/** 注册表路径字段里 `<configDir>/plugins/` 分隔的截取标记 */
const PLUGINS_PATH_SEP = '/plugins/';

/**
 * 深拷贝官方 plugins 到镜像并归一注册表路径。
 *
 * 幂等:镜像 plugins 已是真目录时跳过(实例运行期在副本上的演化不回滚);
 * 是旧版残留 symlink 时删除重拷(升级兼容)。官方侧无 plugins 时不动,
 * claude 首跑会在镜像内自初始化。
 */
function syncPluginsCopy(realConfigDir: string, mirrorDir: string): void {
  const src = join(realConfigDir, 'plugins');
  if (!existsSync(src)) return;
  const dest = join(mirrorDir, 'plugins');
  if (existsSync(dest)) {
    if (!lstatSync(dest).isSymbolicLink()) return; // 已有独立副本
    rmSync(dest, { recursive: true, force: true }); // 旧版 symlink 残留
  }
  try {
    cpSync(src, dest, { recursive: true });
    normalizePluginsPaths(dest);
  } catch (err) {
    logger.warn({ err }, 'claude-config 镜像:plugins 副本构建失败,该实例插件/市场不可用');
  }
}

/**
 * 归一 plugins 注册表里的绝对路径:白名单字段(installLocation /
 * source.path / installPath)凡含 `/plugins/` 分隔的,前缀统一改写为本镜像
 * plugins 路径(marketplaces/... 与 cache/... 后缀不变);projectPath 等
 * 项目路径字段不碰。
 */
function normalizePluginsPaths(pluginsDir: string): void {
  const rewrite = (value: string): string => {
    const idx = value.indexOf(PLUGINS_PATH_SEP);
    if (idx === -1) return value;
    return pluginsDir + value.slice(idx + PLUGINS_PATH_SEP.length - 1);
  };

  // known_marketplaces.json:{ <name>: { installLocation, source: { path? } } }
  rewriteJson(join(pluginsDir, 'known_marketplaces.json'), (root) => {
    if (!isRecord(root)) return;
    for (const entry of Object.values(root)) {
      if (!isRecord(entry)) continue;
      if (typeof entry.installLocation === 'string') {
        entry.installLocation = rewrite(entry.installLocation);
      }
      if (isRecord(entry.source) && typeof entry.source.path === 'string') {
        entry.source.path = rewrite(entry.source.path);
      }
    }
  });

  // installed_plugins.json:{ plugins: { <key>: [{ installPath }] } }
  rewriteJson(join(pluginsDir, 'installed_plugins.json'), (root) => {
    if (!isRecord(root) || !isRecord(root.plugins)) return;
    for (const versions of Object.values(root.plugins)) {
      if (!Array.isArray(versions)) continue;
      for (const version of versions) {
        if (isRecord(version) && typeof version.installPath === 'string') {
          version.installPath = rewrite(version.installPath);
        }
      }
    }
  });
}

/** 读-改-写一个 json 文件;文件不存在或解析失败仅降级(保留拷贝原样) */
function rewriteJson(path: string, mutate: (root: unknown) => void): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return; // 官方侧无该文件——正常
  }
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, path }, 'claude-config 镜像:plugins 注册表解析失败,跳过归一');
    return;
  }
  mutate(root);
  try {
    writeFileSync(path, JSON.stringify(root, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err, path }, 'claude-config 镜像:plugins 注册表归一写回失败');
  }
}

/** 窄化 unknown 为普通对象(排除 null/数组) */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
