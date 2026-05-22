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

import type { JSX } from 'react';
import type { PluggableList, Plugin } from 'unified';
import type { Components } from 'react-markdown';
import type { Root, Yaml } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import { visit, SKIP } from 'unist-util-visit';
import { FrontmatterTable } from './frontmatter.js';

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
export function buildObsidianBindings(eff: ObsidianEffective): ObsidianBindings {
  const remarkPlugins: PluggableList = [
    remarkFrontmatter,
    [remarkObsidianFrontmatter, { enabled: eff.frontmatter }],
  ];

  // react-markdown 的 components 字段只接受标准 HTML 标签名作为 key 的类型,
  // 自定义元素名(obs-frontmatter)需用 `unknown` 中转。运行时 react-markdown
  // 实际支持任意小写带连字符的标签名(因为 mdast→hast 阶段的 hName 直接成为 type)。
  const components = {
    'obs-frontmatter': ((props: { raw?: string }): JSX.Element => (
      <FrontmatterTable raw={props.raw ?? ''} />
    )),
  } as unknown as Components;

  return { remarkPlugins, components };
}
