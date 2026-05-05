/**
 * DisplaySettings
 *
 * 终端显示偏好：目标列数（自适应字号）+ 字间距。
 *
 * 列数：
 *  - 0 = 关闭自适应（用默认字号 13px）
 *  - 80/100/120 三个预设按钮一键切换
 *  - 自定义输入：[40, 240]
 *
 * 字间距：
 *  - 范围 [-2, 4]，0 = 默认
 *  - 滑块 + 数值同步
 *
 * 即时生效：用户调一项 → setDraft → useTerminal 收到 effect 立即重应用
 */

import { useState, useEffect, useRef, type JSX } from 'react';
import {
  COLS_PRESETS,
  DEFAULT_DISPLAY,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LETTER_SPACING_MIN,
  LETTER_SPACING_MAX,
  type DisplayPrefs,
} from '@otr/shared';
import clsx from 'clsx';
import { XTERM_FONT_SIZE } from '../../config/constants.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './DisplaySettings.module.scss';

// 与 useTerminal 同源：mono 字符宽度 / fontSize 比例
const CHAR_WIDTH_RATIO = 0.6;

/**
 * 与 useTerminal 中 computeFontPrefs 同算法
 * targetCols=0 → 用默认字号；否则按容器宽度反推
 */
function computePreviewFontSize(
  containerWidth: number,
  targetCols: number,
  letterSpacing: number,
): number {
  if (!targetCols || targetCols <= 0 || containerWidth <= 0) return XTERM_FONT_SIZE;
  const raw = (containerWidth / targetCols - letterSpacing) / CHAR_WIDTH_RATIO;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.floor(raw)));
}

export interface DisplaySettingsProps {
  value: DisplayPrefs | undefined;
  onChange: (next: DisplayPrefs) => void;
}

// 输入框接受的范围（可超出滑块）
const COLS_MIN = 40;
const COLS_MAX = 240;
// 滑块本身的范围：覆盖常用区间，超出靠输入框
const SLIDER_MIN = 80;
const SLIDER_MAX = 220;

export function DisplaySettings({ value, onChange }: DisplaySettingsProps): JSX.Element {
  const t = useT();
  const targetCols = value?.targetCols ?? DEFAULT_DISPLAY.targetCols;
  const letterSpacing = value?.letterSpacing ?? DEFAULT_DISPLAY.letterSpacing;

  // 自定义列数输入框：与 targetCols 双向绑定，但允许输入中途为空
  const [colsInput, setColsInput] = useState<string>(targetCols > 0 ? String(targetCols) : '');
  useEffect(() => {
    setColsInput(targetCols > 0 ? String(targetCols) : '');
  }, [targetCols]);

  // ──────────────── 预览框宽度测量 ────────────────
  // 用 ResizeObserver 实时拿预览容器的可用宽度，按 useTerminal 同算法反推 fontSize
  // 预览容器宽度通常 ≠ 终端宽度，但视觉密度感（字号/字间距/列数比例）可如实反映
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(0);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    setPreviewWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setPreviewWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const previewFontSize = computePreviewFontSize(previewWidth, targetCols, letterSpacing);

  const setCols = (n: number): void => {
    onChange({ ...value, targetCols: n });
  };

  const handleColsInput = (v: string): void => {
    setColsInput(v);
    if (v === '') return;
    const n = Number(v);
    if (!Number.isInteger(n)) return;
    if (n < COLS_MIN || n > COLS_MAX) return;
    setCols(n);
  };

  const handleColsBlur = (): void => {
    if (colsInput === '') {
      // 留空 = 关闭自适应
      setCols(0);
      return;
    }
    const n = Number(colsInput);
    if (!Number.isInteger(n)) {
      setColsInput(targetCols > 0 ? String(targetCols) : '');
      return;
    }
    setCols(Math.max(COLS_MIN, Math.min(COLS_MAX, n)));
  };

  const setLetterSpacing = (n: number): void => {
    const clamped = Math.max(LETTER_SPACING_MIN, Math.min(LETTER_SPACING_MAX, n));
    onChange({ ...value, letterSpacing: clamped });
  };

  return (
    <div className={s.root}>
      {/* 预览：用 xterm 主题色 + Geist Mono，按当前算法反推字号 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.previewTitle')}</h3>
          <p className={s.sectionHint}>{t('display.previewHint')}</p>
        </header>
        <div
          ref={previewRef}
          className={s.preview}
          style={{
            fontSize: `${previewFontSize}px`,
            letterSpacing: `${letterSpacing}px`,
          }}
        >
          <div className={s.previewLine}>
            <span className={s.cPrompt}>user@host</span>
            <span className={s.cMuted}>:</span>
            <span className={s.cBlue}>~/projects</span>
            <span className={s.cMuted}>$ </span>
            <span className={s.cFg}>ls -la</span>
          </div>
          <div className={s.previewLine}>
            <span className={s.cMuted}>drwxr-xr-x </span>
            <span className={s.cBlue}>4 </span>
            <span className={s.cFg}>user </span>
            <span className={s.cMuted}>4096 </span>
            <span className={s.cGreen}>May 06 02:34 </span>
            <span className={s.cFg}>src/</span>
          </div>
          <div className={s.previewLine}>
            <span className={s.cRed}>error</span>
            <span className={s.cMuted}>: </span>
            <span className={s.cFg}>cannot find module </span>
            <span className={s.cYellow}>'./missing'</span>
          </div>
          <div className={s.previewMeta}>
            {t('display.previewMeta', {
              size: previewFontSize,
              ls: letterSpacing.toFixed(1),
              cols: targetCols > 0
                ? t('display.colsModeTarget', { cols: targetCols })
                : t('display.colsModeAuto'),
            })}
          </div>
        </div>
      </section>

      {/* 列数 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.targetColsTitle')}</h3>
          <p className={s.sectionHint}>{t('display.targetColsHint')}</p>
        </header>

        <div className={s.row}>
          <button
            type="button"
            onClick={() => setCols(0)}
            className={clsx(s.presetBtn, targetCols === 0 && s.presetBtnActive)}
            title={t('display.autoTooltip')}
          >
            {t('display.autoLabel')}
          </button>
          {/*
            拖拽条范围 [SLIDER_MIN, SLIDER_MAX]（80~220），下方显示预设 tick：
            点 tick = 跳到该预设值。输入框接受超出滑块的值（[40, 240]）。
            --fill 是已填充段百分比，由当前值与滑块范围算得；同样 tick 的 left 也按比例算
          */}
          {(() => {
            const v = targetCols > 0
              ? Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, targetCols))
              : SLIDER_MIN;
            const fillPct = ((v - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
            return (
              <div className={s.colsSliderWrap}>
                <input
                  type="range"
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={1}
                  value={v}
                  onChange={(e) => setCols(Number(e.target.value))}
                  className={s.colsSlider}
                  style={{ ['--fill' as string]: `${fillPct}%` }}
                  aria-label={t('display.targetColsTitle')}
                />
                <div className={s.colsTicks} aria-hidden="true">
                  {COLS_PRESETS.map((p) => {
                    const left = ((p - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
                    return (
                      <span
                        key={p}
                        className={clsx(s.colsTick, targetCols === p && s.colsTickActive)}
                        style={{ left: `${left}%` }}
                      >
                        {p}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <input
            type="number"
            inputMode="numeric"
            min={COLS_MIN}
            max={COLS_MAX}
            value={colsInput}
            placeholder={t('display.customPlaceholder')}
            onChange={(e) => handleColsInput(e.target.value)}
            onBlur={handleColsBlur}
            className={s.numInput}
            aria-label={t('display.customAriaLabel')}
          />
        </div>
      </section>

      {/* 字间距 */}
      <section className={s.section}>
        <header className={s.sectionHeader}>
          <h3 className={s.sectionTitle}>{t('display.letterSpacingTitle')}</h3>
          <p className={s.sectionHint}>{t('display.letterSpacingHint')}</p>
        </header>

        <div className={s.row}>
          <input
            type="range"
            min={LETTER_SPACING_MIN}
            max={LETTER_SPACING_MAX}
            step={0.5}
            value={letterSpacing}
            onChange={(e) => setLetterSpacing(Number(e.target.value))}
            className={s.slider}
            aria-label={t('display.letterSpacingAriaLabel')}
          />
          <span className={s.valueLabel}>
            {t('display.letterSpacingValue', { val: letterSpacing.toFixed(1) })}
          </span>
          <button
            type="button"
            onClick={() => setLetterSpacing(0)}
            className={s.resetBtn}
            disabled={letterSpacing === 0}
            title={t('display.resetTooltip')}
          >
            {t('common.reset')}
          </button>
        </div>
      </section>
    </div>
  );
}
