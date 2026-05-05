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

export interface CreateInstanceModalProps {
  open: boolean;
  /** 提交：返回是否成功 */
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
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="创建新实例"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--color-fg)] hover:bg-[var(--color-bg)]"
          >
            取消
          </button>
          <button
            type="submit"
            form="create-instance-form"
            disabled={submitting || cwd.trim().length === 0}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[#0d1117] disabled:opacity-50"
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <form id="create-instance-form" className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-fg-muted)]">工作目录（cwd）</span>
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
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-fg-muted)]">实例名（可选）</span>
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
        {error && <p className="m-0 font-mono text-xs text-[var(--color-error)]">{error}</p>}
      </form>
    </Sheet>
  );
}
