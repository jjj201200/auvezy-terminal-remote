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
  ObsidianSettingsModal,
  type ObsidianSettingsModalProps,
} from '../../settings/ObsidianSettingsModal.js';
import {
  MarkdownSettingsModal,
  type MarkdownSettingsModalProps,
} from '../../settings/MarkdownSettingsModal.js';
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
import { PreviewStackView, type PreviewStackViewProps } from '../../files/PreviewStackView.js';

/** 把组件 props 中的 open/onClose/onOpenChange 拆掉,由 presenter 注入 */
type WithoutOpen<P> = Omit<P, 'open' | 'onClose' | 'onOpenChange'>;

/** 调用方一律可以传 onClosed,在退场动画完后回调(用于焦点恢复 / 触发 state 重置) */
type PresenterArgs<Extra> = Extra & { onClosed?: () => void };

interface PresenterMeta {
  kind: string;
  /** 批量操作分组(可选)。与 kind 互补 — 见 ModalEntryInput.group 注释 */
  group?: string;
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
    ...(meta.group != null ? { group: meta.group } : {}),
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

export const useObsidianSettingsPresenter = makeModalPresenter<ObsidianSettingsModalProps>(
  ObsidianSettingsModal,
  { kind: 'obsidian-settings' },
);

export const useMarkdownSettingsPresenter = makeModalPresenter<MarkdownSettingsModalProps>(
  MarkdownSettingsModal,
  { kind: 'markdown-settings' },
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

// kind: 单例语义(文件列表点不同文件 = 替换),group: 批量语义(与 pusher 同组,
// "全部关闭"一键清这两条入口产生的所有 preview)
//
// 与 pusher 的差异:这条路径保留 kind = 'file-preview' → 同 kind 互斥(替换),
// 用于"文件列表点新文件 = 替换当前预览"。但 meta 与 pusher 一致,栈视图能枚举到。
//
// 注意 onCloseAll / onShowStack 也由 presenter 注入(条件:groupSize >= 2),
// 与 pusher 行为一致 — 不管你是从 FileBrowser 入口还是 wikilink 入口推的 preview,
// 在栈深 ≥ 2 时都能看见两个 icon 按钮。
export function useFilePreviewPresenter(): (
  args: PresenterArgs<WithoutOpen<FilePreviewSheetProps>>,
) => string {
  const stack = useModalStack();
  const presentStackView = usePreviewStackViewPresenter();
  return useCallback(
    (args) => {
      const { onClosed, instanceId, target } = args;
      return stack.push({
        kind: 'file-preview',
        group: 'file-preview',
        meta: { instanceId, path: target.path, name: target.name },
        debugLabel: `file-preview:${target.path}`,
        onClosed,
        render: (ctx) => (
          <FilePreviewSheet
            instanceId={instanceId}
            target={target}
            open={ctx.isOpen}
            onOpenChange={(next: boolean) => {
              if (!next) ctx.close();
            }}
            activationSeq={ctx.activatedSeq}
            onCloseAll={
              ctx.groupSize >= 2 ? () => stack.popGroup('file-preview') : undefined
            }
            onShowStack={
              ctx.groupSize >= 2 ? () => presentStackView({ instanceId }) : undefined
            }
          />
        ),
      });
    },
    [stack, presentStackView],
  );
}

/**
 * PreviewStackView presenter — kind 单例(同时只有一个栈视图),不带 group
 * (它本身不属于 file-preview 组,popGroup 不能关它;由它自己内部 useEffect
 * 在 file-preview 数 <=1 时主动 close)。
 */
export const usePreviewStackViewPresenter = makeSheetPresenter<PreviewStackViewProps>(
  PreviewStackView,
  { kind: 'file-preview-stack-view' },
);

/**
 * Wikilink 跨文件预览专用 presenter — 允许叠加 + 环检测。
 *
 * 与 useFilePreviewPresenter 的差异:
 *  - 不传 kind(允许多个 file-preview 共存),改用 group: 'file-preview' 做批量操作
 *  - 环检测:同 (instanceId, path) 已在栈中 → bringToTop(不重 mount,scrollTop 保留)
 *  - 传 ctx.activatedSeq 给 FilePreviewSheet,让 MarkdownPreview 在 bringToTop 时
 *    重新触发 anchor scrollIntoView
 *  - 栈中同 group 数 ≥ 2 时给 FilePreviewSheet onCloseAll(显示"全部关闭"按钮)
 *
 * FileBrowser 入口仍用 useFilePreviewPresenter(单例语义不变 — 列表中点不同文件
 * 期望替换而非堆叠)。
 */
type FilePreviewPusherArgs = PresenterArgs<WithoutOpen<FilePreviewSheetProps>>;

export function useFilePreviewPusher(): (args: FilePreviewPusherArgs) => string {
  const stack = useModalStack();
  const presentStackView = usePreviewStackViewPresenter();
  return useCallback(
    (args) => {
      const { onClosed, instanceId, target } = args;
      // 环检测:已存在该 (instanceId, path) → bringToTop,不再 push
      const existingId = stack.find(
        (m) => m?.['instanceId'] === instanceId && m?.['path'] === target.path,
      );
      if (existingId) {
        stack.bringToTop(existingId);
        return existingId;
      }
      return stack.push({
        group: 'file-preview',
        meta: { instanceId, path: target.path, name: target.name },
        debugLabel: `file-preview:${target.path}`,
        onClosed,
        render: (ctx) => (
          <FilePreviewSheet
            instanceId={instanceId}
            target={target}
            open={ctx.isOpen}
            onOpenChange={(next) => {
              if (!next) ctx.close();
            }}
            activationSeq={ctx.activatedSeq}
            onCloseAll={
              ctx.groupSize >= 2 ? () => stack.popGroup('file-preview') : undefined
            }
            onShowStack={
              ctx.groupSize >= 2 ? () => presentStackView({ instanceId }) : undefined
            }
          />
        ),
      });
    },
    [stack, presentStackView],
  );
}

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

