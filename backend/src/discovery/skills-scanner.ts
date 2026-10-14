/**
 * Skill / 自定义命令扫描（claude code + codex）
 *
 * 发现规则依据调研（docs/research/，2026-10）：
 *  - claude：skills 目录（.claude/skills/<name>/SKILL.md）与旧式单文件命令
 *    （.claude/commands/<name>.md，现行模型下命令=技能）同权重发现；
 *    只看用户级（$HOME/.claude）与项目级（<cwd>/.claude）两层
 *  - codex：开放标准 .agents/skills（不是 ~/.codex/skills！），
 *    用户级 $HOME/.agents/skills + 从 git root 向下到 cwd 每一级 .agents/skills
 *    （官方行为：CWD 向上到 repo root 每一级都扫）
 *
 * 全部只读固定名称目录，不接受任意路径参数，无穿越面。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredSkill } from 'auvezy-terminal-remote-shared';
import { logger } from '../logger/logger.js';

/** SKILL.md / 命令文件 frontmatter 只读前 4KB（description 很少超长） */
const FRONTMATTER_MAX_BYTES = 4096;

/** 单个 skill 目录下的清单文件名（开放标准 agentskills.io 约定） */
const SKILL_MANIFEST = 'SKILL.md';

export interface SkillsScanOptions {
  /** 用户 HOME（用户级目录基准） */
  home: string;
  /** 实例 cwd（项目级目录基准） */
  cwd: string;
}

/**
 * 解析 SKILL.md 头部 YAML frontmatter 的 name / description
 *
 * 只认最简单的 `key: value` 行（两侧引号剥掉），不引 YAML 解析器 ——
 * SKILL.md frontmatter 规范只要求这两个标量字段，够用且零依赖。
 *
 * @param text 文件内容（建议只传前 4KB）
 * @returns name / description；缺 frontmatter 或缺字段时对应项为 undefined
 */
export function parseSkillFrontmatter(text: string): {
  name?: string;
  description?: string;
} {
  if (!text.startsWith('---')) return {};
  // 结束分隔符：独立一行的 ---（允许 \r\n）
  const endMatch = /\r?\n---\s*(\r?\n|$)/.exec(text.slice(3));
  if (!endMatch) return {};
  const block = text.slice(3, 3 + endMatch.index);
  const out: { name?: string; description?: string } = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(rawLine);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim().replace(/^["'](.*)["']$/, '$1').trim();
    if (key === 'name' && value) out.name = value;
    if (key === 'description' && value) out.description = value;
  }
  return out;
}

/** 判定路径存在（目录或文件皆可）；任何错误按不存在处理 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫描一个 skills 目录：<dir>/<name>/SKILL.md 每个目录一个 skill
 *
 * 目录不存在返回空数组；单个 skill 解析失败跳过（不中断整体扫描）。
 */
async function scanSkillsDir(
  dir: string,
  tui: 'claude' | 'codex',
  source: 'user' | 'project',
): Promise<DiscoveredSkill[]> {
  if (!(await pathExists(dir))) return [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.warn({ err, dir }, 'skills-scanner readdir 失败');
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifest = join(dir, entry.name, SKILL_MANIFEST);
    let frontmatter: { name?: string; description?: string } = {};
    try {
      const buf = await readFile(manifest, 'utf8');
      frontmatter = parseSkillFrontmatter(buf.slice(0, FRONTMATTER_MAX_BYTES));
    } catch {
      continue; // 无 SKILL.md 或读失败 → 不是 skill 目录
    }
    const name = frontmatter.name ?? entry.name;
    out.push({
      tui,
      name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      source,
      kind: 'skill',
      invoke: tui === 'claude' ? `/${name} ` : `$${name} `,
    });
  }
  return out;
}

/**
 * 扫描 claude 旧式命令目录：<dir>/<name>.md 每个文件一个命令（=技能）
 */
async function scanCommandsDir(
  dir: string,
  source: 'user' | 'project',
): Promise<DiscoveredSkill[]> {
  if (!(await pathExists(dir))) return [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.warn({ err, dir }, 'skills-scanner readdir 失败');
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const name = entry.name.slice(0, -3);
    if (!name) continue;
    let description: string | undefined;
    try {
      const buf = await readFile(join(dir, entry.name), 'utf8');
      description = parseSkillFrontmatter(buf.slice(0, FRONTMATTER_MAX_BYTES)).description;
    } catch {
      // 读失败也保留条目（name 已知），只是缺描述
    }
    out.push({
      tui: 'claude',
      name,
      ...(description ? { description } : {}),
      source,
      kind: 'command',
      invoke: `/${name} `,
    });
  }
  return out;
}

/**
 * 从 cwd 向上找 git 仓库根（含 .git 的最近祖先）
 *
 * codex 官方按"repo root → CWD 每级扫 .agents/skills"；找不到 .git 时
 * 退化为只扫 cwd 一级（避免一路扫到 / 触发大量无效 stat）。
 */
async function findGitRoot(cwd: string): Promise<string> {
  let dir = cwd;
  // 防御：上限 32 层，避免异常路径死循环
  for (let i = 0; i < 32; i += 1) {
    if (await pathExists(join(dir, '.git'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break; // 到达文件系统根
    dir = parent;
  }
  return cwd;
}

/**
 * 扫描 claude code 的 skills 与旧式命令
 *
 * @param opts.home 用户 HOME
 * @param opts.cwd 实例工作目录
 * @returns 用户级 + 项目级条目（各自内部按目录序）
 */
export async function scanClaudeSkills(opts: SkillsScanOptions): Promise<DiscoveredSkill[]> {
  const { home, cwd } = opts;
  const userSkills = await scanSkillsDir(join(home, '.claude', 'skills'), 'claude', 'user');
  const userCommands = await scanCommandsDir(join(home, '.claude', 'commands'), 'user');
  const projectSkills = await scanSkillsDir(join(cwd, '.claude', 'skills'), 'claude', 'project');
  const projectCommands = await scanCommandsDir(join(cwd, '.claude', 'commands'), 'project');
  return [...userSkills, ...userCommands, ...projectSkills, ...projectCommands];
}

/**
 * 扫描 codex 的 skills（.agents/skills 开放标准目录）
 *
 * 官方行为：USER 级 $HOME/.agents/skills + 从 repo root 向下到 CWD 每级
 * .agents/skills（越近 CWD 越优先）。同级重复名不去重 —— invoke 都是
 * $name，用户在 modal 里看到两条同名时通常意味着遮蔽关系，保留原样。
 */
export async function scanCodexSkills(opts: SkillsScanOptions): Promise<DiscoveredSkill[]> {
  const { home, cwd } = opts;
  const userSkills = await scanSkillsDir(join(home, '.agents', 'skills'), 'codex', 'user');

  // 项目级：git root → cwd 每一级（含两端）。从 cwd 向上收集到 root 再反转，
  // 得到从外（root）到内（cwd）的顺序，近 CWD 的排后面（与官方
  // "越近 CWD 越优先"一致——列表靠后 = 用户最近配置的）。
  const root = await findGitRoot(cwd);
  const levels: string[] = [];
  let dir = cwd;
  while (true) {
    levels.push(dir);
    if (dir === root) break;
    const parent = join(dir, '..');
    if (parent === dir) break; // 到达文件系统根仍未命中 root（理论不可达）
    dir = parent;
    if (levels.length > 32) break; // 防御：超 32 层直接放弃
  }
  levels.reverse();
  const projectSkills: DiscoveredSkill[] = [];
  for (const level of levels) {
    projectSkills.push(...(await scanSkillsDir(join(level, '.agents', 'skills'), 'codex', 'project')));
  }
  return [...userSkills, ...projectSkills];
}
