/**
 * CreateInstanceModal —— 两阶段新增实例
 *
 * 阶段 1：方式选择（pickMethod）
 *  - cwd（在已有主机新增） / scan（扫二维码） / url（粘贴 URL）
 *
 * 阶段 2：对应表单
 *  - form 模式：必选已注册的 host（仅当前 backend host 可启动），填 cwd + name
 *    - 远端 host 仅展示，但 disabled —— backend 没法跨主机 spawn
 *    - cwd focus 时弹"最近创建过"下拉
 *  - scan 模式：识别二维码 → parseAccessUrl → upsertHost(hostname) → 跳转
 *  - url 模式：粘贴链接 → 同上
 *
 * scan/url 跳转前自动登记 host（alias 默认 = host），方便后续在主机分组里看到。
 */

import { useEffect, useMemo, useRef, useState, type JSX, type FormEvent, type KeyboardEvent } from 'react';
import {
  IconAlertTriangle,
  IconFolderPlus,
  IconHistory,
  IconLink,
  IconQrcode,
  IconX,
} from '@tabler/icons-react';
import { Sheet } from '../ui/Sheet.js';
import { TextField } from '../ui/TextField.js';
import { QrScanPane } from '../auth/QrScanPane.js';
import { UrlPastePane, parseAccessUrl } from '../auth/UrlPastePane.js';
import { useT } from '../../i18n/i18n-context.js';
import { useScanCtaLabel } from '../../hooks/useScanCtaLabel.js';
import { useHostRegistry } from '../../hooks/useHostRegistry.js';
import { upsertHost } from '../../services/host-aliases.js';
import {
  getRecentInstances,
  pushRecentInstance,
  removeRecentInstance,
  type RecentInstance,
} from '../../services/recent-instances.js';
import { fetchWorkdirPolicy } from '../../services/workdir-policy-api.js';
import { bases as extractBases, joinBaseAndRelative, matchAllow } from '../../utils/workdir-glob.js';
import s from './CreateInstanceModal.module.scss';

export interface CreateInstanceModalProps {
  open: boolean;
  /** 成功返回 null；失败返回错误信息（直接显示给用户） */
  onSubmit: (cwd: string, name?: string) => Promise<string | null>;
  onClose: () => void;
}

type Mode = 'pick' | 'form' | 'scan' | 'url';

export function CreateInstanceModal({
  open,
  onSubmit,
  onClose,
}: CreateInstanceModalProps): JSX.Element {
  const t = useT();
  const scanLabel = useScanCtaLabel({ defaultKey: 'instance.scanCta' });
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const { hosts, displayOf } = useHostRegistry({ currentHost });

  const [mode, setMode] = useState<Mode>('pick');
  const [selectedHost, setSelectedHost] = useState(currentHost);
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInstance[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [scanInvalid, setScanInvalid] = useState<string | null>(null);

  // workdir 白名单（从当前 backend 拉）。null = 还没拉到
  const [allow, setAllow] = useState<string[] | null>(null);
  // 两段式 cwd：base + relative
  const [selectedBase, setSelectedBase] = useState('');
  const [relPath, setRelPath] = useState('');

  const cwdRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const relRef = useRef<HTMLInputElement | null>(null);

  // 从 allow 抽出 base 候选
  const baseList = useMemo(() => (allow ? extractBases(allow) : []), [allow]);
  const hasAllow = baseList.length > 0;

  useEffect(() => {
    if (open) {
      setMode('pick');
      setSelectedHost(currentHost);
      setCwd('');
      setName('');
      setError(null);
      setSubmitting(false);
      setScanInvalid(null);
      setRecent(getRecentInstances());
      setShowRecent(false);
      setSelectedBase('');
      setRelPath('');
      // 拉一次策略；token 失效 / 网络故障时静默 fallback 到"自由填 cwd"
      void fetchWorkdirPolicy().then((r) => {
        if (r.ok && r.data) {
          setAllow(r.data.allow);
        } else {
          setAllow([]); // 视作无白名单（保守不阻塞用户）
        }
      });
    }
  }, [open, currentHost]);

  // 进 form 模式 + 有白名单时，默认选第一个 base
  useEffect(() => {
    if (mode === 'form' && hasAllow && !selectedBase) {
      setSelectedBase(baseList[0] ?? '');
    }
  }, [mode, hasAllow, baseList, selectedBase]);

  const refreshRecent = (): void => setRecent(getRecentInstances());

  /**
   * 拼出最终 cwd：
   *  - 有白名单：base + relative
   *  - 无白名单：用户在单输入框里填的整段
   */
  const computeFinalCwd = (): string => {
    if (hasAllow) return joinBaseAndRelative(selectedBase, relPath);
    return cwd.trim();
  };

  const handleSubmit = async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
    e?.preventDefault();
    const finalCwd = computeFinalCwd();
    if (!finalCwd) {
      setError(t('instance.errorEmptyCwd'));
      return;
    }
    if (selectedHost && selectedHost !== currentHost) {
      // 兜底：UI 已经禁用远端选项，但万一被绕过
      setError(t('instance.addHostRemoteDisabled'));
      return;
    }
    // 提交前白名单校验（黑名单不暴露 → 让后端拒）
    if (allow && allow.length > 0 && !matchAllow(finalCwd, allow)) {
      setError(t('instance.errorCwdNotAllowed'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const errMsg = await onSubmit(finalCwd, name.trim() || undefined);
    setSubmitting(false);
    if (errMsg === null) {
      pushRecentInstance({ cwd: finalCwd, name: name.trim() || undefined });
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

  const handleRelKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
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
    if (hasAllow) {
      // 找一个 r.cwd 命中的 base，然后把剩下作为 relative
      const matchedBase = baseList.find((b) => r.cwd === b || r.cwd.startsWith(`${b}/`));
      if (matchedBase) {
        setSelectedBase(matchedBase);
        const rel = r.cwd === matchedBase ? '' : r.cwd.slice(matchedBase.length + 1);
        setRelPath(rel);
      } else {
        // 跨白名单的旧记录：保持 base 不变，rel 留空，让用户感知失配
        setRelPath('');
      }
    } else {
      setCwd(r.cwd);
    }
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

  /**
   * 扫码/URL 命中后：解析 hostname → upsertHost（已存在则不动，新 host 默认 alias=host）
   * → 跳转过去（换 origin 后 useAuth 会接手 token）
   */
  const handleRemoteAccess = (parsedUrl: string): void => {
    try {
      const u = new URL(parsedUrl);
      const host = u.hostname;
      if (host) {
        // 只有未注册时才登记，不覆盖已有 alias
        const existed = hosts.some((h) => h.host === host);
        if (!existed) {
          try {
            upsertHost(host, host);
          } catch {
            /* alias 不能为空 —— 这里直接传 host，理论不会触发 */
          }
        }
      }
    } catch {
      /* URL 已经被 parseAccessUrl 验过，理论上不会失败 */
    }
    window.location.assign(parsedUrl);
  };

  const goBackToPick = (): void => {
    setMode('pick');
    setError(null);
    setScanInvalid(null);
  };

  // ─────────────── footer 渲染 ───────────────
  // 取消按钮统一语义 = "返回上一步"：
  //   阶段 1 (pick) 已是首层 → 关闭 modal 回到实例列表
  //   阶段 2 (form/scan/url) → 回到阶段 1 (pick)
  const handleCancel = (): void => {
    if (mode === 'pick') onClose();
    else goBackToPick();
  };
  const renderCancelButton = (): JSX.Element => (
    <button type="button" onClick={handleCancel} className={s.cancelBtn}>
      {t('common.cancel')}
    </button>
  );

  const pickFooter = renderCancelButton();

  const formFooter = (
    <>
      {renderCancelButton()}
      <button
        type="submit"
        form="create-instance-form"
        disabled={
          submitting ||
          computeFinalCwd().length === 0 ||
          selectedHost !== currentHost
        }
        className={s.submitBtn}
      >
        {submitting ? t('instance.submitting') : t('instance.submit')}
      </button>
    </>
  );

  // scan 模式 footer：仅"取消"（扫码命中自动触发，无 submit 按钮）
  const scanFooter = renderCancelButton();

  // url 模式 footer：取消 + 提交（submit 通过 form id 联动 UrlPastePane 内部 form）
  const urlFooter = (
    <>
      {renderCancelButton()}
      <button type="submit" form="create-instance-url-form" className={s.submitBtn}>
        {t('authPage.urlSubmit')}
      </button>
    </>
  );

  const footer =
    mode === 'pick'
      ? pickFooter
      : mode === 'form'
        ? formFooter
        : mode === 'scan'
          ? scanFooter
          : urlFooter;

  return (
    <Sheet
      id="create-instance-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('instance.create')}
      footer={footer}
    >
      {mode === 'pick' && (
        <div className={s.methods}>
          <div className={s.methodHeader}>
            <span className={s.methodTitle}>{t('instance.addPickMethodTitle')}</span>
            <span className={s.methodHint}>{t('instance.addPickMethodHint')}</span>
          </div>
          <button type="button" className={s.methodCard} onClick={() => setMode('form')}>
            <span className={s.methodIcon}>
              <IconFolderPlus size={20} stroke={1.5} />
            </span>
            <span className={s.methodBody}>
              <span className={s.methodLabel}>{t('instance.addMethodCwdLabel')}</span>
              <span className={s.methodDesc}>{t('instance.addMethodCwdDesc')}</span>
            </span>
          </button>
          <button
            type="button"
            className={s.methodCard}
            onClick={() => {
              setScanInvalid(null);
              setMode('scan');
            }}
          >
            <span className={s.methodIcon}>
              <IconQrcode size={20} stroke={1.5} />
            </span>
            <span className={s.methodBody}>
              <span className={s.methodLabel}>{scanLabel}</span>
              <span className={s.methodDesc}>{t('instance.addMethodScanDesc')}</span>
            </span>
          </button>
          <button type="button" className={s.methodCard} onClick={() => setMode('url')}>
            <span className={s.methodIcon}>
              <IconLink size={20} stroke={1.5} />
            </span>
            <span className={s.methodBody}>
              <span className={s.methodLabel}>{t('instance.addMethodUrlLabel')}</span>
              <span className={s.methodDesc}>{t('instance.addMethodUrlDesc')}</span>
            </span>
          </button>
        </div>
      )}

      {mode === 'form' && (
        <form id="create-instance-form" className={s.form} onSubmit={handleSubmit}>
          <label className={s.field}>
            <span className={s.fieldLabel}>{t('instance.addHostLabel')}</span>
            <select
              className={s.hostSelect}
              value={selectedHost}
              onChange={(e) => setSelectedHost(e.target.value)}
            >
              {hosts.map((h) => {
                const isCurrent = h.host === currentHost;
                const display = displayOf(h.host);
                const label = isCurrent
                  ? `${display} · ${h.host} (${t('instance.addHostCurrentTag')})`
                  : `${display} · ${h.host}`;
                return (
                  <option key={h.host} value={h.host} disabled={!isCurrent}>
                    {label}
                  </option>
                );
              })}
            </select>
            {selectedHost !== currentHost && (
              <p className={s.hostNote}>{t('instance.addHostRemoteDisabled')}</p>
            )}
          </label>

          {hasAllow ? (
            <>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t('instance.cwdBaseLabel')}</span>
                <select
                  className={s.hostSelect}
                  value={selectedBase}
                  onChange={(e) => setSelectedBase(e.target.value)}
                >
                  {baseList.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t('instance.cwdRelativeLabel')}</span>
                <div className={s.cwdWrap}>
                  <TextField
                    ref={relRef}
                    type="text"
                    placeholder={t('instance.cwdRelativeHelper')}
                    value={relPath}
                    mono
                    onChange={(e) => setRelPath(e.target.value)}
                    onClear={() => {
                      setRelPath('');
                      relRef.current?.focus();
                    }}
                    onFocus={() => setShowRecent(true)}
                    onBlur={handleCwdBlur}
                    onKeyDown={handleRelKeyDown}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                  />
                  {showRecent && recent.length > 0 && (
                    <div className={s.recentList} role="listbox">
                      <div className={s.recentHeader}>
                        <IconHistory size={12} stroke={1.5} />
                        <span>{t('instance.recentTitle')}</span>
                      </div>
                      {recent.map((r) => (
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
                      ))}
                    </div>
                  )}
                </div>
                <p className={s.hostNote}>{computeFinalCwd() || t('instance.cwdPreviewEmpty')}</p>
              </label>
            </>
          ) : (
            <>
              <p className={s.allowEmptyWarn}>
                <IconAlertTriangle size={14} stroke={1.5} />
                <span>{t('instance.cwdAllowEmptyWarn')}</span>
              </p>
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
            </>
          )}
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
        </form>
      )}

      {mode === 'scan' && (
        <QrScanPane
          title={t('authPage.scanLabel')}
          subtitle={t('instance.addRemoteHint')}
          cancelLabel={t('instance.altCancel')}
          onCancel={goBackToPick}
          onResult={(text) => {
            const parsed = parseAccessUrl(text);
            if (!parsed) {
              setScanInvalid(t('authPage.scanInvalidQr', { value: trim(text, 40) }));
              return false;
            }
            handleRemoteAccess(parsed);
            return true;
          }}
          invalidNotice={scanInvalid}
          hideActions
        />
      )}

      {mode === 'url' && (
        <UrlPastePane
          title={t('authPage.urlLabel')}
          subtitle={t('instance.addRemoteHint')}
          placeholder={t('authPage.urlPlaceholder')}
          submitLabel={t('authPage.urlSubmit')}
          cancelLabel={t('instance.altCancel')}
          onCancel={goBackToPick}
          onSubmit={(url) => {
            const parsed = parseAccessUrl(url);
            if (!parsed) return t('authPage.urlInvalid');
            handleRemoteAccess(parsed);
            return null;
          }}
          hideActions
          formId="create-instance-url-form"
        />
      )}
    </Sheet>
  );
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
