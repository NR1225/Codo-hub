import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '../../utils/api';
import { MoreIcon, LockIcon, EditIcon, TrashIcon, CheckSmallIcon } from '../home/icons';
import './ProjectMenu.css';

interface ProjectMenuProps {
  code: CodeFile;
  /** Жабық/ашық ауыстыру — бірден сақталады */
  onTogglePrivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/* ---------- Профильдегі код картасының ⋮ мәзірі (тек иесіне) ---------- */

const ProjectMenu: React.FC<ProjectMenuProps> = ({ code, onTogglePrivate, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className={`pjm ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="pjm__btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('projectVisibility.menu')}
        title={t('projectVisibility.menu')}
      >
        <MoreIcon size={16} />
      </button>
      {open && (
        <div className="pjm__list" role="menu">
          {/* Мәзір ашық қалады — күйі өзгергені бірден көрінеді */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={!!code.isPrivate}
            className={`pjm__item pjm__item--check ${code.isPrivate ? 'is-on' : ''}`}
            onClick={onTogglePrivate}
          >
            <span className="pjm__box" aria-hidden="true">{code.isPrivate && <CheckSmallIcon size={12} />}</span>
            <span className="pjm__text">
              <span><LockIcon size={13} /> {t('projectVisibility.private')}</span>
              <small>{t(code.isPrivate ? 'projectVisibility.privateHint' : 'projectVisibility.publicHint')}</small>
            </span>
          </button>
          <span className="pjm__sep" role="separator" />
          <button type="button" role="menuitem" className="pjm__item" onClick={() => run(onEdit)}>
            <EditIcon size={15} /> {t('projectVisibility.edit')}
          </button>
          <button type="button" role="menuitem" className="pjm__item pjm__item--danger" onClick={() => run(onDelete)}>
            <TrashIcon size={15} /> {t('projectVisibility.delete')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProjectMenu;
