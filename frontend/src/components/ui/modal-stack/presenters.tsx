/**
 * Modal 呈现器(thin wrappers)
 *
 * 把 "xx Modal 组件 + open/onClose props" 的旧式调用封装成 `present(args)` 函数式:
 *   const present = useCreateInstancePresenter();
 *   present({ onSubmit, onSuccess: () => ... });
 *
 * 内部走 stack.push,自动管 z-index / esc / 多层嵌套。
 *
 * Why 两个 factory(makeModalPresenter / makeSheetPresenter):
 *   Modal 类组件接 { open, onClose },Sheet 类接 { open, onOpenChange(next) }。
 *   抽两个公共 factory 消掉 10 个 presenter 各自重复的 stack.push + ctx.close 胶水;
 *   两个签名差异不大但语义不同,合一个 factory 会让调用方误传 prop 名。
 */

import { useCallback, type ComponentType, type ReactNode } from 'react';
import type { ModalEntryInput, ModalRenderContext, ModalStackHandle } from './types.js';
import { useModalStack } from './ModalStack.js';

import { CreateInstanceModal, type CreateInstanceModalProps } from '../../instances/CreateInstanceModal.js';
import { InstanceDetailModal, type InstanceDetailModalProps } from '../../instances/InstanceDetailModal.js';
import { SettingsModal, type SettingsModalProps } from '../../settings/SettingsModal.js';
import {
  ClaudeCodeSettingsModal,
  type ClaudeCodeSettingsModalProps,
} from '../../settings/ClaudeCodeSettingsModal.js';
import {
  ShortcutSettingsModal,
  type ShortcutSettingsModalProps,
} from '../../settings/ShortcutSettingsModal.js';
import {
  CommandSettingsModal,
  type CommandSettingsModalProps,
} from '../../settings/CommandSettingsModal.js';
import { ShareSheet, type ShareSheetProps } from '../../share/ShareSheet.js';
import { MobileInstanceSwitcher, type MobileInstanceSwitcherProps } from '../../instances/MobileInstanceSwitcher.js';
import { FileBrowserSheet, type FileBrowserSheetProps } from '../../files/FileBrowserSheet.js';
import { FilePreviewSheet, type FilePreviewSheetProps } from '../../files/FilePreviewSheet.js';

/** 把组件 props 中的 open/onClose/onOpenChange 拆掉,由 presenter 注入 */
type WithoutOpen<P> = Omit<P, 'open' | 'onClose' | 'onOpenChange'>;

/** 调用方一律可以传 onClosed,在退场动画完后回调(用于焦点恢复 / 触发 state 重置) */
type PresenterArgs<Extra> = Extra & { onClosed?: () => void };

interface PresenterMeta {
  kind: string;
  debugLabel?: string;
}

function pushModal(
  stack: ModalStackHandle,
  meta: PresenterMeta,
  onClosed: (() => void) | undefined,
  render: (ctx: ModalRenderContext) => ReactNode,
): string {
  const entry: ModalEntryInput = {
    kind: meta.kind,
    debugLabel: meta.debugLabel ?? meta.kind,
    onClosed,
    render,
  };
  return stack.push(entry);
}

/**
 * Modal 类组件(接 { open, onClose })的 presenter factory。
 *
 * 直接把组件传进来,生成 useXxxPresenter hook。
 */
function makeModalPresenter<P extends { open: boolean; onClose: () => void }>(
  Component: ComponentType<P>,
  meta: PresenterMeta,
): () => (args: PresenterArgs<WithoutOpen<P>>) => string {
  return function usePresenter() {
    const stack = useModalStack();
    return useCallback(
      (args) => {
        const { onClosed, ...rest } = args;
        return pushModal(stack, meta, onClosed, (ctx) => (
          <Component
            {...(rest as unknown as P)}
            open={ctx.isOpen}
            onClose={ctx.close}
          />
        ));
      },
      [stack],
    );
  };
}

/**
 * Sheet 类组件(接 { open, onOpenChange(next) })的 presenter factory。
 *
 * next === false 时调 ctx.close;否则忽略(Sheet 的 onOpenChange(true) 不应该来自子组件)。
 */
function makeSheetPresenter<P extends { open: boolean; onOpenChange: (next: boolean) => void }>(
  Component: ComponentType<P>,
  meta: PresenterMeta,
): () => (args: PresenterArgs<WithoutOpen<P>>) => string {
  return function usePresenter() {
    const stack = useModalStack();
    return useCallback(
      (args) => {
        const { onClosed, ...rest } = args;
        return pushModal(stack, meta, onClosed, (ctx) => (
          <Component
            {...(rest as unknown as P)}
            open={ctx.isOpen}
            onOpenChange={(next: boolean) => { if (!next) ctx.close(); }}
          />
        ));
      },
      [stack],
    );
  };
}

// ─────────────────────── Modal 类 ───────────────────────

export const useCreateInstancePresenter = makeModalPresenter<CreateInstanceModalProps>(
  CreateInstanceModal,
  { kind: 'create-instance' },
);

export const useInstanceDetailPresenter = makeModalPresenter<InstanceDetailModalProps>(
  InstanceDetailModal,
  { kind: 'instance-detail' },
);

export const useSettingsPresenter = makeModalPresenter<SettingsModalProps>(
  SettingsModal,
  { kind: 'settings' },
);

export const useClaudeCodeSettingsPresenter = makeModalPresenter<ClaudeCodeSettingsModalProps>(
  ClaudeCodeSettingsModal,
  { kind: 'claude-code-settings' },
);

export const useShortcutSettingsPresenter = makeModalPresenter<ShortcutSettingsModalProps>(
  ShortcutSettingsModal,
  { kind: 'shortcut-settings' },
);

export const useCommandSettingsPresenter = makeModalPresenter<CommandSettingsModalProps>(
  CommandSettingsModal,
  { kind: 'command-settings' },
);

// ─────────────────────── Sheet 类 ───────────────────────

export const useSharePresenter = makeSheetPresenter<ShareSheetProps>(
  ShareSheet,
  { kind: 'share' },
);

export const useFileBrowserPresenter = makeSheetPresenter<FileBrowserSheetProps>(
  FileBrowserSheet,
  { kind: 'file-browser' },
);

export const useFilePreviewPresenter = makeSheetPresenter<FilePreviewSheetProps>(
  FilePreviewSheet,
  { kind: 'file-preview' },
);

// ─────────────────────── 特殊接口:MobileInstanceSwitcher ───────────────────────

/**
 * MobileInstanceSwitcher 是受控 / 非受控双模组件,prop 名是 externalOpen /
 * onExternalOpenChange(不是通用的 open / onOpenChange),所以走自定义 render
 * 而不是上面的 factory。这是整个文件里唯一的特例。
 */
type ManageHostsArgs = PresenterArgs<
  Omit<MobileInstanceSwitcherProps, 'externalOpen' | 'onExternalOpenChange' | 'hideTrigger'>
>;

export function useManageHostsPresenter(): (args: ManageHostsArgs) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return pushModal(stack, { kind: 'manage-hosts' }, onClosed, (ctx) => (
        <MobileInstanceSwitcher
          {...rest}
          externalOpen={ctx.isOpen}
          onExternalOpenChange={(next) => { if (!next) ctx.close(); }}
          hideTrigger
        />
      ));
    },
    [stack],
  );
}

