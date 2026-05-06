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
  },

  topBar: {
    settings: 'Settings',
    settingsTooltip: 'Settings',
    share: 'Share this instance',
    shareTooltip: 'Share this instance (with QR)',
    copy: 'Copy',
    copyTooltip: 'Copy selection (or visible viewport if no selection)',
    instances: 'Instances',
    createInstance: 'Create instance',
    switchInstance: 'Switch instance',
  },

  console: {
    startingTitle: 'Starting terminal',
    startingBody:
      'Browser connected, PTY child process starting…\nIf it stalls, press Enter in the otr terminal.',
    awaitingTitle: 'Awaiting terminal output',
    awaitingBody:
      'PTY started but no output yet. If you used --wait-confirm, press Enter in the otr terminal.',
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
  },

  network: {
    reconnectMaxTitle: 'Auto-reconnect attempts',
    reconnectMaxHint:
      'Stop auto-retrying after this many tries. Mobile data is consumed even when retries fail. Tap the reconnect badge to resume after the cap.',
    reconnectMaxAriaLabel: 'Max auto-reconnect attempts',
    reconnectMaxUnit: 'times',
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

  search: {
    aria: 'Search terminal buffer',
    placeholder: 'Search… (Enter / Shift+Enter)',
    next: 'Next match',
    prev: 'Previous match',
    close: 'Close (Esc)',
  },
};
