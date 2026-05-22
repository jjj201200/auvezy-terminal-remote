/**
 * anchor-bus — wikilink 点击跳转时,把目标 anchor(heading/block-id)
 * 传给即将 mount 的 MarkdownPreview。
 *
 * 形态:模块级单一槽位。wikilink onClick 是同步行为,从点击到目标 MarkdownPreview
 * mount + render 完成之间不会有第二次点击插队(modal-stack 推 preview 是异步,
 * 但下一次点击必须等用户操作)。
 *
 * 如果未来出现并发场景(双窗口 / 程序化触发),改为 Map<instanceId+path, Anchor>。
 */

import type { Anchor } from './resolve-link.js';

interface Pending {
  instanceId: string;
  path: string;
  anchor: Anchor;
}

let pending: Pending | null = null;

export function setPendingAnchor(instanceId: string, path: string, anchor: Anchor): void {
  pending = { instanceId, path, anchor };
}

/**
 * 目标 MarkdownPreview mount + render 完成后调,匹配 instanceId+path 才返回。
 * 返回后 pending 自动清空(防止下次 mount 同文件意外触发上次的 anchor)。
 */
export function consumePendingAnchor(instanceId: string, path: string): Anchor | null {
  if (pending && pending.instanceId === instanceId && pending.path === path) {
    const a = pending.anchor;
    pending = null;
    return a;
  }
  return null;
}
