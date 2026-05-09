/**
 * ConfirmProvider + useConfirm
 *
 * Promise-based 二次确认服务。0.7 重构后接入 ModalStack：每次 confirm() 调用
 * 通过 stack.push 推一个嵌套 modal，自动叠在当前栈顶之上。
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: '删除分类', message: '...', tone: 'danger' })) {
 *     // 用户点了确认
 *   }
 *
 * 与旧版区别：
 *  - 不再用 useState 管 pending —— pending 由 ModalStack 维护
 *  - 不需要 <ConfirmModal> 渲染节点，直接 push
 *  - 多个 confirm 嵌套（confirm A 弹 confirm B）→ stack 自然支持，A 等 B 决议
 */

import {
  createContext,
  useCallback,
  useContext,
  type JSX,
  type ReactNode,
} from 'react';
import { ConfirmModal } from './ConfirmModal.js';
import { ModalStackOutlet, useModalStack } from './modal-stack/ModalStack.js';

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
  /**
   * 单按钮模式（alert 替代）。true → 仅"确认"按钮，无"取消"。
   * 用户点确认后 resolve(true)；点 backdrop / esc resolve(false)
   */
  singleButton?: boolean;
  /**
   * 第三按钮（位于"取消"和"确认"之间）。给"次选行为"用，例如：
   *   关实例确认里的"断开（仅本设备）"——比红色"关实例"温和一档
   * 触发后 resolve('extra')；与 confirm/cancel 互斥
   */
  extraLabel?: string;
}

/** confirm() 的返回值：true=确认 / false=取消 / 'extra'=点了第三按钮 */
export type ConfirmResult = boolean | 'extra';

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const stack = useModalStack();

  const confirm = useCallback<ConfirmFn>(
    (options) => {
      return new Promise<ConfirmResult>((resolve) => {
        let resolved = false;
        const settle = (v: ConfirmResult): void => {
          if (resolved) return;
          resolved = true;
          resolve(v);
        };
        stack.push({
          // 不传 kind → 总是叠加；同时打开多个 confirm 的极端场景下也能嵌套
          dismissible: true,
          render: (ctx) => (
            <ConfirmModal
              open={ctx.isOpen}
              title={options.title}
              message={options.message}
              messageTemplate={options.messageTemplate}
              messageVars={options.messageVars}
              highlightVar={options.highlightVar}
              confirmTone={options.tone ?? 'default'}
              confirmLabel={options.confirmLabel}
              cancelLabel={options.cancelLabel}
              singleButton={options.singleButton}
              extraLabel={options.extraLabel}
              onExtra={
                options.extraLabel
                  ? () => {
                      settle('extra');
                      ctx.close();
                    }
                  : undefined
              }
              onConfirm={() => {
                settle(true);
                ctx.close();
              }}
              onClose={() => {
                settle(false);
                ctx.close();
              }}
            />
          ),
          // esc / 点 backdrop → ctx.close 触发，但不会调 onConfirm/onClose
          // 所以这里兜底：modal 退场时若还没 settle，视为取消
          onClosed: () => settle(false),
          debugLabel: 'confirm',
        });
      });
    },
    [stack],
  );

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {/*
        Modal 渲染出口：放在 ConfirmCtx 内，让 modal 内部组件能用 useConfirm
        （否则 ModalStack 默认在 ModalStackProvider 下渲染，那里 ConfirmCtx 还没设）
      */}
      <ModalStackOutlet />
    </ConfirmCtx.Provider>
  );
}

/**
 * useConfirm 返回 confirm(opts) 函数，await 可拿 true/false。
 * 必须包裹在 <ConfirmProvider>（且其上必须有 <ModalStackProvider>）内。
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx);
  if (!fn) {
    throw new Error('useConfirm must be used within <ConfirmProvider>');
  }
  return fn;
}
