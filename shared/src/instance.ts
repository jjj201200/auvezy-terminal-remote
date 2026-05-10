/**
 * 实例注册表类型（前后端共享）
 *
 * 多实例场景下，每个 atr 进程在 ~/.atr/instances.json
 * 注册自己的元信息，前端可拉取此列表实现 Tab 切换。
 *
 * 文件结构带版本号是为了向前兼容——以后如要升级 schema，
 * 旧版进程读到不识别的 version 就放弃使用，避免数据破坏。
 */

/** 一个 atr 实例的元信息 */
export interface InstanceInfo {
  /** UUID，进程内生成，代表本次启动的唯一身份 */
  instanceId: string;

  /** 实例展示名（默认取 cwd basename，可通过 --name 覆盖） */
  name: string;

  /**
   * worker 监听地址。
   *
   * 0.7.0 ADR-009 起 worker 强制 listen 127.0.0.1,该字段固定为 "127.0.0.1"。
   * broker 反代时用 `host:port` 直接连 worker 进程,**这是 broker 内部反代细节,
   * 前端不应用作"实例属于哪台机"的分组键**(应该用 brokerHost)。
   */
  host: string;

  /** worker 监听端口(loopback 高位,OS 自动分配) */
  port: number;

  /** 进程 PID，用于注册表清理时探测存活 */
  pid: number;

  /** 工作目录（绝对路径），即 Claude Code 启动的 cwd */
  cwd: string;

  /** 启动时间（ISO 字符串） */
  startedAt: string;

  /** 是否为无终端模式（通过 --no-terminal 或 Web 创建实例启动） */
  headless?: boolean;

  /**
   * 注册该实例的 broker 对外可达 host(LAN IP / hostname)。
   *
   * 用途:多 broker / 多机场景下,前端按 brokerHost 把实例分组到不同主机标签;
   * `host` 字段是 worker 反代细节(永远 127.0.0.1),不能拿来当分组键。
   *
   * 0.7.x 起新增,旧实例可能不带此字段(向前兼容,前端 fallback 用 host)。
   */
  brokerHost?: string;
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
