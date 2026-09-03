/**
 * 实例名生成与展示工具
 *
 * 命名规则（「目录名+序号」）：
 *  - 无冲突：直接用 base（首个实例不加序号）
 *  - 冲突：base-2、base-3… 取已占用最大序号 +1（不复用已死实例的号）
 *  - 显式指定的名字不避让——重名确认由调用方负责
 *    （CLI 走 selectOne 交互，Web 走 POST /api/instances 的 409 两段式）
 *
 * 原子性：本模块是纯函数；「读名单 → 生成 → 写入」的原子性由 register()
 * 的 withFileLock 临界区保证（见 instance-registry.ts）。
 */

/**
 * 生成不与 existingNames 冲突的实例名。
 *
 * 匹配规则：`base` 本身或 `base-N`（N 为纯数字）视为占用；
 * 前缀更长（foobar ≠ foo）或非数字后缀（foo-bar）不算冲突；大小写敏感。
 *
 * @param base 期望名（通常是 cwd basename）
 * @param existingNames 当前活实例名列表
 * @returns base（无冲突）或 base-N（N = 已占用最大序号 + 1）
 * @example
 *   nextInstanceName('myproj', [])                    // 'myproj'
 *   nextInstanceName('myproj', ['myproj'])            // 'myproj-2'
 *   nextInstanceName('myproj', ['myproj', 'myproj-5']) // 'myproj-6'
 */
export function nextInstanceName(
  base: string,
  existingNames: readonly string[],
): string {
  if (!existingNames.includes(base)) return base;
  // 裸 base 算序号 1；扫描 base-N 找最大已占序号
  let max = 1;
  const prefix = `${base}-`;
  for (const name of existingNames) {
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = Number(suffix);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${base}-${max + 1}`;
}

/**
 * 显示层截断：超长时截 basename 部分而保住尾部 -N 序号。
 *
 * 背景：atr list / atr status 对 name 列有固定宽度限制，直接 slice 会把
 * 同路径多实例赖以区分的序号切掉（如 30+ 字符的目录名），等于白避让。
 * 启发式：把「尾部 `-` + 纯数字」视作序号优先保留；无该模式则直接截断。
 *
 * @param name 实例名
 * @param max 最大显示宽度
 * @returns 长度 ≤ max 的显示名
 * @example
 *   truncateName('myproj', 30)   // 'myproj'
 *   truncateName('c'.repeat(34) + '-2', 30) // 'cc…c-2'（保序号）
 */
export function truncateName(name: string, max: number): string {
  if (name.length <= max) return name;
  const m = /^(.*)-(\d+)$/.exec(name);
  if (!m) return name.slice(0, max);
  const suffix = m[2]!;
  // 病态长后缀：连 -N 都放不下，保数字头部
  if (suffix.length + 1 >= max) return suffix.slice(0, max);
  const keep = max - suffix.length - 1;
  return `${m[1]!.slice(0, keep)}-${suffix}`;
}
