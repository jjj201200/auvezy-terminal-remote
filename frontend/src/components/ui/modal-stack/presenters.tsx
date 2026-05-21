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
import { FileBrowserSheet } from '../../files/FileBrowserSheet.js';
import { FilePreviewSheet } from '../../files/FilePreviewSheet.js';
import type { PreviewTarget } from '../../files/PreviewPane.js';

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
          <CreateInstanceModal
            {...(rest as WithoutOpen<CreateInstanceModalProps>)}
            open={ctx.isOpen}
            onClose={ctx.close}
          />
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
            open={ctx.isOpen}
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
          <SettingsModal
            {...(rest as WithoutOpen<SettingsModalProps>)}
            open={ctx.isOpen}
            onClose={ctx.close}
          />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── ClaudeCode 集成详细设置 ───────────────────────

export function useClaudeCodeSettingsPresenter(): (
  args: WithoutOpen<ClaudeCodeSettingsModalProps> & { onClosed?: () => void },
) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'claude-code-settings',
        debugLabel: 'claude-code-settings',
        onClosed,
        render: (ctx) => (
          <ClaudeCodeSettingsModal
            {...(rest as WithoutOpen<ClaudeCodeSettingsModalProps>)}
            open={ctx.isOpen}
            onClose={ctx.close}
          />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── 快捷键管理 ───────────────────────

export function useShortcutSettingsPresenter(): (
  args: WithoutOpen<ShortcutSettingsModalProps> & { onClosed?: () => void },
) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'shortcut-settings',
        debugLabel: 'shortcut-settings',
        onClosed,
        render: (ctx) => (
          <ShortcutSettingsModal
            {...(rest as WithoutOpen<ShortcutSettingsModalProps>)}
            open={ctx.isOpen}
            onClose={ctx.close}
          />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── 命令管理 ───────────────────────

export function useCommandSettingsPresenter(): (
  args: WithoutOpen<CommandSettingsModalProps> & { onClosed?: () => void },
) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      const { onClosed, ...rest } = args;
      return stack.push({
        kind: 'command-settings',
        debugLabel: 'command-settings',
        onClosed,
        render: (ctx) => (
          <CommandSettingsModal
            {...(rest as WithoutOpen<CommandSettingsModalProps>)}
            open={ctx.isOpen}
            onClose={ctx.close}
          />
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
        render: (ctx) => (
          <ShareSheet
            open={ctx.isOpen}
            onOpenChange={(next) => {
              if (!next) ctx.close();
            }}
          />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── FileBrowserSheet ───────────────────────

export function useFileBrowserPresenter(): (args: { instanceId: string; onClosed?: () => void }) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      return stack.push({
        kind: 'file-browser',
        debugLabel: 'file-browser',
        onClosed: args.onClosed,
        render: (ctx) => (
          <FileBrowserSheet
            open={ctx.isOpen}
            instanceId={args.instanceId}
            onOpenChange={(next) => {
              if (!next) ctx.close();
            }}
          />
        ),
      });
    },
    [stack],
  );
}

// ─────────────────────── FilePreviewSheet(modal-stack 第二层) ───────────────────────

export function useFilePreviewPresenter(): (args: {
  instanceId: string;
  target: PreviewTarget;
  onClosed?: () => void;
}) => string {
  const stack = useModalStack();
  return useCallback(
    (args) => {
      return stack.push({
        kind: 'file-preview',
        debugLabel: 'file-preview',
        onClosed: args.onClosed,
        render: (ctx) => (
          <FilePreviewSheet
            open={ctx.isOpen}
            instanceId={args.instanceId}
            target={args.target}
            onOpenChange={(next) => {
              if (!next) ctx.close();
            }}
          />
        ),
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
            externalOpen={ctx.isOpen}
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
