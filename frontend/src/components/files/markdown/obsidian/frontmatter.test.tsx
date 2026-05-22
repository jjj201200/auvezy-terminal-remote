/**
 * FrontmatterTable + inferType 单测
 *
 * 覆盖:类型推断 / 解析失败兜底 / 空对象 / tags 强制 array。
 *
 * 注:项目 vitest setup 不引入 @testing-library/jest-dom 的 toBeInTheDocument,
 * 所以这里用原生 chai 断言(toBeTruthy / toMatch)。
 */

import type { JSX } from 'react';
import { render, screen, type RenderResult } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { I18nProvider } from '../../../../i18n/i18n-context.js';
import { FrontmatterTable, inferType } from './frontmatter.js';

function renderWithI18n(ui: JSX.Element): RenderResult {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('inferType', () => {
  it('detects string', () => expect(inferType('hello').kind).toBe('text'));
  it('detects number', () => expect(inferType(42).kind).toBe('number'));
  it('detects boolean', () => expect(inferType(true).kind).toBe('checkbox'));
  it('detects Date', () => expect(inferType(new Date()).kind).toBe('date'));
  it('detects ISO date string', () =>
    expect(inferType('2026-05-22').kind).toBe('date'));
  it('detects ISO datetime string', () =>
    expect(inferType('2026-05-22T10:00:00Z').kind).toBe('date'));
  it('detects wikilink string', () =>
    expect(inferType('[[Foo]]').kind).toBe('link'));
  it('detects array', () => expect(inferType(['a', 'b']).kind).toBe('list'));
  it('falls back to text for object', () =>
    expect(inferType({ nested: 1 } as unknown).kind).toBe('text'));
  it('falls back to text for null', () => expect(inferType(null).kind).toBe('text'));
});

describe('FrontmatterTable', () => {
  it('renders parse error gracefully', () => {
    // 字符串顶层 → YAML 合法但不是 mapping → 我们的 wrapper 视为错误
    renderWithI18n(<FrontmatterTable raw="not_a_mapping_just_string" />);
    expect(screen.queryByRole('alert')).toBeTruthy();
  });

  it('renders empty state when yaml is empty', () => {
    const { container } = renderWithI18n(<FrontmatterTable raw="" />);
    expect(container.textContent).toMatch(/empty|\(空\)/i);
  });

  it('renders tags as chip list when value is array', () => {
    // raw 必须是真换行(不是 \n 字面量) — js-yaml 不解释转义序列
    const yaml = `tags:
  - project
  - draft`;
    renderWithI18n(<FrontmatterTable raw={yaml} />);
    expect(screen.queryByText('project')).toBeTruthy();
    expect(screen.queryByText('draft')).toBeTruthy();
  });

  it('renders tags as chip list even when single string (force-array key)', () => {
    renderWithI18n(<FrontmatterTable raw="tags: project" />);
    expect(screen.queryByText('project')).toBeTruthy();
  });

  it('renders number value', () => {
    renderWithI18n(<FrontmatterTable raw="priority: 3" />);
    expect(screen.queryByText('3')).toBeTruthy();
  });

  it('renders boolean as check/cross', () => {
    renderWithI18n(<FrontmatterTable raw="published: true" />);
    expect(screen.queryByText('✓')).toBeTruthy();
  });
});
