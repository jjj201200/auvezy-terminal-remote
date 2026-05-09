/**
 * ConfirmProvider + useConfirm
 *
 * 全局二次确认 Modal 服务。
 *
 * 解决：每个用 ConfirmModal 的组件都要自己 useState 管 open + 写 jsx 太啰嗦；
 * 用 Provider 把 modal 实例提到根，组件用 hook 拿到 confirm() 函数：
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: '删除分类', message: '...', tone: 'danger' })) {
 *     // 用户点了确认
 *   }
 *
 * await Promise resolve true（确认）/ false（取消）。
 *
 * 设计：Promise-based 是为了让 CRUD 函数能写线性流程（`if (await confirm) { mutate() }`），
 * 不必到处穿 callback。
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { ConfirmModal } from './ConfirmModal.js';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** 模板字符串 + 变量 + 高亮变量名（与直接 message 二选一） */
  messageTemplate?: string;
  messageVars?: Record<string, string | number>;
  highlightVar?: string;
  /** 'danger' = 红色确认按钮 */
  tone?: 'default' | 'danger';
  /** 自定义按钮文案；默认 common.confirm / common.cancel */
  confirmLabel?: string;
  cancelLabel?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // 持有最新 pending 的引用，避免 onConfirm/onClose 闭包过期
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // 同时只允许一个 confirm 弹窗：第二个挤掉第一个时让前者 resolve(false)
      if (pendingRef.current) {
        pendingRef.current.resolve(false);
      }
      setPending({ options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const p = pendingRef.current;
    setPending(null);
    p?.resolve(true);
  }, []);

  const handleCancel = useCallback(() => {
    const p = pendingRef.current;
    setPending(null);
    p?.resolve(false);
  }, []);

  // useMemo 让 confirm 函数引用稳定（hook 用户传到 useEffect deps 不抖）
  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {pending && (
        <ConfirmModal
          open
          title={pending.options.title}
          message={pending.options.message}
          messageTemplate={pending.options.messageTemplate}
          messageVars={pending.options.messageVars}
          highlightVar={pending.options.highlightVar}
          confirmTone={pending.options.tone ?? 'default'}
          confirmLabel={pending.options.confirmLabel}
          cancelLabel={pending.options.cancelLabel}
          onConfirm={handleConfirm}
          onClose={handleCancel}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

/**
 * useConfirm 返回 confirm(opts) 函数，await 可拿 true/false。
 * 必须包裹在 <ConfirmProvider> 内。
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx);
  if (!fn) {
    throw new Error('useConfirm must be used within <ConfirmProvider>');
  }
  return fn;
}
