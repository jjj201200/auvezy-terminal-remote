/**
 * OutputBuffer 单测
 *
 * 覆盖：
 * - append 基本行为（带/不带 \n、空字符串、连续多 \n）
 * - partial line 跨多次 append 的拼接
 * - seq 单调递增（每次 append +1，不论内容）
 * - getFullContent 各种状态下的重建语义
 * - 超过 maxLines × 1.1 触发裁剪
 * - clear 清空但保留 seq
 * - 构造参数校验
 */

import { describe, it, expect } from 'vitest';
import { OutputBuffer } from './output-buffer.js';

describe('OutputBuffer', () => {
  describe('构造', () => {
    it('默认 maxLines=10000', () => {
      const buf = new OutputBuffer();
      expect(buf.lineCount).toBe(0);
      expect(buf.sequenceNumber).toBe(0);
    });

    it('非正整数 maxLines 抛错', () => {
      expect(() => new OutputBuffer(0)).toThrow();
      expect(() => new OutputBuffer(-1)).toThrow();
      expect(() => new OutputBuffer(1.5)).toThrow();
    });
  });

  describe('append + seq', () => {
    it('seq 每次 append 递增 1', () => {
      const buf = new OutputBuffer();
      expect(buf.sequenceNumber).toBe(0);
      buf.append('a');
      expect(buf.sequenceNumber).toBe(1);
      buf.append('b\n');
      expect(buf.sequenceNumber).toBe(2);
      buf.append('');
      expect(buf.sequenceNumber).toBe(3); // 空字符串也算一次 append
    });

    it('不含 \\n 的输入全部进入 partial', () => {
      const buf = new OutputBuffer();
      buf.append('hello');
      expect(buf.lineCount).toBe(0);
      expect(buf.getFullContent()).toBe('hello');
    });

    it('单个 \\n 收尾时 lines=1，partial=空', () => {
      const buf = new OutputBuffer();
      buf.append('hello\n');
      expect(buf.lineCount).toBe(1);
      expect(buf.getFullContent()).toBe('hello\n');
    });

    it('多个完整行', () => {
      const buf = new OutputBuffer();
      buf.append('line1\nline2\nline3\n');
      expect(buf.lineCount).toBe(3);
      expect(buf.getFullContent()).toBe('line1\nline2\nline3\n');
    });

    it('完整行 + partial', () => {
      const buf = new OutputBuffer();
      buf.append('line1\nline2\npar');
      expect(buf.lineCount).toBe(2);
      expect(buf.getFullContent()).toBe('line1\nline2\npar');
    });
  });

  describe('partial 跨 append 拼接', () => {
    it('两次 append 拼成一行', () => {
      const buf = new OutputBuffer();
      buf.append('hel');
      buf.append('lo\n');
      expect(buf.lineCount).toBe(1);
      expect(buf.getFullContent()).toBe('hello\n');
    });

    it('三次 append 跨多个 \\n', () => {
      const buf = new OutputBuffer();
      buf.append('a');
      buf.append('b\nc');
      buf.append('d\ne\n');
      // 拼成: ab\ncd\ne\n
      expect(buf.lineCount).toBe(3);
      expect(buf.getFullContent()).toBe('ab\ncd\ne\n');
    });

    it('连续 \\n（空行）正确处理', () => {
      const buf = new OutputBuffer();
      buf.append('\n\n\n');
      expect(buf.lineCount).toBe(3);
      expect(buf.getFullContent()).toBe('\n\n\n');
    });
  });

  describe('getFullContent', () => {
    it('空 buffer 返回空串', () => {
      expect(new OutputBuffer().getFullContent()).toBe('');
    });

    it('仅 partial 返回 partial', () => {
      const buf = new OutputBuffer();
      buf.append('partial');
      expect(buf.getFullContent()).toBe('partial');
    });

    it('仅完整行末尾保留 \\n', () => {
      const buf = new OutputBuffer();
      buf.append('a\nb\n');
      expect(buf.getFullContent()).toBe('a\nb\n');
    });

    it('完整行 + partial', () => {
      const buf = new OutputBuffer();
      buf.append('a\nb\npart');
      expect(buf.getFullContent()).toBe('a\nb\npart');
    });
  });

  describe('裁剪', () => {
    it('未达阈值不裁剪', () => {
      const buf = new OutputBuffer(10);
      // 写 10 行，threshold = floor(10*1.1)=11，未超
      for (let i = 0; i < 10; i++) buf.append(`line${i}\n`);
      expect(buf.lineCount).toBe(10);
    });

    it('超过 maxLines × 1.1 裁剪到 maxLines', () => {
      const buf = new OutputBuffer(10);
      // threshold=11，写 12 行将超过阈值，裁剪到 10（保留最后 10 行：line2..line11）
      for (let i = 0; i < 12; i++) buf.append(`line${i}\n`);
      expect(buf.lineCount).toBe(10);
      // 用精确等值断言避免子串冲突（line1 是 line10/line11 的子串）
      const expected = Array.from({ length: 10 }, (_, i) => `line${i + 2}`).join('\n') + '\n';
      expect(buf.getFullContent()).toBe(expected);
    });

    it('单次 append 多行越界也正确裁剪', () => {
      const buf = new OutputBuffer(5);
      // 一次写入 12 行，应裁剪到 5
      const data = Array.from({ length: 12 }, (_, i) => `L${i}`).join('\n') + '\n';
      buf.append(data);
      expect(buf.lineCount).toBe(5);
      expect(buf.getFullContent()).toContain('L11');
      expect(buf.getFullContent()).toContain('L7');
      expect(buf.getFullContent()).not.toContain('L0');
    });
  });

  describe('clear', () => {
    it('清空 lines 与 partial，但保留 seq', () => {
      const buf = new OutputBuffer();
      buf.append('a\n');
      buf.append('part');
      const seqBefore = buf.sequenceNumber;
      expect(seqBefore).toBe(2);

      buf.clear();
      expect(buf.lineCount).toBe(0);
      expect(buf.getFullContent()).toBe('');
      expect(buf.sequenceNumber).toBe(seqBefore); // 保留
    });
  });
});
