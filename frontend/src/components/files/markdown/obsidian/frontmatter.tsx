/**
 * FrontmatterTable — YAML frontmatter 渲染为 Obsidian Properties 风格表
 *
 * 数据流:raw YAML 字符串 → js-yaml.load → 类型推断 → 行渲染
 * 失败时显示一行错误 + 原文(不丢内容)。
 *
 * 类型推断对齐 Obsidian:string / number / checkbox / date / list / link 6 种 +
 * text fallback;tags / aliases / cssclass(es) 三个特殊 key 强制 array
 * (即使值是 string)。
 *
 * Why js-yaml 不指定 schema:v4 起 `load()` 默认即 safe schema,不再支持
 * `!!js/function` 等可执行类型(详见 design.md §9)。
 */

import { useMemo, useState, type JSX } from 'react';
import yaml from 'js-yaml';
import { useT } from '../../../../i18n/i18n-context.js';
import s from './frontmatter.module.scss';

export interface FrontmatterTableProps {
  /** ---YAML--- 之间的原始 YAML 字符串(不含分隔符) */
  raw: string;
}

export type PropKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'link';

export interface PropTypeInfo {
  kind: PropKind;
}

/** ISO 8601 date 或 datetime 字符串 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** 形如 `[[Note]]` / `[[Note|alias]]` / `[[Note#Heading]]` 的 wikilink */
const WIKILINK_RE = /^\s*\[\[[^\]]+\]\]\s*$/;
/** 即使值是 string 也强制视为 array 的特殊 key(对齐 Obsidian) */
const FORCE_ARRAY_KEYS = new Set(['tags', 'aliases', 'cssclass', 'cssclasses']);

export function inferType(v: unknown): PropTypeInfo {
  if (Array.isArray(v)) return { kind: 'list' };
  if (typeof v === 'number') return { kind: 'number' };
  if (typeof v === 'boolean') return { kind: 'checkbox' };
  if (v instanceof Date) return { kind: 'date' };
  if (typeof v === 'string') {
    if (ISO_DATE_RE.test(v)) return { kind: 'date' };
    if (WIKILINK_RE.test(v)) return { kind: 'link' };
    return { kind: 'text' };
  }
  return { kind: 'text' };
}

const KIND_ICON: Record<PropKind, string> = {
  text: 'A',
  number: '#',
  checkbox: '☑',
  date: '📅',
  list: '#',
  link: '🔗',
};

interface ParseResult {
  ok: true;
  data: Record<string, unknown>;
}

interface ParseError {
  ok: false;
  err: string;
}

function parseYaml(raw: string): ParseResult | ParseError {
  let v: unknown;
  try {
    v = yaml.load(raw);
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
  if (v == null) return { ok: true, data: {} };
  // 顶层必须是 mapping(对象)。Obsidian frontmatter 不接受顶层数组 / 字符串
  if (typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, err: 'YAML root is not a mapping' };
  }
  return { ok: true, data: v as Record<string, unknown> };
}

export function FrontmatterTable({ raw }: FrontmatterTableProps): JSX.Element {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);

  const parsed = useMemo(() => parseYaml(raw), [raw]);

  if (!parsed.ok) {
    return (
      <aside className={s.error} role="alert">
        <strong>{t('obsidian.frontmatterParseError')}</strong>
        <pre className={s.errorMsg}>{parsed.err}</pre>
      </aside>
    );
  }

  const entries = Object.entries(parsed.data);
  if (entries.length === 0) {
    return <aside className={s.empty}>{t('obsidian.frontmatterEmpty')}</aside>;
  }

  return (
    <aside className={s.table} data-collapsed={collapsed ? 'true' : 'false'}>
      <header className={s.header}>
        <button
          type="button"
          className={s.toggle}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className={s.chev}>{collapsed ? '▶' : '▼'}</span>
          <span className={s.title}>{t('obsidian.frontmatterTitle')}</span>
          <span className={s.count}>
            {t('obsidian.frontmatterCount').replace('{n}', String(entries.length))}
          </span>
        </button>
      </header>
      {!collapsed && (
        <ul className={s.rows}>
          {entries.map(([key, val]) => {
            // tags / aliases / cssclass 三个特殊 key 即使值是 string 也按 array 处理
            const v = FORCE_ARRAY_KEYS.has(key) && !Array.isArray(val) ? [val] : val;
            const info = inferType(v);
            return (
              <li key={key} className={s.row} data-kind={info.kind}>
                <span className={s.kindIcon} aria-hidden="true">
                  {KIND_ICON[info.kind]}
                </span>
                <span className={s.key}>{key}</span>
                <span className={s.val}>{renderValue(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function renderValue(v: unknown): JSX.Element {
  if (Array.isArray(v)) {
    return (
      <span className={s.chips}>
        {v.map((item, i) => (
          <span key={i} className={s.chip}>
            {typeof item === 'string' ? item : JSON.stringify(item)}
          </span>
        ))}
      </span>
    );
  }
  if (typeof v === 'boolean') return <>{v ? '✓' : '✗'}</>;
  if (v instanceof Date) return <>{v.toLocaleDateString()}</>;
  if (v == null) return <span className={s.nullVal}>—</span>;
  return <>{String(v)}</>;
}
