/**
 * PushService：Web Push 订阅管理 + 推送
 *
 * 设计：
 *  - VAPID 密钥三优先级：env（VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY） > 文件 > 生成
 *  - 订阅持久化到 ~/.atr/push-subscriptions.json（atomic 写）
 *  - sendNotification 失败 410（Gone） → 自动从订阅列表移除
 *  - p256dh 长度防御性校验（合法 65 字节，base64url ≈ 87 字符）
 *
 * 不做的事：
 *  - 推送优先级（normal/high/urgent）：当前所有审批通知一律 normal
 *  - 跨用户推送：单用户场景
 */

import {
  existsSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import webPush from 'web-push';
import {
  ATR_DATA_DIR,
  VAPID_KEYS_FILENAME,
  PUSH_SUBSCRIPTIONS_FILENAME,
  ErrorCode,
} from 'auvezy-terminal-remote-shared';
import { PushError } from '../errors.js';
import { logger } from '../logger/logger.js';
import { atomicWriteJson } from '../utils/atomic-write.js';

/** VAPID 密钥对 */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Push 订阅信息（与 web-push 库的 PushSubscription 兼容） */
export interface PushSubscriptionInfo {
  endpoint: string;
  keys: {
    /** 椭圆曲线公钥（base64url） */
    p256dh: string;
    /** 鉴权 secret（base64url） */
    auth: string;
  };
}

/** 推送 payload（前端 service-worker 解析） */
export interface PushPayload {
  title: string;
  body: string;
  /** 可选：点击通知打开的 URL */
  url?: string;
}

export interface PushServiceOptions {
  /** 工作目录；默认 ~/.atr/ */
  baseDir?: string;
  /** 注入便于单测 */
  env?: NodeJS.ProcessEnv;
  /** 注入 webPush 模块（测试可 mock） */
  pushImpl?: typeof webPush;
  /** 联系邮箱（VAPID subject 用，默认 mailto:atr@local） */
  contactEmail?: string;
}

/**
 * VAPID 来源
 */
export type VapidSource = 'env' | 'file' | 'generated';

/**
 * Push 服务
 */
export class PushService {
  private readonly baseDir: string;
  private readonly vapidPath: string;
  private readonly subPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly pushImpl: typeof webPush;
  private readonly contactEmail: string;

  private vapid: VapidKeys | null = null;
  private vapidSource: VapidSource | null = null;
  private subscriptions: PushSubscriptionInfo[] = [];

  constructor(opts: PushServiceOptions = {}) {
    this.baseDir = opts.baseDir ?? resolve(homedir(), ATR_DATA_DIR);
    this.vapidPath = resolve(this.baseDir, VAPID_KEYS_FILENAME);
    this.subPath = resolve(this.baseDir, PUSH_SUBSCRIPTIONS_FILENAME);
    this.env = opts.env ?? process.env;
    this.pushImpl = opts.pushImpl ?? webPush;
    this.contactEmail = opts.contactEmail ?? 'mailto:atr@local';
  }

  /**
   * 初始化：读取 / 生成 VAPID + 加载订阅
   *
   * 调用方：startServer 启动期一次。
   */
  async init(): Promise<void> {
    this.ensureDir();
    this.vapid = this.acquireVapid();
    this.pushImpl.setVapidDetails(
      this.contactEmail,
      this.vapid.publicKey,
      this.vapid.privateKey,
    );
    this.subscriptions = this.readSubscriptions();
    logger.info(
      {
        vapidSource: this.vapidSource,
        subscriptionCount: this.subscriptions.length,
      },
      'PushService 初始化完成',
    );
  }

  /** 当前 VAPID 公钥（前端订阅用） */
  getPublicKey(): string {
    if (!this.vapid) {
      throw new PushError(ErrorCode.PUSH_VAPID_NOT_READY, 'PushService 未初始化', 503);
    }
    return this.vapid.publicKey;
  }

  /** 当前订阅数（管理用） */
  getSubscriptionCount(): number {
    return this.subscriptions.length;
  }

  /**
   * 注册订阅（去重：endpoint 相同则覆盖）
   *
   * @throws PushError(PUSH_SUBSCRIPTION_INVALID) p256dh 长度异常时
   */
  subscribe(info: PushSubscriptionInfo): void {
    this.validateSubscription(info);
    const filtered = this.subscriptions.filter((s) => s.endpoint !== info.endpoint);
    filtered.push(info);
    this.subscriptions = filtered;
    this.writeSubscriptions();
    logger.info({ count: this.subscriptions.length }, '订阅已注册');
  }

  /** 注销订阅；找不到返回 false */
  unsubscribe(endpoint: string): boolean {
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter((s) => s.endpoint !== endpoint);
    if (this.subscriptions.length === before) return false;
    this.writeSubscriptions();
    logger.info({ count: this.subscriptions.length }, '订阅已注销');
    return true;
  }

  /**
   * 推送给所有订阅者
   *
   * 失败 410 Gone → 自动剔除该订阅；其它错误仅 log 不抛
   */
  async notifyAll(payload: PushPayload): Promise<{
    sent: number;
    pruned: number;
    failed: number;
  }> {
    if (!this.vapid) return { sent: 0, pruned: 0, failed: 0 };
    let sent = 0;
    let pruned = 0;
    let failed = 0;
    const stale: string[] = [];

    for (const sub of this.subscriptions) {
      try {
        await this.pushImpl.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          stale.push(sub.endpoint);
          pruned++;
        } else {
          failed++;
          logger.warn({ status, endpoint: sub.endpoint }, '推送失败');
        }
      }
    }

    if (stale.length > 0) {
      this.subscriptions = this.subscriptions.filter((s) => !stale.includes(s.endpoint));
      this.writeSubscriptions();
    }

    logger.info({ sent, pruned, failed }, '推送批次完成');
    return { sent, pruned, failed };
  }

  // ───────────── 内部 ─────────────

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
  }

  private acquireVapid(): VapidKeys {
    // 1) env
    const envPub = this.env['VAPID_PUBLIC_KEY'];
    const envPriv = this.env['VAPID_PRIVATE_KEY'];
    if (envPub && envPriv) {
      this.vapidSource = 'env';
      return { publicKey: envPub, privateKey: envPriv };
    }
    // 2) file
    if (existsSync(this.vapidPath)) {
      try {
        const raw = readFileSync(this.vapidPath, 'utf-8');
        const parsed = JSON.parse(raw) as VapidKeys;
        if (
          typeof parsed.publicKey === 'string' &&
          typeof parsed.privateKey === 'string' &&
          parsed.publicKey.length > 0 &&
          parsed.privateKey.length > 0
        ) {
          this.vapidSource = 'file';
          return parsed;
        }
      } catch (err) {
        logger.warn({ err }, 'vapid-keys.json 解析失败，将重新生成');
      }
    }
    // 3) generate
    const generated = this.pushImpl.generateVAPIDKeys();
    atomicWriteJson(this.vapidPath, generated);
    this.vapidSource = 'generated';
    return generated;
  }

  private readSubscriptions(): PushSubscriptionInfo[] {
    if (!existsSync(this.subPath)) return [];
    try {
      const raw = readFileSync(this.subPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s) => isLikelySubscription(s)) as PushSubscriptionInfo[];
    } catch (err) {
      logger.warn({ err }, '订阅文件解析失败，重置为空');
      return [];
    }
  }

  private writeSubscriptions(): void {
    this.ensureDir();
    atomicWriteJson(this.subPath, this.subscriptions);
  }

  /**
   * 防御性校验：p256dh / auth 长度
   *
   * Web Push 的 p256dh 是 P-256 ECDH 公钥（65 字节未压缩），base64url
   * 编码后约 87 字符。auth 是 16 字节随机串，base64url 约 22 字符。
   * 异常长度大概率是攻击或客户端 bug，直接拒绝。
   */
  private validateSubscription(info: PushSubscriptionInfo): void {
    if (!info.endpoint || typeof info.endpoint !== 'string') {
      throw new PushError(
        ErrorCode.PUSH_SUBSCRIPTION_INVALID,
        '订阅缺 endpoint',
        400,
      );
    }
    if (!info.keys || typeof info.keys !== 'object') {
      throw new PushError(
        ErrorCode.PUSH_SUBSCRIPTION_INVALID,
        '订阅缺 keys',
        400,
      );
    }
    const { p256dh, auth } = info.keys;
    if (
      typeof p256dh !== 'string' ||
      p256dh.length < 80 ||
      p256dh.length > 100
    ) {
      throw new PushError(
        ErrorCode.PUSH_SUBSCRIPTION_INVALID,
        `p256dh 长度异常：${p256dh?.length}`,
        400,
      );
    }
    if (typeof auth !== 'string' || auth.length < 16 || auth.length > 32) {
      throw new PushError(
        ErrorCode.PUSH_SUBSCRIPTION_INVALID,
        `auth 长度异常：${auth?.length}`,
        400,
      );
    }
  }

  get vapidSourceTag(): VapidSource | null {
    return this.vapidSource;
  }
}

function isLikelySubscription(s: unknown): s is PushSubscriptionInfo {
  if (!s || typeof s !== 'object') return false;
  const obj = s as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof obj.endpoint === 'string' &&
    !!obj.keys &&
    typeof obj.keys === 'object' &&
    typeof obj.keys.p256dh === 'string' &&
    typeof obj.keys.auth === 'string'
  );
}
