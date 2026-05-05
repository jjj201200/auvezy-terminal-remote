/**
 * useViewportFix
 *
 * 仅负责"键盘弹起检测"和"防 root 滚动"两件事。
 * 高度由浏览器内置 interactive-widget=resizes-content 处理，CSS 直接用 100%。
 *
 * 两层保险：
 *  1. 监听 visualViewport.resize：当 innerHeight - visualViewport.height ≥ 100
 *     给 <body> 加 data-keyboard="true"，配合 .hide-on-keyboard 隐藏特定元素
 *  2. focusin 事件后强制 scrollTo(0,0)，避免浏览器 auto-scroll 把根文档推上去
 *
 * 不依赖任何状态库；挂载即生效，组件树根处调用一次即可。
 */

import { useEffect } from 'react';

const KEYBOARD_THRESHOLD_PX = 100;

export function useViewportFix(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;

    const update = (): void => {
      const vvH = vv?.height ?? window.innerHeight;
      const vvTop = vv?.offsetTop ?? 0;
      const innerH = window.innerHeight;

      // visualViewport 在 layout 内的"底部空白"= layout 高度 - 可视区底端
      // = innerH - (vvTop + vvH)。键盘弹起时这个差就是键盘所占的空间。
      // 同时考虑 iOS visualViewport.offsetTop 可能 > 0 的情况。
      const bottomGap = vv ? Math.max(0, innerH - (vvTop + vvH)) : 0;
      document.documentElement.style.setProperty('--vv-bottom', `${bottomGap}px`);

      // visualViewport 顶端在 layout 内的偏移（iOS 上键盘弹起时会出现 > 0）
      document.documentElement.style.setProperty('--vv-top', `${vvTop}px`);

      // 键盘高度（兼容旧 CSS 变量）
      const kbH = vv ? Math.max(0, innerH - vvH) : 0;
      document.documentElement.style.setProperty('--keyboard-h', `${kbH}px`);

      const keyboardOpen = kbH >= KEYBOARD_THRESHOLD_PX;
      if (keyboardOpen) {
        document.body.setAttribute('data-keyboard', 'true');
      } else {
        document.body.removeAttribute('data-keyboard');
      }
    };

    /**
     * iOS WebKit（含 iOS Chrome / Edge / Firefox 全部）键盘弹起时会 auto-scroll
     * 整个 documentElement 让 focused input 进入 visualViewport 内。即使我们设了
     * html/body 为 fixed + overflow:hidden，iOS 仍可能改 scrollingElement.scrollTop。
     *
     * 策略：focusin 后持续把 scroll 强制归零，直到 blur。
     */
    let scrollGuardId = 0;
    const forceScrollZero = (): void => {
      window.scrollTo(0, 0);
      const se = document.scrollingElement;
      if (se) se.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    const startScrollGuard = (): void => {
      stopScrollGuard();
      window.addEventListener('scroll', forceScrollZero, { passive: true });
      // 兜底再来几次 rAF（iOS 的 auto-scroll 时机不稳）
      let count = 0;
      const tick = (): void => {
        forceScrollZero();
        count += 1;
        if (count < 30) {
          scrollGuardId = window.requestAnimationFrame(tick);
        }
      };
      tick();
    };
    const stopScrollGuard = (): void => {
      window.removeEventListener('scroll', forceScrollZero);
      if (scrollGuardId) {
        cancelAnimationFrame(scrollGuardId);
        scrollGuardId = 0;
      }
    };

    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        startScrollGuard();
        // 弹层内的 input 被键盘挡住时主动滚到中部
        // 主页 InputBar 不需要——它钉死在 visualViewport 底部
        if (target.closest('#settings-modal, #create-instance-modal, #share-sheet')) {
          window.setTimeout(() => {
            try {
              target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } catch {
              /* 旧浏览器没有 ScrollIntoViewOptions */
            }
          }, 300);
        }
      }
    };
    const onFocusOut = (): void => {
      stopScrollGuard();
    };

    update();

    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    } else {
      window.addEventListener('resize', update);
    }
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      } else {
        window.removeEventListener('resize', update);
      }
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      stopScrollGuard();
      document.documentElement.style.removeProperty('--keyboard-h');
      document.documentElement.style.removeProperty('--vv-bottom');
      document.documentElement.style.removeProperty('--vv-top');
      document.body.removeAttribute('data-keyboard');
    };
  }, []);
}
