/**
 * workdir-policy
 *
 * 统一的"cwd 是否允许 spawn 实例"校验，由白名单 + 黑名单两个 picomatch glob 列表决定。
 *
 * 规则：
 *   1. 黑名单优先：cwd 命中任一 deny pattern → 拒绝
 *   2. 白名单非空时：cwd 必须命中至少一个 allow pattern；否则 → 拒绝
 *   3. 白名单为空（undefined / []）→ 跳过白名单这一关（默认放行）
 *
 * 路径规范化：
 *   - 入参 cwd 必须是绝对路径（调用方负责，spawner 已 isAbsolute + resolve）
 *   - picomatch 默认 dot:false → 隐藏文件 / 目录不被通配符自动命中
 *     这里我们显式开 dot:true，因为很多项目目录就叫 .config / .cache 等
 *   - Windows 反斜杠 → forward slash（picomatch 用 unix 风格）
 */

import picomatch from 'picomatch';

/** 校验结果：null = 通过；string = 拒绝原因（可直接给用户看） */
export type WorkdirCheckResult = null | { reason: string; matchedPattern: string };

/**
 * 判断 cwd 是否允许作为 spawn 工作目录。
 *
 * @param cwd 绝对路径（调用方保证，相对路径行为未定义）
 * @param allow 白名单 patterns（undefined / [] 表示不设白名单）
 * @param deny 黑名单 patterns（undefined / [] 表示不设黑名单 —— 极不推荐）
 * @returns null = 通过；{reason, matchedPattern} = 被拒
 */
export function checkWorkdir(
  cwd: string,
  allow: readonly string[] | undefined,
  deny: readonly string[] | undefined,
): WorkdirCheckResult {
  const norm = normalizePath(cwd);
  const opts: picomatch.PicomatchOptions = { dot: true };

  // 黑名单优先
  if (deny && deny.length > 0) {
    for (const pattern of deny) {
      if (picomatch(pattern, opts)(norm)) {
        return {
          reason: `cwd "${cwd}" 命中黑名单 pattern：${pattern}`,
          matchedPattern: pattern,
        };
      }
    }
  }

  // 白名单：非空时必须命中
  if (allow && allow.length > 0) {
    let hit = false;
    for (const pattern of allow) {
      if (picomatch(pattern, opts)(norm)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      return {
        reason: `cwd "${cwd}" 未命中任何白名单 pattern：[${allow.join(', ')}]`,
        matchedPattern: '',
      };
    }
  }

  return null;
}

/** Windows 反斜杠 → forward slash；picomatch 是 unix glob */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
