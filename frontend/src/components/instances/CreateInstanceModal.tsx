/**
 * CreateInstanceModal
 *
 * 派生新 headless 实例的简单表单（Sheet 化）：
 *  - cwd（必填，绝对路径）
 *  - name（可选，留空 = cwd 末段）
 */

import { useEffect, useState, type JSX, type FormEvent } from 'react';
import { Sheet } from '../ui/Sheet.js';
import { TextField } from '../ui/TextField.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './CreateInstanceModal.module.scss';

export interface CreateInstanceModalProps {
  open: boolean;
  onSubmit: (cwd: string, name?: string) => Promise<boolean>;
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

  useEffect(() => {
    if (open) {
      setCwd('');
      setName('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!cwd.trim()) {
      setError(t('instance.errorEmptyCwd'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(cwd.trim(), name.trim() || undefined);
    setSubmitting(false);
    if (ok) onClose();
    else setError(t('instance.errorCreateFailed'));
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
          <TextField
            type="text"
            placeholder={t('instance.workdirHelper')}
            value={cwd}
            mono
            onChange={(e) => setCwd(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label className={s.field}>
          <span className={s.fieldLabel}>{t('instance.nameLabelOptional')}</span>
          <TextField
            type="text"
            placeholder={t('instance.namePlaceholder')}
            value={name}
            mono
            onChange={(e) => setName(e.target.value)}
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
