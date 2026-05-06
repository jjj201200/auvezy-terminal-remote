/**
 * PushService 单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PushService, type PushSubscriptionInfo } from './push-service.js';
import { ErrorCode } from '@auvezy/terminal-remote-shared';

/** 一个长度合法的 p256dh / auth 占位串 */
const VALID_P256DH = 'a'.repeat(87);
const VALID_AUTH = 'b'.repeat(22);

function fakeSub(endpoint: string): PushSubscriptionInfo {
  return {
    endpoint,
    keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
  };
}

/** 注入式 webPush mock：记录发送、控制错误 */
function makeMockPush(opts: {
  failEndpoints?: Map<string, number>; // endpoint → status code
} = {}) {
  const sent: Array<{ sub: PushSubscriptionInfo; payload: string }> = [];
  return {
    setVapidDetails: () => {},
    generateVAPIDKeys: () => ({
      publicKey: 'pub-' + Math.random().toString(36).slice(2, 8),
      privateKey: 'priv-' + Math.random().toString(36).slice(2, 8),
    }),
    sendNotification: async (sub: PushSubscriptionInfo, payload: string) => {
      const code = opts.failEndpoints?.get(sub.endpoint);
      if (code) {
        const err: Error & { statusCode?: number } = new Error(`http ${code}`);
        err.statusCode = code;
        throw err;
      }
      sent.push({ sub, payload });
    },
    sent,
  };
}

describe('PushService', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(resolve(tmpdir(), 'ocr-push-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('init() 在没有 env / file 时生成 VAPID + 写盘', async () => {
    const mock = makeMockPush();
    const svc = new PushService({
      baseDir,
      env: {},
      pushImpl: mock as never,
    });
    await svc.init();
    expect(svc.vapidSourceTag).toBe('generated');
    expect(svc.getPublicKey().length).toBeGreaterThan(0);
    expect(existsSync(resolve(baseDir, 'vapid-keys.json'))).toBe(true);
  });

  it('优先级：env > file > generated', async () => {
    // 先写 file
    writeFileSync(
      resolve(baseDir, 'vapid-keys.json'),
      JSON.stringify({ publicKey: 'file-pub', privateKey: 'file-priv' }),
    );
    const mock = makeMockPush();

    // env 存在 → env
    const svcEnv = new PushService({
      baseDir,
      env: { VAPID_PUBLIC_KEY: 'env-pub', VAPID_PRIVATE_KEY: 'env-priv' },
      pushImpl: mock as never,
    });
    await svcEnv.init();
    expect(svcEnv.vapidSourceTag).toBe('env');
    expect(svcEnv.getPublicKey()).toBe('env-pub');

    // env 缺失 → file
    const svcFile = new PushService({
      baseDir,
      env: {},
      pushImpl: mock as never,
    });
    await svcFile.init();
    expect(svcFile.vapidSourceTag).toBe('file');
    expect(svcFile.getPublicKey()).toBe('file-pub');
  });

  it('subscribe 合法订阅 + 写盘', async () => {
    const mock = makeMockPush();
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    await svc.init();
    svc.subscribe(fakeSub('https://push.example/abc'));
    expect(svc.getSubscriptionCount()).toBe(1);
    const onDisk = JSON.parse(
      readFileSync(resolve(baseDir, 'push-subscriptions.json'), 'utf-8'),
    );
    expect(onDisk).toHaveLength(1);
  });

  it('subscribe 同 endpoint 去重（覆盖）', async () => {
    const mock = makeMockPush();
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    await svc.init();
    svc.subscribe(fakeSub('https://push.example/abc'));
    svc.subscribe(fakeSub('https://push.example/abc'));
    expect(svc.getSubscriptionCount()).toBe(1);
  });

  it('subscribe p256dh 长度异常 → PushError(PUSH_SUBSCRIPTION_INVALID)', async () => {
    const mock = makeMockPush();
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    await svc.init();
    expect(() =>
      svc.subscribe({
        endpoint: 'x',
        keys: { p256dh: 'too-short', auth: VALID_AUTH },
      }),
    ).toThrow(/p256dh 长度异常/);
  });

  it('unsubscribe 删除 + 写盘；不存在返回 false', async () => {
    const mock = makeMockPush();
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    await svc.init();
    svc.subscribe(fakeSub('a'));
    svc.subscribe(fakeSub('b'));
    expect(svc.unsubscribe('a')).toBe(true);
    expect(svc.unsubscribe('not-found')).toBe(false);
    expect(svc.getSubscriptionCount()).toBe(1);
  });

  it('notifyAll：成功一次 + 410 自动 prune + 其它错误 failed', async () => {
    const mock = makeMockPush({
      failEndpoints: new Map([
        ['gone', 410],
        ['boom', 500],
      ]),
    });
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    await svc.init();
    svc.subscribe(fakeSub('ok'));
    svc.subscribe(fakeSub('gone'));
    svc.subscribe(fakeSub('boom'));

    const r = await svc.notifyAll({ title: 't', body: 'b' });
    expect(r).toEqual({ sent: 1, pruned: 1, failed: 1 });
    // 'gone' 已剔除
    expect(svc.getSubscriptionCount()).toBe(2);
  });

  it('notifyAll：未 init → sent=0 不抛', async () => {
    const mock = makeMockPush();
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    // 不 init
    const r = await svc.notifyAll({ title: 't', body: 'b' });
    expect(r).toEqual({ sent: 0, pruned: 0, failed: 0 });
  });

  it('订阅文件损坏 → init 后 subscriptions 为空（不抛）', async () => {
    writeFileSync(resolve(baseDir, 'push-subscriptions.json'), 'not json');
    const mock = makeMockPush();
    const svc = new PushService({ baseDir, env: {}, pushImpl: mock as never });
    await svc.init();
    expect(svc.getSubscriptionCount()).toBe(0);
  });

  it('getPublicKey 未 init → PushError(PUSH_VAPID_NOT_READY)', () => {
    const svc = new PushService({ baseDir });
    expect(() => svc.getPublicKey()).toThrow(/PushService 未初始化/);
  });
});
