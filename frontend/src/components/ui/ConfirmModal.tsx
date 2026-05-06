/**
 * ConfirmModal
 *
 * 替代 window.confirm / window.alert 的页内确认 modal。
 * 桌面 = 居中 Dialog，移动 = 底部 Drawer（复用 Sheet）。
 *
 * 用法：
 *  - 单按钮 alert：传 onConfirm 但 confirmTone='default'，可省 onCancel
 *  - 双按钮 confirm：onConfirm + onClose（取消等同于 onClose）
 *  - 危险操作（关实例 / 删数据）：confirmTone='danger' → 红色按钮
 *  - 文案高亮：传 messageTemplate + messageVars + highlightVar，
 *    模板里 {{name}} 那段会用 <strong> 包起来视觉强调
 */

import { type JSX, type ReactNode } from 'react';
import { Sheet } from './Sheet.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './ConfirmModal.module.scss';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** 直接传 ReactNode；与 messageTemplate 二选一 */
  message?: ReactNode;
  /**
   * 模板字符串（含 {{var}} 占位），与 messageVars 一起用。
   * highlightVar 指定哪个变量名要被 <strong> 包起来高亮。
   */
  messageTemplate?: string;
  messageVars?: Record<string, string | number>;
  highlightVar?: string;
  /** 确认按钮文案，默认 common.confirm */
  confirmLabel?: string;
  /** 取消按钮文案，默认 common.cancel；singleButton=true 时无此按钮 */
  cancelLabel?: string;
  /** 危险操作 → 确认按钮变红 */
  confirmTone?: 'default' | 'danger';
  /** 单按钮模式：仅显示确认按钮（用作 alert 替代） */
  singleButton?: boolean;
  /**
   * 第三个按钮（cancel 与 confirm 之间），用作"次选行为"。
   * 例如关闭实例 modal 里的"断开连接"——比 confirm 更温和。
   * 触发后通常关闭 modal（由 extraAction 自己决定）
   */
  extraLabel?: string;
  onExtra?: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 把含 {{var}} 的模板渲染成 ReactNode：highlightVar 命中的占位换成 <strong>。
 * 其它变量正常字符串替换；未命中变量保留原样占位（debug 友好）。
 */
function renderTemplate(
  template: string,
  vars: Record<string, string | number> | undefined,
  highlightVar: string | undefined,
): ReactNode[] {
  const re = /\{\{(\w+)\}\}/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push(template.slice(last, m.index));
    const name = m[1]!;
    const val = vars?.[name];
    if (name === highlightVar) {
      parts.push(
        <strong key={`h-${key++}`} className={s.highlight}>
          {val === undefined ? `{{${name}}}` : String(val)}
        </strong>,
      );
    } else {
      parts.push(val === undefined ? `{{${name}}}` : String(val));
    }
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}

export function ConfirmModal({
  open,
  title,
  message,
  messageTemplate,
  messageVars,
  highlightVar,
  confirmLabel,
  cancelLabel,
  confirmTone = 'default',
  singleButton = false,
  extraLabel,
  onExtra,
  onConfirm,
  onClose,
}: ConfirmModalProps): JSX.Element {
  const t = useT();
  const body: ReactNode = message
    ?? (messageTemplate
      ? renderTemplate(messageTemplate, messageVars, highlightVar)
      : null);

  const confirmBtnClass = `${s.confirmBtn} ${
    confirmTone === 'danger' ? s.confirmBtnDanger : s.confirmBtnDefault
  }`;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      footer={
        <>
          {!singleButton && (
            <button type="button" onClick={onClose} className={s.cancelBtn}>
              {cancelLabel ?? t('common.cancel')}
            </button>
          )}
          {extraLabel && onExtra && (
            <button type="button" onClick={onExtra} className={s.extraBtn}>
              {extraLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={confirmBtnClass}
            autoFocus
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className={s.body}>{body}</p>
    </Sheet>
  );
}
