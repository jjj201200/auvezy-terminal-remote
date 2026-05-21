/**
 * MarkdownPreview — .md / .markdown 富文本预览
 *
 * 仅在用户在 DisplaySettings 中开启 `markdownPreview` 时使用;关闭时
 * .md 走 TextPreview(同其它代码文件)。
 *
 * 渲染链:react-markdown + remark-gfm + remark-math + rehype-raw + rehype-katex
 *
 * Why 不复用 TextPreview 的 Shiki 行号 + 虚拟滚动:markdown 是富文档(段落 /
 * 列表 / 表格 / 引用 …)不是逐行结构,虚拟列表无法按行分块;代码块仍走项目
 * Shiki(复用 syntax-highlight.highlight,返回 string[] 行片段)。
 *
 * Why dangerouslySetInnerHTML 安全:
 *  - 代码块 HTML 来自 Shiki(可信)
 *  - markdown 文本来自本地文件,经 react-markdown 转义 + rehype-raw 允许的 raw
 *    HTML 子集都不可执行 JS;katex 渲染产物也是静态 SVG/MathML
 */

import { memo, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import { useUserConfig } from '../../hooks/useUserConfig.js';
import { highlight, type ColorScheme } from '../../utils/syntax-highlight.js';
import { translateFileErr } from './translate-err.js';
import s from './MarkdownPreview.module.scss';

export interface MarkdownPreviewProps {
  instanceId: string;
  path: string;
}

const HIGHLIGHT_OFF_BYTES = 1024 * 1024;

export function MarkdownPreview({ instanceId, path }: MarkdownPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const { config } = useUserConfig();
  const [raw, setRaw] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const components = useMemo<Components>(() => ({
    // 代码块:fenced code 由 <pre><code class="language-xxx">...</code></pre> 表示;
    // 这里覆盖 `code` 组件:有 className 视为代码块,无 className 视为 inline code。
    code(props) {
      const { className, children } = props;
      const inline = !className?.startsWith('language-');
      if (inline) {
        return <code>{children}</code>;
      }
      const lang = className!.slice('language-'.length);
      const text = typeof children === 'string'
        ? children
        : String(children).replace(/\n$/, '');
      return <CodeBlock code={text} lang={lang} colorScheme={colorScheme} />;
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
    // blockquote → GFM Alert 识别
    blockquote(props) {
      return renderBlockquote(props.children);
    },
  }), [colorScheme]);

  if (err) {
    return (
      <div className={s.errorState} role="alert">
        {translateFileErr(t, err)}
      </div>
    );
  }
  if (loading) {
    return <div className={s.loading}>{t('files.previewLoading')}</div>;
  }
  return (
    <div className={`${s.root} fb-markdown`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={components}
      >
        {raw}
      </ReactMarkdown>
    </div>
  );
}

/* ─────────────────────────────────────── *
 * Code block — 复用 syntax-highlight.highlight()
 * ─────────────────────────────────────── */

interface CodeBlockProps {
  code: string;
  lang: string;
  colorScheme: ColorScheme;
}

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

  const gutterCh = String(lines.length).length + 1;
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
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
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
      <code dangerouslySetInnerHTML={{ __html: lines.join('\n') }} />
    </pre>
  );
});

/* ─────────────────────────────────────── *
 * Blockquote → 识别 GFM Alert(`> [!NOTE]` 等)
 * ─────────────────────────────────────── */

type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

function renderBlockquote(children: ReactNode): JSX.Element {
  // 首段第一行若是 `[!NOTE]` 标记 → 提升为 alert
  // 注意:react-markdown 把 blockquote 内容嵌成 React 节点,我们要从结构里抠
  // 首行文本判定 — 简化处理:走 children 数组,看第 1 个 <p> 的第 1 段文本
  let kind: AlertKind | null = null;
  let rest: ReactNode = children;
  if (Array.isArray(children)) {
    const first = children.find((c): c is JSX.Element =>
      typeof c === 'object' && c !== null && 'type' in c && (c as JSX.Element).type === 'p');
    if (first) {
      const txt = extractLeadingText(first);
      const m = txt && ALERT_RE.exec(txt.trim());
      if (m) {
        kind = m[1]!.toLowerCase() as AlertKind;
        rest = stripAlertMarker(children, first);
      }
    }
  }
  if (!kind) {
    return <blockquote>{children}</blockquote>;
  }
  const alertClass = {
    note: s.alertNote,
    tip: s.alertTip,
    important: s.alertImportant,
    warning: s.alertWarning,
    caution: s.alertCaution,
  }[kind];
  return (
    <blockquote className={`${s.alert} ${alertClass}`}>
      <div className={s.alertTitle}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</div>
      {rest}
    </blockquote>
  );
}

function extractLeadingText(el: JSX.Element): string | null {
  const ch = el.props?.children;
  if (typeof ch === 'string') return ch;
  if (Array.isArray(ch) && typeof ch[0] === 'string') return ch[0];
  return null;
}

function stripAlertMarker(all: ReactNode[], firstP: JSX.Element): ReactNode {
  // 把 firstP 的内容里的 [!XXX] 标记去掉;若该 p 全是标记,去掉整个 p
  const ch = firstP.props?.children;
  const idx = all.indexOf(firstP);
  if (typeof ch === 'string' && ALERT_RE.test(ch.trim())) {
    return all.slice(0, idx).concat(all.slice(idx + 1));
  }
  if (Array.isArray(ch) && typeof ch[0] === 'string' && ALERT_RE.test(ch[0].trim())) {
    const restCh = ch.slice(1);
    // 若剩余首元素是 <br> 或换行,跳过它
    const cleanedFirst = { ...firstP, props: { ...firstP.props, children: restCh.length ? restCh : null } };
    if (!restCh.length) {
      return all.slice(0, idx).concat(all.slice(idx + 1));
    }
    return all.slice(0, idx).concat([cleanedFirst], all.slice(idx + 1));
  }
  return all;
}
