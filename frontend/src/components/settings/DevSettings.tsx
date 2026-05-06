/**
 * DevSettings
 *
 * 开发者选项。仅本设备生效（写 localStorage，不上传后端 UserConfig）。
 *
 * 当前唯一选项：移动端 eruda 调试浮层。iOS 上没有 chrome://inspect、不连
 * macOS Safari 时无法看 console，eruda 在屏幕角落注入一个调试面板兜底。
 *
 * 切换后必须刷新页面：eruda 是在 main.tsx 启动时根据 localStorage 决定
 * 是否懒加载的，运行时切换不能动态加载/卸载（eruda 没提供干净的卸载）。
 */

import { useState, type JSX } from 'react';
import { Toggle } from '../ui/Toggle.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './GeneralSettings.module.scss';

const ERUDA_KEY = 'atr.devtools.eruda';

export function DevSettings(): JSX.Element {
  const t = useT();
  const [eruda, setEruda] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(ERUDA_KEY) === '1',
  );

  return (
    <div className={s.root}>
      <section className={s.section}>
        <header className={s.header}>
          <h3 className={s.title}>{t('dev.erudaTitle')}</h3>
          <p className={s.hint}>{t('dev.erudaHint')}</p>
        </header>
        <Toggle
          checked={eruda}
          onCheckedChange={(next) => {
            setEruda(next);
            if (next) localStorage.setItem(ERUDA_KEY, '1');
            else localStorage.removeItem(ERUDA_KEY);
          }}
          label={eruda ? t('dev.erudaToggleOn') : t('dev.erudaToggleOff')}
        />
        {/* hint 文案已经说了"刷新生效"，这里不重复加按钮，避免在设置页面里给一个跨模态的副作用 */}
      </section>
    </div>
  );
}
