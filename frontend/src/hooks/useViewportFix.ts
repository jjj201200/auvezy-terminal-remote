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
      const bottomGap = vv ? Math.max(0, innerH - (vvTop + vvH)) : 0;
      // visualViewport 顶端在 layout 内的偏移(iOS 键盘弹起时 > 0)
      document.documentElement.style.setProperty('--vv-top', `${vvTop}px`);

      // 键盘高度 = innerH - vvH。
      //
      // index.html 的 meta viewport 设了 `interactive-widget=resizes-visual`,
      // 这模式下键盘弹起**只缩 visualViewport, 不缩 layout viewport** → innerH
      // 稳定不变, vvH 跟随键盘 → (innerH - vvH) 就是真实键盘高度。
      //
      // 之前版本另外引入 `kbLayout = baselineInnerH - innerH` 作为 resizes-content
      // 模式的 fallback。但本项目固定 resizes-visual, kbLayout 永远是 0 — 而且
      // 当用户主动**缩小浏览器窗口**时, innerH 缩小但 baselineInnerH 仍是旧值,
      // 导致 kbLayout > 100 被误判为"键盘弹起", --vv-bottom 错误持有大值, 且
      // baselineInnerH 只在"键盘开→关"时更新, 错误状态自锁不解。已删除该路径。
      const kbH = vv ? Math.max(Math.max(0, innerH - vvH), bottomGap) : 0;
      document.documentElement.style.setProperty('--keyboard-h', `${kbH}px`);
      // --vv-bottom 是"键盘 + 视口底部空白"的统一值
      document.documentElement.style.setProperty('--vv-bottom', `${kbH}px`);

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
