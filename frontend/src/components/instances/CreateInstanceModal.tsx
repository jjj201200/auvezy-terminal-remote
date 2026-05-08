/**
 * CreateInstanceModal（实际是"新增实例"，"创建"措辞已废弃）
 *
 * 三种新增方式（同一张 Sheet 内分模式切换）：
 *  1. form 模式（默认）—— 在当前 backend 宿主机上 spawn 新实例（cwd 必填）
 *     - cwd 输入框 focus 时弹"最近创建过"下拉，点击填充（支持 × 删除单条）
 *     - cwd 回车 → focus 跳到 name；name 回车 → submit
 *  2. scan 模式 —— 摄像头扫描另一台 atr 实例打印的二维码 → 跳转过去
 *  3. url 模式 —— 粘贴另一台 atr 实例的完整访问 URL → 跳转过去
 *
 * 设计动机：跟认证页一样，scan/url 是"接入远端实例"的逃生入口。
 * 跳转后浏览器换 origin，新页面的 useAuth 会接手 token；从用户角度看
 * 等于"管理面板里多了一台机器的实例"（实际是切换到那台机器的 webapp）。
 */

import { useEffect, useRef, useState, type JSX, type FormEvent, type KeyboardEvent } from 'react';
import { IconHistory, IconLink, IconQrcode, IconX } from '@tabler/icons-react';
import { Sheet } from '../ui/Sheet.js';
import { TextField } from '../ui/TextField.js';
import { QrScanPane } from '../auth/QrScanPane.js';
import { UrlPastePane, parseAccessUrl } from '../auth/UrlPastePane.js';
import { useT } from '../../i18n/i18n-context.js';
import {
  getRecentInstances,
  pushRecentInstance,
  removeRecentInstance,
  type RecentInstance,
} from '../../services/recent-instances.js';
import s from './CreateInstanceModal.module.scss';

export interface CreateInstanceModalProps {
  open: boolean;
  /** 成功返回 null；失败返回错误信息（直接显示给用户） */
  onSubmit: (cwd: string, name?: string) => Promise<string | null>;
  onClose: () => void;
}

type Mode = 'form' | 'scan' | 'url';

export function CreateInstanceModal({
  open,
  onSubmit,
  onClose,
}: CreateInstanceModalProps): JSX.Element {
  const t = useT();
  const [mode, setMode] = useState<Mode>('form');
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInstance[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [scanInvalid, setScanInvalid] = useState<string | null>(null);

  const cwdRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setMode('form');
      setCwd('');
      setName('');
      setError(null);
      setSubmitting(false);
      setScanInvalid(null);
      setRecent(getRecentInstances());
      setShowRecent(false);
    }
  }, [open]);

  const refreshRecent = (): void => setRecent(getRecentInstances());

  const handleSubmit = async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
    e?.preventDefault();
    if (!cwd.trim()) {
      setError(t('instance.errorEmptyCwd'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const errMsg = await onSubmit(cwd.trim(), name.trim() || undefined);
    setSubmitting(false);
    if (errMsg === null) {
      pushRecentInstance({ cwd: cwd.trim(), name: name.trim() || undefined });
      onClose();
    } else {
      setError(errMsg);
    }
  };

  const handleCwdKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && cwd.trim()) {
      e.preventDefault();
      setShowRecent(false);
      nameRef.current?.focus();
    }
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const pickRecent = (r: RecentInstance): void => {
    setCwd(r.cwd);
    if (r.name) setName(r.name);
    setShowRecent(false);
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const handleRemoveRecent = (cwdToRemove: string): void => {
    removeRecentInstance(cwdToRemove);
    refreshRecent();
  };

  const handleCwdBlur = (): void => {
    setTimeout(() => setShowRecent(false), 150);
  };

  // form 模式 footer：取消 + 新增提交
  const formFooter = (
    <>
      <button type="button" onClick={onClose} className={s.cancelBtn}>
        {t('common.cancel')}
      </button>
      <button
        type="submit"
        form="create-instance-form"
        disabled={submitting || cwd.trim().length === 0}
        className={s.submitBtn}
      >
        {submitting ? t('instance.submitting') : t('instance.submit')}
      </button>
    </>
  );

  // scan / url 模式：footer 留空（两个 pane 内置返回按钮）
  const altFooter = null;

  return (
    <Sheet
      id="create-instance-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('instance.create')}
      footer={mode === 'form' ? formFooter : altFooter}
    >
      {mode === 'form' && (
        <form id="create-instance-form" className={s.form} onSubmit={handleSubmit}>
          <label className={s.field}>
            <span className={s.fieldLabel}>{t('instance.workdirLabel')}</span>
            <div className={s.cwdWrap}>
              <TextField
                ref={cwdRef}
                type="text"
                placeholder={t('instance.workdirHelper')}
                value={cwd}
                mono
                onChange={(e) => setCwd(e.target.value)}
                onClear={() => {
                  setCwd('');
                  cwdRef.current?.focus();
                }}
                onFocus={() => setShowRecent(true)}
                onBlur={handleCwdBlur}
                onKeyDown={handleCwdKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              {showRecent && (
                <div className={s.recentList} role="listbox">
                  <div className={s.recentHeader}>
                    <IconHistory size={12} stroke={1.5} />
                    <span>{t('instance.recentTitle')}</span>
                  </div>
                  {recent.length === 0 ? (
                    <div className={s.recentEmpty}>{t('instance.recentEmpty')}</div>
                  ) : (
                    recent.map((r) => (
                      <div
                        key={r.cwd}
                        className={s.recentItem}
                        role="option"
                        tabIndex={0}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickRecent(r);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            pickRecent(r);
                          }
                        }}
                      >
                        <div className={s.recentBody}>
                          <span className={s.recentCwd}>{r.cwd}</span>
                          {r.name && <span className={s.recentName}>{r.name}</span>}
                        </div>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveRecent(r.cwd);
                          }}
                          aria-label={t('instance.recentRemove')}
                          title={t('instance.recentRemove')}
                          className={s.recentRemove}
                        >
                          <IconX size={12} stroke={1.5} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </label>
          <label className={s.field}>
            <span className={s.fieldLabel}>{t('instance.nameLabelOptional')}</span>
            <TextField
              ref={nameRef}
              type="text"
              placeholder={t('instance.namePlaceholder')}
              value={name}
              mono
              onChange={(e) => setName(e.target.value)}
              onClear={() => {
                setName('');
                nameRef.current?.focus();
              }}
              onKeyDown={handleNameKeyDown}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          {error && <p className={s.error}>{error}</p>}

          {/* 备用入口 —— 跳到其它机器的 atr 实例 */}
          <div className={s.divider} />
          <div className={s.altSection}>
            <div className={s.altHeader}>
              <span className={s.altTitle}>{t('instance.addRemoteTitle')}</span>
              <span className={s.altHint}>{t('instance.addRemoteHint')}</span>
            </div>
            <div className={s.altActions}>
              <button
                type="button"
                className={s.altBtn}
                onClick={() => {
                  setScanInvalid(null);
                  setMode('scan');
                }}
              >
                <IconQrcode size={16} stroke={1.5} />
                <span>{t('instance.scanCta')}</span>
              </button>
              <button
                type="button"
                className={s.altBtn}
                onClick={() => setMode('url')}
              >
                <IconLink size={16} stroke={1.5} />
                <span>{t('instance.urlCta')}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {mode === 'scan' && (
        <QrScanPane
          title={t('authPage.scanLabel')}
          subtitle={t('instance.addRemoteHint')}
          cancelLabel={t('instance.altCancel')}
          onCancel={() => setMode('form')}
          onResult={(text) => {
            const parsed = parseAccessUrl(text);
            if (!parsed) {
              setScanInvalid(t('authPage.scanInvalidQr', { value: trim(text, 40) }));
              return false;
            }
            window.location.assign(parsed);
            return true;
          }}
          invalidNotice={scanInvalid}
        />
      )}

      {mode === 'url' && (
        <UrlPastePane
          title={t('authPage.urlLabel')}
          subtitle={t('instance.addRemoteHint')}
          placeholder={t('authPage.urlPlaceholder')}
          submitLabel={t('authPage.urlSubmit')}
          cancelLabel={t('instance.altCancel')}
          onCancel={() => setMode('form')}
          onSubmit={(url) => {
            const parsed = parseAccessUrl(url);
            if (!parsed) return t('authPage.urlInvalid');
            window.location.assign(parsed);
            return null;
          }}
        />
      )}
    </Sheet>
  );
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
