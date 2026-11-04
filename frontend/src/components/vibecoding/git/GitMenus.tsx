import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodoInfoDTO, GitBranchesDTO } from '../../../utils/api';
import { BranchIcon, CheckIcon, PlusIcon, TrashIcon } from '../icons';
import { relativeTime } from './gitGraph';

/** Сыртқа басқанда немесе Esc-те жабылатын popover */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
}

export const GitMenu: React.FC<{ items: MenuItem[]; onClose: () => void; align?: 'left' | 'right' }> = ({ items, onClose, align = 'right' }) => {
  const ref = useDismiss(true, onClose);
  return (
    <div ref={ref} className={`vx-git-menu is-${align}`} role="menu">
      {items.map((it, i) => it.separator ? (
        <div key={`s${i}`} className="vx-git-menu__sep" />
      ) : (
        <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
          className={`vx-git-menu__item ${it.danger ? 'is-danger' : ''}`}
          onClick={() => { onClose(); it.onClick?.(); }}>
          <span className="vx-git-menu__check">{it.checked ? <CheckIcon size={11} /> : null}</span>
          <span className="vx-git-menu__label">{it.label}</span>
          {it.hint && <span className="vx-git-menu__hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
};

/** VS Code-тағы «Checkout to…» сияқты: іздеу, ауысу, жаңа бұтақ, біріктіру, өшіру */
export const BranchPicker: React.FC<{
  branches: GitBranchesDTO | null;
  codo: CodoInfoDTO | null;
  onClose: () => void;
  onCheckout: (name: string) => void;
  onCreate: (name: string) => void;
  onMerge: (name: string) => void;
  onDelete: (name: string) => void;
}> = ({ branches, codo, onClose, onCheckout, onCreate, onMerge, onDelete }) => {
  const { t, i18n } = useTranslation();
  const ref = useDismiss(true, onClose);
  const [q, setQ] = useState('');
  const query = q.trim();
  const current = branches?.current ?? null;

  const local = useMemo(
    () => (branches?.local ?? []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase())),
    [branches, query],
  );
  const localNames = new Set((branches?.local ?? []).map((b) => b.name));
  // Codo-да бар, бірақ жергілікті жоқ бұтақтар (refs/remotes/codo/*, upstream/*)
  const remote = (branches?.remote ?? []).filter((b) => {
    const short = b.name.split('/').slice(1).join('/');
    return !localNames.has(short) && (!query || b.name.toLowerCase().includes(query.toLowerCase()));
  });
  const canCreate = !!query && !localNames.has(query) && /^[A-Za-z0-9._/-]+$/.test(query);

  return (
    <div ref={ref} className="vx-git-picker" role="dialog">
      <input autoFocus className="vx-git-picker__input" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t('vibecoding.git.branch.search', 'Бұтақты іздеу немесе жаңасының атауы')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (local.length === 1 && local[0].name !== current) { onCheckout(local[0].name); onClose(); }
            else if (canCreate) { onCreate(query); onClose(); }
          }
        }} />
      <div className="vx-git-picker__list">
        {canCreate && (
          <button type="button" className="vx-git-picker__item is-create" onClick={() => { onCreate(query); onClose(); }}>
            <PlusIcon size={12} />
            <span>{t('vibecoding.git.branch.create', 'Жаңа бұтақ жасау: {{name}}', { name: query })}</span>
          </button>
        )}
        {local.length > 0 && <div className="vx-git-picker__group">{t('vibecoding.git.branch.local', 'Бұтақтар')}</div>}
        {local.map((b) => {
          const published = codo?.branches.some((c) => c.name === b.name);
          return (
            <div key={b.name} className={`vx-git-picker__item ${b.name === current ? 'is-current' : ''}`}
              role="button" tabIndex={0}
              onClick={() => { if (b.name !== current) onCheckout(b.name); onClose(); }}>
              <BranchIcon size={12} />
              <span className="vx-git-picker__name">{b.name}</span>
              {published && <span className="vx-git-ref is-remote" title={t('vibecoding.git.codo.onCodo', 'Сайт Git-інде бар')}>codo</span>}
              <span className="vx-git-picker__meta">{relativeTime(b.time, i18n.language)}</span>
              {b.name !== current && (
                <span className="vx-git-picker__acts" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="vx-icon-btn vx-icon-btn--xs"
                    title={t('vibecoding.git.branch.mergeInto', '«{{name}}»-ны ағымдағы бұтаққа біріктіру', { name: b.name })}
                    onClick={() => { onMerge(b.name); onClose(); }}>
                    <span className="vx-git-minus" aria-hidden>⇲</span>
                  </button>
                  <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.branch.delete', 'Өшіру')}
                    onClick={() => { onDelete(b.name); onClose(); }}>
                    <TrashIcon size={12} />
                  </button>
                </span>
              )}
              {b.name === current && <CheckIcon size={12} />}
            </div>
          );
        })}
        {remote.length > 0 && <div className="vx-git-picker__group">{t('vibecoding.git.branch.remote', 'Сайт Git-індегі бұтақтар')}</div>}
        {remote.map((b) => (
          <div key={b.name} className="vx-git-picker__item" role="button" tabIndex={0}
            onClick={() => { onCheckout(b.name); onClose(); }}>
            <BranchIcon size={12} />
            <span className="vx-git-picker__name">{b.name}</span>
            <span className="vx-git-picker__meta">{relativeTime(b.time, i18n.language)}</span>
          </div>
        ))}
        {!local.length && !remote.length && !canCreate && (
          <p className="vx-git__hint">{t('vibecoding.git.branch.none', 'Бұтақ табылмады')}</p>
        )}
      </div>
    </div>
  );
};
