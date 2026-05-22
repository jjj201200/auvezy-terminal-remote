/**
 * Embed — `![[file]]` 5 类分发(image / md / pdf / audio / video)+ unsupported 占位
 *
 * 循环检测:`EmbedAncestorsContext` 沿递归路径传 `Set<resolvedPath>`,命中即占位。
 * 深度上限:`EMBED_DEPTH_LIMIT = 5`(详见 ADR-004)。
 *
 * md 嵌入默认折叠(避免一次性递归拉满主线程);用户点 details summary 展开后
 * 动态 import MarkdownPreview 渲染(避免循环依赖 + 减小主 chunk)。
 *
 * 子开关关闭时(`enabled=false`):仅渲染占位 `📎 ![[...]]`,不发 resolve 请求,
 * 不递归。
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type JSX,
} from 'react';
import { resolveLink, type WikilinkResult } from './resolve-link.js';
import { useT } from '../../../../i18n/i18n-context.js';
import s from './embed.module.scss';

/** 嵌套深度硬上限(包括循环兜底);详见 ADR-004。 */
export const EMBED_DEPTH_LIMIT = 5;

export type EmbedKind = 'image' | 'md' | 'pdf' | 'audio' | 'video' | 'unsupported';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MD_EXTS = new Set(['.md', '.markdown']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

export function classify(path: string): EmbedKind {
  const i = path.lastIndexOf('.');
  const ext = i < 0 ? '' : path.slice(i).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (MD_EXTS.has(ext)) return 'md';
  if (ext === '.pdf') return 'pdf';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'unsupported';
}

const EmbedAncestorsContext = createContext<ReadonlySet<string>>(new Set());
export const EmbedAncestorsProvider = EmbedAncestorsContext.Provider;

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i);
}

function rawUrl(instanceId: string, path: string): string {
  return `/api/files/raw?instanceId=${encodeURIComponent(instanceId)}&path=${encodeURIComponent(path)}`;
}

export interface EmbedDispatchProps {
  enabled: boolean;
  instanceId: string;
  /** 当前 markdown 文档路径(parent of this embed),用于 resolveLink 上下文 */
  from: string;
  /** wikilink 形式的目标(可能含 alias / fragment) */
  target: string;
  /** 测试 / 内部使用:跳过 resolve 直接给已知 resolved 路径 */
  resolvedOverride?: string;
}

export function EmbedDispatch({
  enabled,
  instanceId,
  from,
  target,
  resolvedOverride,
}: EmbedDispatchProps): JSX.Element {
  const t = useT();
  const ancestors = useContext(EmbedAncestorsContext);
  const [result, setResult] = useState<WikilinkResult | null>(
    resolvedOverride ? { target, resolved: resolvedOverride } : null,
  );

  useEffect(() => {
    if (resolvedOverride) return;
    if (!enabled) return; // 子开关关时不发请求
    let cancelled = false;
    void resolveLink(instanceId, from, target).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, from, target, resolvedOverride, enabled]);

  if (!enabled) {
    return (
      <span className={s.disabled} title={t('obsidian.embedDisabledHint')}>
        📎 ![[{target}]]
      </span>
    );
  }

  // 深度上限检查(在 resolve 完成之前也可触发,避免不必要的递归请求)
  if (ancestors.size >= EMBED_DEPTH_LIMIT) {
    return <aside className={s.placeholder}>{t('obsidian.embedDepthLimit')}</aside>;
  }

  if (!result) {
    return <span className={s.loading}>...</span>;
  }

  if (result.broken || !result.resolved) {
    return <aside className={s.placeholder}>{t('obsidian.embedNotFound')}</aside>;
  }

  // 循环检测:已在祖先链 → 占位
  if (ancestors.has(result.resolved)) {
    return (
      <aside className={s.placeholder}>
        {t('obsidian.embedCircular').replace('{path}', result.resolved)}
      </aside>
    );
  }

  const kind = classify(result.resolved);

  switch (kind) {
    case 'image':
      return <EmbedImage instanceId={instanceId} path={result.resolved} />;
    case 'pdf':
      return <EmbedPdf instanceId={instanceId} path={result.resolved} />;
    case 'audio':
      return <EmbedAudio instanceId={instanceId} path={result.resolved} />;
    case 'video':
      return <EmbedVideo instanceId={instanceId} path={result.resolved} />;
    case 'md':
      return (
        <EmbedMd
          instanceId={instanceId}
          path={result.resolved}
          ancestors={ancestors}
        />
      );
    case 'unsupported':
      return (
        <aside className={s.placeholder}>
          {t('obsidian.embedUnsupportedType').replace('{ext}', extOf(result.resolved))}
        </aside>
      );
  }
}

function EmbedImage({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return <img className={s.image} src={rawUrl(instanceId, path)} alt={path} />;
}

function EmbedPdf({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  const url = rawUrl(instanceId, path);
  return (
    <div className={s.pdf}>
      <iframe src={url} title={path} />
      <a href={url} target="_blank" rel="noreferrer">
        ↗ {path}
      </a>
    </div>
  );
}

function EmbedAudio({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return <audio className={s.av} controls src={rawUrl(instanceId, path)} />;
}

function EmbedVideo({ instanceId, path }: { instanceId: string; path: string }): JSX.Element {
  return <video className={s.av} controls src={rawUrl(instanceId, path)} />;
}

interface MdEmbedProps {
  instanceId: string;
  path: string;
  ancestors: ReadonlySet<string>;
}

/**
 * md 嵌入:默认折叠 → 用户点 details 展开后才动态加载 MarkdownPreview。
 *
 * 动态 import 避免循环依赖(MarkdownPreview → obsidian/index → embed → MarkdownPreview)。
 */
function EmbedMd({ instanceId, path, ancestors }: MdEmbedProps): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [MdComp, setMdComp] = useState<ComponentType<{
    instanceId: string;
    path: string;
  }> | null>(null);

  const nextAncestors = useMemo(() => {
    const n = new Set(ancestors);
    n.add(path);
    return n;
  }, [ancestors, path]);

  useEffect(() => {
    if (!open || MdComp) return;
    void import('../../MarkdownPreview.js').then((m) => {
      setMdComp(() => m.MarkdownPreview);
    });
  }, [open, MdComp]);

  const label = t('obsidian.embedExpand')
    .replace('{path}', path)
    .replace('{size}', '?'); // 大小未知 — 后续可加 stat 请求,先 ?

  return (
    <details
      className={s.mdEmbed}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>{label}</summary>
      {open && MdComp && (
        <div className={s.mdEmbedBody}>
          <EmbedAncestorsProvider value={nextAncestors}>
            <MdComp instanceId={instanceId} path={path} />
          </EmbedAncestorsProvider>
        </div>
      )}
    </details>
  );
}
