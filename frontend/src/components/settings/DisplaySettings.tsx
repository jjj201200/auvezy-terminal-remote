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

import { useState, useEffect, useMemo, useRef, type JSX } from 'react';
import {
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

// 输入框接受的范围（可超出预设）
const COLS_MIN = 40;
const COLS_MAX = 150;

/**
 * 根据当前屏幕宽度算"有意义的列数预设"
 *
 * 同一字号下相邻 cols 视觉无差别——`fontSize = floor(W / cols / 0.6)` clamp 到
 * [8, 18]。所以对每个可能的 fontSize 反推一个 cols 即可覆盖所有视觉档位。
 *
 * 算法：fontSize 从 18 → 8 遍历，每个算 `cols = floor(W / fontSize / 0.6)`，
 * 落在 [COLS_MIN, COLS_MAX] 内的去重收集。结果按升序返回。
 */
function computeMeaningfulPresets(width: number): number[] {
  if (width <= 0) return [80, 100, 120, 220];
  const set = new Set<number>();
  for (let fs = FONT_SIZE_MAX; fs >= FONT_SIZE_MIN; fs--) {
    const cols = Math.floor(width / fs / CHAR_WIDTH_RATIO);
    if (cols >= COLS_MIN && cols <= COLS_MAX) set.add(cols);
  }
  return Array.from(set).sort((a, b) => a - b);
}

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

  // 用预览容器宽度反推预设——它跟终端宽度量级接近，比 window.innerWidth 更准
  const presets = useMemo(() => computeMeaningfulPresets(previewWidth), [previewWidth]);
  // Auto 模式下使用默认字号 XTERM_FONT_SIZE，对应一个 cols
  // 把它从预设里去掉避免重复，并用来给 Auto 按钮显示具体数值
  const autoCols = useMemo(() => {
    if (previewWidth <= 0) return 0;
    return Math.floor(previewWidth / XTERM_FONT_SIZE / CHAR_WIDTH_RATIO);
  }, [previewWidth]);
  const presetsWithoutAuto = useMemo(
    () => presets.filter((p) => p !== autoCols),
    [presets, autoCols],
  );

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
            {autoCols > 0 ? `${t('display.autoLabel')} · ${autoCols}` : t('display.autoLabel')}
          </button>
          {/*
            预设按钮：根据当前预览宽度反推"有意义的列数"——同字号下的相邻 cols
            视觉无差别，只列出会真实改变 fontSize 的 cols 值。
            过滤掉与 Auto 模式相同的 cols（避免按钮重复）。
            数字输入框接受超出预设的值（[40, 240]）。
          */}
          {presetsWithoutAuto.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCols(p)}
              className={clsx(s.presetBtn, targetCols === p && s.presetBtnActive)}
            >
              {p}
            </button>
          ))}
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
