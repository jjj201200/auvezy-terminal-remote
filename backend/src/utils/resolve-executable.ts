/**
 * 把"用户给的 program 名"解析成实际可执行文件的绝对路径。
 *
 * 用途：`atr <program>` 在 fork broker / 创建实例之前，先确认 program 真的存在
 * 可执行——否则会在 ensureBroker 拉起 broker、worker 写 instances.json、PTY
 * spawn 抛 ENOENT 之间留下脏状态。
 *
 * 行为：
 *  - 绝对 / 相对路径（含 `/` 或 Windows `\`）：直接 stat + 检查可执行位
 *  - 纯名字（"zsh" / "claude"）：在 $PATH 各目录下找；Windows 需考虑 PATHEXT
 *  - 无任何匹配 → 返回 null（调用方决定怎么报错，便于本地化 / 加 hint）
 *
 * 不做：
 *  - 不抛错——让调用方拼上下文（"atr <program> 找不到"）
 *  - 不缓存——一次启动只调一次，无需缓存
 *  - 不解析 shell builtin（用户传 `cd` / `set` 这种内置命令本来也起不了）
 */

import { accessSync, existsSync, readdirSync, statSync, constants } from 'node:fs';
import { resolve as pathResolve, isAbsolute, sep } from 'node:path';
import { delimiter } from 'node:path';

/**
 * 解析 program 到绝对可执行路径
 *
 * @param program 用户给的命令名（"zsh" / "/usr/bin/zsh" / "./my-tool"）
 * @param env 环境变量（默认 process.env）；测试可注入
 * @returns 找到的绝对路径；找不到返回 null
 */
export function resolveExecutable(
  program: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!program || program.length === 0) return null;

  // 含路径分隔符 → 直接 stat（绝对路径或相对路径）
  if (program.includes('/') || program.includes(sep)) {
    const abs = isAbsolute(program) ? program : pathResolve(program);
    return isExecutable(abs) ? abs : null;
  }

  // 纯名字 → 在 PATH 上查找
  const pathEnv = env['PATH'] ?? env['Path'] ?? '';
  if (!pathEnv) return null;
  const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);

  // Windows：PATHEXT 决定哪些扩展名算可执行（.EXE/.CMD/.BAT/...）
  // 用户传 "claude" 期望匹配 "claude.exe" / "claude.cmd"
  const exts = process.platform === 'win32'
    ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((e) => e.length > 0)
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = pathResolve(dir, program + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * 列出 PATH 上所有可执行文件名(去重 + 去扩展名)。
 *
 * 用途:`atr cluade` 找不到时,在这份名单里 didyoumean 给最相似建议(`claude`)。
 *
 * 性能:扫一次 readdir 各 PATH dir,通常 <2000 个文件 + readdir 是同步系统调用,
 * 整个 ~10ms。仅在错误路径才调,不影响成功启动。
 *
 * 失败处理:某个 PATH dir 不存在 / 无权限 → 跳过该 dir(不抛错)。
 *
 * Windows:扣去 PATHEXT 里的扩展名 —— 用户输入"claude"应该匹配"claude.exe"
 * 但建议时显示"claude"更友好。
 */
export function listPathExecutables(env: NodeJS.ProcessEnv = process.env): string[] {
  const pathEnv = env['PATH'] ?? env['Path'] ?? '';
  if (!pathEnv) return [];
  const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);

  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter((e) => e.length > 0)
        .map((e) => e.toLowerCase())
    : [];

  const seen = new Set<string>();
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // 不存在 / 权限拒绝,跳过
    }
    for (const entry of entries) {
      let name = entry;
      if (isWin) {
        // 把 PATHEXT 里的扩展名剥掉:claude.exe → claude
        const lower = name.toLowerCase();
        const matchedExt = exts.find((e) => lower.endsWith(e));
        if (matchedExt) name = name.slice(0, name.length - matchedExt.length);
        else continue; // Windows 上没匹配 PATHEXT 的不视作可执行
      }
      // POSIX 上不能 readdir 后挨个 statSync(慢) —— 直接全部加进去,误差由
      // didyoumean 阈值过滤;真要校验可执行也只是建议,不影响行为正确性
      if (name.length > 0) seen.add(name);
    }
  }
  return Array.from(seen);
}

/** 检查路径是文件且可执行（POSIX X 位 / Windows 任意可读） */
function isExecutable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const st = statSync(path);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }
  // POSIX: 检查 X 位；Windows: 没有 X 位概念，能 access 就算
  if (process.platform === 'win32') return true;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
