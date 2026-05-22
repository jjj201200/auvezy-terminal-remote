/**
 * remarkObsidianCallout + CalloutBlock — Obsidian 13 类 callout 渲染
 *
 * 把首段以 `[!type](+|-)?\s*title` 开头的 blockquote 升级为自定义 `obs-callout` 节点。
 * enabled=false 时不识别(回退到 react-markdown 默认 blockquote)。
 *
 * 此实现替换原 MarkdownPreview 内 5 类 GFM Alert(callout 是其超集),
 * 详见 docs/plans/obsidian-integration/design.md §6.3.2。
 *
 * 节点结构:
 *   { type: 'paragraph', data: { hName: 'obs-callout', hProperties: { kind, collapse, title } },
 *     children: [...blockquote 内容(已剥掉首段头部标记)] }
 */

import { type JSX, type ReactNode } from 'react';
import type { Plugin } from 'unified';
import type { Root, Blockquote, Paragraph, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { useT } from '../../../../i18n/i18n-context.js';
import {
  resolveCalloutKind,
  CALLOUT_META,
  type CalloutKind,
  type CalloutTone,
} from './callout-types.js';
import s from './callout.module.scss';

/** 首行匹配 `[!type](+|-)?\s*<custom title>` */
const CALLOUT_HEADER_RE = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/i;

export interface RemarkObsidianCalloutOptions {
  enabled: boolean;
}

export const remarkObsidianCallout: Plugin<[RemarkObsidianCalloutOptions], Root> = (opts) => {
  return (tree) => {
    if (!opts.enabled) return;
    visit(tree, 'blockquote', (node: Blockquote, index, parent) => {
      if (!parent || index == null) return;
      const first = node.children[0];
      if (!first || first.type !== 'paragraph') return;
      const firstChild = (first as Paragraph).children[0];
      if (!firstChild || firstChild.type !== 'text') return;

      const text = (firstChild as Text).value;
      const lines = text.split('\n');
      const head = lines[0] ?? '';
      const m = CALLOUT_HEADER_RE.exec(head);
      if (!m) return;

      const kind = resolveCalloutKind(m[1]!);
      if (!kind) return; // 未知类型 → 不动,留作普通 blockquote

      const collapseMode: 'none' | 'open' | 'closed' =
        m[2] === '+' ? 'open' : m[2] === '-' ? 'closed' : 'none';
      const customTitle = m[3]?.trim() ?? '';

      // 把首段第一个 text 节点的"标记行"剥掉
      const restFirstLine = lines.slice(1).join('\n');
      if (restFirstLine.length > 0) {
        (firstChild as Text).value = restFirstLine;
      } else if ((first as Paragraph).children.length > 1) {
        // 首 child 标记行剥完是空 → 删它,保留兄弟节点(emphasis 等)
        (first as Paragraph).children.shift();
      } else {
        // 整个 paragraph 只有头部一行 → 删 paragraph
        node.children.shift();
      }

      // 替换为 obs-callout 自定义节点(用 hProperties 传递元数据给 components)
      const replacement = {
        type: 'paragraph',
        data: {
          hName: 'obs-callout',
          hProperties: {
            kind,
            collapse: collapseMode,
            title: customTitle,
          },
        },
        // children 直接复用 blockquote 已经剥掉头部的内容
        children: node.children as unknown as Paragraph['children'],
      } as Root['children'][number];

      parent.children[index] = replacement;
    });
  };
};

// ─── 渲染组件 ─────────────────────────────────────────────────────────

export interface CalloutBlockProps {
  kind?: CalloutKind;
  collapse?: 'none' | 'open' | 'closed';
  title?: string;
  children?: ReactNode;
}

export function CalloutBlock({
  kind,
  collapse = 'none',
  title,
  children,
}: CalloutBlockProps): JSX.Element {
  const t = useT();

  if (!kind) {
    // 没 kind 时(plugin 透传失败的兜底)直接渲染普通 blockquote
    return <blockquote>{children}</blockquote>;
  }

  const meta = CALLOUT_META[kind];
  const displayTitle = title && title.length > 0 ? title : t(meta.i18nKey);
  const tone: CalloutTone = meta.tone;
  const cls = `${s.callout} callout`;

  if (collapse === 'none') {
    return (
      <aside className={cls} data-kind={kind} data-tone={tone}>
        <header className={s.title}>{displayTitle}</header>
        <div className={s.body}>{children}</div>
      </aside>
    );
  }
  return (
    <details
      className={cls}
      data-kind={kind}
      data-tone={tone}
      open={collapse === 'open'}
    >
      <summary className={s.title}>{displayTitle}</summary>
      <div className={s.body}>{children}</div>
    </details>
  );
}
