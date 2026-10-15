/**
 * CODEX_HOME 镜像目录构建
 *
 * Codex 支持 env `CODEX_HOME` 重定向主目录。本模块在 atr 数据目录下构建
 * 镜像(与 claude-code 的 config-dir-mirror 同构,见 ADR-002 按项目共享):
 *
 *   <ATR_DATA_DIR>/codex/<escapedCwd>/
 *   ├── hooks.json        ← 真文件:atr 生成的事件回调(唯一注入物)
 *   ├── app-server-daemon/ ← 不透传(留空):codex 自建的 daemon socket 目录
 *   ├── app-server-control/ ← 同上(透传 symlink 会让 codex lstat 判非目录 fatal)
 *   └── <其余 entry>      ← 全部 symlink → ~/.codex 对应 entry
 *                           (auth.json 登录态 / sessions 会话历史 /
 *                            history.jsonl / config.toml 用户配置零拷贝共享)
 *
 * 与 claude 侧的差异(源码级核对,rust-v0.162.1):
 *  - config.toml **symlink 保真**:codex 把项目 trust([projects.<path>])、
 *    模型、MCP 全记在 user config.toml,生成替代版会丢用户配置;atr 的注入
 *    走独立 hooks.json(codex 对各层 hooks 是 union 合并,互不覆盖)
 *  - 镜像目录必须是**真实目录**:CODEX_HOME 会被 canonicalize(),目录本身
 *    若是 symlink 会解析回真实 ~/.codex,镜像失效(utils/home-dir 源码)
 *  - 镜像内已存在的 hooks.json **不无条件覆写**:内容属于 trust 身份
 *    (trusted_hash 的输入),内容不变时覆写无害,但保持"内容相同即跳过"
 *    可让 mtime 成为"上次注入时间"的观测点
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logger/logger.js';
import { escapeCwdToDirName } from '../claude-code/config-dir-mirror.js';
import { buildCodexHooksJson } from './hooks-builder.js';

/**
 * 不透传进镜像的 entry(相对 ~/.codex 的名字)
 *
 *  - `hooks.json`(MIRROR_REPLACED):由镜像生成版顶替(atr 注入;文件由下方
 *    第 2 步统一写,循环里只需跳过透传)
 *  - `app-server-daemon` / `app-server-control`(MIRROR_BLOCKED):codex 的
 *    后台 daemon **socket 目录**——codex 启动(含扫码登录拉 daemon)时要求在
 *    CODEX_HOME 下自建该目录,路径若是透传 symlink,lstat 非 directory 直接
 *    fatal("socket directory path exists and is not a directory",0.19.0
 *    实测 `atr codex` 扫码即闪退)。必须留空让 codex 自建;旧镜像遗留的
 *    透传 symlink 在重建时清除(幂等治愈)。
 */
const MIRROR_REPLACED_ENTRIES = new Set(['hooks.json']);
const MIRROR_BLOCKED_ENTRIES = new Set(['app-server-daemon', 'app-server-control']);

/** 镜像构建参数 */
export interface CodexHomeMirrorOptions {
  /** 镜像根目录(每集成模块一个;如 <ATR_DATA_DIR>/codex) */
  mirrorBaseDir: string;
  /** 真实 codex 主目录(如 ~/.codex);不存在时镜像仅含 hooks.json */
  realCodexHome: string;
  /** 实例工作目录——决定镜像子目录名(同项目共享) */
  cwd: string;
}

/**
 * 推导某 cwd 的镜像目录路径(不构建)
 *
 * trust API 用它从 instanceId → cwd 反查 hooks.json 位置,与
 * buildCodexHomeMirror 的路径决策保持单一来源。
 */
export function codexMirrorDirPath(mirrorBaseDir: string, cwd: string): string {
  return join(mirrorBaseDir, escapeCwdToDirName(cwd));
}

/**
 * 构建(或幂等更新)项目专属的 CODEX_HOME 镜像目录
 *
 * @returns 镜像目录绝对路径(hooks.json 已就位,可直接作为 CODEX_HOME)
 */
export function buildCodexHomeMirror(opts: CodexHomeMirrorOptions): string {
  const dir = join(opts.mirrorBaseDir, escapeCwdToDirName(opts.cwd));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // 幂等校准(umask / 已存在目录)

  // 1. symlink 透传:~/.codex 的每个 entry(排除语义见 MIRROR_*_ENTRIES 注释)
  if (existsSync(opts.realCodexHome)) {
    for (const entry of readdirSync(opts.realCodexHome)) {
      if (MIRROR_REPLACED_ENTRIES.has(entry)) continue; // 由第 2 步生成版顶替
      if (MIRROR_BLOCKED_ENTRIES.has(entry)) {
        // 幂等治愈:0.19.0 旧镜像可能已透传了 socket 目录 symlink(codex 会
        // fatal),重建时清掉让 codex 自建
        const stale = join(dir, entry);
        if (lstatSync(stale, { throwIfNoEntry: false }) !== undefined) {
          try {
            rmSync(stale, { recursive: true, force: true });
            logger.info({ entry }, 'codex 镜像:清除不该透传的 entry(运行时 socket 目录)');
          } catch (err) {
            logger.warn({ entry, err }, 'codex 镜像:排除项清理失败');
          }
        }
        continue;
      }
      const target = join(opts.realCodexHome, entry);
      const linkPath = join(dir, entry);
      if (existsSync(linkPath)) continue; // 幂等(悬挂 symlink 会在下次重建)
      try {
        symlinkSync(target, linkPath);
      } catch (err) {
        logger.warn({ entry, err }, 'codex 镜像:entry symlink 失败,已跳过');
      }
    }
  } else {
    logger.info(
      { realCodexHome: opts.realCodexHome },
      'codex 镜像:真实 ~/.codex 不存在,仅写 hooks.json(codex 首跑会在镜像内初始化)',
    );
  }

  // 2. hooks.json:内容相同跳过(保 mtime 观测),变化才覆写
  const hooksJson = JSON.stringify(buildCodexHooksJson(), null, 2) + '\n';
  const hooksPath = join(dir, 'hooks.json');
  let current: string | undefined;
  try {
    current = readFileSync(hooksPath, 'utf8');
  } catch {
    current = undefined; // 首次写入
  }
  if (current !== hooksJson) {
    writeFileSync(hooksPath, hooksJson, { encoding: 'utf8', mode: 0o600 });
  }

  return dir;
}
