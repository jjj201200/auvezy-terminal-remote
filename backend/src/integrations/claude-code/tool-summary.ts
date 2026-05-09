/**
 * Tool 调用摘要生成
 *
 * 把 Claude Code hook payload 里的 `tool_name` + `tool_input` 提炼成一行
 * 人类友好描述,用于 PWA StatusBar 上的 activeTool 显示与推送通知正文。
 *
 * 设计:
 *  - 默认值:`tool_name` 单独显示(如 'Bash');有结构化字段时拼接
 *  - 输入字段长度过长截断到 60 字符,加省略号
 *  - 不抛错,字段缺失或类型不对都回退到只显示 tool_name
 */

const MAX_LEN = 60;

function clip(s: string, max = MAX_LEN): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 主入口。tool_input 形态由工具决定,我们只识别官方文档列出的内置工具。
 * 未识别工具回退为单独显示 tool_name,避免出错。
 */
export function summarizeToolCall(toolName: string, toolInput: unknown): string {
  const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<
    string,
    unknown
  >;

  switch (toolName) {
    case 'Bash': {
      const cmd = asStr(input['command']);
      return cmd ? `Bash: ${clip(cmd)}` : 'Bash';
    }
    case 'Write': {
      const path = asStr(input['file_path']);
      return path ? `Write ${clip(path)}` : 'Write';
    }
    case 'Edit': {
      const path = asStr(input['file_path']);
      return path ? `Edit ${clip(path)}` : 'Edit';
    }
    case 'Read': {
      const path = asStr(input['file_path']);
      return path ? `Read ${clip(path)}` : 'Read';
    }
    case 'Glob': {
      const pattern = asStr(input['pattern']);
      return pattern ? `Glob ${clip(pattern)}` : 'Glob';
    }
    case 'Grep': {
      const pattern = asStr(input['pattern']);
      return pattern ? `Grep ${clip(pattern)}` : 'Grep';
    }
    case 'WebFetch': {
      const url = asStr(input['url']);
      return url ? `WebFetch ${clip(url)}` : 'WebFetch';
    }
    case 'WebSearch': {
      const query = asStr(input['query']);
      return query ? `WebSearch ${clip(query)}` : 'WebSearch';
    }
    case 'Agent': {
      const desc = asStr(input['description']) ?? asStr(input['subagent_type']);
      return desc ? `Agent ${clip(desc)}` : 'Agent';
    }
    default: {
      // MCP 工具或未知工具:用 tool_name 兜底
      return toolName || 'unknown_tool';
    }
  }
}
