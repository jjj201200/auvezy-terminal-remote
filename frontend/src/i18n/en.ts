/**
 * 英文文案表（默认 locale）
 *
 * 风格：
 *  - 句首大写，句末标点遵从英文习惯
 *  - 控件 label 用 sentence case（如 "Display"），不要 Title Case
 *  - 提示句尽量短，不超 80 字符
 */

import type { Messages } from './messages.js';

export const en: Messages = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    confirm: 'Confirm',
    reset: 'Reset',
    refresh: 'Refresh',
    loading: 'Loading',
    yes: 'Yes',
    no: 'No',
    auto: 'Auto',
    custom: 'Custom',
    clear: 'Clear',
  },

  app: {
    loading: 'loading',
  },

  authPage: {
    title: 'Authenticate',
    subtitle: 'Enter the access token shown when the server started.',
    fieldLabel: 'Access token',
    placeholder: '64-char hex',
    submit: 'Authenticate',
    submitting: 'Verifying…',
    hint: 'Scan the terminal QR code or paste the token shown on launch. Token is stored on this device only.',
    back: 'Back to previous instance',
  },

  topBar: {
    settings: 'Settings',
    settingsTooltip: 'Settings',
    share: 'Share this instance',
    shareTooltip: 'Share this instance (with QR)',
    instances: 'Instances',
    createInstance: 'Create instance',
    switchInstance: 'Switch instance',
  },

  console: {
    startingTitle: 'Starting terminal',
    startingBody:
      'Browser connected, PTY child process starting…\nIf it stalls, press Enter in the atr terminal.',
    awaitingTitle: 'Awaiting terminal output',
    awaitingBody:
      'PTY started but no output yet. If you used --wait-confirm, press Enter in the atr terminal.',
  },

  status: {
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
    disconnectedReconnect: 'Disconnected · reconnect',
    gaveUp: 'Gave up · tap to retry',
    gaveUpReconnect: 'Gave up · tap to retry',
    reconnecting: 'Reconnecting…',
    reconnect: 'Reconnect',
    reconnectTooltip: 'Reconnect now',
    idle: 'Idle',
    running: 'Running',
    ptyPending: 'Pending',
    waitingInput: 'Awaiting approval',
    startingTerminal: 'Starting terminal…',

    connectionDialogTitle: 'Connection status',
    sessionDialogTitle: 'Session status',
    descConnecting: 'Establishing WebSocket connection to backend. Will auto-retry if not connected within a few seconds.',
    descConnected: 'WebSocket connected. PTY output / input flowing both ways.',
    descDisconnected: 'WebSocket disconnected. Will auto-retry with exponential backoff. Tap to reconnect immediately.',
    descGaveUp: 'Auto-reconnect gave up (reached attempt limit). Tap to manually reconnect.',
    descPtyPending: 'Backend ready but PTY child process not yet spawned. Waiting for first browser connect / Enter / timeout.',
    descIdle: 'PTY child exited; session has ended.',
    descRunning: 'PTY child running normally.',
    descWaitingInput: 'Claude triggered an approval hook and is waiting for confirmation in the terminal (Y / N or arrow keys).',
  },

  settings: {
    title: 'Settings',
    saveError: 'Failed to save, please try again.',
    tab: {
      shortcuts: 'Shortcuts',
      commands: 'Commands',
      display: 'Display',
      general: 'General',
      notifications: 'Notifications',
      network: 'Network',
      dev: 'Developer',
      about: 'About',
    },
    saving: 'Saving…',
  },

  display: {
    previewTitle: 'Preview',
    previewHint:
      'Rendered with current cols & letter-spacing. Preview width may differ from terminal — visual density only.',
    previewMeta: 'Font {{size}}px · Spacing {{ls}}px · Cols {{cols}}',
    targetColsTitle: 'Target columns',
    targetColsHint:
      'Adapt font size by container width to fit target chars per row. Phones: 80 recommended.',
    autoLabel: 'Auto',
    customPlaceholder: 'Custom',
    autoTooltip: 'Disable adaptive sizing, use default font size',
    customAriaLabel: 'Custom column count',
    letterSpacingTitle: 'Letter spacing',
    letterSpacingHint: 'Extra px between mono chars. Negative compresses, positive widens.',
    letterSpacingAriaLabel: 'Letter spacing',
    letterSpacingValue: '{{val}} px',
    resetTooltip: 'Reset to 0',
    colsModeAuto: 'auto',
    colsModeTarget: 'target {{cols}}',
  },

  general: {
    languageTitle: 'Language',
    languageHint: 'Interface language. Stored on this device.',
    inputModeTitle: 'Input mode',
    inputModeHint: 'Turn off to hide the bottom input bar and type directly in the terminal area — desktop-like real-time keystrokes. IME (Chinese/Japanese) support varies by browser (experimental).',
    inputModeUseBar: 'Use bottom input bar (line-edit, send on Enter)',
    inputModeDirect: 'Type directly in terminal (real-time keystrokes to PTY)',
  },

  network: {
    reconnectMaxTitle: 'Auto-reconnect attempts',
    reconnectMaxHint:
      'Stop auto-retrying after this many tries. Mobile data is consumed even when retries fail. Tap the reconnect badge to resume after the cap.',
    reconnectMaxAriaLabel: 'Max auto-reconnect attempts',
    reconnectMaxUnit: 'times',
  },

  dev: {
    erudaTitle: 'Mobile DevTools overlay (eruda)',
    erudaHint:
      'Inject a floating debug console (console / network / elements) at the bottom-right corner. Local to this device; reload to apply.',
    erudaToggleOn: 'Enabled — refresh page to show the debug button',
    erudaToggleOff: 'Disabled',
    reloadHint: 'Reload the page after toggling to take effect',
    consoleBridgeTitle: 'Console bridge (remote dev)',
    consoleBridgeHint:
      'Forward browser console output to the backend stderr via WebSocket so developers can `tail -f` server logs. Reload to apply.',
    consoleBridgeOn: 'Enabled — subsequent console logs forwarded to backend',
    consoleBridgeOff: 'Disabled',
  },

  about: {
    tagline: 'Remote-control any PC terminal program from your phone or tablet over LAN.',
    versionLabel: 'Version',
    versionTooltip: 'Click to copy version',
    descTitle: 'About',
    descBody:
      'One command — atr <program> — bridges any CLI on your PC (zsh / bash / claude / anything) to a phone browser via WebSocket: live output, remote input, approval notifications. LAN / Tailscale only, no public exposure; token + cookie auth.',
    featuresTitle: 'Highlights',
    featurePty: 'PTY bridge (node-pty + xterm.js) with ANSI colors and alt-screen support',
    featureMultiInstance: 'Multi-instance auto port; tab-switch in the top bar',
    featureAuth: 'timingSafeEqual token + session cookie, binds only LAN/Tailscale',
    featurePush: 'Web Push (VAPID 3-priority) + iOS Safari LocalNotification fallback',
    featureMobile: 'Mobile PWA: local-echo, keyboard reflow guard, double-pulse PTY resize',
    notesTitle: 'Notes',
    notePersistent:
      'Closing the browser tab / quitting the PWA does NOT stop the backend — the PTY keeps running on your PC and your phone can pick up the full output later. To actually stop an instance: use the "close instance" button in the webapp, or run atr stop on the PC.',
    noteLanOnly:
      'Listens on LAN / Tailscale only — no public exposure. To access from a different network (e.g. phone on 4G), connect Tailscale or another VPN first.',
    noteMasterResize:
      'When multiple devices connect to the same instance, the PTY size is decided by the "master" device (otherwise resize fights cause render glitches). To take master from your phone, tap the "fit size" button in the top bar.',
    noteVirtualNic:
      'On multi-NIC hosts (Hyper-V / WSL / Docker bridge / VPN), the banner picks the display IP in this order: Tailscale > real LAN > 172.x — which may differ from what you expect. Trust the IP shown on the banner "scan" line.',
    linksTitle: 'Links',
    repoGithubLabel: 'Source (GitHub)',
    repoGiteeLabel: 'Source (Gitee mirror, faster from mainland China)',
    issuesGithubLabel: 'Feedback / file an issue (GitHub)',
    issuesGiteeLabel: 'Feedback / file an issue (Gitee)',
    npmLabel: 'npm package',
    licenseTitle: 'License',
    licenseBody:
      'PolyForm Noncommercial 1.0.0: free to use, modify, and redistribute for personal / educational / nonprofit purposes; commercial use requires a separate license. © 2026 DrowsyFlesh / Auvezy.',
  },

  list: {
    enableAll: 'Enable all',
    disableAll: 'Disable all',
    add: 'Add',
  },

  shortcuts: {
    addBtn: 'Add shortcut',
    nameLabel: 'Label',
    namePlaceholder: 'Label',
    dataPlaceholder: '\\e \\r \\xHH …',
    dataLabel: 'Data',
    descLabel: 'Description',
    descPlaceholder: 'Optional, shown in tooltip and settings',
    enabledLabel: 'Enabled',
    unnamed: 'Untitled',
    empty: 'empty',
    emptyList: 'No shortcuts (drag here to add)',
    deleteTooltip: 'Delete',
    editTooltip: 'Edit',
    saveTooltip: 'Save',
    cancelTooltip: 'Cancel',
    dragHandleTooltip: 'Drag to reorder / move across groups',
    listAriaLabel: 'Shortcut list',
    groupListAriaLabel: 'Group list',
  },

  commands: {
    addBtn: 'Add command',
    nameLabel: 'Label',
    namePlaceholder: 'Label',
    commandPlaceholder: 'Command text (e.g. /clear)',
    descPlaceholder: 'Optional, shown in tooltip and settings',
    autoSendLabel: 'Auto-send',
    autoSendHint: 'On: send immediately. Off: fill into input box for editing.',
    unnamed: 'Untitled',
    empty: 'empty',
    emptyList: 'No commands (drag here to add)',
    deleteTooltip: 'Delete',
    editTooltip: 'Edit',
    saveTooltip: 'Save',
    cancelTooltip: 'Cancel',
    dragHandleTooltip: 'Drag to reorder / move across groups',
  },

  toolbar: {
    pickGroup: 'Pick a category',
    groupEmpty: 'No enabled items in this group',
    customGroup: 'Custom',
  },

  instance: {
    create: 'Create instance',
    instancesAriaLabel: 'Instance switcher',
    sheetTitle: 'Instances',
    workdirLabel: 'Working directory (cwd)',
    workdirHelper: '/home/me/code/foo',
    nameLabelOptional: 'Instance name (optional)',
    namePlaceholder: 'leave empty to use cwd basename',
    submit: 'Create',
    submitting: 'Creating…',
    errorEmptyCwd: 'cwd cannot be empty',
    errorCreateFailed: 'Create failed: check that the cwd exists',
    pendingTooltip: 'Spawning…',
    pendingFailed: 'Create failed',
    pendingNameless: '(unnamed)',
    pendingRetry: 'Retry waiting',
    pendingDismiss: 'Dismiss placeholder',
    disconnect: 'Disconnect',
    reconnect: 'Reconnect',
    disconnectedTitle: 'Disconnected (this device only)',
    disconnectedBody: 'The instance is still running on the backend; other devices are unaffected. Click below to reconnect.',
    closeOrDisconnectTitle: 'Close or Disconnect?',
    closeOrDisconnectBody: 'Close instance {{name}}: terminates its PTY process; all devices will lose connection.\nDisconnect: only this device closes the WS; the backend process keeps running, other devices stay connected, and this device can reconnect manually later.',
    recentTitle: 'Recent',
    recentRemove: 'Remove from history',
    recentEmpty: '(no history)',
    close: 'Close instance',
    closeFailed: 'Close failed',
    closeConfirmTitle: 'Close instance',
    closeConfirm: 'Close instance {{name}}? Its PTY process will be terminated.',
    closeCurrentBlocked: 'Cannot close the instance serving this webapp — it would disconnect everything. Use CLI (atr stop) or kill the process directly.',
    closeCurrentLastTitle: 'Cannot close',
    closeCurrentLast: 'Cannot close the only instance — create another one first.',
    closeCurrentConfirmTitle: 'Close serving instance',
    closeCurrentConfirm: 'Close instance {{name}}? You will be redirected to another instance, then it will be terminated. Other devices connected to this instance will be disconnected.',
    closeFailedTitle: 'Close failed',
    pendingFailedTitle: 'Create failed',
  },

  push: {
    title: 'Push notifications',
    enable: 'Enable',
    disable: 'Disable',
    enabling: 'Enabling…',
    disabling: 'Disabling…',
    statusOn: 'On',
    statusOff: 'Off',
    statusDenied: 'Denied',
    needHttps: 'HTTPS required',
    notSupported: 'Not supported',
    notSupportedHint: 'Browser missing ServiceWorker / PushManager API.',
    needHttpsHint: 'HTTP page — browser disables Web Push. Use HTTPS or localhost.',
    deniedHint: 'Notification permission denied. Enable it in OS settings.',
    permissionDenied: 'Permission denied',
    busy: 'Working…',
    clickToEnable: 'Click to enable push',
    clickToDisable: 'Click to disable push',
    headDesc: 'Receive Web Push when Claude requests approval.',
    error: 'Error',
  },

  share: {
    title: 'Share this instance',
    intro: 'Scan or copy the link to log in from another device',
    devHint: 'Page on dev proxy :{{win}}, share link points to real backend :{{real}} (use this on phone).',
    sectionLabel: 'Choose endpoint',
    refreshTooltip: 'Refresh endpoints',
    loading: 'Loading endpoints…',
    loadError: 'Failed to load endpoints',
    endpointListAria: 'Available endpoints',
    qrEmpty: 'Pick an endpoint to generate a QR code',
    urlAriaLabel: 'Instance URL',
    revealTooltip: 'Show token',
    hideTooltip: 'Hide token',
    copyTooltip: 'Copy full URL (with token)',
    copyAriaLabel: 'Copy full URL',
    hint:
      'Token is embedded in the URL — no need to re-enter after scanning / opening.\nSwitch endpoints to generate QR for different networks (LAN / Tailscale / loopback).',
    kindLan: 'LAN',
    kindTailscale: 'Tailscale',
    kindLoopback: 'Loopback',
    kindIpv6: 'IPv6',
    kindOther: 'Other',
  },

  ipChange: {
    title: 'Server IP changed',
    body: '{{old}} → {{new}}',
    dismiss: 'Close',
    copy: 'Copy link',
    copied: 'Copied',
  },

  input: {
    placeholder: 'Type a command, Enter to send',
    placeholderDisabled: 'Disconnected…',
    sendTooltip: 'Send (Enter)',
    scrollLeft: 'Scroll left',
    scrollRight: 'Scroll right',
    showButtonList: 'Show button list',
    clearConfirmTitle: 'Clear input',
    clearConfirmBody: 'Clear the current input? This cannot be undone.',
    adaptSize: 'Adapt to this device',
    adaptSizeTooltip: 'Force PTY to wrap at this device\'s width (take over when multiple clients are connected)',
  },

  createInstance: {
    title: 'Create instance',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. backend',
    workdirLabel: 'Working directory',
    workdirPlaceholder: '/abs/path',
    submit: 'Create',
    submitting: 'Creating…',
    cancel: 'Cancel',
  },

  scrollToBottom: {
    label: 'Back to bottom',
  },
  scrollToTop: {
    label: 'Back to top',
  },

  search: {
    aria: 'Search terminal buffer',
    placeholder: 'Search… (Enter / Shift+Enter)',
    next: 'Next match',
    prev: 'Previous match',
    close: 'Close (Esc)',
  },

  pwa: {
    installTitle: 'Install ATR',
    installBody: 'Add to home screen for a fullscreen, app-like experience.',
    installAction: 'Install',
    updateReady: 'New version ready',
    updateApply: 'Reload',
  },
};
