/**
 * 协议常量（前后端共享）
 *
 * 这里只放与协议契约 / 默认行为相关的常量。运行时调优常量
 * （如 WS 输出批合并阈值）放在 backend/src/constants.ts。
 *
 * 修改这里的常量等于修改协议——前后端必须同步重新构建。
 */

// ============================================================
// 服务默认值
// ============================================================

/** 默认服务端口（被占用时自动递增） */
export const DEFAULT_PORT = 3000;

/** 默认 Session TTL：24 小时（毫秒） */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 默认认证速率限制：每 IP 每分钟 20 次 */
export const DEFAULT_AUTH_RATE_LIMIT = 20;

/** 默认输出缓冲区最大行数（重连时回放此行数） */
export const DEFAULT_MAX_BUFFER_LINES = 10000;

/**
 * 默认 PTY 兜底超时（秒）。
 *
 * banner 打印后的等待窗口：浏览器连入 / 用户按 Enter / 此超时三选一触发 spawn。
 * 0 = 无超时（永远等浏览器/Enter）。
 */
export const DEFAULT_SPAWN_TIMEOUT_SEC = 30;

// ============================================================
// 安全相关
// ============================================================

/** Token 字节数：32 字节 = 256 bit，hex 编码后 64 字符 */
export const TOKEN_BYTES = 32;

/** Session ID 字节数：与 Token 同规格 */
export const SESSION_ID_BYTES = 32;

// ============================================================
// WebSocket
// ============================================================

/** 心跳间隔：服务端每 30s 发一次 ping */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** 心跳超时：35s 内没收到 pong 就 terminate */
export const WS_HEARTBEAT_TIMEOUT_MS = 35_000;

/** 单条 WS 消息上限：1MB（防止恶意客户端发送巨大 payload） */
export const MAX_WS_MESSAGE_SIZE = 1024 * 1024;

// ============================================================
// 文件系统路径
// ============================================================

/**
 * 用户数据目录（位于 ~ 之下，相对路径）
 *
 * 当前：~/.atr/
 *  - 工具内部数据（instances/vapid/push-subscriptions/settings 等），
 *    用户一般不直接编辑
 *  - 主配置在 `~/.atrrc`（CONFIG_FILENAME），是用户主要编辑入口
 *
 * 历史：0.5.x 及之前用 `~/.auvezy/terminal-remote/` 双层嵌套，0.6.0 起改为
 * `~/.atr/` + `~/.atrrc`（顶级 dotfile）。不做向后兼容（breaking，CHANGELOG 已说明）。
 *
 * `path.resolve(homedir(), ATR_DATA_DIR)` 会跨平台正确处理路径分隔符。
 * 所有 mkdir 调用必须传 `recursive: true`，否则父目录不会自动创建。
 */
export const ATR_DATA_DIR = '.atr';

/**
 * 主配置文件名（.atrrc，顶级 dotfile，与 ATR_DATA_DIR 同级，直接放 ~ 下）
 *
 * 路径：~/.atrrc
 *
 * 形式上是 dotfile（npm/eslint/git 等惯例），用户最常编辑这个文件。
 * 内容仍为 JSON（不是 ini 也不是 yaml）—— 与 0.5.x 兼容（结构未变，只改了路径）
 */
export const CONFIG_FILENAME = '.atrrc';

/** 实例注册表文件名 */
export const REGISTRY_FILENAME = 'instances.json';

/** Claude settings 子目录名（每实例一个 <port>.json） */
export const SETTINGS_DIRNAME = 'settings';

/** VAPID 密钥文件名 */
export const VAPID_KEYS_FILENAME = 'vapid-keys.json';

/** Push 订阅文件名 */
export const PUSH_SUBSCRIPTIONS_FILENAME = 'push-subscriptions.json';
