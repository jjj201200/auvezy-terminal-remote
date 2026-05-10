import { describe, it, expect } from 'vitest';
import {
  generateCompletionScript,
  isSupportedCompletionShell,
  listCompletionShells,
} from './completion-scripts.js';

describe('completion-scripts', () => {
  it('listCompletionShells = zsh / bash / fish', () => {
    expect(listCompletionShells()).toEqual(['zsh', 'bash', 'fish']);
  });

  it('isSupportedCompletionShell', () => {
    expect(isSupportedCompletionShell('zsh')).toBe(true);
    expect(isSupportedCompletionShell('bash')).toBe(true);
    expect(isSupportedCompletionShell('fish')).toBe(true);
    expect(isSupportedCompletionShell('xonsh')).toBe(false);
    expect(isSupportedCompletionShell('')).toBe(false);
  });

  it('zsh 脚本含 compdef + 主要 subcommand', () => {
    const s = generateCompletionScript('zsh');
    expect(s).toContain('compdef _atr atr');
    expect(s).toContain('start');
    expect(s).toContain('stop');
    expect(s).toContain('kill');
    expect(s).toContain('all'); // kill all 子参数
  });

  it('bash 脚本含 complete -F + COMPREPLY', () => {
    const s = generateCompletionScript('bash');
    expect(s).toContain('complete -F _atr_complete atr');
    expect(s).toContain('COMPREPLY');
    expect(s).toContain('kill');
  });

  it('fish 脚本含 complete -c atr', () => {
    const s = generateCompletionScript('fish');
    expect(s).toContain('complete -c atr');
    expect(s).toContain('start');
    expect(s).toContain('attach');
    expect(s).toContain("__fish_seen_subcommand_from kill");
  });

  it('未知 shell → throw', () => {
    expect(() => generateCompletionScript('xxx')).toThrow(/unsupported shell/);
  });
});
