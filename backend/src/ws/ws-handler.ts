/**
 * ws-handler
 *
 * 客户端消息分发器：把 WS 收到的原始字符串解析为 ClientMessage union 后分派到回调。
 *
 * 设计动机：
 * - 把"消息形状校验"（这里）与"业务执行"（SessionController）分离
 * - 不识别的消息丢弃 + warn 日志，不抛异常（恶意客户端不应让代理崩溃）
 * - heartbeat 在本层直接回包（业务层不关心心跳）
 *
 * 调用方：WsServer.onMessage(handleWsMessage(..., callbacks))
 */

import { WebSocket } from 'ws';
import type { ClientMessage } from 'auvezy-terminal-remote-shared';
import { logger } from '../logger/logger.js';

/** 业务回调集合 */
export interface WsHandlerCallbacks {
  /** 用户输入透传到 PTY */
  onUserInput: (data: string) => void;
  /**
   * 终端尺寸调整请求
   * @param cols / rows 目标尺寸
   * @param source     连接来源（用作主控身份标识）
   * @param master     true=声明此连接为新主控；false/undefined=普通 resize（仅在
   *                   当前没主控或自己就是主控时生效）
   */
  onResize: (cols: number, rows: number, source: WebSocket, master?: boolean) => void;
}

/**
 * 处理一条客户端消息
 *
 * @param ws  消息来源连接，用于 heartbeat 回包
 * @param raw 原始字符串（已 toString 转码）
 * @param cb  业务回调集合
 */
export function handleWsMessage(
  ws: WebSocket,
  raw: string,
  cb: WsHandlerCallbacks,
): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    logger.warn({ rawSnippet: raw.slice(0, 200) }, '收到非法 JSON WS 消息');
    return;
  }

  switch (msg.type) {
    case 'user_input':
      if (typeof msg.data === 'string') {
        cb.onUserInput(msg.data);
      } else {
        logger.warn({ msg }, 'user_input 缺 data 字段或类型错误');
      }
      break;

    case 'resize':
      if (typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        cb.onResize(msg.cols, msg.rows, ws, msg.master === true);
      } else {
        logger.warn({ msg }, 'resize 缺 cols/rows 字段或类型错误');
      }
      break;

    case 'heartbeat':
      // 直接回包，不经业务层
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
      }
      break;

    case 'client_log':
      // 前端 console 转发到 backend stdout（仅 dev 调试，生产环境前端不发）。
      // 不走 logger（logger 输出 JSON 一行，可读性差）；直接 stderr.write
      // 让开发者用 `tail -f` 看到原样字符串
      if (typeof msg.message === 'string' && typeof msg.level === 'string') {
        const ts = typeof msg.ts === 'number' ? new Date(msg.ts).toISOString().slice(11, 23) : '?';
        process.stderr.write(`[client ${ts} ${msg.level}] ${msg.message}\n`);
      }
      break;

    default: {
      // TypeScript 此处应推断为 never，运行时仍打 warn 日志
      const t = (msg as { type?: unknown }).type;
      logger.warn({ type: t }, '未知 WS 消息类型，已忽略');
    }
  }
}
