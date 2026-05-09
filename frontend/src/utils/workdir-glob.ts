/**
 * Workdir glob 工具：从 backend 的 workdirAllow（picomatch glob 列表）抽
 * "可作为 cwd base 的目录"，并复用 picomatch 做提交前的最终校验。
 *
 * 设计：
 *  - extractBase(pattern)：从 pattern 头部抽出非通配前缀
 *      "/home/me/projects/**"   → "/home/me/projects"
 *      "/mnt/d/work/?app/**"    → "/mnt/d/work"   (? 是通配)
 *      "/exact/path/no/glob"    → "/exact/path/no/glob" (整条字面)
 *  - bases(allow)：对每条 allow 抽 base，**字面去重**（保留包含关系，
 *    见 README）
 *  - matchAllow(cwd, allow)：复用后端同款 picomatch 校验逻辑（dot:true）
 *
 * 与后端 workdir-policy.ts 保持一致：picomatch options 都是 { dot: true }，
 * 路径用 forward slash 规范化（Windows 的反斜杠）。
 */

import picomatch from 'picomatch';

/** 抽 pattern 的非通配前缀作为 base 路径 */
export function extractBase(pattern: string): string {
  if (!pattern) return '';
  // picomatch 通配元字符：*, ?, [, ], {, }, !, +, @, (, ), |
  // 找到第一个元字符前的 segment 边界
  const metaIdx = findFirstMetaIndex(pattern);
  if (metaIdx === -1) {
    // 整条都是字面，直接返回（去尾部 /）
    return stripTrailingSlash(pattern);
  }
  // 从 metaIdx 往前找最近的 '/'，截断到那为止
  const cut = pattern.lastIndexOf('/', metaIdx);
  if (cut <= 0) return ''; // 头就是元字符（如 "**"），无 base
  return pattern.slice(0, cut);
}

const META_CHARS = new Set(['*', '?', '[', '{', '!', '+', '@', '(', '|']);

function findFirstMetaIndex(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (META_CHARS.has(s[i] ?? '')) return i;
  }
  return -1;
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

/**
 * 从 allow 列表生成 base 候选，字面去重后保持原顺序。
 * 包含关系（A 是 B 前缀）保留两个 —— 用户可能想从更深的 base 直接填短相对路径。
 */
export function bases(allow: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of allow) {
    const b = extractBase(p);
    if (!b) continue;
    if (seen.has(b)) continue;
    seen.add(b);
    out.push(b);
  }
  return out;
}

/** 路径规范化：反斜杠 → 正斜杠（picomatch 是 unix 风格） */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 校验 cwd 是否命中至少一条 allow pattern（白名单空 = 总是通过）。
 * 与 backend workdir-policy.ts 同款 picomatch options。
 */
export function matchAllow(cwd: string, allow: readonly string[]): boolean {
  if (!allow || allow.length === 0) return true;
  const norm = normalizePath(cwd);
  for (const pattern of allow) {
    if (picomatch(pattern, { dot: true })(norm)) return true;
  }
  return false;
}

/**
 * 把 base 和相对路径拼成绝对路径。
 * 相对路径为空 → 返回 base 本身；否则 base + '/' + relative，去重 '/'。
 */
export function joinBaseAndRelative(base: string, relative: string): string {
  const b = stripTrailingSlash(base);
  const r = relative.trim().replace(/^\/+/, '');
  if (!r) return b;
  return `${b}/${r}`;
}
