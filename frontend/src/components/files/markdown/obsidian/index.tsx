/**
 * Obsidian 集成模块聚合入口
 *
 * 由 MarkdownPreview 通过二级 lazy import 加载。导出 plugin 数组 + components
 * 工厂,供主入口在 `rendering.obsidian.enabled === true` 时拼装到 ReactMarkdown。
 *
 * Why 单独 chunk:js-yaml + remark-frontmatter + 自写 plugin 体积约 ~50KB,
 * 未开 Obsidian 集成的用户不应付这份代价。
 *
 * 各子开关由 `ObsidianEffective` 携入;**plugin 永远 push**(只要 obsidian
 * 总开关开),子开关只决定渲染样式分支(disabled hint vs 真渲染)。
 * 见 design.md §6.1。
 *
 * 自定义节点输出:
 * remark-frontmatter 原本只产出 mdast 'yaml' 节点,react-markdown 默认不渲染。
 * 我们的 `remarkObsidianFrontmatter` plugin 把 yaml 节点转换为带 `hName: 'obs-frontmatter'`
 * + `hProperties.raw: <YAML 字符串>` 的占位节点;之后 react-markdown 的 components
 * 表按 `obs-frontmatter` 自定义元素名映射到 FrontmatterTable 组件。
 * 关闭 frontmatter 子开关时,plugin 直接从 mdast 中 splice 掉 yaml 节点(strip)。
 */

import type { JSX, ReactNode } from 'react';
import type { PluggableList, Plugin } from 'unified';
import type { Components } from 'react-markdown';
import type { Root, Yaml } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import { visit, SKIP } from 'unist-util-visit';
import { FrontmatterTable } from './frontmatter.js';
import { remarkObsidianCallout, CalloutBlock } from './callout.js';
import { remarkObsidianInline } from './inline-syntax.js';
import './inline-syntax.module.scss';
import { remarkObsidianLink, WikilinkActive, WikilinkDisabled } from './wikilink.js';

export interface ObsidianEffective {
  frontmatter: boolean;
  wikilink: boolean;
  embed: boolean;
  callout: boolean;
  inlineSyntax: boolean;
}

export interface ObsidianBindings {
  remarkPlugins: PluggableList;
  components: Components;
}

interface RemarkObsidianFrontmatterOptions {
  enabled: boolean;
}

/**
 * 把 remark-frontmatter 产出的 `yaml` 节点替换为自定义 `obs-frontmatter` 节点,
 * 并把 raw YAML 字符串挂到 `data.hProperties.raw`。
 *
 * enabled=false 时直接从 mdast 中 splice 掉 yaml 节点(用户不要看到 frontmatter 块)。
 */
const remarkObsidianFrontmatter: Plugin<[RemarkObsidianFrontmatterOptions], Root> =
  (opts) => {
    return (tree) => {
      visit(tree, 'yaml', (node: Yaml, index, parent) => {
        if (!parent || index == null) return;
        if (!opts.enabled) {
          parent.children.splice(index, 1);
          return [SKIP, index];
        }
        // 占位 paragraph + hName 让 react-markdown 渲染成自定义元素
        parent.children[index] = {
          type: 'paragraph',
          data: {
            hName: 'obs-frontmatter',
            hProperties: { raw: node.value },
          },
          children: [],
        } as Root['children'][number];
      });
    };
  };

/**
 * 拼装 Obsidian 渲染所需的 remark plugin + react-markdown components 映射。
 *
 * S3-3 当前只接 frontmatter;后续 task 增量补:S4 加 callout,S5 加 inline-syntax,
 * S6b 加 wikilink,S7 加 embed。
 */
/** wikilink / embed 组件需要的运行时上下文 */
export interface ObsidianContext {
  /** 当前 markdown 所在的实例 id */
  instanceId: string;
  /** 当前 markdown 文档相对 cwd 的路径(用于 backend resolver shortest-path 启发式) */
  path: string;
}

export function buildObsidianBindings(
  eff: ObsidianEffective,
  ctx: ObsidianContext,
): ObsidianBindings {
  const remarkPlugins: PluggableList = [
    remarkFrontmatter,
    [remarkObsidianFrontmatter, { enabled: eff.frontmatter }],
    [remarkObsidianCallout, { enabled: eff.callout }],
    [remarkObsidianInline, { enabled: eff.inlineSyntax }],
    // wikilink/embed 总是识别(plugin push 与否由 obsidian 总开关决定);
    // 子开关在渲染层判
    [remarkObsidianLink, { enabled: true }],
  ];

  // react-markdown 的 components 字段只接受标准 HTML 标签名作为 key 的类型,
  // 自定义元素名(obs-frontmatter / obs-callout / obs-highlight / obs-comment /
  // obs-tag / obs-block-id)需用 `unknown` 中转。运行时 react-markdown 实际支持
  // 任意小写带连字符的标签名(因为 mdast→hast 阶段的 hName 直接成为 type)。
  //
  // inline 类节点(highlight/comment/tag/block-id)的样式 class 由 plugin 直接写
  // 进 hProperties.className,这里组件层只决定结构 + comment 返回 null。
  const components = {
    'obs-frontmatter': ((props: { raw?: string }): JSX.Element => (
      <FrontmatterTable raw={props.raw ?? ''} />
    )),
    'obs-callout': CalloutBlock,
    // highlight / tag / block-id:transparent wrap children(class 已挂在 hProperties)
    'obs-highlight': ((props: { children?: ReactNode; className?: string }) => (
      <mark className={props.className}>{props.children}</mark>
    )),
    'obs-tag': ((props: { children?: ReactNode; className?: string }) => (
      <span className={props.className}>#{props.children}</span>
    )),
    'obs-block-id': ((props: { children?: ReactNode; className?: string; 'data-block-id'?: string }) => (
      <span
        className={props.className}
        data-block-id={props['data-block-id']}
        aria-hidden="true"
      >
        {props.children}
      </span>
    )),
    'obs-comment': (() => null),
    // wikilink 渲染分支:子开关开 → 可点击 + 解析;关 → 虚线灰显
    'obs-wikilink': ((props: { target?: string; alias?: string }) =>
      eff.wikilink ? (
        <WikilinkActive
          instanceId={ctx.instanceId}
          from={ctx.path}
          target={props.target ?? ''}
          {...(props.alias ? { alias: props.alias } : {})}
        />
      ) : (
        <WikilinkDisabled target={props.target ?? ''} {...(props.alias ? { alias: props.alias } : {})} />
      )),
    // embed 占位 — S7 实现具体分发
    'obs-embed': ((props: { target?: string }) => (
      <span style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
        ![[{props.target ?? ''}]]
      </span>
    )),
  } as unknown as Components;

  return { remarkPlugins, components };
}
