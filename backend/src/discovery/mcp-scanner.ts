/**
 * MCP server 配置发现（claude code + codex）
 *
 * 发现规则依据调研（docs/research/，2026-10）：
 *  - claude：用户级 $HOME/.claude.json 的 `mcpServers` 键 + 项目级 <cwd>/.mcp.json
 *    （两者结构相同：{ mcpServers: { <name>: { command?, args?, url?, ... } } }）
 *  - codex：$HOME/.codex/config.toml 与 <cwd>/.codex/config.toml 的
 *    `[mcp_servers.<name>]` 表（stdio 看 command/args，http 看 url）
 *
 * 刻意不跑 `codex mcp list` 子进程：解析静态配置零副作用、零延迟，
 * 也避免 codex 不在 PATH 时的环境差异。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscoveredMcpServer } from 'auvezy-terminal-remote-shared';
import { logger } from '../logger/logger.js';

export interface McpScanOptions {
  /** 用户 HOME */
  home: string;
  /** 实例 cwd */
  cwd: string;
}

/** .claude.json / .mcp.json 里单个 server 定义的最小结构 */
interface ClaudeMcpEntry {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
}

/** 读文件为 UTF-8 文本；不存在或读失败返回 null（调用方按"无配置"处理） */
async function readTextOrNull(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/** 把单个 server 定义归一为 DiscoveredMcpServer；字段全缺的脏条目返回 null */
function claudeEntryToServer(
  name: string,
  entry: ClaudeMcpEntry,
  source: 'user' | 'project',
): DiscoveredMcpServer | null {
  const isHttp = typeof entry.url === 'string' || entry.type === 'http' || entry.type === 'sse';
  if (isHttp && entry.url) {
    return { tui: 'claude', name, transport: 'http', source, detail: entry.url };
  }
  if (typeof entry.command === 'string') {
    const argv = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])];
    return { tui: 'claude', name, transport: 'stdio', source, detail: argv.join(' ') };
  }
  if (isHttp) {
    return { tui: 'claude', name, transport: 'http', source };
  }
  return null;
}

/**
 * 扫描 claude 的 MCP 配置（.claude.json + .mcp.json）
 *
 * @param opts.home 用户 HOME
 * @param opts.cwd 实例工作目录
 * @returns 用户级 + 项目级条目
 */
export async function scanClaudeMcp(opts: McpScanOptions): Promise<DiscoveredMcpServer[]> {
  const out: DiscoveredMcpServer[] = [];

  // 用户级 ~/.claude.json：内含大量项目历史但顶层 mcpServers 独立，
  // 整体 JSON.parse 后只取该键（文件通常 < 几 MB，可接受）
  const claudeJsonText = await readTextOrNull(join(opts.home, '.claude.json'));
  if (claudeJsonText !== null) {
    try {
      const parsed: unknown = JSON.parse(claudeJsonText);
      const servers = (parsed as { mcpServers?: unknown }).mcpServers;
      if (servers !== null && typeof servers === 'object') {
        for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
          if (entry === null || typeof entry !== 'object') continue;
          const server = claudeEntryToServer(name, entry as ClaudeMcpEntry, 'user');
          if (server) out.push(server);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'mcp-scanner: ~/.claude.json 解析失败（忽略）');
    }
  }

  // 项目级 .mcp.json
  const mcpJsonText = await readTextOrNull(join(opts.cwd, '.mcp.json'));
  if (mcpJsonText !== null) {
    try {
      const parsed: unknown = JSON.parse(mcpJsonText);
      const servers = (parsed as { mcpServers?: unknown }).mcpServers;
      if (servers !== null && typeof servers === 'object') {
        for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
          if (entry === null || typeof entry !== 'object') continue;
          const server = claudeEntryToServer(name, entry as ClaudeMcpEntry, 'project');
          if (server) out.push(server);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'mcp-scanner: .mcp.json 解析失败（忽略）');
    }
  }

  return out;
}

/**
 * 解析 codex config.toml 文本中的 [mcp_servers.*] 表
 *
 * 轻量逐行扫描：表头行开一个 server 段，段内认 `command` / `args` / `url`
 * 三个键判断 transport 与 detail。只覆盖 [mcp_servers.x] 一层表头 ——
 * 子表（如 [mcp_servers.x.env]）跳过但不断段，直到下一个 [mcp_servers.y]
 * 或其它顶层表。不引 TOML 库，注释行（# 开头）忽略。
 *
 * @param text config.toml 内容
 * @param source 条目来源标注
 * @returns 发现的 server 列表（按出现顺序）
 */
export function parseCodexTomlMcpServers(
  text: string,
  source: 'user' | 'project',
): DiscoveredMcpServer[] {
  const out: DiscoveredMcpServer[] = [];
  let current: { name: string; command?: string; args?: string[]; url?: string } | null = null;

  const flush = () => {
    if (current === null) return;
    if (current.url) {
      out.push({ tui: 'codex', name: current.name, transport: 'http', source, detail: current.url });
    } else if (current.command) {
      const argv = [current.command, ...(current.args ?? [])];
      out.push({ tui: 'codex', name: current.name, transport: 'stdio', source, detail: argv.join(' ') });
    }
    // command/url 全缺 → 脏配置，丢弃
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    // 表头：[mcp_servers.<name>]（name 可带引号/点号）
    const header = /^\[mcp_servers\.(.+)\]$/.exec(line);
    if (header) {
      flush();
      const rawName = header[1]!.trim();
      const name = rawName.replace(/^"(.*)"$/, '$1');
      current = { name };
      continue;
    }
    // 其它顶层表（非 mcp_servers 前缀的 [xxx]）结束当前段
    if (line.startsWith('[')) {
      flush();
      continue;
    }
    if (current === null) continue;

    // 段内键值：只认三种
    const kv = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    let value = kv[2]!.trim();
    if (value.startsWith('#')) continue;
    // 去行尾注释（值不在引号内的场景；带引号的串内 # 极罕见，够用）
    value = value.split(/\s+#/)[0]!.trim();

    if (key === 'command') {
      current.command = stripTomlString(value);
    } else if (key === 'url') {
      current.url = stripTomlString(value);
    } else if (key === 'args' && value.startsWith('[')) {
      current.args = parseTomlStringArray(value);
    }
  }
  flush();
  return out;
}

/** 剥 TOML 字符串值的引号；裸值原样返回 */
function stripTomlString(v: string): string {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v) ?? /^'(.*)'$/.exec(v);
  if (!m) return v;
  return m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** 解析 TOML 字符串数组字面量 ["a", "b"]；解析不了返回 undefined */
function parseTomlStringArray(v: string): string[] | undefined {
  const inner = v.trim();
  if (!inner.startsWith('[') || !inner.endsWith(']')) return undefined;
  const body = inner.slice(1, -1).trim();
  if (body.length === 0) return [];
  const parts = body.split(',').map((s) => stripTomlString(s.trim())).filter((s) => s.length > 0);
  return parts;
}

/**
 * 扫描 codex 的 MCP 配置（~/.codex/config.toml + <cwd>/.codex/config.toml）
 *
 * @param opts.home 用户 HOME
 * @param opts.cwd 实例工作目录
 * @returns 用户级 + 项目级条目
 */
export async function scanCodexMcp(opts: McpScanOptions): Promise<DiscoveredMcpServer[]> {
  const out: DiscoveredMcpServer[] = [];
  const userText = await readTextOrNull(join(opts.home, '.codex', 'config.toml'));
  if (userText !== null) out.push(...parseCodexTomlMcpServers(userText, 'user'));
  const projectText = await readTextOrNull(join(opts.cwd, '.codex', 'config.toml'));
  if (projectText !== null) out.push(...parseCodexTomlMcpServers(projectText, 'project'));
  return out;
}
