/**
 * CreateInstanceModal
 *
 * 派生新 headless 实例的简单表单：
 *  - cwd（必填，绝对路径）
 *  - name（可选，留空 = cwd 末段）
 *
 * 阶段 6b 不做：
 *  - WorkspaceSelector（按目录树选）：留作后续打磨
 *  - 实时校验目录存在性（后端会校验，错误信息能显示）
 */

import { useEffect, useState, type JSX, type FormEvent } from 'react';

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
}: CreateInstanceModalProps): JSX.Element | null {
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

  if (!open) return null;

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
    if (ok) {
      onClose();
    } else {
      setError('创建失败：请检查 cwd 是否存在');
    }
  };

  return (
    <div
      className="settings-modal__backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal__panel">
        <header className="settings-modal__header">
          <h2 className="settings-modal__title">创建新实例</h2>
          <button
            type="button"
            className="settings-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <form className="settings-modal__body" onSubmit={handleSubmit}>
          <label className="create-instance__field">
            <span className="create-instance__label">工作目录（cwd）</span>
            <input
              type="text"
              className="auth-card__input"
              placeholder="/home/me/code/foo"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </label>

          <label className="create-instance__field">
            <span className="create-instance__label">实例名（可选）</span>
            <input
              type="text"
              className="auth-card__input"
              placeholder="留空则用 cwd 末段"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>

          {error && <p className="auth-card__error">{error}</p>}

          <footer className="settings-modal__footer">
            <button
              type="button"
              className="settings-modal__btn settings-modal__btn--ghost"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="settings-modal__btn settings-modal__btn--primary"
              disabled={submitting || cwd.trim().length === 0}
            >
              {submitting ? '创建中…' : '创建'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
