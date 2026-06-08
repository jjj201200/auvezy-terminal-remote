/**
 * HtmlPreview — .html / .htm / .xhtml 网页渲染预览
 *
 * 仅当用户在预览界面把视图切到「渲染」模式时使用;「源码」模式仍走 TextPreview。
 *
 * ## 渲染方式:iframe srcdoc + sandbox
 *
 * 不用 dangerouslySetInnerHTML 直接注入,而是塞进 <iframe srcdoc>:
 *  - iframe 给基本 DOM / CSS 隔离 —— 页面自带样式不会污染 app 全局 CSS
 *  - sandbox 属性控制脚本能否执行
 *
 * ## 沙箱 / 危险 两档(每次进入渲染都问,不持久化)
 *
 * 网页可能含 <script>,执行后能读 token / 发请求。安全选择不应被静默记住后
 * 在另一个文件上沉默生效(项目安全红线:显式授权)。故每次进入 html 渲染都
 * 先弹「选择卡」,用户显式选:
 *  - 沙箱模式(推荐): sandbox 不含 allow-scripts → 脚本不执行,纯静态渲染
 *  - 危险模式:        sandbox="allow-scripts allow-same-origin" → 脚本执行
 *
 * srcdoc 用文件原文(不清洗) —— 沙箱模式靠 iframe sandbox 拦住脚本,危险模式
 * 是用户知情选择。
 */

import { useEffect, useState, type JSX } from 'react';
import { IconAlertTriangle, IconShieldCheck, IconShieldOff } from '@tabler/icons-react';
import { useFiles } from '../../hooks/useFiles.js';
import { useT } from '../../i18n/i18n-context.js';
import { translateFileErr } from './translate-err.js';
import { BrailleSpinner } from '../ui/BrailleSpinner.js';
import s from './FileBrowserSheet.module.scss';

export interface HtmlPreviewProps {
  instanceId: string;
  path: string;
}

/** 渲染信任档:未选 / 沙箱 / 危险 */
type TrustMode = 'unchosen' | 'sandbox' | 'danger';

export function HtmlPreview({ instanceId, path }: HtmlPreviewProps): JSX.Element {
  const t = useT();
  const files = useFiles(instanceId);
  const [raw, setRaw] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 每次 mount(进入渲染模式)都从 unchosen 起步,不持久化
  const [trust, setTrust] = useState<TrustMode>('unchosen');

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setRaw('');
    setLoading(true);
    setTrust('unchosen');
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

  if (err) {
    return (
      <div className={s.error} role="alert">
        {translateFileErr(t, err)}
      </div>
    );
  }
  if (loading) {
    return (
      <div className={`${s.notice} ${s.previewLoadingFallback} fb-preview__notice`}>
        <BrailleSpinner size="lg" label={t('files.previewLoading')} />
      </div>
    );
  }

  // 未选信任档 → 显示选择卡
  if (trust === 'unchosen') {
    return (
      <div className={s.htmlTrustGate} role="group" aria-label={t('files.htmlRenderWarn')}>
        <div className={s.htmlTrustIcon}>
          <IconAlertTriangle size={32} stroke={1.5} />
        </div>
        <p className={s.htmlTrustMsg}>{t('files.htmlRenderWarn')}</p>
        <div className={s.htmlTrustActions}>
          <button
            type="button"
            className={s.htmlTrustBtn}
            onClick={() => setTrust('sandbox')}
            data-action="files-html-trust-sandbox"
          >
            <IconShieldCheck size={16} stroke={1.5} />
            {t('files.htmlRenderSandbox')}
          </button>
          <button
            type="button"
            className={`${s.htmlTrustBtn} ${s.htmlTrustBtnDanger}`}
            onClick={() => setTrust('danger')}
            data-action="files-html-trust-danger"
          >
            <IconShieldOff size={16} stroke={1.5} />
            {t('files.htmlRenderDanger')}
          </button>
        </div>
      </div>
    );
  }

  // sandbox 属性:沙箱档不含 allow-scripts(脚本禁用);危险档放开脚本。
  // allow-same-origin 仅危险档加,配合 allow-scripts 让页面脚本可正常运行。
  const sandbox = trust === 'danger' ? 'allow-scripts allow-same-origin' : '';

  return (
    <iframe
      className={s.htmlFrame}
      srcDoc={raw}
      sandbox={sandbox}
      title={path}
      data-trust={trust}
    />
  );
}
