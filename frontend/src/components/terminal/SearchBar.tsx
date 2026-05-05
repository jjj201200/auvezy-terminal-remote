/**
 * SearchBar
 *
 * 终端内浮层搜索框。Ctrl+F / Cmd+F 唤出，Esc 关闭，Enter / Shift+Enter 跳下/上一处。
 * 仅做 UI + 键位绑定；实际查找走 useTerminal 暴露的 searchNext/searchPrev/clearSearch。
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react';
import { IconButton } from '../ui/IconButton.js';
import { useT } from '../../i18n/i18n-context.js';
import s from './SearchBar.module.scss';

export interface SearchBarProps {
  open: boolean;
  onClose: () => void;
  onNext: (q: string) => boolean;
  onPrev: (q: string) => boolean;
  onClear: () => void;
}

export function SearchBar({ open, onClose, onNext, onPrev, onClear }: SearchBarProps): JSX.Element | null {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);

  // 打开时聚焦 + 全选
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  // 关闭时清装饰
  useEffect(() => {
    if (!open) onClear();
  }, [open, onClear]);

  const submit = useCallback((dir: 'next' | 'prev') => {
    if (!query) return;
    const ok = dir === 'next' ? onNext(query) : onPrev(query);
    setNotFound(!ok);
  }, [query, onNext, onPrev]);

  if (!open) return null;

  return (
    <div className={s.root} role="search" aria-label={t('search.aria')}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit(e.shiftKey ? 'prev' : 'next');
          }
        }}
        placeholder={t('search.placeholder')}
        className={s.input}
        aria-invalid={notFound}
      />
      <IconButton onClick={() => submit('prev')} aria-label={t('search.prev')} title={t('search.prev')}>
        <IconChevronUp size={14} stroke={1.5} />
      </IconButton>
      <IconButton onClick={() => submit('next')} aria-label={t('search.next')} title={t('search.next')}>
        <IconChevronDown size={14} stroke={1.5} />
      </IconButton>
      <IconButton onClick={onClose} aria-label={t('search.close')} title={t('search.close')}>
        <IconX size={14} stroke={1.5} />
      </IconButton>
    </div>
  );
}
