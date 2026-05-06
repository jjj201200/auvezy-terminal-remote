/**
 * CreateInstanceModal
 *
 * 派生新 headless 实例的表单（Sheet 化）：
 *  - cwd（必填，绝对路径） + name（可选）
 *  - cwd 输入框 focus 时弹出"最近创建过"下拉，点击填充（支持 × 删除单条）
 *  - cwd 回车 → focus 跳到 name；name 回车 → submit
 *  - 不影响"自由输入"：用户可不选历史，自己输入
 */

import { useEffect, useRef, useState, type JSX, type FormEvent, type KeyboardEvent } from 'react';
import { IconHistory, IconX } from '@tabler/icons-react';
import { Sheet } from '../ui/Sheet.js';
import { TextField } from '../ui/TextField.js';
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

export function CreateInstanceModal({
  open,
  onSubmit,
  onClose,
}: CreateInstanceModalProps): JSX.Element {
  const t = useT();
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInstance[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  const cwdRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setCwd('');
      setName('');
      setError(null);
      setSubmitting(false);
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
      // 成功 → 写入 LRU
      pushRecentInstance({ cwd: cwd.trim(), name: name.trim() || undefined });
      onClose();
    } else {
      setError(errMsg);
    }
  };

  // cwd 回车 → 跳 name；name 回车 → submit。受控输入框默认行为已被 form 接管，
  // 我们用 keydown 拦截只负责跳焦
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

  // 点击历史项：填 cwd + name；不自动 submit（让用户决定是否改）
  const pickRecent = (r: RecentInstance): void => {
    setCwd(r.cwd);
    if (r.name) setName(r.name);
    setShowRecent(false);
    // 自然焦点跳到 name（cwd 已填好）
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const handleRemoveRecent = (cwdToRemove: string): void => {
    removeRecentInstance(cwdToRemove);
    refreshRecent();
  };

  // 失焦时关下拉，但延迟一帧让 onClick 有机会触发
  const handleCwdBlur = (): void => {
    setTimeout(() => setShowRecent(false), 150);
  };

  return (
    <Sheet
      id="create-instance-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('instance.create')}
      footer={
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
      }
    >
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
                      // mousedown 比 click 早，且不会让 input 先失焦
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
                          // 只阻止冒泡到父项的 onMouseDown，不要 preventDefault
                          // —— preventDefault 会让按钮自己也无法触发 click
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
      </form>
    </Sheet>
  );
}
