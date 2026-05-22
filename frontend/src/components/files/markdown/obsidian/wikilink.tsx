/**
 * remarkObsidianLink — 识别 `[[Foo]]` / `[[Foo|alias]]` / `[[Foo#H2]]` / `[[Foo#^id]]`
 * 与 `![[...]]` 嵌入。
 *
 * 产出节点:
 *  - `obs-wikilink`(普通)→ WikilinkActive(可点击)或 WikilinkDisabled(子开关关时灰显)
 *  - `obs-embed`(`!` 前缀)→ S7 EmbedDispatch(分发 image/md/pdf/audio/video)
 *
 * 嵌入子开关关 → embed 显示占位框;wikilink 子开关关 → 仍识别为 wikilink,
 * 但渲染为虚线灰色(详见 design.md §6.3.3)。
 *
 * Plugin 总是 push(只要 obsidian 总开关开),子开关只控制 components 渲染分支
 * (而非是否 push plugin)— 这样 disabled 状态仍有视觉提示。
 */

import { useEffect, useState, type JSX, type MouseEvent } from 'react';
import type { Plugin } from 'unified';
import type { Root, Text, Paragraph, PhrasingContent } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { useFilePreviewPresenter } from '../../../ui/modal-stack/presenters.js';
import { useT } from '../../../../i18n/i18n-context.js';
import { resolveLink, type WikilinkResult } from './resolve-link.js';
import { setPendingAnchor } from './anchor-bus.js';
import s from './wikilink.module.scss';

/** `!?[[target(#frag)?(|alias)?]]` */
const WIKILINK_RE = /(!?)\[\[([^\[\]\|#]+)(#[^\[\]\|]+)?(?:\|([^\[\]]+))?\]\]/g;

const PHRASING_PARENT_TYPES = new Set([
  'paragraph',
  'listItem',
  'blockquote',
  'tableCell',
  'heading',
]);

export interface RemarkObsidianLinkOptions {
  /** 总开关 = obsidian.enabled。子开关在渲染层判,这里只决定要不要识别语法。 */
  enabled: boolean;
}

export const remarkObsidianLink: Plugin<[RemarkObsidianLinkOptions], Root> = (opts) => {
  return (tree) => {
    if (!opts.enabled) return;

    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return;
      const parentType = (parent as { type: string }).type;
      if (!PHRASING_PARENT_TYPES.has(parentType)) return;

      const value = node.value;
      interface Hit {
        start: number;
        end: number;
        isEmbed: boolean;
        target: string;
        alias?: string;
      }
      const hits: Hit[] = [];
      for (const m of value.matchAll(WIKILINK_RE)) {
        // target 含 fragment(`#H2` / `#^id`)— backend resolver 会切;
        // 这里保留 fragment 给 resolver 决定 anchor
        const target = (m[2] ?? '') + (m[3] ?? '');
        hits.push({
          start: m.index!,
          end: m.index! + m[0].length,
          isEmbed: m[1] === '!',
          target,
          ...(m[4] ? { alias: m[4] } : {}),
        });
      }
      if (hits.length === 0) return;

      const replacements: PhrasingContent[] = [];
      let cursor = 0;
      for (const h of hits) {
        if (h.start > cursor) {
          replacements.push({ type: 'text', value: value.slice(cursor, h.start) } as Text);
        }
        const hProperties: Record<string, string> = { target: h.target };
        if (h.alias) hProperties['alias'] = h.alias;
        replacements.push({
          type: 'emphasis',
          data: {
            hName: h.isEmbed ? 'obs-embed' : 'obs-wikilink',
            hProperties,
          },
          children: [],
        } as PhrasingContent);
        cursor = h.end;
      }
      if (cursor < value.length) {
        replacements.push({ type: 'text', value: value.slice(cursor) } as Text);
      }
      (parent as Paragraph).children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });
  };
};

// ─── 渲染组件 ──────────────────────────────────────────────────

function stripFragment(t: string): string {
  const i = t.indexOf('#');
  return i < 0 ? t : t.slice(0, i);
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export interface WikilinkDisabledProps {
  target: string;
  alias?: string;
}

/** 子开关关闭时的虚线灰色样式 — 不发请求,不可点击 */
export function WikilinkDisabled({ target, alias }: WikilinkDisabledProps): JSX.Element {
  const t = useT();
  return (
    <span className={s.disabled} title={t('obsidian.wikilinkDisabledHint')}>
      {alias ?? stripFragment(target)}
    </span>
  );
}

export interface WikilinkActiveProps {
  instanceId: string;
  from: string;
  target: string;
  alias?: string;
}

/** 子开关开时:发请求解析 → 蓝色链接 / 红色 broken / ambiguous tooltip */
export function WikilinkActive({
  instanceId,
  from,
  target,
  alias,
}: WikilinkActiveProps): JSX.Element {
  const t = useT();
  const presentPreview = useFilePreviewPresenter();
  const [result, setResult] = useState<WikilinkResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveLink(instanceId, from, target).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, from, target]);

  const display = alias ?? stripFragment(target);

  if (!result) {
    return <span className={s.pending}>{display}</span>;
  }
  if (result.broken) {
    return (
      <span className={s.broken} title={t('obsidian.wikilinkBroken')}>
        {display}
      </span>
    );
  }
  const title =
    result.candidates && result.candidates.length > 1
      ? t('obsidian.wikilinkAmbiguous').replace('{n}', String(result.candidates.length))
      : undefined;

  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    if (!result.resolved) return;
    if (result.fragment) {
      setPendingAnchor(instanceId, result.resolved, result.fragment);
    }
    presentPreview({
      instanceId,
      target: {
        kind: 'text',
        path: result.resolved,
        name: basenameOf(result.resolved),
      },
    });
  };

  return (
    <a href="#" className={s.active} title={title} onClick={onClick}>
      {display}
    </a>
  );
}
