import React, { useState } from 'react';
import { apiService, BurkitStatus } from '../utils/api';

/* Gemini кілтін енгізу/ауыстыру/өшіру картасы — Vibecoding-тегі (cls="vx-ai") және
   басты беттегі (cls="sai") Бүркітке ортақ. Сыныптар: `${cls}__key…` */

const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';

interface BurkitKeyCardProps {
  /** CSS сыныптарының түбірі */
  cls: string;
  status: BurkitStatus | null;
  onChange: (status: BurkitStatus) => void;
  onClose?: () => void;
  /** Жабу батырмасының белгішесі мен сыныбы (әр бетте өзінікі) */
  closeIcon?: React.ReactNode;
  closeClassName?: string;
}

const BurkitKeyCard: React.FC<BurkitKeyCardProps> = ({ cls, status, onChange, onClose, closeIcon = '×', closeClassName }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<BurkitStatus>) => {
    setBusy(true);
    setError('');
    try {
      onChange(await action());
      setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате орын алды');
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) run(() => apiService.saveBurkitKey(value.trim()));
  };

  return (
    <form className={`${cls}__key`} onSubmit={save}>
      <div className={`${cls}__key-head`}>
        <b>Gemini API кілті</b>
        {onClose && (
          <button type="button" className={closeClassName ?? `${cls}__key-close`} onClick={onClose} title="Жабу">
            {closeIcon}
          </button>
        )}
      </div>
      <p className={`${cls}__key-text`}>
        {status?.source === 'own' && <>Өз кілтіңіз қосулы: <code>{status.keyHint}</code></>}
        {status?.source === 'shared' && <>Сіз сайттың ортақ кілтін қолданып жатырсыз. Өз кілтіңізді қойсаңыз, сол қолданылады.</>}
        {(!status || status.source === 'none') && (
          <>
            Бүркітті қолдану үшін тегін кілт алыңыз:{' '}
            <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer" className={`${cls}__link`}>aistudio.google.com</a>
            {' '}→ «Create API key».
          </>
        )}
      </p>
      <div className={`${cls}__key-row`}>
        <input
          type="password"
          className={`${cls}__key-input`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status?.source === 'own' ? 'Жаңа кілт' : 'Кілтті осында қойыңыз'}
          autoComplete="off"
          spellCheck={false}
          aria-label="Gemini API кілті"
        />
        <button type="submit" className={`${cls}__key-btn`} disabled={busy || !value.trim()}>
          {busy ? '…' : 'Сақтау'}
        </button>
      </div>
      {error && <p className={`${cls}__key-error`}>{error}</p>}
      {status?.source === 'own' && (
        <button type="button" className={`${cls}__key-remove`} disabled={busy} onClick={() => run(() => apiService.deleteBurkitKey())}>
          Кілтті өшіру
        </button>
      )}
      <p className={`${cls}__key-note`}>Кілт серверде шифрланып сақталады, оны тек сіздің аккаунтыңыз қолданады.</p>
    </form>
  );
};

export default BurkitKeyCard;
