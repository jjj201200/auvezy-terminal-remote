/**
 * ~/.claude 镜像目录构建
 *
 * Claude Code 支持 env `CLAUDE_CONFIG_DIR` 重定向配置目录(官方文档化行为)。
 * 本模块在 atr 数据目录下构建镜像:
 *
 *   <ATR_DATA_DIR>/claude-code/<escapedCwd>/
 *   ├── settings.json     ← 真文件:用户 ~/.claude/settings.json 合并 + atr hooks
 *   │                       (hooks 端口走 ${ATR_HOOK_PORT} env,内容与实例无关)
 *   ├── .claude.json      ← symlink → 顶级 ~/.claude.json(直跑会话的现行状态文件)
 *   ├── plugins           ← 真目录:官方 ~/.claude/plugins 深拷贝副本(路径注册表
 *   │                       须每镜像独立,见 syncPluginsCopy)
 *   └── <其余 entry>      ← 全部 symlink → ~/.claude 对应 entry
 *                           (凭据/历史/projects/skills 零拷贝共享,登录态不丢)
 *
 * 0.18 起(ADR-002)镜像**按项目 cwd 命名**(转义规则对齐 claude projects 桶的
 * 观感:非字母数字→'-'),同项目多实例共享同一镜像;实例退出不删除,启动幂等重建。
 * transcripts 经 symlink 穿透仍落 ~/.claude/projects/<sanitized-cwd>/ 主桶,
 * 与直跑会话历史并列——claude 对"项目"的固有键是 cwd,与 CONFIG_DIR 无关。
 *
 * 已知限制(接受):
 *  - claude 原子写会把部分 symlink(如 .credentials.json)替换为镜像内实体文件;
 *    共享镜像不随实例删,物化副本留存复用,token 各自刷新同账号不冲突
 *  - 不同 cwd 转义后极端撞名(如 /a/b 与 /a-b)共享同一镜像,无功能损害
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
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { logger } from '../../logger/logger.js';
import { buildClaudeSettings, readUserSettings } from './settings-builder.js';

/** 转义后目录名上限(防文件系统路径过长;与 claude 的 200 上限同量级) */
const MAX_PROJECT_DIR_NAME = 180;

/**
 * 项目 cwd → 镜像子目录名
 *
 * 非字母数字统一替换为 '-'(与 claude projects/<sanitized-cwd> 观感一致);
 * 超长时截断并追加 cwd 全量 sha1 前 8 位(防撞名 + 防路径上限)。
 *
 * @param cwd 实例工作目录(绝对路径)
 */
export function escapeCwdToDirName(cwd: string): string {
  const escaped = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (escaped.length <= MAX_PROJECT_DIR_NAME) return escaped;
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 8);
  return `${escaped.slice(0, MAX_PROJECT_DIR_NAME - 9)}-${hash}`;
}

/** 镜像构建参数 */
export interface ConfigDirMirrorOptions {
  /** 镜像根目录(每集成模块一个;如 <ATR_DATA_DIR>/claude-code) */
  mirrorBaseDir: string;
  /** 真实配置目录(如 ~/.claude);不存在时降级为只写 settings */
  realConfigDir: string;
  /** 实例工作目录——决定镜像子目录名(同项目共享) */
  cwd: string;
  /** 额外合并进 settings 的既有配置(如用户 --settings 参数提取值);默认读 realConfigDir/settings.json */
  existingSettings?: Record<string, unknown>;
}

/**
 * 构建(或幂等更新)项目专属的镜像目录
 *
 * @returns 镜像目录绝对路径(settings.json 已就位,可直接作为 CLAUDE_CONFIG_DIR)
 */
export function buildConfigDirMirror(opts: ConfigDirMirrorOptions): string {
  const dir = join(opts.mirrorBaseDir, escapeCwdToDirName(opts.cwd));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync 的 mode 受 umask 影响且已存在目录不生效,显式校准(幂等)
  chmodSync(dir, 0o700);

  // 1. symlink 透传:~/.claude 的每个 entry(除 settings.json/.claude.json/plugins)→ 镜像
  if (existsSync(opts.realConfigDir)) {
    for (const entry of readdirSync(opts.realConfigDir)) {
      if (entry === 'settings.json') continue; // 由镜像版顶替
      // .claude.json 不透传:目录内同名文件是历史误产物,顶级 ~/.claude.json 才是
      // 直跑会话的现行状态文件——透传循环若先链走它,顶级的修正链接永远落空
      // (0.18 前的实际行为,曾致双身份分裂,见 ADR-002)
      if (entry === '.claude.json') continue;
      if (entry === 'plugins') continue; // 注册表含绝对路径,须独立副本(见 syncPluginsCopy)

      const target = join(opts.realConfigDir, entry);
      const linkPath = join(dir, entry);
      if (existsSync(linkPath)) continue; // 幂等:已透传(含 symlink 悬挂时 existsSync=false 会重建)

      try {
        symlinkSync(target, linkPath);
      } catch (err) {
        // 单个 entry 失败(权限/平台限制)只降级该 entry,不阻断镜像整体
        logger.warn({ entry, err }, 'claude-code 镜像:entry symlink 失败,已跳过');
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
          logger.warn({ err }, 'claude-code 镜像:.claude.json symlink 失败,已跳过');
        }
      }
    }
  } else {
    logger.info(
      { realConfigDir: opts.realConfigDir },
      'claude-code 镜像:真实配置目录不存在,仅写 settings(claude 首跑会在镜像内初始化)',
    );
  }

  // 2. settings.json:用户原配置(默认读 realConfigDir/settings.json)+ atr hooks
  //    (全事件注册,端口走 env;实例级开关由 onHookPayload 运行时过滤)
  const existing =
    opts.existingSettings ??
    readUserSettings(opts.realConfigDir);
  const settings = buildClaudeSettings(existing);
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  return dir;
}

/** 注册表路径字段里 `<configDir>/plugins/` 分隔的截取标记 */
const PLUGINS_PATH_SEP = '/plugins/';

/**
 * 数字命名目录的清理宽限期:24h 内修改过的视为可能被同机混跑的旧版本
 * 实例(旧版仍按端口建镜像)正在使用,不动
 */
const LEGACY_PORT_MIRROR_GRACE_MS = 24 * 3600_000;

/**
 * 清理按端口命名的旧版镜像残留(0.18 迁移兜底,见 ADR-002)
 *
 * 覆盖两处:旧命名根 `claude-config/<数字>` 与新命名根 `claude-code/` 下
 * 防御性排查的数字目录(新版只按项目命名,正常不出现)。按项目命名的镜像
 * 共享长存,不受影响。旧版数据目录 `~/.atr/` 不在本清理范围。
 *
 * @param dataDir atr 数据目录(如 ~/.auvezy/terminal-remote)
 */
export function cleanupLegacyPortMirrors(dataDir: string): void {
  for (const base of ['claude-config', 'claude-code']) {
    const baseDir = join(dataDir, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir)) {
      if (!/^\d+$/.test(entry)) continue;
      const dir = join(baseDir, entry);
      try {
        const mtime = statSync(dir).mtimeMs;
        if (Date.now() - mtime < LEGACY_PORT_MIRROR_GRACE_MS) continue;
        rmSync(dir, { recursive: true, force: true });
        logger.info({ dir }, '已清理旧端口镜像残留');
      } catch (err) {
        logger.warn({ err, dir }, '旧端口镜像清理失败(残留无害,下次重试)');
      }
    }
  }
}

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
    logger.warn({ err }, 'claude-code 镜像:plugins 副本构建失败,该实例插件/市场不可用');
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
    logger.warn({ err, path }, 'claude-code 镜像:plugins 注册表解析失败,跳过归一');
    return;
  }
  mutate(root);
  try {
    writeFileSync(path, JSON.stringify(root, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err, path }, 'claude-code 镜像:plugins 注册表归一写回失败');
  }
}

/** 窄化 unknown 为普通对象(排除 null/数组) */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
