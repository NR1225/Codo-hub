import React from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, RefreshIcon, TrashIcon } from '../home/icons';
import { AlertIcon } from './MediaIcons';

/* Серверге әлі жетпеген хабарламаның күйлері: файл жүктелуі (сақина + тоқтату)
   және «жіберілмеді» жолағы (қайталау / жою). Стильдері: ChatPage.css (cht-upload, cht-failed) */

const RING_R = 19;
const RING_LEN = 2 * Math.PI * RING_R;

export const UploadOverlay: React.FC<{ progress: number; onCancel: () => void }> = ({ progress, onCancel }) => {
  const { t } = useTranslation();
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="cht-upload" role="status" aria-label={t('chat.delivery.uploading', { percent })}>
      <button type="button" className="cht-upload__btn" onClick={onCancel} title={t('chat.delivery.cancelUpload')}>
        <svg className="cht-upload__ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle className="cht-upload__track" cx="22" cy="22" r={RING_R} />
          <circle
            className="cht-upload__bar"
            cx="22"
            cy="22"
            r={RING_R}
            strokeDasharray={RING_LEN}
            strokeDashoffset={RING_LEN * (1 - Math.max(0.03, progress))}
          />
        </svg>
        <CloseIcon size={16} />
      </button>
      <span className="cht-upload__percent">{percent}%</span>
    </div>
  );
};

export const FailedBar: React.FC<{ error?: string; onRetry: () => void; onDiscard: () => void }> = ({
  error,
  onRetry,
  onDiscard,
}) => {
  const { t } = useTranslation();
  return (
    <div className="cht-failed" role="alert">
      <span className="cht-failed__label" title={error}>
        <AlertIcon size={14} />
        {t('chat.delivery.failed')}
      </span>
      <button type="button" className="cht-failed__btn" onClick={onRetry}>
        <RefreshIcon />
        {t('chat.delivery.retry')}
      </button>
      <button type="button" className="cht-failed__btn is-danger" onClick={onDiscard} title={t('chat.delivery.discard')}>
        <TrashIcon size={14} />
      </button>
    </div>
  );
};
