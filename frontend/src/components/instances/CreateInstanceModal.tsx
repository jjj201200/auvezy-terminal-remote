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
      setError('cwd 不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(cwd.trim(), name.trim() || undefined);
    setSubmitting(false);
    if (ok) onClose();
    else setError('创建失败：请检查 cwd 是否存在');
  };

  return (
    <Sheet
      id="create-instance-modal"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="创建新实例"
      footer={
        <>
          <button type="button" onClick={onClose} className={s.cancelBtn}>
            取消
          </button>
          <button
            type="submit"
            form="create-instance-form"
            disabled={submitting || cwd.trim().length === 0}
            className={s.submitBtn}
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <form id="create-instance-form" className={s.form} onSubmit={handleSubmit}>
        <label className={s.field}>
          <span className={s.fieldLabel}>工作目录（cwd）</span>
          <TextField
            type="text"
            placeholder="/home/me/code/foo"
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
          <span className={s.fieldLabel}>实例名（可选）</span>
          <TextField
            type="text"
            placeholder="留空则用 cwd 末段"
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
