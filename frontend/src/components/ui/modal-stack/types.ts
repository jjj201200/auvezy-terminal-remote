/**
 * ModalStack 类型定义
 *
 * 一个 ModalStack 就是一个有序数组，最后一个元素是当前最上层 modal。
 * 每个元素由调用方提供：
 *   - id：内部生成的 UUID，用作 push/replace/popTo 等操作的句柄
 *   - kind：可选的语义键。同 kind 的 modal 默认互斥（push 时若栈顶已是同 kind → 自动 replace）
 *   - render：纯函数，返回 modal body / footer。render 时由 stack 注入 helpers（pop 等）
 *   - onClosed：modal 退场动画结束后回调，给调用方做清理（恢复焦点、reset 父级 state 等）
 *
 * 设计要点：
 *  1. 单 portal：所有 modal 都共用一个 root portal，避免 Radix Portal 多实例时的 z-index 抢夺
 *  2. 层级 = 栈下标，z-index 自动按 (z-modal + idx * step) 计算
 *  3. push 子 modal 时，下层 modal 不卸载（state 保留），只把 aria-hidden 设上、暂停其交互
 *  4. esc 默认 pop 顶层；点 backdrop 默认 pop 顶层（可由 entry.dismissible=false 关闭）
 */

import type { ReactNode } from 'react';

/** 调用方拿到的 stack handle，所有操作都通过它发起 */
export interface ModalStackHandle {
  /** 推入一个新 modal；返回 id 用作后续 pop / replace */
  push: (entry: ModalEntryInput) => string;
  /** 替换栈顶（同 kind 互斥时自动调用，也可手动用） */
  replace: (entry: ModalEntryInput) => string;
  /** 弹出指定 id 对应的 modal；不传 = 弹出栈顶 */
  pop: (id?: string) => void;
  /** 关到指定 id（包含），用于"返回特定层级" */
  popTo: (id: string) => void;
  /** 关闭整个栈 */
  dismiss: () => void;
  /** 当前栈深度（开发调试用） */
  depth: () => number;
}

/** 调用方提交给 stack 的 modal 描述（id 由 stack 生成） */
export interface ModalEntryInput {
  /**
   * 语义键。同 kind 的 modal 互斥（push 时栈顶已是同 kind → 自动 replace）。
   * 不传 = 总是叠加（用于真正的嵌套，如 confirm-from-detail）
   */
  kind?: string;
  /**
   * Modal 的渲染函数。stack 把 helpers 注入进来，让 modal 内部能 pop / push 子 modal。
   * 注：ModalShell 的 open / onOpenChange / 标题 / footer 由 render 函数自己用 ModalShell 组件生成
   */
  render: (ctx: ModalRenderContext) => ReactNode;
  /**
   * 点 backdrop / 按 esc 是否能关闭。默认 true。
   * 用于"必须显式选择"场景（如关键确认对话框，要求用户点确定 / 取消，不允许误关）
   */
  dismissible?: boolean;
  /**
   * 退场动画结束后回调。调用方在这里做：
   *  - 把触发该 modal 的源 state 重置（如 setDetailFor(null)）
   *  - 恢复触发按钮的焦点
   */
  onClosed?: () => void;
  /** debug 标签 */
  debugLabel?: string;
}

/** push 后内部存储的完整条目 */
export interface ModalEntry extends Required<Pick<ModalEntryInput, 'render'>> {
  id: string;
  kind: string | undefined;
  dismissible: boolean;
  onClosed: (() => void) | undefined;
  debugLabel: string | undefined;
  /** 是否正在退场（动画中，等 onClosed 触发后从数组里移除） */
  closing: boolean;
}

/** stack 注入给 render 函数的上下文 */
export interface ModalRenderContext {
  /** 当前 modal 的 id（让 render 内部能拿到自己） */
  id: string;
  /** 关掉自己（= stack.pop(id)） */
  close: () => void;
  /** 在自己上面 push 子 modal */
  pushChild: (entry: ModalEntryInput) => string;
  /** 替换为同级 modal（自己被卸载，新 modal 在同位置） */
  replaceSelf: (entry: ModalEntryInput) => string;
  /**
   * 是否是栈顶（被遮挡时为 false）。
   * 子 modal push 后，父 modal 的 isTop 变 false → 父 modal 内部输入框可以禁用、避免抢焦点
   */
  isTop: boolean;
  /** 自己在栈中的下标（0 = 最底层） */
  index: number;
  /**
   * Modal 当前应该是"打开"还是"关闭"状态。
   * pop 时 stack 不立即把 entry 从数组移除，先把它设为 closing=false（即 isOpen=false）
   * 让 Radix/vaul 内部的 open prop 转 false → 触发退场动画 → 动画完成后真移除。
   * render 函数把这个值传给 Sheet 的 `open` prop。
   */
  isOpen: boolean;
}
