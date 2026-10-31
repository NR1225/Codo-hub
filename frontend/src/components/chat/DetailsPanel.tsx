import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../home/icons';

/* Сөйлесудің оң жағындағы ақпарат панелі (досының профилі, топ туралы).
   Кең экранда — сөйлесумен қатар тұратын үшінші баған, тарырақ экранда — оң жақтан
   шығатын тартпа (фонын басқанда жабылады). Стильдері: ChatPage.css (.cht-details) */

interface DetailsPanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Төменгі жолақ (мысалы, «Топтан шығу») — айналмайды */
  footer?: React.ReactNode;
}

const DetailsPanel: React.FC<DetailsPanelProps> = ({ title, onClose, children, footer }) => {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Ашылғанда фокус — жабу батырмасына; Esc — жабу (мәзір/жазу өрісі өзі өңдемесе)
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.message-input-form')) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="cht-details-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="cht-details" aria-label={title}>
        <div className="cht-details__head">
          <h2>{title}</h2>
          <button ref={closeRef} type="button" className="cht-icon-btn x-close" onClick={onClose} aria-label={t('common.close')}>
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="cht-details__body">{children}</div>
        {footer && <div className="cht-details__foot">{footer}</div>}
      </aside>
    </>
  );
};

export default DetailsPanel;
