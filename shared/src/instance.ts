/**
 * 实例注册表类型（前后端共享）
 *
 * 多实例场景下，每个 claude-remote 进程在 ~/.claude-remote/instances.json
 * 注册自己的元信息，前端可拉取此列表实现 Tab 切换。
 *
 * 文件结构带版本号是为了向前兼容——以后如要升级 schema，
 * 旧版进程读到不识别的 version 就放弃使用，避免数据破坏。
 */

/** 一个 claude-remote 实例的元信息 */
export interface InstanceInfo {
  /** UUID，进程内生成，代表本次启动的唯一身份 */
  instanceId: string;

  /** 实例展示名（默认取 cwd basename，可通过 --name 覆盖） */
  name: string;

  /** 服务监听的对外可达地址（LAN IP） */
  host: string;

  /** 服务监听端口（findAvailablePort 选定的实际端口，不一定是 preferred） */
  port: number;

  /** 进程 PID，用于注册表清理时探测存活 */
  pid: number;

  /** 工作目录（绝对路径），即 Claude Code 启动的 cwd */
  cwd: string;

  /** 启动时间（ISO 字符串） */
  startedAt: string;

  /** 是否为无终端模式（通过 --no-terminal 或 Web 创建实例启动） */
  headless?: boolean;
}

/**
 * 注册表文件结构
 *
 * version 用于以后 schema 演进；当前固定为 1。
 */
export interface InstanceRegistry {
  version: 1;
  instances: InstanceInfo[];
}

/**
 * API 返回给前端的实例项（多带 isCurrent 标记）
 *
 * isCurrent 由后端在响应时计算（当前请求所连的实例为 true）。
 */
export interface InstanceListItem extends InstanceInfo {
  isCurrent: boolean;
}
