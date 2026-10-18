import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SortIcon, ChevronIcon, CheckIcon } from '../home/icons';
import { SORT_OPTIONS, SortOption } from './codeUtils';

/* ---------- Сұрыптау мәзірі ---------- */

const SortMenu: React.FC<{ value: SortOption; onChange: (value: SortOption) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  // Сыртын басқанда жабылады
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Ашылғанда — таңдалған нұсқаға фокус
  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLButtonElement>('.cdx-menu__item.is-active')?.focus();
  }, [open]);

  // ↑/↓ — нұсқалар арасында жүру, Esc/Tab — жабу
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.cdx-menu__item') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : idx <= 0 ? items.length - 1 : idx - 1;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className={`cdx-menu ${open ? 'is-open' : ''}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="cdx-menu__trigger"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="cdx-sort-list"
      >
        <SortIcon />
        <span className="sr-only">{t('home.sortBy')}: </span>
        <span className="cdx-menu__value">{t(current.labelKey)}</span>
        <span className="cdx-menu__chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div id="cdx-sort-list" className="cdx-menu__pop" role="listbox" aria-label={t('home.sortBy')}>
          <p className="cdx-menu__caption" aria-hidden="true">
            {t('home.sortBy')}
          </p>
          {SORT_OPTIONS.map((opt, i) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`cdx-menu__item ${active ? 'is-active' : ''}`}
                style={{ '--d': i } as React.CSSProperties}
                onClick={() => {
                  onChange(opt.value);
                  close(true);
                }}
              >
                <span className="cdx-menu__label">{t(opt.labelKey)}</span>
                <CheckIcon />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SortMenu;
