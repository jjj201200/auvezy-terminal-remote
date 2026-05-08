/**
 * i18n 消息表（en / zh-CN 共享 key）
 *
 * 设计原则：
 *  - key 用 dot.case 分组：authPage.* / settings.display.* / share.* …
 *  - 字符串里 {{var}} 模板插值，由 useT(key, vars) 替换
 *  - 没有复数 / 没有日期格式化（LAN 自用工具用不到 ICU 那一套）
 *  - 缺 key 时返回 key 本身作 fallback（开发期一眼能看到漏译）
 *
 * 加新 key：
 *  1. 在 Messages 类型里加字段（保证 type-safe）
 *  2. 在 en.ts / zh-CN.ts 都填值
 *  3. 组件里 const t = useT(); t('newKey')
 */

export type Locale = 'en' | 'zh-CN';

export const SUPPORTED_LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
];

export const DEFAULT_LOCALE: Locale = 'en';

/** 全部 i18n key 的字面量类型 —— 加 key 必须先在这里声明 */
export interface Messages {
  // 通用
  common: {
    save: string;
    cancel: string;
    close: string;
    delete: string;
    edit: string;
    confirm: string;
    reset: string;
    refresh: string;
    loading: string;
    yes: string;
    no: string;
    auto: string;
    custom: string;
    clear: string;
  };

  // 加载页 / 通用状态
  app: {
    loading: string;
  };

  // 认证页
  authPage: {
    title: string;
    subtitle: string;
    fieldLabel: string;
    placeholder: string;
    submit: string;
    submitting: string;
    hint: string;
    back: string;
    // 扫码登录
    scanCta: string;
    scanLabel: string;
    scanSubtitle: string;
    scanCancel: string;
    scanInitializing: string;
    scanPermissionDenied: string;
    scanUnsupported: string;
    scanError: string;
    scanInvalidQr: string;
    // 链接登录
    urlCta: string;
    urlLabel: string;
    urlPlaceholder: string;
    urlSubmit: string;
    urlInvalid: string;
  };

  // 顶栏
  topBar: {
    settings: string;
    settingsTooltip: string;
    share: string;
    shareTooltip: string;
    instances: string;
    createInstance: string;
    switchInstance: string;
  };

  // 终端覆盖层（启动 / 空载提示）
  console: {
    startingTitle: string;
    startingBody: string; // 含两行
    awaitingTitle: string;
    awaitingBody: string; // 模板 {{flag}} 是 --wait-confirm
  };

  // 状态栏
  status: {
    connecting: string;
    connected: string;
    disconnected: string;
    disconnectedReconnect: string;
    gaveUp: string;
    gaveUpReconnect: string;
    reconnecting: string;
    reconnect: string;
    reconnectTooltip: string;
    idle: string;
    running: string;
    ptyPending: string;
    waitingInput: string;
    startingTerminal: string;
    // 状态点击弹出说明 modal 用
    connectionDialogTitle: string;
    sessionDialogTitle: string;
    descConnecting: string;
    descConnected: string;
    descDisconnected: string;
    descGaveUp: string;
    descPtyPending: string;
    descIdle: string;
    descRunning: string;
    descWaitingInput: string;
  };

  // 设置面板
  settings: {
    title: string;
    saveError: string;
    tab: {
      general: string;
      actions: string;
      display: string;
      notifications: string;
      network: string;
      dev: string;
      about: string;
    };
    saving: string;
  };

  // 设置 - 显示
  display: {
    previewTitle: string;
    previewHint: string;
    previewMeta: string; // 模板：字号 {{size}}px · 间距 {{ls}}px · 列数 {{cols}}
    targetColsTitle: string;
    targetColsHint: string;
    autoLabel: string;
    customPlaceholder: string;
    autoTooltip: string;
    customAriaLabel: string;
    letterSpacingTitle: string;
    letterSpacingHint: string;
    letterSpacingAriaLabel: string;
    letterSpacingValue: string; // {{val}} px
    resetTooltip: string;
    colsModeAuto: string;
    colsModeTarget: string; // 目标 {{cols}} / target {{cols}}
    themeTitle: string;
    themeHint: string;
    // 7 个 Claude Code 主题名（与 /theme 命令对齐）
    themeDark: string;
    themeLight: string;
    themeDarkAnsi: string;
    themeLightAnsi: string;
    themeDarkDaltonized: string;
    themeLightDaltonized: string;
    themeAuto: string;
  };

  // 设置 - 通用（语言切换）
  general: {
    languageTitle: string;
    languageHint: string;
  };

  // 设置 - 操作（输入 / 快捷键 / 命令汇总）
  actions: {
    /** 操作 tab 内三个 section 各自的 H2 标题 */
    sectionControls: string;
    sectionShortcuts: string;
    sectionCommands: string;

    inputModeTitle: string;
    inputModeHint: string;
    inputModeUseBar: string;
    inputModeDirect: string;

    tuiScrollTitle: string;
    tuiScrollHint: string;
    tuiScrollOn: string;
    tuiScrollOff: string;

    tuiTapTitle: string;
    tuiTapHint: string;
    tuiTapOn: string;
    tuiTapOff: string;

    scrollLinesTitle: string;
    scrollLinesHint: string;
    scrollLinesUnitLine: string;
    scrollLinesHalf: string;
    scrollLinesFull: string;
  };

  // 设置 - 网络
  network: {
    reconnectMaxTitle: string;
    reconnectMaxHint: string;
    reconnectMaxAriaLabel: string;
    reconnectMaxUnit: string;
  };

  // 设置 - 开发者
  dev: {
    erudaTitle: string;
    erudaHint: string;
    erudaToggleOn: string;
    erudaToggleOff: string;
    reloadHint: string;
    consoleBridgeTitle: string;
    consoleBridgeHint: string;
    consoleBridgeOn: string;
    consoleBridgeOff: string;
  };

  // 设置 - 关于
  about: {
    tagline: string;
    versionLabel: string;
    versionTooltip: string;
    descTitle: string;
    descBody: string;
    featuresTitle: string;
    featurePty: string;
    featureMultiInstance: string;
    featureAuth: string;
    featurePush: string;
    featureMobile: string;
    notesTitle: string;
    notePersistent: string;
    noteLanOnly: string;
    noteMasterResize: string;
    noteVirtualNic: string;
    linksTitle: string;
    repoGithubLabel: string;
    repoGiteeLabel: string;
    issuesGithubLabel: string;
    issuesGiteeLabel: string;
    npmLabel: string;
    licenseTitle: string;
    licenseBody: string;
  };

  // 通用列表操作
  list: {
    enableAll: string;
    disableAll: string;
    add: string;
  };

  // 设置 - 快捷键
  shortcuts: {
    addBtn: string;
    nameLabel: string;
    namePlaceholder: string;
    dataPlaceholder: string;
    dataLabel: string;
    descLabel: string;
    descPlaceholder: string;
    enabledLabel: string;
    unnamed: string;
    empty: string; // '空'
    emptyList: string; // '暂无快捷键（可拖入）'
    deleteTooltip: string;
    editTooltip: string;
    saveTooltip: string;
    cancelTooltip: string;
    dragHandleTooltip: string;
    listAriaLabel: string;
    groupListAriaLabel: string;
  };

  // 设置 - 命令
  commands: {
    addBtn: string;
    nameLabel: string;
    namePlaceholder: string;
    commandPlaceholder: string;
    descPlaceholder: string;
    autoSendLabel: string;
    autoSendHint: string;
    unnamed: string;
    empty: string;
    emptyList: string; // 暂无命令（可拖入）
    deleteTooltip: string;
    editTooltip: string;
    saveTooltip: string;
    cancelTooltip: string;
    dragHandleTooltip: string;
  };

  // Toolbar
  toolbar: {
    pickGroup: string;
    groupEmpty: string;
    customGroup: string;
  };

  // 实例
  instance: {
    create: string;
    instancesAriaLabel: string;
    sheetTitle: string;
    workdirLabel: string;
    workdirHelper: string;
    nameLabelOptional: string;
    namePlaceholder: string;
    submit: string;
    submitting: string;
    errorEmptyCwd: string;
    errorCreateFailed: string;
    pendingTooltip: string;
    pendingFailed: string;
    pendingNameless: string;
    pendingRetry: string;
    pendingDismiss: string;
    disconnect: string;
    reconnect: string;
    disconnectedTitle: string;
    disconnectedBody: string;
    closeOrDisconnectTitle: string;
    closeOrDisconnectBody: string;
    recentTitle: string;
    recentRemove: string;
    recentEmpty: string;
    close: string;
    closeFailed: string;
    closeFailedTitle: string;
    closeConfirmTitle: string;
    closeConfirm: string; // {{name}} 实例名
    closeCurrentBlocked: string;
    closeCurrentLastTitle: string;
    closeCurrentLast: string;
    closeCurrentConfirmTitle: string;
    closeCurrentConfirm: string; // {{name}}
    pendingFailedTitle: string;
    // 详情 modal（移动端实例切换器点卡片弹）
    detailTitle: string;
    detailNameLabel: string;
    detailCwdLabel: string;
    detailHostLabel: string;
    detailPortLabel: string;
    detailSwitch: string;
    detailSwitchAlready: string;
    /** 标题栏右上角的长期提示："字段值都可点击复制" */
    detailCopyHint: string;
    /** 用户点字段后字段下方/原地短暂浮现的成功提示 */
    detailValueCopied: string;
    /** 复制失败（LAN HTTP 下无 clipboard API + execCommand 也失败） */
    detailCopyFailed: string;
    /** iOS + LAN HTTP 场景：clipboard API 不可用，整页提示改成"点字段会自动选中文本，长按可复制" */
    detailSelectHint: string;
    /** iOS 场景下点击字段后字段右上角浮的"已选中"反馈 */
    detailValueSelected: string;
    switchAriaLabel: string; // 切换图标按钮 aria
    // —— 新增实例 Modal 的扫码 / 链接入口（语义：扫到/粘到合法的远端 atr URL → 跳转过去）
    /** 主表单底部"或"分隔线下方的两个备用入口的章节标签 */
    addRemoteTitle: string;
    /** 主表单底部"或"分隔线下方的两个备用入口的章节副标 */
    addRemoteHint: string;
    /** 扫码按钮 cta */
    scanCta: string;
    /** 链接按钮 cta */
    urlCta: string;
    /** 扫码 / URL 子页的取消按钮 */
    altCancel: string;
  };

  // 设置 - 通知（PushToggle）
  push: {
    title: string;
    enable: string;
    disable: string;
    enabling: string;
    disabling: string;
    statusOn: string;
    statusOff: string;
    statusDenied: string;
    needHttps: string;
    notSupported: string;
    notSupportedHint: string;
    needHttpsHint: string;
    deniedHint: string;
    permissionDenied: string;
    busy: string;
    clickToEnable: string;
    clickToDisable: string;
    headDesc: string;
    error: string;
  };

  // ShareSheet
  share: {
    title: string;
    intro: string;
    devHint: string; // 模板：dev 代理 :{{win}}，分享链接指向真后端 :{{real}}
    sectionLabel: string;
    refreshTooltip: string;
    loading: string;
    loadError: string;
    endpointListAria: string;
    qrEmpty: string;
    urlAriaLabel: string;
    revealTooltip: string;
    hideTooltip: string;
    copyTooltip: string;
    copyAriaLabel: string;
    hint: string;
    kindLan: string;
    kindTailscale: string;
    kindLoopback: string;
    kindIpv6: string;
    kindOther: string;
  };

  // IpChangeToast
  ipChange: {
    title: string;
    body: string; // {{old}} → {{new}}
    dismiss: string;
    copy: string;
    copied: string;
  };

  // InputBar / Toolbar
  input: {
    placeholder: string;
    placeholderDisabled: string;
    sendTooltip: string;
    scrollLeft: string;
    scrollRight: string;
    showButtonList: string;
    clearConfirmTitle: string;
    clearConfirmBody: string;
    adaptSize: string;
    adaptSizeTooltip: string;
  };

  // 滚动控制按钮
  scrollToBottom: {
    label: string;
  };
  scrollToTop: {
    label: string;
  };

  // 终端搜索
  search: {
    aria: string;
    placeholder: string;
    next: string;
    prev: string;
    close: string;
  };

  // PWA：安装 / 更新提示
  pwa: {
    installTitle: string;
    installBody: string;
    installAction: string;
    updateReady: string;
    updateApply: string;
  };
}

/** 模板变量替换：'a {{x}} b' + { x: 1 } → 'a 1 b' */
export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined ? `{{${k}}}` : String(v);
  });
}

/** 按 dot path 取嵌套值 */
export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}
