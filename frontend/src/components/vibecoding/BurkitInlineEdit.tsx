import React, { useEffect, useRef, useState } from 'react';
import BurkitLogo from '../BurkitLogo';
import { CloseIcon } from './icons';
import SendIcon from '../SendIcon';

/* Ctrl+K — редактордың ішіндегі Бүркіт (Cursor-дағы inline edit): белгіленген жолдардың үстінде
   шығатын шағын өріс. Нұсқау жазылып Enter басылса, Бүркіт сол жолдарды қайта жазады,
   нәтижесі кәдімгі diff ретінде «Қабылдау / Қайтару» арқылы қаралады. */

interface BurkitInlineEditProps {
  /** Редактордың жоғарғы жиегінен қашықтығы (px) */
  top: number;
  /** «12–18 жолдар» немесе «14-жолдан кейін» */
  rangeLabel: string;
  onSubmit: (instruction: string) => Promise<void>;
  onClose: () => void;
}

const BurkitInlineEdit: React.FC<BurkitInlineEditProps> = ({ top, rangeLabel, onSubmit, onClose }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const instruction = value.trim();
    if (!instruction || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(instruction);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Қате орын алды');
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <form
      className={`vx-inline ${busy ? 'is-busy' : ''}`}
      style={{ top }}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="vx-inline__row">
        <BurkitLogo size={18} />
        <input
          ref={inputRef}
          className="vx-inline__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={busy ? 'Бүркіт жазып жатыр…' : 'Не өзгерту керек? (мысалы: қатені түзет, түсініктеме қос)'}
          disabled={busy}
          spellCheck={false}
          aria-label="Бүркітке нұсқау"
        />
        {busy ? (
          <span className="vx-ai__dots" aria-hidden="true"><span /><span /><span /></span>
        ) : (
          <button type="submit" className="vx-inline__send" disabled={!value.trim()} title="Жіберу (Enter)">
            <SendIcon size={12} />
          </button>
        )}
        <button type="button" className="vx-icon-btn vx-icon-btn--xs x-close" onClick={onClose} title="Жабу (Esc)">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="vx-inline__meta">
        {error ? <span className="vx-inline__error">{error}</span> : <span>{rangeLabel} · Enter — жіберу · Esc — жабу</span>}
      </div>
    </form>
  );
};

export default BurkitInlineEdit;
