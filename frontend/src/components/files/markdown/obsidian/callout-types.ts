/**
 * Obsidian callout 13 类 + 别名表
 *
 * 大小写不敏感:解析时 type 字符串先 toLowerCase 再查表。别名(如 `tldr` →
 * `abstract`)在 ALIASES 中映射到主 kind。
 *
 * 颜色 tone 用项目既有 token:--color-info / --color-success / --color-warn /
 * --color-alarm / --color-text-muted。memory 提示:不存在 `--color-danger`,
 * alarm tone 用 `--color-alarm`。
 *
 * 设计:tone 只 5 档(info/success/warn/alarm/muted)而非 13 种独立配色,
 * 让"信息密度"语义高于"色相多样"——5 档跨平台 / 跨主题易识别。
 */

export type CalloutKind =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'success'
  | 'question'
  | 'warning'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote';

export const ALL_CALLOUT_KINDS: readonly CalloutKind[] = [
  'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
] as const;

/** 别名 → 主 kind(来源:Obsidian 官方文档) */
export const CALLOUT_ALIASES: Readonly<Record<string, CalloutKind>> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

export type CalloutTone = 'info' | 'success' | 'warn' | 'alarm' | 'muted';

export interface CalloutMeta {
  /** i18n key,见 `obsidian.calloutXxx` */
  i18nKey: string;
  /** SCSS `[data-tone]` 选择器值 */
  tone: CalloutTone;
}

export const CALLOUT_META: Readonly<Record<CalloutKind, CalloutMeta>> = {
  note:     { i18nKey: 'obsidian.calloutNote',     tone: 'info' },
  abstract: { i18nKey: 'obsidian.calloutAbstract', tone: 'info' },
  info:     { i18nKey: 'obsidian.calloutInfo',     tone: 'info' },
  todo:     { i18nKey: 'obsidian.calloutTodo',     tone: 'info' },
  tip:      { i18nKey: 'obsidian.calloutTip',      tone: 'success' },
  success:  { i18nKey: 'obsidian.calloutSuccess',  tone: 'success' },
  question: { i18nKey: 'obsidian.calloutQuestion', tone: 'warn' },
  warning:  { i18nKey: 'obsidian.calloutWarning',  tone: 'warn' },
  failure:  { i18nKey: 'obsidian.calloutFailure',  tone: 'alarm' },
  danger:   { i18nKey: 'obsidian.calloutDanger',   tone: 'alarm' },
  bug:      { i18nKey: 'obsidian.calloutBug',      tone: 'alarm' },
  example:  { i18nKey: 'obsidian.calloutExample',  tone: 'info' },
  quote:    { i18nKey: 'obsidian.calloutQuote',    tone: 'muted' },
};

/** type 字符串 → kind(应用别名 + 大小写归一);未知返回 null */
export function resolveCalloutKind(raw: string): CalloutKind | null {
  const k = raw.trim().toLowerCase();
  if ((ALL_CALLOUT_KINDS as readonly string[]).includes(k)) {
    return k as CalloutKind;
  }
  return CALLOUT_ALIASES[k] ?? null;
}
