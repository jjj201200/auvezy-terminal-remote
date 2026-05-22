/**
 * remarkObsidianInline — 在 text 节点上切出 4 种 Obsidian inline 语法:
 *   ==highlight==   → <mark class="atr-obs-highlight">
 *   %%comment%%     → null(不渲染)
 *   #tag            → <span class="atr-obs-tag">
 *   ^block-id       → <span class="atr-obs-block-id" data-block-id="...">(锚点)
 *
 * 关闭子开关(enabled=false)时整 plugin no-op,原文保留(对齐 design.md §6.3.5)。
 *
 * 实现:每个 text 节点扫 4 个正则,按 hit 位置切片重组为节点序列。命中节点用
 * mdast `emphasis` 类型作载体(它是合法 phrasing children),通过 `data.hName`
 * 把渲染 tag 改写成自定义元素;text 子节点正常承载文本。
 *
 * Why hName + emphasis 而非自定义 node type:react-markdown 内部 mdast→hast
 * 阶段对未知 mdast type 直接 drop,而 emphasis 是已知 phrasing type,hast
 * 阶段保留并按 `data.hName` 重写 tag。这是 unified 社区惯例。
 *
 * 父节点白名单:只在段落级父(paragraph/listItem/blockquote/tableCell/heading)
 * 的直接 text 子上切分,跳过 link/code/emphasis/strong 等 inline 上下文 —
 * 这些里出现 ==/%%/#/^ 极大概率是字面意义,不应识别。
 */

import type { Plugin } from 'unified';
import type { Root, Text, Paragraph, PhrasingContent } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';

const HIGHLIGHT_RE = /==([^=]+)==/g;
const COMMENT_RE = /%%([^%]+)%%/g;
/** #tag:前面必须空白或行首;首字符必须 letter(不含数字),后续允许 \w/-。详见 design §6.3.5 */
const TAG_RE = /(^|\s)#([A-Za-z][\w/-]*)/g;
/** ^block-id:仅行尾;前面必须空白或行首,字符集 [a-z0-9-] 对齐 Obsidian */
const BLOCK_ID_RE = /(?:^|\s)\^([a-z0-9-]+)\s*$/;

const PHRASING_PARENT_TYPES = new Set([
  'paragraph',
  'listItem',
  'blockquote',
  'tableCell',
  'heading',
]);

export interface RemarkObsidianInlineOptions {
  enabled: boolean;
}

interface Hit {
  start: number;
  end: number;
  hName: 'obs-highlight' | 'obs-comment' | 'obs-tag' | 'obs-block-id';
  value: string;
}

export const remarkObsidianInline: Plugin<[RemarkObsidianInlineOptions], Root> = (opts) => {
  return (tree) => {
    if (!opts.enabled) return;

    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return;
      const parentType = (parent as { type: string }).type;
      if (!PHRASING_PARENT_TYPES.has(parentType)) return;

      const value = node.value;
      const hits: Hit[] = [];

      for (const m of value.matchAll(HIGHLIGHT_RE)) {
        hits.push({
          start: m.index!,
          end: m.index! + m[0].length,
          hName: 'obs-highlight',
          value: m[1]!,
        });
      }
      for (const m of value.matchAll(COMMENT_RE)) {
        hits.push({
          start: m.index!,
          end: m.index! + m[0].length,
          hName: 'obs-comment',
          value: m[1]!,
        });
      }
      for (const m of value.matchAll(TAG_RE)) {
        // m[1] 是前置空白(可能空 = 行首);hit 范围只覆盖 #tagname 不含前置空白
        const tagStart = m.index! + (m[1]?.length ?? 0);
        hits.push({
          start: tagStart,
          end: tagStart + 1 + m[2]!.length,
          hName: 'obs-tag',
          value: m[2]!,
        });
      }
      const blockMatch = BLOCK_ID_RE.exec(value);
      if (blockMatch) {
        // 前置空白可能 0 或 1 字符;只覆盖 ^id
        const lead = blockMatch[0]!.match(/^[ \t]/) ? 1 : 0;
        hits.push({
          start: blockMatch.index + lead,
          end: blockMatch.index + blockMatch[0].length,
          hName: 'obs-block-id',
          value: blockMatch[1]!,
        });
      }

      if (hits.length === 0) return;

      // 按起点排序,处理重叠(先到先得)
      hits.sort((a, b) => a.start - b.start);
      const replacements: PhrasingContent[] = [];
      let cursor = 0;
      for (const h of hits) {
        if (h.start < cursor) continue; // 重叠 skip
        if (h.start > cursor) {
          replacements.push({ type: 'text', value: value.slice(cursor, h.start) } as Text);
        }
        // 用 emphasis 节点作 hast 容器,hName 重写为自定义元素
        // hProperties 仅在 block-id 上挂 data-block-id 供 anchor 定位
        const hProperties: Record<string, string> =
          h.hName === 'obs-tag'
            ? { className: 'atr-obs-tag' }
            : h.hName === 'obs-highlight'
              ? { className: 'atr-obs-highlight' }
              : h.hName === 'obs-block-id'
                ? { className: 'atr-obs-block-id', 'data-block-id': h.value, 'aria-hidden': 'true' }
                : {}; // comment 无属性

        replacements.push({
          type: 'emphasis',
          data: {
            hName: h.hName,
            hProperties,
          },
          children: [{ type: 'text', value: h.value } as Text],
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
