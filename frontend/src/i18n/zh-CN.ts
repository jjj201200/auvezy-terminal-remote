/**
 * 简体中文文案表
 */

import type { Messages } from './messages.js';

export const zhCN: Messages = {
  common: {
    save: '保存',
    cancel: '取消',
    close: '关闭',
    delete: '删除',
    edit: '编辑',
    confirm: '确认',
    reset: '重置',
    refresh: '刷新',
    loading: '加载中',
    yes: '是',
    no: '否',
    auto: '自动',
    custom: '自定义',
  },

  app: {
    loading: '加载中',
  },

  authPage: {
    title: '认证',
    subtitle: '输入服务器启动时显示的 token。',
    fieldLabel: 'Access token',
    placeholder: '64-char hex',
    submit: '登录',
    submitting: '验证中…',
    hint: '扫描终端二维码或粘贴启动时显示的 token。token 仅保存在本设备。',
  },

  topBar: {
    settings: '设置',
    settingsTooltip: '设置',
    share: '分享此实例',
    shareTooltip: '分享此实例（含二维码）',
    instances: '实例',
    createInstance: '新建实例',
    switchInstance: '切换实例',
  },

  console: {
    startingTitle: '正在启动终端',
    startingBody:
      '浏览器已连接，PTY 子进程正在启动…\n若长时间无响应，请回到 otr 终端按一下 Enter。',
    awaitingTitle: '等待终端输出',
    awaitingBody:
      'PTY 已启动但暂无输出。如果使用了 --wait-confirm，请回到 otr 终端按一下 Enter。',
  },

  status: {
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
    disconnectedReconnect: 'Disconnected · 重连',
    reconnecting: 'Reconnecting…',
    reconnect: '重连',
    reconnectTooltip: '立即重新连接',
    idle: 'Idle',
    running: 'Running',
    ptyPending: 'Pending',
    waitingInput: 'Awaiting approval',
    startingTerminal: '正在启动终端…',
  },

  settings: {
    title: '设置',
    saveError: '保存失败，请稍后重试',
    tab: {
      shortcuts: '快捷键',
      commands: '命令',
      display: '显示',
      general: '常规',
      notifications: '通知',
    },
    saving: '保存中…',
  },

  display: {
    previewTitle: '预览',
    previewHint: '按当前 cols 与 letter-spacing 渲染。预览框宽度可能与终端不同，仅作视觉密度参考。',
    previewMeta: 'Font {{size}}px · Spacing {{ls}}px · Cols {{cols}}',
    targetColsTitle: '目标列数（target cols）',
    targetColsHint: '按容器宽度反推 font-size，目标每行字符数。手机窄屏推荐 80。',
    autoLabel: 'Auto',
    customPlaceholder: 'Custom',
    autoTooltip: '关闭自适应，使用默认 font-size',
    customAriaLabel: '自定义 cols',
    letterSpacingTitle: 'Letter spacing',
    letterSpacingHint: '等宽字符之间的额外像素。负值压缩、正值拉宽，0 为默认。',
    letterSpacingAriaLabel: 'Letter spacing',
    letterSpacingValue: '{{val}} px',
    resetTooltip: '重置为 0',
    colsModeAuto: 'auto',
    colsModeTarget: 'target {{cols}}',
  },

  general: {
    languageTitle: '语言',
    languageHint: '界面语言。仅保存于本设备。',
  },

  list: {
    enableAll: '全部启用',
    disableAll: '全部禁用',
    add: '新增',
  },

  shortcuts: {
    addBtn: '新增快捷键',
    nameLabel: 'Label',
    namePlaceholder: 'Label',
    dataPlaceholder: '\\e \\r \\xHH …',
    dataLabel: 'Data',
    descLabel: '描述',
    descPlaceholder: '可选，按钮 title 与设置面板均会展示',
    enabledLabel: '启用',
    unnamed: '未命名',
    empty: 'empty',
    emptyList: '暂无快捷键（可拖入）',
    deleteTooltip: '删除',
    editTooltip: '编辑',
    saveTooltip: '保存',
    cancelTooltip: '取消',
    dragHandleTooltip: '拖动以重新排序 / 跨分组移动',
    listAriaLabel: '快捷键列表',
    groupListAriaLabel: '分组列表',
  },

  commands: {
    addBtn: '新增命令',
    nameLabel: 'Label',
    namePlaceholder: 'Label',
    commandPlaceholder: 'Command text (例：/clear)',
    descPlaceholder: '可选，按钮 title 与设置面板均会展示',
    autoSendLabel: 'Auto-send',
    autoSendHint: '开：直接发送；关：填到输入框等待编辑。',
    unnamed: '未命名',
    empty: 'empty',
    emptyList: '暂无命令（可拖入）',
    deleteTooltip: '删除',
    editTooltip: '编辑',
    saveTooltip: '保存',
    cancelTooltip: '取消',
    dragHandleTooltip: '拖动以重新排序 / 跨分组移动',
  },

  toolbar: {
    pickGroup: '选择一个分类',
    groupEmpty: '该分组暂无启用项',
    customGroup: '自定义',
  },

  instance: {
    create: '创建实例',
    instancesAriaLabel: '实例切换',
    sheetTitle: '实例',
    workdirLabel: 'cwd',
    workdirHelper: '/home/me/code/foo',
    nameLabelOptional: '实例名（可选）',
    namePlaceholder: '留空则用 cwd basename',
    submit: '创建',
    submitting: '创建中…',
    errorEmptyCwd: 'cwd 不能为空',
    errorCreateFailed: '创建失败：请检查 cwd 是否存在',
  },

  push: {
    title: 'Push 通知',
    enable: '启用',
    disable: '禁用',
    enabling: '启用中…',
    disabling: '禁用中…',
    statusOn: '已开启',
    statusOff: '未开启',
    statusDenied: '已禁',
    needHttps: '需 HTTPS',
    notSupported: '不支持',
    notSupportedHint: '当前浏览器缺少 ServiceWorker / PushManager API',
    needHttpsHint: '当前是 HTTP 连接，浏览器禁用 Web Push；请用 HTTPS 或 localhost 访问',
    deniedHint: '通知权限被禁，请在系统设置中开启',
    permissionDenied: '已拒绝',
    busy: '处理中…',
    clickToEnable: '点击开启推送',
    clickToDisable: '点击关闭推送',
    headDesc: 'Claude 触发审批时通过 Web Push 通知到本设备',
    error: '错误',
  },

  share: {
    title: '分享此实例',
    intro: '扫码或复制链接，让其它设备直接登录此实例',
    devHint: '当前页面在 dev proxy :{{win}}，分享链接指向 backend :{{real}}（手机扫码用这个）。',
    sectionLabel: '选择入口',
    refreshTooltip: '刷新入口列表',
    loading: '加载入口…',
    loadError: '加载入口失败',
    endpointListAria: '可用入口',
    qrEmpty: '选择入口后生成二维码',
    urlAriaLabel: '实例链接',
    revealTooltip: '显示 token',
    hideTooltip: '隐藏 token',
    copyTooltip: '复制完整链接（含 token）',
    copyAriaLabel: '复制完整链接',
    hint: 'token 自带于链接中，扫码 / 打开后无需再次输入。\n切换入口可针对不同网络（LAN / Tailscale / Loopback）生成对应二维码。',
    kindLan: 'LAN',
    kindTailscale: 'Tailscale',
    kindLoopback: 'Loopback',
    kindIpv6: 'IPv6',
    kindOther: 'Other',
  },

  ipChange: {
    title: '服务端 IP 已变化',
    body: '{{old}} → {{new}}',
    dismiss: '关闭',
    copy: '复制链接',
    copied: '已复制',
  },

  input: {
    placeholder: '输入命令，按 Enter 发送',
    placeholderDisabled: 'Disconnected…',
    sendTooltip: '发送（Enter）',
    scrollLeft: '向左滚动',
    scrollRight: '向右滚动',
    showButtonList: '显示按钮列表',
  },

  createInstance: {
    title: '新建实例',
    nameLabel: '名称',
    namePlaceholder: '如 backend',
    workdirLabel: '工作目录',
    workdirPlaceholder: '/绝对/路径',
    submit: '创建',
    submitting: '创建中…',
    cancel: '取消',
  },

  scrollToBottom: {
    label: '返回底部',
  },

  search: {
    aria: '在终端缓冲区搜索',
    placeholder: '搜索… (Enter / Shift+Enter)',
    next: '下一处',
    prev: '上一处',
    close: '关闭 (Esc)',
  },
};
