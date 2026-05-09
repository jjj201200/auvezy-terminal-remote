/**
 * Modal 呈现器（thin wrappers）
 *
 * 把 "xx Modal 组件 + open/onClose props" 的旧式调用，封装成 `present(args)` 函数式。
 * 调用方写：
 *   const present = useCreateInstancePresenter();
 *   present({ onSubmit, onSuccess: () => ... });
 *
 * 内部走 stack.push，自动管 z-index / esc / 多层嵌套。组件本身（CreateInstanceModal 等）
 * 仍保持原 props 接口（open/onClose），只是被 presenter 隐藏。
 */

import { useCallback } from 'react';
import { useModalStack } from './ModalStack.js';

import { CreateInstanceModal, type CreateInstanceModalProps } from '../../instances/CreateInstanceModal.js';
import { InstanceDetailModal, type InstanceDetailModalProps } from '../../instances/InstanceDetailModal.js';
import { SettingsModal, type SettingsModalProps } from '../../settings/SettingsModal.js';
import { ShareSheet, type ShareSheetProps } from '../../share/ShareSheet.js';
import { MobileInstanceSwitcher, type MobileInstanceSwitcherProps } from '../../instances/MobileInstanceSwitcher.js';

/** 把"xxx + open/onClose" 类组件升级成 stack-aware presenter */
type WithoutOpen<P> = Omit<P, 'open' | 'onClose' | 'onOpenChange'>;

// ─────────────────────── CreateInstance ───────────────────────

export function useCreateInstancePresenter(): (
  args: WithoutOpen<CreateInstanceModalProps> & { onClosed?: () => void },
) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'create-instance',
        debugLabel: 'create-instance',
        onClosed,
        render: (ctx) => (
          <CreateInstanceModal {...(rest as WithoutOpen<CreateInstanceModalProps>)} open onClose={ctx.close} />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── InstanceDetail ───────────────────────

export function useInstanceDetailPresenter(): (
  args: WithoutOpen<InstanceDetailModalProps> & { onClosed?: () => void },
) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'instance-detail',
        debugLabel: 'instance-detail',
        onClosed,
        render: (ctx) => (
          <InstanceDetailModal
            {...(rest as WithoutOpen<InstanceDetailModalProps>)}
            open
            onClose={ctx.close}
          />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── Settings ───────────────────────

export function useSettingsPresenter(): (
  args: WithoutOpen<SettingsModalProps> & { onClosed?: () => void },
) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'settings',
        debugLabel: 'settings',
        onClosed,
        render: (ctx) => (
          <SettingsModal {...(rest as WithoutOpen<SettingsModalProps>)} open onClose={ctx.close} />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── Share ───────────────────────

export function useSharePresenter(): (args: { onClosed?: () => void }) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      return stack.push({
        kind: 'share',
        debugLabel: 'share',
        onClosed: args.onClosed,
        render: (ctx) => <ShareSheet open onOpenChange={(next) => { if (!next) ctx.close(); }} />,
      });
    },
    [stack],
  );
}

// ─────────────────────── MobileInstanceSwitcher / 主机管理 sheet ───────────────────────

type ManageHostsArgs = Omit<
  MobileInstanceSwitcherProps,
  'externalOpen' | 'onExternalOpenChange' | 'hideTrigger'
> & { onClosed?: () => void };

export function useManageHostsPresenter(): (args: ManageHostsArgs) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'manage-hosts',
        debugLabel: 'manage-hosts',
        onClosed,
        render: (ctx) => (
          <MobileInstanceSwitcher
            {...rest}
            externalOpen
            onExternalOpenChange={(next) => {
              if (!next) ctx.close();
            }}
            hideTrigger
          />
        ),
      });
    },
    [stack],
  );
}
