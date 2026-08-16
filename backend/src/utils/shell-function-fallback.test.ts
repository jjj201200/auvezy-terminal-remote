/**
 * shell 函数 fallback 单元测试
 *
 * 场景:`atr zclaude`——zclaude 是用户 .zshrc 里的函数,node-pty 只能 exec PATH
 * 上的二进制,无法解析函数/alias。fallback 为 `$SHELL -ic '<完整命令行>'`,
 * 让交互 shell 加载 rc 文件后解析函数(顺带带上 rc 里的 export,如用户给
 * claude 配的 API 网关变量)。
 */

import { describe, it, expect } from 'vitest';
import { shellQuote, buildInteractiveFallback } from './shell-function-fallback.js';

describe('shellQuote', () => {
  it('无特殊字符 → 原样包裹单引号', () => {
    expect(shellQuote('zclaude')).toBe("'zclaude'");
  });

  it('含空格 → 整体一个参数', () => {
    expect(shellQuote('--msg hello world')).toBe("'--msg hello world'");
  });

  it("含单引号 → '\\'' 转义", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('含 $ 与反引号 → 不展开（单引号内字面量）', () => {
    expect(shellQuote('$HOME `pwd`')).toBe("'$HOME `pwd`'");
  });

  it('空串 → 空的单引号（合法空参数）', () => {
    expect(shellQuote('')).toBe("''");
  });
});

describe('buildInteractiveFallback', () => {
  const env = { SHELL: '/usr/bin/zsh', PATH: '/usr/bin:/bin' };

  it('POSIX + $SHELL 存在 → 返回 shell -ic 包裹的完整命令行', () => {
    const r = buildInteractiveFallback('zclaude', ['--resume', 'task 1'], env);
    expect(r).not.toBeNull();
    expect(r!.command).toBe('/usr/bin/zsh');
    expect(r!.args).toHaveLength(2);
    expect(r!.args[0]).toBe('-ic');
    expect(r!.args[1]).toBe("'zclaude' '--resume' 'task 1'");
  });

  it('args 为空 → 命令行只有 program 本身', () => {
    const r = buildInteractiveFallback('zclaude', [], env);
    expect(r!.args[1]).toBe("'zclaude'");
  });

  it('无 $SHELL → null（无法 fallback，调用方走 127）', () => {
    expect(buildInteractiveFallback('zclaude', [], { PATH: '/usr/bin' })).toBeNull();
  });

  it('$SHELL 指向不存在的文件 → null', () => {
    expect(
      buildInteractiveFallback('zclaude', [], { SHELL: '/no/such/sh', PATH: '/usr/bin' }),
    ).toBeNull();
  });

  it('Windows → null（交互 shell 函数概念不适用，维持 127）', () => {
    // platform 检查在实现内部;linux 测试环境直接断言 win 语义函数返回 null
    // 通过显式 platform 参数注入,避免 mock process.platform
    const r = buildInteractiveFallback('zclaude', [], env, 'win32');
    expect(r).toBeNull();
  });
});
