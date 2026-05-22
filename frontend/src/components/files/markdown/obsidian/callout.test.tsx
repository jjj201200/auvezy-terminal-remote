/**
 * remarkObsidianCallout + CalloutBlock 单测
 *
 * 覆盖:13 类识别 / 别名 / 大小写不敏感 / +- collapsible / 自定义标题 /
 * 未知类型 fallback / enabled=false 关闭。
 */

import type { JSX } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { I18nProvider } from '../../../../i18n/i18n-context.js';
import { remarkObsidianCallout, CalloutBlock } from './callout.js';

function renderMd(md: string, enabled = true): RenderResult {
  return render(
    <I18nProvider>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkObsidianCallout, { enabled }]]}
        components={{ 'obs-callout': CalloutBlock as never } as never}
      >
        {md}
      </ReactMarkdown>
    </I18nProvider>,
  );
}

describe('remarkObsidianCallout — kinds', () => {
  const kinds = [
    'note', 'abstract', 'info', 'todo', 'tip', 'success',
    'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote',
  ];
  for (const k of kinds) {
    it(`recognizes ${k}`, () => {
      const { container } = renderMd(`> [!${k}] T\n> body`);
      expect(container.querySelector(`[data-kind="${k}"]`)).toBeTruthy();
    });
  }
});

describe('remarkObsidianCallout — aliases', () => {
  it('tldr → abstract', () => {
    const { container } = renderMd('> [!tldr] T\n> body');
    expect(container.querySelector('[data-kind="abstract"]')).toBeTruthy();
  });
  it('summary → abstract', () => {
    const { container } = renderMd('> [!summary] T\n> body');
    expect(container.querySelector('[data-kind="abstract"]')).toBeTruthy();
  });
  it('error → danger', () => {
    const { container } = renderMd('> [!error] T\n> body');
    expect(container.querySelector('[data-kind="danger"]')).toBeTruthy();
  });
  it('caution → warning', () => {
    const { container } = renderMd('> [!caution] T\n> body');
    expect(container.querySelector('[data-kind="warning"]')).toBeTruthy();
  });
});

describe('remarkObsidianCallout — case insensitive', () => {
  it('[!NOTE] works', () => {
    const { container } = renderMd('> [!NOTE] T\n> body');
    expect(container.querySelector('[data-kind="note"]')).toBeTruthy();
  });
  it('[!Note] works', () => {
    const { container } = renderMd('> [!Note] T\n> body');
    expect(container.querySelector('[data-kind="note"]')).toBeTruthy();
  });
});

describe('remarkObsidianCallout — collapsible', () => {
  it('+ → details[open]', () => {
    const { container } = renderMd('> [!tip]+ Open\n> body');
    const d = container.querySelector('details');
    expect(d).toBeTruthy();
    expect(d!.hasAttribute('open')).toBe(true);
  });
  it('- → details(closed)', () => {
    const { container } = renderMd('> [!tip]- Closed\n> body');
    const d = container.querySelector('details');
    expect(d).toBeTruthy();
    expect(d!.hasAttribute('open')).toBe(false);
  });
  it('no marker → aside(non-collapsible)', () => {
    const { container } = renderMd('> [!tip] Plain\n> body');
    expect(container.querySelector('details')).toBeFalsy();
    expect(container.querySelector('aside.callout')).toBeTruthy();
  });
});

describe('remarkObsidianCallout — custom title', () => {
  it('uses custom title when given', () => {
    const { container } = renderMd('> [!note] My custom title\n> body');
    expect(container.textContent).toContain('My custom title');
  });
  it('falls back to i18n default title when empty', () => {
    const { container } = renderMd('> [!note]\n> body');
    // i18n locale 默认 zh-CN 或 en;命中任一即可
    expect(container.textContent).toMatch(/Note|笔记/);
  });
});

describe('remarkObsidianCallout — fallbacks', () => {
  it('unknown type → plain blockquote', () => {
    const { container } = renderMd('> [!nonsense] T\n> body');
    expect(container.querySelector('.callout')).toBeFalsy();
    expect(container.querySelector('blockquote')).toBeTruthy();
  });
  it('enabled=false → plain blockquote even with valid type', () => {
    const { container } = renderMd('> [!note] T\n> body', false);
    expect(container.querySelector('.callout')).toBeFalsy();
    expect(container.querySelector('blockquote')).toBeTruthy();
  });
});
