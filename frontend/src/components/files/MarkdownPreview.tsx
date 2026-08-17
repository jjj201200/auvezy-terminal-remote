/**
 * MarkdownPreview — .md / .markdown 富文本预览
 *
 * 仅在用户在 集成 → 渲染 → Markdown 开启时使用(读 `rendering.markdown.enabled`);
 * 关闭时 .md 走 TextPreview(同其它代码文件)。
 *
 * 渲染链:react-markdown + remark-gfm + remark-math + rehype-raw + rehype-katex
 * + 可选 obsidian 扩展(frontmatter / callout / wikilink / embed / inline 语法)。
 *
 * Why 不复用 TextPreview 的 Shiki 行号 + 虚拟滚动:markdown 是富文档(段落 /
 * 列表 / 表格 / 引用 …)不是逐行结构,虚拟列表无法按行分块;代码块仍走项目
 * Shiki(复用 syntax-highlight.highlight,返回 string[] 行片段)。
 *
 * Why dangerouslySetInnerHTML 安全:
 *  - 代码块 HTML 来自 Shiki(可信)
 *  - markdown 文本来自本地文件,经 react-markdown 转义 + rehype-raw 允许的 raw
 *    HTML 子集都不可执行 JS;katex 渲染产物也是静态 SVG/MathML
 *
 * Obsidian 集成动态加载(S3-3 起):仅在 `rendering.obsidian.enabled` 为 true 时
 * 通过 dynamic import 拉 `markdown/obsidian` 模块(js-yaml + remark-frontmatter +
 * 自写 plugin,共 ~50KB)。未开 obsidian 的用户不付这份代价。
 */

import { createElement, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';
import 'katex/dist/katex.min.css';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { highlight, type ColorScheme } from '../../utils/syntax-highlight.js';
import { translateFileErr } from './translate-err.js';
import { BrailleSpinner } from '../ui/BrailleSpinner.js';
import type { ObsidianBindings, ObsidianEffective } from './markdown/obsidian/index.js';
import { consumePendingAnchor } from './markdown/obsidian/anchor-bus.js';
import { EmbedAncestorsProvider } from './markdown/obsidian/embed.js';
import s from './MarkdownPreview.module.scss';

/**
 * heading text → slug
 * 算法:lowercase → 空白替为连字符 → 去除非 \w- 字符。对齐 Obsidian 默认 slugify。
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
}

export interface MarkdownPreviewProps {
  instanceId: string;
  path: string;
  /**
   * 重激活序号(可选)。modal-stack bringToTop 时此值变化 → 强制重跑 anchor
   * useEffect → 重新 consumePendingAnchor + scrollIntoView。
   *
   * 不传(FileBrowser 入口)时该 effect 仍按 [raw, instanceId, path] 触发,行为
   * 与改动前一致。
   */
  activationSeq?: number;
}

const HIGHLIGHT_OFF_BYTES = 1024 * 1024;

export function MarkdownPreview({ instanceId, path, activationSeq }: MarkdownPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const { config } = useUserConfig();
  const [raw, setRaw] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── 正文字号(集成 → Markdown 设置;0 = 自动跟随 --fs-md)──────────────
  // 通过 CSS var --atr-md-fs 注入 .root;标题/代码/表格等内部字号全部 em 相对
  // 该值,整篇按比例缩放(见 MarkdownPreview.module.scss .root 注释)。
  const mdFontSize = config.integrations?.rendering?.markdown?.fontSize ?? 0;
  const mdFsStyle = useMemo<CSSProperties | undefined>(
    () => (mdFontSize > 0 ? ({ '--atr-md-fs': `${mdFontSize}px` } as CSSProperties) : undefined),
    [mdFontSize],
  );

  // ─── obsidian 集成 effective 状态 + 动态加载 bindings ─────────────────────
  // markdown 已开(走到这里就保证),只需判断 obsidian.enabled。子开关传给 bindings 内部分支。
  const obsEff = useMemo<ObsidianEffective | null>(() => {
    const obs = config.integrations?.rendering?.obsidian;
    if (!obs || obs.enabled === false) return null;
    return {
      frontmatter: obs.frontmatter !== false,
      wikilink: obs.wikilink !== false,
      embed: obs.embed !== false,
      callout: obs.callout !== false,
      inlineSyntax: obs.inlineSyntax !== false,
    };
  }, [config.integrations?.rendering?.obsidian]);

  const [obsBindings, setObsBindings] = useState<ObsidianBindings | null>(null);
  useEffect(() => {
    if (!obsEff) {
      setObsBindings(null);
      return;
    }
    let cancelled = false;
    void import('./markdown/obsidian/index.js').then((m) => {
      if (!cancelled) {
        setObsBindings(m.buildObsidianBindings(obsEff, { instanceId, path }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [obsEff, instanceId, path]);

  const themeName = config.display?.theme;
  const colorScheme: ColorScheme =
    themeName === 'dark-daltonized' || themeName === 'light-daltonized'
      ? 'daltonized'
      : 'standard';

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setRaw('');
    setLoading(true);
    files.read(path)
      .then((r) => {
        if (cancelled) return;
        setRaw(r.content);
        setLoading(false);
      })
      .catch((e: Error & { code?: string }) => {
        if (cancelled) return;
        setErr(e.code ?? 'UNKNOWN');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, files]);

  const baseComponents = useMemo<Components>(() => ({
    // 代码块:fenced code 由 <pre><code class="language-xxx">...</code></pre> 表示;
    // 这里覆盖 `code` 组件:有 className 视为代码块,无 className 视为 inline code。
    code(props) {
      const { className, children } = props;
      // 仅当 className 匹配 `language-<lang>` 才升级为代码块;
      // 包含 className 但非语言标记(如 rehype-raw 透传的旁路 class)走 inline
      const match = /^language-([\w+-]+)$/.exec(className ?? '');
      if (!match) {
        return <code className={className}>{children}</code>;
      }
      return (
        <CodeBlock
          code={toCodeText(children).replace(/\n$/, '')}
          lang={match[1]!}
          colorScheme={colorScheme}
        />
      );
    },
    pre(props) {
      // react-markdown 把 pre>code 拆开渲染。我们让 CodeBlock 自己输出 <pre>,
      // 这里 pre 透传一层 fragment 即可(不再多一层 <pre>)。
      return <>{props.children}</>;
    },
    table(props) {
      // 给表格外加滚动包装
      return <div className={s.tableWrap}>{props.children && <table>{props.children}</table>}</div>;
    },
    // heading 注入 data-heading-id 供 anchor-bus scrollIntoView 定位(S6b)。
    // h1..h6 6 个 tag 行为一致,工厂化避免重复 — 用 React.createElement 绑 tag 名。
    ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).reduce<Partial<Components>>((acc, tag) => {
      acc[tag] = (p) =>
        createElement(tag, { 'data-heading-id': slugify(toCodeText(p.children)) }, p.children);
      return acc;
    }, {}),
    // blockquote 默认渲染;callout 子开关启用时由 obsidian/callout plugin 接管(见 S4)
  }), [colorScheme]);

  // 顶层 ancestors set:把自己 path 加入,防止 A.md `![[A]]` 自指无限递归。
  // EmbedMd 内会进一步 `Set(ancestors).add(child)` 沿递归链增长。
  const ancestorsForEmbed = useMemo(() => new Set<string>([path]), [path]);

  // wikilink 跳转后 consume 目标 anchor(heading/block-id) → scrollIntoView
  //
  // activationSeq 进 deps:当同一文件被 bringToTop 复活(组件不卸载,raw / path
  // 都没变),此值变化触发 effect 重跑,让带 anchor 的二次跳转(如 [[A#H2]] 后
  // 又 [[A#H3]])也能滚到新位置。
  useEffect(() => {
    if (!raw) return;
    // 等一帧让 ReactMarkdown 渲染完成 DOM
    const handle = requestAnimationFrame(() => {
      const anchor = consumePendingAnchor(instanceId, path);
      if (!anchor) return;
      const sel =
        anchor.kind === 'heading'
          ? `[data-heading-id="${slugify(anchor.id)}"]`
          : `[data-block-id="${CSS.escape(anchor.id)}"]`;
      const el = document.querySelector(sel);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(handle);
  }, [raw, instanceId, path, activationSeq]);

  // 合并 base + obsidian 的 plugin / components
  const remarkPlugins = useMemo<PluggableList>(
    () => [remarkGfm, remarkMath, ...(obsBindings?.remarkPlugins ?? [])],
    [obsBindings],
  );
  const components = useMemo<Components>(
    () => ({ ...baseComponents, ...(obsBindings?.components ?? {}) }),
    [baseComponents, obsBindings],
  );

  if (err) {
    return (
      <div className={s.errorState} role="alert">
        {translateFileErr(t, err)}
      </div>
    );
  }
  if (loading) {
    return (
      <div className={s.loading}>
        <BrailleSpinner size="lg" label={t('files.previewLoading')} />
      </div>
    );
  }
  return (
    // 顶层包 EmbedAncestorsProvider:把自己 path 加入祖先 set,
    // 防止 A.md ![[A]] 这种自指 embed 触发无限递归(单层即被循环检测拦截)
    <EmbedAncestorsProvider value={ancestorsForEmbed}>
      <div className={`${s.root} fb-markdown`} style={mdFsStyle}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
          components={components}
        >
          {raw}
        </ReactMarkdown>
      </div>
    </EmbedAncestorsProvider>
  );
}

/* ─────────────────────────────────────── *
 * Code block — 复用 syntax-highlight.highlight()
 * ─────────────────────────────────────── */

/**
 * 递归提取 React children 中的纯文本。
 * Why:react-markdown 给 code 的 children 99% 是单字符串,但 rehype-raw 介入后
 * 可能出现节点数组(含 emphasis 等);用 String() 会得到 "[object Object]" 喂给
 * Shiki 渲染乱码。
 */
function toCodeText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(toCodeText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as JSX.Element).props as { children?: ReactNode };
    return toCodeText(props.children);
  }
  return '';
}

interface CodeBlockProps {
  code: string;
  lang: string;
  colorScheme: ColorScheme;
}

/** 单代码块最多渲染的行数;超出截断并提示。
 *  Why:markdown 文档没有按行虚拟化,单个超大代码块(几千行 dump / patch)
 *  会一次性注入 DOM,主线程阻塞 1s+。 */
const CODE_BLOCK_LINE_LIMIT = 1000;

const CodeBlock = memo(function CodeBlock({ code, lang, colorScheme }: CodeBlockProps): JSX.Element {
  const [lines, setLines] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlight(code, lang, { maxBytes: HIGHLIGHT_OFF_BYTES, colorScheme }).then((r) => {
      if (!cancelled) setLines(r);
    });
    return () => { cancelled = true; };
  }, [code, lang, colorScheme]);

  const truncated = lines.length > CODE_BLOCK_LINE_LIMIT;
  const renderLines = truncated ? lines.slice(0, CODE_BLOCK_LINE_LIMIT) : lines;
  const gutterCh = String(renderLines.length).length + 1;
  const isDiff = lang === 'diff';

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板权限拒绝 — 静默(用户能感知 copied=false)
    }
  };
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  return (
    <pre
      className={isDiff ? s.isDiff : undefined}
      style={{ '--atr-gutter-w': `${gutterCh}ch` } as React.CSSProperties}
    >
      <div className={s.codeHeader}>
        <div className={s.meta}>
          {lang && <span className={s.lang}>{lang}</span>}
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={s.iconBtn}
            onClick={onCopy}
            data-copied={copied ? 'true' : undefined}
            aria-label="Copy"
            title="Copy code"
          >
            {copied ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3 3 7-7" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="5" width="8" height="9" rx="1" />
                <path d="M3 11V3a1 1 0 0 1 1-1h7" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <code dangerouslySetInnerHTML={{ __html: renderLines.join('\n') }} />
      {truncated && (
        <div className={s.truncatedHint}>
          … {lines.length - CODE_BLOCK_LINE_LIMIT} more lines truncated
        </div>
      )}
    </pre>
  );
});

