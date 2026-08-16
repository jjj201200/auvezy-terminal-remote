/**
 * ShortcutSettingsModal 回归测试
 *
 * 防「modal 冻结快照」回归（0.13.x 修复）：modal-stack 的 entry render 闭包在
 * present() 时固化 props，父级 draft 再变也送不进新 value。曾导致：
 *  - 新建分组后 modal 不显示新分组（编辑看似无效）
 *  - 连续编辑互相覆盖（每次都从打开瞬间的快照 spread）
 *
 * 修复 = modal 内部持有本地编辑态。本测试直接模拟「props 冻结」场景：
 * 用固定 value/onChange 引用渲染（不随状态重传新 props），走真实 UI 操作，
 * 断言编辑结果既反映在渲染输出里、也完整上报给 onChange。
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  buildDefaultShortcutGroups,
  makeActionId,
} from 'auvezy-terminal-remote-shared';
import { I18nProvider } from '../../i18n/i18n-context.js';
import { ModalStackProvider } from '../ui/modal-stack/ModalStack.js';
import { ConfirmProvider } from '../ui/ConfirmProvider.js';
import { ShortcutSettingsModal } from './ShortcutSettingsModal.js';

// Sheet（Radix Dialog）在 jsdom 里不稳定；本测试只关心编辑态语义，mock 掉容器
vi.mock('../ui/Sheet.js', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// 固定 zh-CN：断言用中文按钮名 / placeholder，不随默认 locale 变化
beforeEach(() => {
  localStorage.setItem('atr.locale', 'zh-CN');
});

/** 与生产一致的 Provider 包装（useT / useConfirm / ConfirmProvider 内部栈必需） */
function renderModal(
  value: ReturnType<typeof buildDefaultShortcutGroups>,
  onChange: Mock,
): ReturnType<typeof render> {
  return render(
    <I18nProvider>
      <ModalStackProvider>
        <ConfirmProvider>
          <ShortcutSettingsModal
            open
            onClose={() => {}}
            value={value}
            onChange={onChange}
          />
        </ConfirmProvider>
      </ModalStackProvider>
    </I18nProvider>,
  );
}

/** 默认组标题（zh locale）——用来定位分组 head */
const DEFAULT_GROUP_TITLES = ['常用', 'Readline', '编辑', 'Vim', 'Tmux', '信号'];

describe('ShortcutSettingsModal 本地编辑态（冻结 props 回归）', () => {
  it('新建分组：新分组立即显示且上报 onChange（不依赖父级重传 value）', () => {
    const groups = buildDefaultShortcutGroups();
    const onChange = vi.fn();
    renderModal(groups, onChange);

    // 打开瞬间后父级 props 冻结（模拟 modal-stack entry 固化 render 闭包）
    const addBtn = screen.getByRole('button', { name: '新建分组' });
    act(() => {
      fireEvent.click(addBtn);
    });

    // 核心断言 1：不靠父级重传，新分组 head 也要出现在渲染输出里（编辑表单态）
    const titleInput = screen.getByPlaceholderText('如：自定义工作流') as HTMLInputElement;
    expect(titleInput.value).toBe('新建分组');

    // 核心断言 2：完整新树（含空新分组）已上报给 onChange
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as ReturnType<typeof buildDefaultShortcutGroups>;
    expect(next).toHaveLength(groups.length + 1);
    expect(next[next.length - 1]!.items).toEqual([]);
  });

  it('连续两次编辑：第二次基于第一次的结果累积，而非各写各的快照', () => {
    const groups = buildDefaultShortcutGroups();
    const onChange = vi.fn();
    renderModal(groups, onChange);

    // 第一次：新建分组并提交标题
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
    });
    const titleInput = screen.getByPlaceholderText('如：自定义工作流');
    act(() => {
      fireEvent.change(titleInput, { target: { value: '我的工作流' } });
      fireEvent.keyDown(titleInput, { key: 'Enter' });
    });

    // 第二次：再建一个分组（此时父级仍没送来新 props —— 冻结场景）
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
    });

    // 若仍是冻结快照，第二次上报会丢掉第一个新分组（从旧快照 spread）
    // onChange 序列：1=新建空组、2=标题提交、3=再建一个空组
    const calls = onChange.mock.calls.map((c) => c[0] as ReturnType<typeof buildDefaultShortcutGroups>);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toHaveLength(groups.length + 2);
    // 第一次建的那个组还在，且标题已提交
    expect(
      calls[2]!.some((g) => g.title === '我的工作流'),
    ).toBe(true);
  });

  it('分组说明：编辑 builtin 分组 desc 并提交，显示 + 上报同步', () => {
    const groups = buildDefaultShortcutGroups();
    const onChange = vi.fn();
    renderModal(groups, onChange);

    // 进入首组编辑（编辑按钮 aria-label = groupEditTooltip「编辑分组」）
    const firstGroupEdit = screen
      .getAllByRole('button', { name: '编辑分组' })
      .find((btn) => btn.closest('section')?.contains(screen.getByText(DEFAULT_GROUP_TITLES[0]!)));
    act(() => {
      fireEvent.click(firstGroupEdit!);
    });

    const descInput = screen.getByPlaceholderText('可选，展开分组时显示在列表上方');
    act(() => {
      fireEvent.change(descInput, { target: { value: '我的常用键说明' } });
      fireEvent.keyDown(descInput, { key: 'Enter' });
    });

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as ReturnType<typeof buildDefaultShortcutGroups>;
    expect(next[0]!.desc).toBe('我的常用键说明');
    // 其余字段不丢
    expect(next[0]!.title).toBe(groups[0]!.title);
    expect(next[0]!.items).toEqual(groups[0]!.items);
    // 提交后说明直接渲染在分组 body…（分组折叠时不渲染 body，此处只验树）
    expect(next).toHaveLength(groups.length);
  });

  it('说明置空提交 → desc 变回 undefined（round-trip 里 meta 不残留）', () => {
    const groups = [
      { ...buildDefaultShortcutGroups()[0]!, desc: '旧说明' },
      ...buildDefaultShortcutGroups().slice(1),
    ];
    const onChange = vi.fn();
    renderModal(groups, onChange);

    const firstGroupEdit = screen
      .getAllByRole('button', { name: '编辑分组' })[0]!;
    act(() => {
      fireEvent.click(firstGroupEdit);
    });

    const descInput = screen.getByPlaceholderText('可选，展开分组时显示在列表上方') as HTMLInputElement;
    expect(descInput.value).toBe('旧说明');
    act(() => {
      fireEvent.change(descInput, { target: { value: '   ' } });
      fireEvent.keyDown(descInput, { key: 'Enter' });
    });

    const next = onChange.mock.calls.at(-1)![0] as ReturnType<typeof buildDefaultShortcutGroups>;
    expect(next[0]!.desc).toBeUndefined();
  });
});

// makeActionId 在这里只是引用占位（确保 shared 导入路径正确性由测试本身验证）
void makeActionId;
