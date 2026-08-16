/**
 * Integration 抽象层
 *
 * 把 ATR 对"特定 CLI 工具的状态识别"做成可热插拔模块。每个 Integration
 * 实现负责:
 *  1. detect: 在 spawn 阶段判断当前命令是不是这个工具(命令名 / basename)
 *  2. prepareSpawn: 给 PTY spawn 注入它需要的参数(如 Claude Code 的 `--settings`)
 *  3. onHookPayload: 把工具上报的 hook payload 翻译成统一的 IntegrationEvent
 *  4. onPtyData: 可选,某些工具靠 PTY 输出特征推断状态(目前不使用)
 *  5. shutdown: 清理临时文件等
 *
 * SessionController 只消费 IntegrationEvent,不感知具体工具——后续接入
 * gemini-cli / aider / codex 等只需新增模块,不改主流程。
 */

/**
 * 模块标识。固定枚举,避免拼写漂移。
 *
 * 新模块加入时在此扩展;`null` 表示未激活任何模块(纯透传 PTY)。
 */
export type IntegrationId = 'claude-code';

/**
 * Spawn 时上下文,供 detect / prepareSpawn 判断
 */
export interface SpawnContext {
  /** 命令绝对路径或裸名(如 'claude' / '/usr/local/bin/claude') */
  command: string;
  /** 命令参数(已剥离 ATR 自己注入的,只剩用户给的) */
  args: readonly string[];
  /** 当前实例端口,用于生成回调地址 */
  port: number;
  /**
   * program 是否经 shell 函数 fallback 改写(此时 command 是 $SHELL,真实
   * 命令在 args[1] 的内层命令行里,detect 无法从 command 识别——如 zshrc
   * 里的 zclaude 函数最终启动 claude)
   */
  viaShellFallback?: boolean;
}

/**
 * prepareSpawn 返回值,补丁式合并到 spawn args / env
 */
export interface SpawnAugmentation {
  /** 追加到 args 末尾的额外参数 */
  extraArgs?: readonly string[];
  /** 追加到 env 的键值(覆盖同名) */
  extraEnv?: Record<string, string>;
}

/**
 * 统一事件模型
 *
 * 所有 Integration 都把工具特定的 hook / 输出特征翻译成这套事件。
 * SessionController 用这些事件维护 RichSessionState(阶段 3 引入)。
 *
 * 设计准则:
 *  - 事件携带"足够身份"(approval 用 id 配对开始/结束;tool_started/finished
 *    用 toolUseId)以便计数器正确加减
 *  - "outcome" 字段尽量保留原值('allow'/'deny'/'unknown')而非简化为 boolean,
 *    UI 可据此展示更细
 */
export type IntegrationEvent =
  /** 审批开始:Notification(permission_prompt) 或 PermissionRequest */
  | {
      kind: 'approval_pending';
      /** 配对 id(同一审批的 pending 与 resolved 必须相同 id) */
      id: string;
      /** 工具名(如 'Bash' / 'Edit' / 'mcp__memory__create_entities') */
      tool: string;
      /** 人类可读说明(可选) */
      detail?: string;
    }
  /** 审批结束:由 PostToolUse / PostToolUseFailure 推断 */
  | {
      kind: 'approval_resolved';
      id: string;
      outcome: 'allow' | 'deny' | 'unknown';
    }
  /** 工具开始执行:PreToolUse */
  | {
      kind: 'tool_started';
      /** 工具调用 id(用于配对结束事件) */
      toolUseId: string;
      tool: string;
      /** 简短摘要(如 "Edit src/foo.ts" / "Bash: npm test") */
      summary: string;
    }
  /** 工具结束:PostToolUse / PostToolUseFailure */
  | {
      kind: 'tool_finished';
      toolUseId: string;
      ok: boolean;
      durationMs?: number;
      /** 失败时的错误描述 */
      error?: string;
    }
  /** 一轮对话开始(此事件由模块根据需要发出,无强制来源) */
  | { kind: 'turn_started' }
  /** 一轮对话结束:Stop */
  | { kind: 'turn_ended'; lastMessage?: string }
  /** 一轮失败:StopFailure(API 错误) */
  | {
      kind: 'turn_failed';
      /** 错误类型(如 'rate_limit' / 'authentication_failed' / 'billing_error') */
      errorKind: string;
      detail?: string;
    }
  /** 用户向 Claude 提交 prompt:UserPromptSubmit */
  | { kind: 'user_prompt'; text: string }
  /** 会话生命周期:SessionStart / SessionEnd / PreCompact / PostCompact */
  | {
      kind: 'session_event';
      phase: 'start' | 'end' | 'compact_start' | 'compact_end';
      /** 详情(如 SessionStart.source / SessionEnd.reason) */
      detail?: string;
    }
  /** 工作目录变化:CwdChanged */
  | { kind: 'cwd_changed'; from: string; to: string };

/**
 * Integration 接口
 *
 * 实例由 IntegrationManager 创建并持有;非线程安全,假设由单一
 * SessionController 顺序调用。
 */
export interface Integration {
  /** 模块唯一 id */
  readonly id: IntegrationId;
  /** 模块人类可读名(用于日志 / UI) */
  readonly displayName: string;

  /** 检测当前 spawn 上下文是否属于本模块 */
  detect(ctx: SpawnContext): boolean;

  /** 生成 spawn 增强(注入 args / env)。返回 null = 不需要任何增强 */
  prepareSpawn(ctx: SpawnContext): SpawnAugmentation | null;

  /**
   * 翻译 hook payload 为统一事件。返回空数组表示无需触发事件。
   *
   * 接受 unknown:工具上报的 payload 形态由该工具决定,模块自己负责解析与校验。
   */
  onHookPayload(payload: unknown): IntegrationEvent[];

  /**
   * 可选:观察 PTY 输出推断状态。多数模块不需要(留接口给未来)。
   * 不要在此做副作用,只返回事件。
   */
  onPtyData?(chunk: string): IntegrationEvent[];

  /** 清理(临时文件等)。manager 在实例 shutdown 时调用 */
  shutdown(): void;
}

/**
 * 用户偏好,影响 manager 的检测策略与事件订阅细分
 */
export interface IntegrationPreferences {
  /** 总开关。false = 不激活任何模块 */
  enabled: boolean;
  /**
   * 强制选择特定模块,跳过 detect:
   *  - 'auto'(默认):各模块依次 detect,第一个命中的激活
   *  - IntegrationId:无视 detect,强制激活该模块
   *  - 'none':不激活
   */
  forceModule: 'auto' | IntegrationId | 'none';
  /** 各模块自己的子开关(如 ClaudeCode 的事件细分) */
  perModule: Record<string, unknown>;
}
