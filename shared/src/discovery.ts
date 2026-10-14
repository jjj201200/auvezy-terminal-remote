/**
 * Skill / MCP 自动发现协议类型（前后端共享）
 *
 * backend 扫描 claude code 与 codex 的 skills / MCP 配置目录（见
 * docs/research/codex-cli-shortcuts-commands.md §4-5 与
 * docs/research/claude-code-shortcuts-commands.md §二.8），
 * 前端在 modal 中列出供用户选择后注入输入框。
 *
 * 发现规则（只读固定目录，无用户可控路径）：
 *  - claude skills：$HOME/.claude/skills/<name>/SKILL.md、<cwd>/.claude/skills/<name>/SKILL.md
 *  - claude 旧式命令（=技能）：$HOME/.claude/commands/<name>.md、<cwd>/.claude/commands/<name>.md
 *  - codex skills：$HOME/.agents/skills/<name>/SKILL.md、<cwd> 向上到 git root 每级 .agents/skills
 *  - claude mcp：$HOME/.claude.json 的 mcpServers、<cwd>/.mcp.json
 *  - codex mcp：$HOME/.codex/config.toml 与 <cwd>/.codex/config.toml 的 [mcp_servers.<name>]
 */

/** 发现的 skill / 自定义命令条目 */
export interface DiscoveredSkill {
  /** 归属 TUI：决定 invoke 前缀（claude 用 /name，codex 用 $name） */
  tui: 'claude' | 'codex';
  /** skill 名（SKILL.md frontmatter name 或目录名 / 命令文件名） */
  name: string;
  /** 一行描述（frontmatter description，可缺省） */
  description?: string;
  /** 来源：user = 用户级目录，project = 实例 cwd 相关目录 */
  source: 'user' | 'project';
  /** 形态：skill = SKILL.md 目录技能，command = claude 旧式单文件命令 */
  kind: 'skill' | 'command';
  /** 注入输入框的完整调用文本（含尾随空格，如 "/deploy " / "$skill-name "） */
  invoke: string;
}

/** 发现的 MCP server 条目 */
export interface DiscoveredMcpServer {
  /** 归属 TUI */
  tui: 'claude' | 'codex';
  /** server 名（配置键名） */
  name: string;
  /** 传输方式：stdio（command+args）/ http（url） */
  transport: 'stdio' | 'http';
  /** 来源：user = 用户级配置，project = 项目级配置 */
  source: 'user' | 'project';
  /** 人读细节：stdio 为 "npx -y xxx"，http 为 url */
  detail?: string;
}

/** GET /api/discovery?instanceId= 响应体 */
export interface DiscoveryResponse {
  ok: true;
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcpServer[];
}
