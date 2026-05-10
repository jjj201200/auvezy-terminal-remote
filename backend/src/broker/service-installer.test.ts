/**
 * service-installer 单测
 *
 * - detectPlatform：linux / macos / wsl2 / unsupported
 * - renderSystemdUnit / renderLaunchdPlist 模板内容（含 brokerPort 可选）
 * - install / uninstall：临时目录验证文件写入与删除（注入 fs）
 * - 不支持平台抛错
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectPlatform,
  renderSystemdUnit,
  renderLaunchdPlist,
  install,
  uninstall,
  getInstalledPath,
  ServicePlatformUnsupportedError,
} from './service-installer.js';

describe('detectPlatform', () => {
  it('macos', () => {
    expect(detectPlatform({}, 'darwin')).toBe('macos');
  });

  it('linux 无 WSL_DISTRO_NAME → linux', () => {
    expect(detectPlatform({}, 'linux')).toBe('linux');
  });

  it('linux + WSL_DISTRO_NAME → wsl2', () => {
    expect(detectPlatform({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux')).toBe('wsl2');
  });

  it('win32 / 其它 → unsupported', () => {
    expect(detectPlatform({}, 'win32')).toBe('unsupported');
    expect(detectPlatform({}, 'aix')).toBe('unsupported');
  });
});

describe('renderSystemdUnit', () => {
  it('基础模板（无 brokerPort）', () => {
    const u = renderSystemdUnit({
      nodeBin: '/usr/bin/node',
      cliPath: '/opt/atr/cli.js',
    });
    expect(u).toContain('Description=Auvezy Terminal Remote broker');
    expect(u).toContain('ExecStart=/usr/bin/node /opt/atr/cli.js start');
    expect(u).toContain('Restart=on-failure');
    expect(u).toContain('WantedBy=default.target');
    expect(u).not.toContain('ATR_BROKER_PORT');
  });

  it('带 brokerPort → Environment 行', () => {
    const u = renderSystemdUnit({
      nodeBin: '/usr/bin/node',
      cliPath: '/opt/atr/cli.js',
      brokerPort: 3333,
    });
    expect(u).toContain('Environment=ATR_BROKER_PORT=3333');
  });
});

describe('renderLaunchdPlist', () => {
  it('基础模板（无 brokerPort）', () => {
    const p = renderLaunchdPlist({
      nodeBin: '/usr/local/bin/node',
      cliPath: '/opt/atr/cli.js',
      logPath: '/tmp/broker.log',
    });
    expect(p).toContain('<key>Label</key>');
    expect(p).toContain('<string>ke.kkjb.atr-broker</string>');
    expect(p).toContain('<string>/usr/local/bin/node</string>');
    expect(p).toContain('<string>/opt/atr/cli.js</string>');
    expect(p).toContain('<string>start</string>');
    expect(p).not.toContain('<string>broker</string>');
    expect(p).toContain('<key>RunAtLoad</key><true/>');
    expect(p).toContain('<key>KeepAlive</key><true/>');
    expect(p).toContain('<string>/tmp/broker.log</string>');
    expect(p).not.toContain('EnvironmentVariables');
  });

  it('带 brokerPort → EnvironmentVariables 块', () => {
    const p = renderLaunchdPlist({
      nodeBin: '/usr/local/bin/node',
      cliPath: '/opt/atr/cli.js',
      logPath: '/tmp/broker.log',
      brokerPort: 4444,
    });
    expect(p).toContain('EnvironmentVariables');
    expect(p).toContain('ATR_BROKER_PORT');
    expect(p).toContain('<string>4444</string>');
  });
});

describe('install + uninstall（systemd）', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(resolve(tmpdir(), 'atr-svc-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('install 写出 unit 文件到 ~/.config/systemd/user/', () => {
    const r = install({
      nodeBin: '/usr/bin/node',
      cliPath: '/opt/atr/cli.js',
      brokerPort: 3000,
      homeDir: home,
      forcePlatform: 'linux',
    });
    expect(r.platform).toBe('linux');
    const expected = resolve(home, '.config', 'systemd', 'user', 'atr-broker.service');
    expect(r.servicePath).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    const content = readFileSync(expected, 'utf-8');
    expect(content).toContain('Description=Auvezy Terminal Remote broker');
    expect(content).toContain('ATR_BROKER_PORT=3000');
    // nextSteps 含 systemctl --user 命令
    expect(r.nextSteps.some((s) => s.includes('daemon-reload'))).toBe(true);
    expect(r.nextSteps.some((s) => s.includes('enable atr-broker'))).toBe(true);
  });

  it('install wsl2 平台 → 同 unit + WSL 提示', () => {
    const r = install({
      nodeBin: '/usr/bin/node',
      cliPath: '/opt/atr/cli.js',
      homeDir: home,
      forcePlatform: 'wsl2',
    });
    expect(r.platform).toBe('wsl2');
    expect(r.nextSteps.some((s) => s.includes('/etc/wsl.conf'))).toBe(true);
  });

  it('uninstall 删除 unit 文件，再删幂等', () => {
    install({
      nodeBin: '/usr/bin/node',
      cliPath: '/opt/atr/cli.js',
      homeDir: home,
      forcePlatform: 'linux',
    });

    const u1 = uninstall({ homeDir: home, forcePlatform: 'linux' });
    expect(u1.removed).toBe(true);
    expect(existsSync(u1.servicePath)).toBe(false);

    const u2 = uninstall({ homeDir: home, forcePlatform: 'linux' });
    expect(u2.removed).toBe(false);
  });

  it('getInstalledPath：装前 null，装后返回路径', () => {
    expect(getInstalledPath({ homeDir: home, forcePlatform: 'linux' })).toBeNull();
    install({
      nodeBin: '/usr/bin/node',
      cliPath: '/opt/atr/cli.js',
      homeDir: home,
      forcePlatform: 'linux',
    });
    expect(getInstalledPath({ homeDir: home, forcePlatform: 'linux' })).toContain(
      'atr-broker.service',
    );
  });
});

describe('install + uninstall（macOS）', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(resolve(tmpdir(), 'atr-svc-mac-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('install 写出 plist 到 ~/Library/LaunchAgents/', () => {
    const r = install({
      nodeBin: '/usr/local/bin/node',
      cliPath: '/opt/atr/cli.js',
      homeDir: home,
      forcePlatform: 'macos',
    });
    expect(r.platform).toBe('macos');
    const expected = resolve(home, 'Library', 'LaunchAgents', 'ke.kkjb.atr-broker.plist');
    expect(r.servicePath).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    const content = readFileSync(expected, 'utf-8');
    expect(content).toContain('<string>ke.kkjb.atr-broker</string>');
    expect(r.nextSteps.some((s) => s.includes('launchctl bootstrap'))).toBe(true);
  });

  it('uninstall 删除 plist', () => {
    install({
      nodeBin: '/usr/local/bin/node',
      cliPath: '/opt/atr/cli.js',
      homeDir: home,
      forcePlatform: 'macos',
    });
    const u = uninstall({ homeDir: home, forcePlatform: 'macos' });
    expect(u.removed).toBe(true);
    expect(existsSync(u.servicePath)).toBe(false);
  });
});

describe('unsupported platform', () => {
  it('install → ServicePlatformUnsupportedError', () => {
    expect(() =>
      install({
        nodeBin: '/usr/bin/node',
        cliPath: '/opt/atr/cli.js',
        forcePlatform: 'unsupported',
      }),
    ).toThrow(ServicePlatformUnsupportedError);
  });

  it('uninstall → ServicePlatformUnsupportedError', () => {
    expect(() => uninstall({ forcePlatform: 'unsupported' })).toThrow(
      ServicePlatformUnsupportedError,
    );
  });

  it('getInstalledPath → null', () => {
    expect(getInstalledPath({ forcePlatform: 'unsupported' })).toBeNull();
  });
});
