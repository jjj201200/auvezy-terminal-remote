/**
 * IntegrationManager
 *
 * 集中管理所有 Integration 模块的注册、检测、激活与事件路由。
 *
 * 生命周期:
 *  1. SessionController 启动时 new IntegrationManager(prefs),注册可用模块
 *  2. spawn 阶段调用 prepareSpawn(ctx) → 内部 detect 决定激活哪个模块,
 *     返回该模块的 SpawnAugmentation(args / env 注入)
 *  3. 运行期 hook payload 到达 → routeHookPayload(payload) 把事件分发给监听器
 *  4. 关闭时 shutdown() 清理所有模块
 *
 * 设计要点:
 *  - 同时只激活一个模块(active),没必要多模块并存;新模块场景再扩展
 *  - 事件订阅采用 EventEmitter 风格(on/off),让 SessionController 单一消费点
 *  - manager 不持有 SessionStatus 状态,只做"识别 + 翻译";状态机在 controller
 */

import { EventEmitter } from 'node:events';
import { logger } from '../logger/logger.js';
import type {
  Integration,
  IntegrationEvent,
  IntegrationId,
  IntegrationPreferences,
  SpawnAugmentation,
  SpawnContext,
} from './types.js';

/**
 * 默认偏好:全部启用 + auto detect
 */
export const DEFAULT_INTEGRATION_PREFS: IntegrationPreferences = {
  enabled: true,
  forceModule: 'auto',
  perModule: {},
};

/**
 * EventEmitter 内部使用的事件名
 *
 * 唯一公开事件 'event':payload 是 IntegrationEvent
 */
type ManagerEventMap = {
  event: [IntegrationEvent];
};

export class IntegrationManager extends EventEmitter<ManagerEventMap> {
  private readonly modules: Integration[] = [];
  private active: Integration | null = null;
  private prefs: IntegrationPreferences;

  constructor(prefs: IntegrationPreferences = DEFAULT_INTEGRATION_PREFS) {
    super();
    this.prefs = prefs;
  }

  /** 注册一个 Integration。重复注册同 id 抛错(配置 bug) */
  register(integration: Integration): void {
    if (this.modules.some((m) => m.id === integration.id)) {
      throw new Error(`Integration ${integration.id} 已注册,不能重复 register`);
    }
    this.modules.push(integration);
  }

  /** 当前已注册的所有模块 id(用于设置面板展示可选项) */
  listRegistered(): readonly IntegrationId[] {
    return this.modules.map((m) => m.id);
  }

  /** 当前激活的模块 id;null = 未激活(总开关关 / 无命中 / forceModule='none') */
  get activeId(): IntegrationId | null {
    return this.active?.id ?? null;
  }

  /**
   * Spawn 阶段决定激活哪个模块,并返回它的 spawn 增强补丁。
   *
   * - 总开关关 → 直接返回 null,不激活
   * - forceModule='none' → 同上
   * - forceModule=<id> → 强制激活该模块(若已注册),detect 不执行
   * - 否则按注册顺序 detect,第一个命中的激活
   */
  prepareSpawn(ctx: SpawnContext): SpawnAugmentation | null {
    if (!this.prefs.enabled || this.prefs.forceModule === 'none') {
      this.active = null;
      logger.debug({ command: ctx.command }, 'integrations: 未激活(总开关关 / forceModule=none)');
      return null;
    }

    if (this.prefs.forceModule !== 'auto') {
      const forced = this.modules.find((m) => m.id === this.prefs.forceModule);
      if (forced) {
        this.active = forced;
        logger.info({ id: forced.id, command: ctx.command }, 'integrations: 强制激活模块');
        return forced.prepareSpawn(ctx);
      }
      logger.warn(
        { forceModule: this.prefs.forceModule },
        'integrations: forceModule 指定的模块未注册,回退到 auto detect',
      );
    }

    for (const m of this.modules) {
      if (m.detect(ctx)) {
        this.active = m;
        logger.info({ id: m.id, command: ctx.command }, 'integrations: 自动检测命中并激活');
        return m.prepareSpawn(ctx);
      }
    }
    this.active = null;
    logger.debug({ command: ctx.command }, 'integrations: 无模块命中');
    return null;
  }

  /**
   * 把 hook payload 路由到激活的模块,并把翻译出的事件 emit 出去。
   *
   * 未激活时返回 false(由路由层决定要不要 400);激活则返回 true 哪怕事件为空
   * (模块认为该 payload 不需要翻译时合法返回 [])
   */
  routeHookPayload(payload: unknown): boolean {
    if (!this.active) return false;
    const events = this.active.onHookPayload(payload);
    for (const e of events) this.emit('event', e);
    return true;
  }

  /**
   * 把 PTY 数据片段路由给激活模块的可选 onPtyData。
   *
   * 多数模块不需要;调用方(SessionController.wirePty)在每次 data 事件后调用,
   * 性能为零成本(active.onPtyData 不存在时直接 return)。
   */
  routePtyData(chunk: string): void {
    if (!this.active?.onPtyData) return;
    const events = this.active.onPtyData(chunk);
    for (const e of events) this.emit('event', e);
  }

  /** 更新偏好(允许运行时改 forceModule);active 不立即切换,下次 prepareSpawn 才生效 */
  updatePreferences(next: IntegrationPreferences): void {
    this.prefs = next;
  }

  /** 关闭所有模块。多次调用幂等 */
  shutdown(): void {
    for (const m of this.modules) {
      try {
        m.shutdown();
      } catch (err) {
        logger.warn({ err, id: m.id }, 'integration shutdown 失败');
      }
    }
    this.active = null;
    this.removeAllListeners();
  }
}
