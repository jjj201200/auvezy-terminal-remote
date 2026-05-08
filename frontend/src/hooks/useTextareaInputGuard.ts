/**
 * useTextareaInputGuard
 *
 * 给 textarea 装一层 iOS Smart Punctuation / QuickType / 自动空格删除等智能
 * 键盘行为的防御层。把"用户真实意图"通过 onCommit 回调暴露给外部。
 *
 * ## 设计哲学：CodeMirror 风格的 DOM-as-truth + 后置矫正
 *
 * 不监听单个事件（beforeinput / keydown）的语义类型——iOS 上事件可以乱序、
 * 重复、被合成。只看 textarea.value 的**最终态**变化（diff），用 80ms 防抖
 * 等所有 iOS 智能行为落地后一次性 commit。
 *
 * 模式匹配（CodeMirror domchange.ts:144 同款）：
 *   - smart-punct: prev='X '  actual='X.' (单 postSmartSet 字符) →
 *                  iOS 把空格替换成标点，撤销之 → commit insert(标点)，保留空格
 *
 * 终端语义：用户实际按了什么字符，PTY 就收到什么字符。iOS 智能键盘的中间态
 * （删空格、加标点的两步实现）对 PTY 完全透明。
 *
 * ## 两种使用模式
 *
 * 区别仅在调用方语义，hook 内部完全一致：
 *  - **stream** (终端直接输入)：每次 commit 后调用方 send 字节流到 PTY；
 *    buffer 由调用方在合适时机（Enter 提交后）调 clear() 重置
 *  - **buffered** (命令编辑栏)：buffer 累积成草稿；调用方通过 getBuffer() /
 *    setValue() 命令式控制
 */

import { useCallback, useEffect, useRef } from 'react';

/** WebKit SmartReplaceCF.cpp postSmartSet：触发 smart-punct 的字符 */
const POST_SMART_SET = new Set([
  ')', ']', '.', ',', ';', ':', '?', "'", '!', '"', '%', '*', '-', '/', '}',
]);

/** 防抖窗口：等 iOS 智能键盘所有事件落地后才 diff commit */
const SETTLE_MS = 80;

export type InputIntent =
  | { kind: 'insert'; text: string }
  | { kind: 'delete'; count: number }
  | { kind: 'replace'; deleteCount: number; insert: string };

export type InputGuardMode = 'stream' | 'buffered';

export interface UseTextareaInputGuardOptions {
  mode: InputGuardMode;
  filter?: (intent: InputIntent, ctx: { buffer: string }) => InputIntent | null;
  onCommit: (intent: InputIntent, ctx: { buffer: string }) => void;
  composingRef: React.MutableRefObject<boolean>;
}

export interface UseTextareaInputGuardReturn {
  getBuffer: () => string;
  setBuffer: (text: string) => void;
  clear: () => void;
  /** 立即 flush 防抖中挂起的 diff（控制键路径用） */
  flushPending: () => void;
}

/** 找两段字符串的最长公共前缀长度 */
function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export function useTextareaInputGuard(
  elRef: React.MutableRefObject<HTMLTextAreaElement | null>,
  opts: UseTextareaInputGuardOptions,
): UseTextareaInputGuardReturn {
  const { mode, composingRef } = opts;

  const onCommitRef = useRef(opts.onCommit);
  onCommitRef.current = opts.onCommit;
  const filterRef = useRef(opts.filter);
  filterRef.current = opts.filter;

  // hook truth：当前已 commit 的 buffer（textarea 应当显示的真值）
  const bufferRef = useRef('');
  // 防抖 timer
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 把 textarea.value sync 回 hook truth */
  const syncTextareaToBuffer = useCallback((): void => {
    const el = elRef.current;
    if (!el) return;
    const expected = bufferRef.current;
    if (el.value !== expected) {
      el.value = expected;
    }
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* iOS 偶发 */
    }
  }, [elRef]);

  /** 把 intent 应用到 buffer truth */
  const applyIntent = (buffer: string, intent: InputIntent): string => {
    switch (intent.kind) {
      case 'insert':
        return buffer + intent.text;
      case 'delete':
        return buffer.slice(0, Math.max(0, buffer.length - intent.count));
      case 'replace':
        return (
          buffer.slice(0, Math.max(0, buffer.length - intent.deleteCount)) +
          intent.insert
        );
    }
  };

  /** 单 commit：filter → 更新 buffer → onCommit 通知 */
  const commitOne = useCallback(
    (intent: InputIntent): void => {
      const ctx = { buffer: bufferRef.current };
      const reshaped = filterRef.current?.(intent, ctx);
      if (reshaped === null) return;
      const final = reshaped ?? intent;
      const before = bufferRef.current;
      bufferRef.current = applyIntent(bufferRef.current, final);
      // eslint-disable-next-line no-console
      console.log('[GUARD] commit', JSON.stringify({
        mode, intent: final, before, after: bufferRef.current,
      }));
      onCommitRef.current(final, { buffer: bufferRef.current });
    },
    [mode],
  );

  /**
   * 核心 diff & commit：对照 prev (bufferRef) 和 actual (textarea.value)，
   * **同时做 smart-punct 模式匹配**——CodeMirror domchange.ts:144 同款。
   *
   * smart-punct 命中条件：
   *   - removed = 1（前一字符被删）
   *   - added.length = 1（恰好一字符被插入）
   *   - added 是 postSmartSet 字符
   *   - 被删的字符是空格
   *  → 改写：保留空格 + 插标点 = 在原 prev 末尾加 added → 等价 commit insert(added)
   */
  const flushDiff = useCallback((): void => {
    const el = elRef.current;
    if (!el) return;
    const prev = bufferRef.current;
    // iOS 在某些场景下把 textarea 中已有的 ASCII space (32) 自动替换为 NBSP
    // (160) / narrow NBSP (8239)，导致 LCP diff 在等价空格位置上错位（prev
    // 已被 filter 规范化成 ASCII space）。在 diff 入口先把 actual 中的 NBSP
    // 也规范化成 ASCII space，让两边可比
    const actual = el.value.replace(/[  ]/g, ' ');
    if (actual === prev) return;

    const prefix = commonPrefixLen(prev, actual);
    const removed = prev.length - prefix;
    const added = actual.slice(prefix);
    const removedText = prev.slice(prefix);

    // iOS smart-insert-delete 矫正：iOS 在用户输入空格紧跟任意字符时，会把
    // 空格"吞掉"做替换（不只是 postSmartSet 标点，连字母数字也会触发）。这
    // 是 WebKit smart insert delete + autocorrect 的联动行为，终端场景下永远
    // 不希望发生。
    //
    // 命中条件：
    //  - removed 序列末尾是空白字符（NBSP / narrow NBSP / ASCII space）
    //  - added 至少 1 字符 **且 added 不全是空白**（如果 added 全是空白说明
    //    iOS 只是在切换 space/NBSP charCode，不是真的"替换内容"，按用户实际
    //    delete 行为处理即可，不要矫正成"添加内容"）
    //
    // 矫正：恢复用户原始意图 = removedText 去掉末尾空白后的前缀 + ASCII space
    // + 完整 added。等价于"空格保留 + 字符追加"
    //
    // 例 1：'x ' → 'x.'    removed=' '   added='.'  → 矫正 'x .'
    // 例 2：'cd ' → 'c..'  removed='d '  added='..' → 矫正 'cd ..'
    // 例 3：'cdopen ' → 'cdopenv' removed=' ' added='v' → 矫正 'cdopen v'
    // 例 4：'cdopen ' → 'cdopen5' removed=' ' added='5' → 矫正 'cdopen 5'
    // 反例：'a, ' → 'a' removed=', '+NBSP added=NBSP → **不矫正**，正常 commit
    //   delete (用户按 Backspace 删 ', '，iOS 顺便把前面空格 32→160)
    const isSmartPunct =
      removed >= 1 &&
      added.length >= 1 &&
      /\s/.test(removedText[removedText.length - 1] ?? '') &&
      !/^\s+$/.test(added);

    // eslint-disable-next-line no-console
    console.log('[GUARD] flushDiff', JSON.stringify({
      mode, prev, actual, removed, added, isSmartPunct,
      removedCodes: [...removedText].map((c) => c.charCodeAt(0)),
      addedCodes: [...added].map((c) => c.charCodeAt(0)),
    }));

    if (isSmartPunct) {
      // 矫正：恢复用户原始输入序列 = removedText 去掉末尾空白后的前缀 +
      // ASCII space + 完整 added。
      // 例：removed='d ' added='..' → restored='d ..'
      // 用 replace intent：删 removed 个字符 + 插 restored
      const removedPrefix = removedText.slice(0, -1); // 去掉末尾空白
      const restored = removedPrefix + ' ' + added;
      commitOne({ kind: 'replace', deleteCount: removed, insert: restored });
      syncTextareaToBuffer();
      return;
    }

    // iOS smart-delete 反向矫正：用户按 Backspace 删空格，iOS 会**同时删掉**
    // 前面紧邻的 postSmartSet 标点（"标点紧贴单词"逻辑的反向操作）。
    //
    // 命中：removed >= 2 + 末尾是空白 + 末尾前一字符是 postSmartSet + added 空
    // 矫正：只删空格（buffer 留下"前缀 + 标点"），把被错删的标点还回去
    //
    // 例：'cd .h, ' → 'cd .h' removed=', '(2字符) → 矫正只删空格 → 'cd .h,'
    const isSmartDelete =
      removed >= 2 &&
      added.length === 0 &&
      /\s/.test(removedText[removedText.length - 1] ?? '') &&
      POST_SMART_SET.has(removedText[removedText.length - 2] ?? '');
    if (isSmartDelete) {
      // 只 commit delete 1（删空格），保留前面的标点。等价于：删 removed 个 +
      // 插回 removedText 的前缀（留下标点）
      const removedPrefix = removedText.slice(0, -1); // 含被错删的标点
      // eslint-disable-next-line no-console
      console.log('[GUARD] smartDelete restore', JSON.stringify({ removedPrefix }));
      commitOne({ kind: 'replace', deleteCount: removed, insert: removedPrefix });
      syncTextareaToBuffer();
      return;
    }

    if (removed > 0 && added.length > 0) {
      commitOne({ kind: 'replace', deleteCount: removed, insert: added });
    } else if (removed > 0) {
      commitOne({ kind: 'delete', count: removed });
    } else if (added.length > 0) {
      commitOne({ kind: 'insert', text: added });
    }
    // commit 后 syncTextareaToBuffer 让 textarea 对齐
    syncTextareaToBuffer();
  }, [elRef, mode, commitOne, syncTextareaToBuffer]);

  /** 防抖：每次输入事件都重置 timer，settled 后才 diff commit */
  const scheduleFlush = useCallback((): void => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      flushDiff();
    }, SETTLE_MS);
  }, [flushDiff]);

  /** 立即 flush（控制键 / 提交场景） */
  const flushNow = useCallback((): void => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    flushDiff();
  }, [flushDiff]);

  // ─────────── 事件挂载 ───────────

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const handleInput = (e: Event): void => {
      if (composingRef.current) return;
      const ie = e as InputEvent;
      // eslint-disable-next-line no-console
      console.log('[GUARD] input', JSON.stringify({
        mode, type: ie.inputType, data: ie.data, bufRef: bufferRef.current, val: el.value,
      }));
      // 任何 input 事件都重置 settle timer，等 80ms 看完整变化
      scheduleFlush();
    };

    /**
     * beforeinput 仅处理 insertReplacementText（QuickType / 拼写修正）—— 它
     * 自带 dataTransfer + getTargetRanges 给精确替换信息。其它 inputType 全部
     * 由 input 事件 + 防抖 LCP diff 处理。
     */
    const handleBeforeInput = (e: InputEvent): void => {
      if (composingRef.current) return;
      if (e.inputType !== 'insertReplacementText') return;
      const replaceText = (e.dataTransfer?.getData('text/plain')) ?? e.data ?? '';
      const ranges = (e as InputEvent & { getTargetRanges?: () => StaticRange[] })
        .getTargetRanges?.() ?? [];
      let removeLen = 0;
      if (ranges.length > 0) {
        const r = ranges[0];
        removeLen = (r?.endOffset ?? 0) - (r?.startOffset ?? 0);
      }
      // 取消挂起防抖（避免后续 input 又跑一次 diff）
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      // eslint-disable-next-line no-console
      console.log('[GUARD] insertReplacement', JSON.stringify({
        replaceText, removeLen,
      }));
      if (removeLen > 0 && replaceText.length > 0) {
        commitOne({ kind: 'replace', deleteCount: removeLen, insert: replaceText });
      } else if (removeLen > 0) {
        commitOne({ kind: 'delete', count: removeLen });
      } else if (replaceText.length > 0) {
        commitOne({ kind: 'insert', text: replaceText });
      }
      // 等 input 事件结束后再 sync（让 iOS 自己改完 textarea，我们再覆盖）
      Promise.resolve().then(syncTextareaToBuffer);
    };

    el.addEventListener('input', handleInput);
    el.addEventListener('beforeinput', handleBeforeInput);
    // eslint-disable-next-line no-console
    console.log('[GUARD] mounted', JSON.stringify({
      mode, owner: el.className.slice(0, 40),
    }));
    return () => {
      el.removeEventListener('input', handleInput);
      el.removeEventListener('beforeinput', handleBeforeInput);
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [elRef, mode, composingRef, scheduleFlush, commitOne, syncTextareaToBuffer]);

  // ─────────── 命令式 API ───────────

  const getBuffer = useCallback(() => bufferRef.current, []);

  const setBuffer = useCallback(
    (text: string): void => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      bufferRef.current = text;
      syncTextareaToBuffer();
    },
    [syncTextareaToBuffer],
  );

  const clear = useCallback((): void => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    bufferRef.current = '';
    syncTextareaToBuffer();
  }, [syncTextareaToBuffer]);

  return { getBuffer, setBuffer, clear, flushPending: flushNow };
}
