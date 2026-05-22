/**
 * Obsidian 集成模块聚合入口
 *
 * 由 MarkdownPreview 通过二级 lazy import 加载。导出 plugin 数组 + components
 * 工厂,供主入口在 `rendering.obsidian.enabled === true` 时拼装到 ReactMarkdown。
 *
 * Why 单独 chunk:js-yaml + remark-frontmatter + 自写 plugin 体积约 ~50KB,
 * 未开 Obsidian 集成的用户不应付这份代价(主 markdown chunk 已经 ~250KB,叠
 * 加上去会让首次预览 .md 更慢)。
 *
 * 各子开关(frontmatter / wikilink / embed / callout / inlineSyntax)由
 * `ObsidianEffective` 携入;**plugin 永远 push**(只要 obsidian 总开关开),
 * 子开关只决定渲染样式分支(disabled hint vs 真渲染)。见 design.md §6.1。
 */

import type { PluggableList } from 'unified';
import type { Components } from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';

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

/**
 * 拼装 Obsidian 渲染所需的 remark plugin + react-markdown components 映射。
 *
 * 后续 task 增量补:S3-3 加 frontmatter,S4 加 callout,S5 加 inline-syntax,
 * S6b 加 wikilink,S7 加 embed。当前(S3-1)只接 remark-frontmatter 标记节点,
 * 等 S3-3 真正接渲染。
 */
export function buildObsidianBindings(_eff: ObsidianEffective): ObsidianBindings {
  return {
    remarkPlugins: [remarkFrontmatter],
    components: {},
  };
}
