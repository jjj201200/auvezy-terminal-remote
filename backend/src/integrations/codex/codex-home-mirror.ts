/**
 * CODEX_HOME 镜像目录构建
 *
 * Codex 支持 env `CODEX_HOME` 重定向主目录。本模块在 atr 数据目录下构建
 * 镜像(与 claude-code 的 config-dir-mirror 同构,见 ADR-002 按项目共享):
 *
 *   <ATR_DATA_DIR>/codex/<escapedCwd>/
 *   ├── hooks.json        ← 真文件:atr 生成的事件回调(唯一注入物)
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
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logger/logger.js';
import { escapeCwdToDirName } from '../claude-code/config-dir-mirror.js';
import { buildCodexHooksJson } from './hooks-builder.js';

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

  // 1. symlink 透传:~/.codex 的每个 entry(除 hooks.json——由镜像版顶替)
  if (existsSync(opts.realCodexHome)) {
    for (const entry of readdirSync(opts.realCodexHome)) {
      if (entry === 'hooks.json') continue; // 由 atr 生成版顶替
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
