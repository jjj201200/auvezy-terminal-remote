/**
 * IntegrationManager 单元测试
 *
 * 覆盖:
 *  - 总开关 / forceModule='none' → 不激活
 *  - forceModule=<id> 强制激活,跳过 detect
 *  - auto 模式下按注册顺序 detect,第一个命中激活
 *  - routeHookPayload 把模块翻译出的事件 emit 给监听者
 *  - shutdown 调用每个模块的 shutdown
 */

import { describe, it, expect, vi } from 'vitest';
import { IntegrationManager } from './manager.js';
import type {
  Integration,
  IntegrationEvent,
  IntegrationPreferences,
  SpawnAugmentation,
  SpawnContext,
} from './types.js';

/** 构造一个最简模块(spy 友好) */
function makeMockIntegration(opts: {
  id: 'claude-code';
  detectsCommand: string;
  onHook?: (p: unknown) => IntegrationEvent[];
  augmentation?: SpawnAugmentation;
}): Integration & {
  shutdownSpy: ReturnType<typeof vi.fn>;
  detectSpy: ReturnType<typeof vi.fn>;
} {
  const shutdownSpy = vi.fn();
  const detectSpy = vi.fn((ctx: SpawnContext) => ctx.command === opts.detectsCommand);
  const onHookSpy = opts.onHook ?? ((): IntegrationEvent[] => []);
  return {
    id: opts.id,
    displayName: 'Mock',
    detect: detectSpy,
    prepareSpawn: () => opts.augmentation ?? null,
    onHookPayload: onHookSpy,
    shutdown: shutdownSpy,
    shutdownSpy,
    detectSpy,
  };
}

const baseCtx: SpawnContext = { command: 'claude', args: [], port: 3000 };

describe('IntegrationManager.prepareSpawn', () => {
  it('总开关关 → 不激活,返回 null', () => {
    const mgr = new IntegrationManager({ enabled: false, forceModule: 'auto', perModule: {} });
    const m = makeMockIntegration({ id: 'claude-code', detectsCommand: 'claude' });
    mgr.register(m);
    expect(mgr.prepareSpawn(baseCtx)).toBeNull();
    expect(mgr.activeId).toBeNull();
    expect(m.detectSpy).not.toHaveBeenCalled();
  });

  it("forceModule='none' → 不激活", () => {
    const mgr = new IntegrationManager({ enabled: true, forceModule: 'none', perModule: {} });
    const m = makeMockIntegration({ id: 'claude-code', detectsCommand: 'claude' });
    mgr.register(m);
    expect(mgr.prepareSpawn(baseCtx)).toBeNull();
    expect(mgr.activeId).toBeNull();
  });

  it('auto 模式 detect 命中 → 激活该模块,返回它的 augmentation', () => {
    const mgr = new IntegrationManager({ enabled: true, forceModule: 'auto', perModule: {} });
    const aug: SpawnAugmentation = { extraArgs: ['--settings', '/tmp/x.json'] };
    const m = makeMockIntegration({
      id: 'claude-code',
      detectsCommand: 'claude',
      augmentation: aug,
    });
    mgr.register(m);
    expect(mgr.prepareSpawn(baseCtx)).toEqual(aug);
    expect(mgr.activeId).toBe('claude-code');
    expect(m.detectSpy).toHaveBeenCalledWith(baseCtx);
  });

  it('auto 模式无模块命中 → 不激活', () => {
    const mgr = new IntegrationManager({ enabled: true, forceModule: 'auto', perModule: {} });
    const m = makeMockIntegration({ id: 'claude-code', detectsCommand: 'claude' });
    mgr.register(m);
    expect(mgr.prepareSpawn({ ...baseCtx, command: 'bash' })).toBeNull();
    expect(mgr.activeId).toBeNull();
  });

  it("forceModule=<id> → 强制激活,跳过 detect", () => {
    const prefs: IntegrationPreferences = {
      enabled: true,
      forceModule: 'claude-code',
      perModule: {},
    };
    const mgr = new IntegrationManager(prefs);
    const aug: SpawnAugmentation = { extraArgs: ['--forced'] };
    const m = makeMockIntegration({
      id: 'claude-code',
      detectsCommand: 'claude',
      augmentation: aug,
    });
    mgr.register(m);
    // 命令是 bash,detect 会返 false,但 forceModule 跳过 detect 强制激活
    expect(mgr.prepareSpawn({ ...baseCtx, command: 'bash' })).toEqual(aug);
    expect(mgr.activeId).toBe('claude-code');
    expect(m.detectSpy).not.toHaveBeenCalled();
  });
});

describe('IntegrationManager.routeHookPayload', () => {
  it('未激活 → false,不 emit', () => {
    const mgr = new IntegrationManager({ enabled: false, forceModule: 'auto', perModule: {} });
    const listener = vi.fn();
    mgr.on('event', listener);
    expect(mgr.routeHookPayload({ any: 'thing' })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('激活后 → 调模块翻译并 emit 每条事件', () => {
    const events: IntegrationEvent[] = [
      { kind: 'approval_pending', id: 'a-1', tool: 'Bash' },
      { kind: 'tool_started', toolUseId: 't-1', tool: 'Bash', summary: 'Bash: ls' },
    ];
    const m = makeMockIntegration({
      id: 'claude-code',
      detectsCommand: 'claude',
      onHook: () => events,
    });
    const mgr = new IntegrationManager();
    mgr.register(m);
    mgr.prepareSpawn(baseCtx);

    const captured: IntegrationEvent[] = [];
    mgr.on('event', (e) => captured.push(e));
    expect(mgr.routeHookPayload({})).toBe(true);
    expect(captured).toEqual(events);
  });

  it('模块返空数组 → routeHookPayload 仍 true,但无事件', () => {
    const m = makeMockIntegration({
      id: 'claude-code',
      detectsCommand: 'claude',
      onHook: () => [],
    });
    const mgr = new IntegrationManager();
    mgr.register(m);
    mgr.prepareSpawn(baseCtx);

    const listener = vi.fn();
    mgr.on('event', listener);
    expect(mgr.routeHookPayload({})).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('IntegrationManager 注册与 shutdown', () => {
  it('重复注册同 id → 抛错', () => {
    const mgr = new IntegrationManager();
    mgr.register(makeMockIntegration({ id: 'claude-code', detectsCommand: 'claude' }));
    expect(() =>
      mgr.register(makeMockIntegration({ id: 'claude-code', detectsCommand: 'claude' })),
    ).toThrow(/已注册/);
  });

  it('shutdown 调用每个模块的 shutdown 并清空 active', () => {
    const m = makeMockIntegration({ id: 'claude-code', detectsCommand: 'claude' });
    const mgr = new IntegrationManager();
    mgr.register(m);
    mgr.prepareSpawn(baseCtx);
    expect(mgr.activeId).toBe('claude-code');
    mgr.shutdown();
    expect(m.shutdownSpy).toHaveBeenCalledTimes(1);
    expect(mgr.activeId).toBeNull();
  });
});
