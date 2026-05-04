/**
 * IpMonitor：定期检测 displayIp 是否变化，稳定后触发回调
 *
 * 用例：
 *  - 笔记本切换 Wi-Fi（家 ↔ 公司）→ LAN IP 变了 → 之前的二维码失效
 *  - 用户在 ConsolePage 上需要被告知"扫码 URL 变了，请重新扫码"
 *
 * 设计：
 *  - 每 IP_MONITOR_INTERVAL_MS（30s）轮询一次 detectDisplayIp()
 *  - 抖动忽略：连续 N（IP_MONITOR_STABILITY_THRESHOLD）次检测到同一新 IP 才触发
 *    （避免 DHCP 短暂切换 / IPv6 vs IPv4 切换抖动）
 *  - 回调收到 { oldIp, newIp }；调用方负责广播 ip_changed
 *
 * 不做的事：
 *  - 监听网卡事件（跨平台兼容差，netlink/SCDynamicStore 不易封装）
 *  - 多 IP 同时追踪（单 IP 已够用：用户对手机看到的"那个二维码 URL"关心）
 */

import { detectDisplayIp } from './network.js';
import { logger } from '../logger/logger.js';
import {
  IP_MONITOR_INTERVAL_MS,
  IP_MONITOR_STABILITY_THRESHOLD,
} from '../constants.js';

export interface IpMonitorOptions {
  /** 初始 IP（通常是 startServer 1.6 步算出的 displayIp） */
  initialIp: string;
  /** 服务监听端口（与 hostHint 一起决定 detectDisplayIp 的行为） */
  hostHint?: string;
  /** 轮询间隔（ms）；默认 IP_MONITOR_INTERVAL_MS */
  intervalMs?: number;
  /** 稳定阈值；默认 IP_MONITOR_STABILITY_THRESHOLD */
  stabilityThreshold?: number;
  /** 注入 detectDisplayIp 便于单测 */
  detect?: (hostHint?: string) => string;
}

export interface IpChangeEvent {
  oldIp: string;
  newIp: string;
}

export class IpMonitor {
  private currentIp: string;
  private candidateIp: string | null = null;
  private candidateCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listener: ((evt: IpChangeEvent) => void) | null = null;
  private readonly intervalMs: number;
  private readonly stability: number;
  private readonly hostHint?: string;
  private readonly detect: (hostHint?: string) => string;

  constructor(opts: IpMonitorOptions) {
    this.currentIp = opts.initialIp;
    this.intervalMs = opts.intervalMs ?? IP_MONITOR_INTERVAL_MS;
    this.stability = opts.stabilityThreshold ?? IP_MONITOR_STABILITY_THRESHOLD;
    this.hostHint = opts.hostHint;
    this.detect = opts.detect ?? detectDisplayIp;
  }

  /** 注册变更回调（仅一次；重复调用覆盖旧 listener） */
  onChange(fn: (evt: IpChangeEvent) => void): void {
    this.listener = fn;
  }

  /** 开始轮询 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // 不要把 timer 绑住 event loop（让进程能正常退出）
    this.timer.unref();
    logger.info(
      { initialIp: this.currentIp, intervalMs: this.intervalMs, stability: this.stability },
      'IpMonitor 启动',
    );
  }

  /** 停止轮询 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 手动 tick：测试用 */
  tick(): void {
    let detected: string;
    try {
      detected = this.detect(this.hostHint);
    } catch (err) {
      logger.warn({ err }, 'detectDisplayIp 失败');
      return;
    }

    if (detected === this.currentIp) {
      // 与当前一致，重置候选
      this.candidateIp = null;
      this.candidateCount = 0;
      return;
    }

    if (detected !== this.candidateIp) {
      // 出现新候选，重新计数
      this.candidateIp = detected;
      this.candidateCount = 1;
      return;
    }

    this.candidateCount++;
    if (this.candidateCount >= this.stability) {
      // 稳定，触发
      const oldIp = this.currentIp;
      this.currentIp = detected;
      this.candidateIp = null;
      this.candidateCount = 0;
      logger.info({ oldIp, newIp: detected }, 'displayIp 已变化');
      this.listener?.({ oldIp, newIp: detected });
    }
  }

  get current(): string {
    return this.currentIp;
  }
}
