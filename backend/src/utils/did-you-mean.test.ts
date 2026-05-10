import { describe, it, expect } from 'vitest';
import { suggest } from './did-you-mean.js';

describe('suggest', () => {
  const SUBCMDS = ['start', 'stop', 'status', 'list', 'kill', 'attach', 'install', 'uninstall', 'logs'];

  it('typo → 最相似 subcommand', () => {
    expect(suggest('stp', { candidates: SUBCMDS })).toBe('stop');
    expect(suggest('lst', { candidates: SUBCMDS })).toBe('list');
    expect(suggest('staus', { candidates: SUBCMDS })).toBe('status');
    expect(suggest('atach', { candidates: SUBCMDS })).toBe('attach');
  });

  it('完全匹配 → null(已合法,无需建议)', () => {
    expect(suggest('start', { candidates: SUBCMDS })).toBeNull();
  });

  it('差距过大 → null', () => {
    expect(suggest('xxxxxxxxxxx', { candidates: SUBCMDS })).toBeNull();
    expect(suggest('foo', { candidates: SUBCMDS })).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(suggest('', { candidates: SUBCMDS })).toBeNull();
  });

  it('flag typo', () => {
    const flags = ['--port', '--host', '--workdir', '--instance-name', '--no-terminal'];
    expect(suggest('--por', { candidates: flags })).toBe('--port');
    expect(suggest('--workdr', { candidates: flags })).toBe('--workdir');
  });
});
