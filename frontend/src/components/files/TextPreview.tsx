/**
 * TextPreview(阶段 5:无高亮纯 <pre>;阶段 6 接 Shiki)
 */

import { useEffect, useState, type JSX } from 'react';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './FileBrowserSheet.module.scss';

export interface TextPreviewProps {
  instanceId: string;
  path: string;
}

export function TextPreview({ instanceId, path }: TextPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const [content, setContent] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setContent('');
    setTruncated(false);
    files.read(path).then((r) => {
      if (cancelled) return;
      setContent(r.content);
      setTruncated(r.truncated);
    }).catch((e: Error & { code?: string }) => {
      if (!cancelled) setErr(e.code ?? 'UNKNOWN');
    });
    return () => { cancelled = true; };
  }, [path, files]);

  if (err) return <div className={s.error}>{translateErr(t, err)}</div>;
  return (
    <>
      {truncated && <div className={s.notice}>{t('files.previewTruncated')}</div>}
      <pre className={s.textPre}>{content}</pre>
    </>
  );
}

function translateErr(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'PATH_NOT_FOUND': return t('files.errorPathNotFound');
    case 'PATH_FORBIDDEN': return t('files.errorPathForbidden');
    case 'FILE_BINARY': return t('files.errorFileBinary');
    default: return t('files.errorUnknown');
  }
}
