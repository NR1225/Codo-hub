import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '../../utils/api';
import { LockIcon, CheckSmallIcon } from '../home/icons';
import './ProjectMenu.css';

export interface ProjectEdit {
  title: string;
  description: string;
  isPrivate: boolean;
}

interface ProjectEditModalProps {
  code: CodeFile;
  onClose: () => void;
  /** Сақтау; қате болса — терезеде көрсетіледі */
  onSave: (changes: ProjectEdit) => Promise<void>;
}

/* ---------- Жобаны өңдеу: атауы, сипаттамасы, ашық/жабық ---------- */

const ProjectEditModal: React.FC<ProjectEditModalProps> = ({ code, onClose, onSave }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(code.title);
  const [description, setDescription] = useState(code.description || '');
  const [isPrivate, setIsPrivate] = useState(!!code.isPrivate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: title.trim(), description: description.trim(), isPrivate });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projectVisibility.updateError'));
      setSaving(false);
    }
  };

  return (
    <div className="pje-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="pje" role="dialog" aria-modal="true" aria-labelledby="pje-title" onSubmit={submit}>
        <h2 id="pje-title" className="pje__title">{t('projectVisibility.editTitle')}</h2>

        <label className="pje__field">
          {t('projectUpload.name')}
          <input
            className="pje__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            autoFocus
          />
        </label>

        <label className="pje__field">
          {t('projectUpload.description')}
          <textarea
            className="pje__input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('projectUpload.descriptionPlaceholder')}
            maxLength={500}
            rows={4}
          />
        </label>

        <button
          type="button"
          role="checkbox"
          aria-checked={isPrivate}
          className={`pjm__item pjm__item--check ${isPrivate ? 'is-on' : ''}`}
          onClick={() => setIsPrivate((v) => !v)}
        >
          <span className="pjm__box" aria-hidden="true">{isPrivate && <CheckSmallIcon size={12} />}</span>
          <span className="pjm__text">
            <span><LockIcon size={13} /> {t('projectVisibility.private')}</span>
            <small>{t(isPrivate ? 'projectVisibility.privateHint' : 'projectVisibility.publicHint')}</small>
          </span>
        </button>

        {error && <p className="pje__error" role="alert">{error}</p>}

        <div className="pje__actions">
          <button type="button" className="pje__btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="pje__btn pje__btn--primary" disabled={saving || !title.trim()}>
            {t(saving ? 'projectVisibility.saving' : 'projectVisibility.save')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProjectEditModal;
