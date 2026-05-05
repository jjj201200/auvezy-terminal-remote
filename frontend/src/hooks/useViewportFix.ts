/**
 * useViewportFix
 *
 * 解决移动端 100vh 不等于真实可视高度的问题：
 *  - 监听 visualViewport.resize / scroll
 *  - 实测高度写入 CSS 变量 --app-vh（被 #app 高度引用）
 *  - 检测键盘弹起：innerHeight - visualViewport.height >= 100 时，
 *    给 <body> 加 data-keyboard="true"，CSS 利用此 hook 隐藏元素
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
      const height = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-vh', `${height}px`);

      const innerH = window.innerHeight;
      const keyboardOpen =
        vv !== undefined && vv !== null && innerH - height >= KEYBOARD_THRESHOLD_PX;
      if (keyboardOpen) {
        document.body.setAttribute('data-keyboard', 'true');
      } else {
        document.body.removeAttribute('data-keyboard');
      }
    };

    update();

    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    } else {
      window.addEventListener('resize', update);
    }

    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      } else {
        window.removeEventListener('resize', update);
      }
      document.documentElement.style.removeProperty('--app-vh');
      document.body.removeAttribute('data-keyboard');
    };
  }, []);
}
