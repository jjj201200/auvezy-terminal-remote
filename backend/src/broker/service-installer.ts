/**
 * broker service installer（0.7.0 阶段 6）
 *
 * 把 broker 注册为操作系统级服务（开机自启 + 崩溃自动重启）。详见 ADR-010。
 *
 * 平台支持：
 *  - Linux + WSL2（启用 systemd）：user-level systemd unit
 *      `~/.config/systemd/user/atr-broker.service`
 *  - macOS：user agent launchd plist
 *      `~/Library/LaunchAgents/ke.kkjb.atr-broker.plist`
 *  - Windows：本阶段不支持，detectPlatform 返 'unsupported'
 *
 * 故意不直接调用 systemctl / launchctl 真实改系统状态：
 *  - install / uninstall 只写 / 删 unit 文件
 *  - 实际启用（systemctl --user enable / launchctl bootstrap）由 caller（CLI）
 *    决定何时调；service-installer 提供 nextSteps 字符串供 CLI 打印
 *  - 这样单测可以在临时目录里完整跑通文件流程，不污染系统
 *
 * 注入点：
 *  - `fsImpl`：测试可注入 fake fs（默认 node:fs）
 *  - `homeDir`：默认 `homedir()`；测试覆盖临时目录
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { ErrorCode } from 'auvezy-terminal-remote-shared';
import { AppError } from '../errors.js';

/** 检测到的平台 */
export type ServicePlatform = 'linux' | 'wsl2' | 'macos' | 'unsupported';

/** 注入式 fs（仅本模块用到的子集） */
export interface FsLike {
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts: { recursive?: boolean; mode?: number }): void;
  writeFileSync(path: string, data: string, opts?: { mode?: number }): void;
  readFileSync(path: string, encoding: 'utf-8'): string;
  rmSync(path: string, opts?: { force?: boolean; recursive?: boolean }): void;
}

const defaultFs: FsLike = {
  existsSync,
  mkdirSync: (p, o) => { mkdirSync(p, o); },
  writeFileSync: (p, d, o) => writeFileSync(p, d, { encoding: 'utf-8', ...(o ?? {}) }),
  readFileSync: (p) => readFileSync(p, 'utf-8'),
  rmSync,
};

/** install / uninstall 共用配置 */
export interface ServiceInstallerOptions {
  /** node 可执行文件路径（用于 ExecStart） */
  nodeBin: string;
  /** atr cli.js 绝对路径（用于 ExecStart） */
  cliPath: string;
  /** broker 监听端口；默认 3000 */
  brokerPort?: number;
  /** 用户家目录；默认 `homedir()` */
  homeDir?: string;
  /** 注入 fs */
  fs?: FsLike;
  /** 强制平台（测试用） */
  forcePlatform?: ServicePlatform;
}

/** install 调用结果 */
export interface InstallResult {
  /** 已写出的 service 文件路径 */
  servicePath: string;
  /** 提示用户后续命令（systemctl --user enable / launchctl bootstrap …） */
  nextSteps: string[];
  /** 平台 */
  platform: ServicePlatform;
}

/** uninstall 调用结果 */
export interface UninstallResult {
  /** 是否真的删了文件（不存在则 false） */
  removed: boolean;
  servicePath: string;
  nextSteps: string[];
  platform: ServicePlatform;
}

/** 平台不支持时抛 */
export class ServicePlatformUnsupportedError extends AppError {
  constructor(message: string) {
    super(ErrorCode.NOT_IMPLEMENTED, message, 501);
  }
}

/**
 * 探测当前平台
 *
 * Linux + systemd 视作 'linux'；WSL2 优先识别（同样走 systemd unit，但 user
 * 需要在 /etc/wsl.conf 启 systemd）。macOS = 'macos'。其它 = 'unsupported'。
 */
export function detectPlatform(env: NodeJS.ProcessEnv = process.env, plat = platform()): ServicePlatform {
  if (plat === 'darwin') return 'macos';
  if (plat === 'linux') {
    // WSL 检测：常见两种 env：WSL_DISTRO_NAME 或 /proc/version 含 microsoft
    if (env['WSL_DISTRO_NAME']) return 'wsl2';
    return 'linux';
  }
  return 'unsupported';
}

// ──────────────── 模板 ────────────────

/** systemd user unit 模板（Linux / WSL2 共用） */
export function renderSystemdUnit(opts: {
  nodeBin: string;
  cliPath: string;
  brokerPort?: number;
}): string {
  const portEnv = opts.brokerPort
    ? `Environment=ATR_BROKER_PORT=${opts.brokerPort}\n`
    : '';
  return `[Unit]
Description=Auvezy Terminal Remote broker
After=network.target

[Service]
Type=simple
ExecStart=${opts.nodeBin} ${opts.cliPath} start --foreground
Restart=on-failure
RestartSec=5s
${portEnv}[Install]
WantedBy=default.target
`;
}

/** launchd user agent plist 模板（macOS） */
export function renderLaunchdPlist(opts: {
  nodeBin: string;
  cliPath: string;
  brokerPort?: number;
  logPath: string;
}): string {
  const envBlock = opts.brokerPort
    ? `  <key>EnvironmentVariables</key>
  <dict>
    <key>ATR_BROKER_PORT</key>
    <string>${opts.brokerPort}</string>
  </dict>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ke.kkjb.atr-broker</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.nodeBin}</string>
    <string>${opts.cliPath}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${opts.logPath}</string>
  <key>StandardErrorPath</key><string>${opts.logPath}</string>
${envBlock}</dict>
</plist>
`;
}

// ──────────────── 路径推导 ────────────────

/** systemd user unit 路径：~/.config/systemd/user/atr-broker.service */
function systemdUnitPath(home: string): string {
  return resolve(home, '.config', 'systemd', 'user', 'atr-broker.service');
}

/** launchd plist 路径：~/Library/LaunchAgents/ke.kkjb.atr-broker.plist */
function launchdPlistPath(home: string): string {
  return resolve(home, 'Library', 'LaunchAgents', 'ke.kkjb.atr-broker.plist');
}

/** broker 日志路径（launchd 用）：~/.atr/broker.log */
function brokerLogPath(home: string): string {
  return resolve(home, '.atr', 'broker.log');
}

// ──────────────── install / uninstall ────────────────

/**
 * 写 service 文件 + 返回后续步骤指引
 *
 * **不**主动 daemon-reload / enable / start —— 这一步由 CLI 显式跑；让本函数
 * 在测试 / dry-run 场景下可纯文件操作完成。
 */
export function install(opts: ServiceInstallerOptions): InstallResult {
  const fs = opts.fs ?? defaultFs;
  const home = opts.homeDir ?? homedir();
  const platformDetected = opts.forcePlatform ?? detectPlatform();

  if (platformDetected === 'unsupported') {
    throw new ServicePlatformUnsupportedError(
      'service install is not supported on Windows / other platforms (planned for 0.7.x)',
    );
  }

  if (platformDetected === 'macos') {
    const path = launchdPlistPath(home);
    const logPath = brokerLogPath(home);
    ensureDir(fs, dirname(path));
    ensureDir(fs, dirname(logPath));
    fs.writeFileSync(
      path,
      renderLaunchdPlist({
        nodeBin: opts.nodeBin,
        cliPath: opts.cliPath,
        ...(opts.brokerPort !== undefined ? { brokerPort: opts.brokerPort } : {}),
        logPath,
      }),
      { mode: 0o644 },
    );
    return {
      servicePath: path,
      platform: 'macos',
      nextSteps: [
        `launchctl bootstrap gui/$(id -u) ${path}`,
        `launchctl kickstart -k gui/$(id -u)/ke.kkjb.atr-broker`,
        `# verify: launchctl list | grep atr-broker`,
      ],
    };
  }

  // linux / wsl2
  const path = systemdUnitPath(home);
  ensureDir(fs, dirname(path));
  fs.writeFileSync(
    path,
    renderSystemdUnit({
      nodeBin: opts.nodeBin,
      cliPath: opts.cliPath,
      ...(opts.brokerPort !== undefined ? { brokerPort: opts.brokerPort } : {}),
    }),
    { mode: 0o644 },
  );
  return {
    servicePath: path,
    platform: platformDetected,
    nextSteps: [
      'systemctl --user daemon-reload',
      'systemctl --user enable atr-broker.service',
      'systemctl --user start atr-broker.service',
      '# verify: systemctl --user status atr-broker.service',
      ...(platformDetected === 'wsl2'
        ? [
            '# WSL2: enable systemd first in /etc/wsl.conf ([boot] systemd=true), then restart WSL',
          ]
        : []),
    ],
  };
}

/** 删 service 文件 */
export function uninstall(opts: {
  homeDir?: string;
  fs?: FsLike;
  forcePlatform?: ServicePlatform;
} = {}): UninstallResult {
  const fs = opts.fs ?? defaultFs;
  const home = opts.homeDir ?? homedir();
  const platformDetected = opts.forcePlatform ?? detectPlatform();

  if (platformDetected === 'unsupported') {
    throw new ServicePlatformUnsupportedError(
      'service uninstall is not supported on Windows / other platforms',
    );
  }

  const path =
    platformDetected === 'macos' ? launchdPlistPath(home) : systemdUnitPath(home);

  const removed = fs.existsSync(path);
  if (removed) {
    fs.rmSync(path, { force: true });
  }

  const nextSteps =
    platformDetected === 'macos'
      ? [
          `launchctl bootout gui/$(id -u)/ke.kkjb.atr-broker || true`,
          `# verify: launchctl list | grep atr-broker (should be empty)`,
        ]
      : [
          'systemctl --user stop atr-broker.service || true',
          'systemctl --user disable atr-broker.service || true',
          'systemctl --user daemon-reload',
        ];

  return { removed, servicePath: path, platform: platformDetected, nextSteps };
}

/** 当前已安装 service 文件路径（不存在返 null） */
export function getInstalledPath(opts: {
  homeDir?: string;
  fs?: FsLike;
  forcePlatform?: ServicePlatform;
} = {}): string | null {
  const fs = opts.fs ?? defaultFs;
  const home = opts.homeDir ?? homedir();
  const platformDetected = opts.forcePlatform ?? detectPlatform();
  if (platformDetected === 'unsupported') return null;
  const path =
    platformDetected === 'macos' ? launchdPlistPath(home) : systemdUnitPath(home);
  return fs.existsSync(path) ? path : null;
}

// ──────────────── 内部 ────────────────

function ensureDir(fs: FsLike, dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
