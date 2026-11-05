import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import DocArticle from './DocArticle';
import './SettingsDocs.css';
import './LegalDocModal.css';

/* Пайдалану шарттары / Құпиялылық саясаты — аккаунтсыз көруге арналған модал.
   /settings беті ProtectedRoute ішінде, сондықтан кірмеген қолданушыға (Welcome беті)
   құжат осы терезеде ашылады. */

export type LegalDoc = 'terms' | 'privacy';

interface Props {
  doc: LegalDoc | null;
  onClose: () => void;
}

const LegalDocModal: React.FC<Props> = ({ doc, onClose }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  if (!doc) return null;

  return createPortal(
    <div className="legal-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="legal-modal__dialog" role="dialog" aria-modal="true" aria-label={t(`settings.docs.${doc}.title`)}>
        <button type="button" className="legal-modal__close" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
        <div className="legal-modal__body">
          <DocArticle doc={doc} showContactLink={false} />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LegalDocModal;
