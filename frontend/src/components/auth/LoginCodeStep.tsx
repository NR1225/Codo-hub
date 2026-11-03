import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiService, LoginChallenge } from '../../utils/api';
import './LoginCodeStep.css';

/* Кірудің екінші қадамы (құпия сөз жоқ): поштаға келген 6 таңбалы код.
   Код 3 минут жарамды. Қайта сұралса, алдыңғы код серверде бірден жарамсыз болады.

   6 квадрат: 6-шы сан енгізілгенде квадраттардың өзі жүктелу анимациясына (толқын)
   айналып, код тексеріледі. Дұрыс болса — квадраттар көрініп тұрып ортаға жиналады,
   бір квадратқа айналады, ол жасыл дөңгелекке ауысып ✓ сызылады да, сайтқа кіргізеді.
   Қате болса — сілкініп, тазаланады. */

interface Props {
  challenge: LoginChallenge;
  onSuccess: (response: any) => Promise<void> | void;
  onCancel: () => void;
}

// idle → checking (толқын) → merging (ортаға жиналу) → done (бір квадрат + ✓) → сайт
type Phase = 'idle' | 'checking' | 'merging' | 'done' | 'error';

const LENGTH = 6;
const CENTER = Math.floor(LENGTH / 2); // соңында қалатын квадрат
const MIN_CHECK_MS = 700; // толқын кем дегенде бір айналым көрінсін
const MERGE_MS = 1000; // квадраттар ортаға жиналу уақыты (CSS-пен бірдей)
const DONE_MS = 1100; // бір квадрат пен ✓ белгісі көрінетін уақыт
const ERROR_MS = 520; // сілкіну анимациясы

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LoginCodeStep: React.FC<Props> = ({ challenge, onSuccess, onCancel }) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [focused, setFocused] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + challenge.expires_in * 1000);
  const [resendAt, setResendAt] = useState(() => Date.now() + challenge.resend_in * 1000);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expired = left === 0;
  const busy = phase === 'checking' || phase === 'merging' || phase === 'done';

  const mapError = (msg: string) => {
    if (msg.includes('Invalid login code')) return t('loginCode.invalid');
    if (msg.includes('Too many')) return t('loginCode.tooMany');
    if (msg.includes('expired')) return t('loginCode.expired');
    if (msg.includes('wait')) return t('loginCode.wait', { seconds: resendIn || 60 });
    return msg || t('login.error');
  };

  const focusInput = () => inputRef.current?.focus();

  const verify = async (value: string) => {
    setPhase('checking');
    setError(null);
    setInfo(null);
    try {
      const [res] = await Promise.all([
        apiService.verifyLoginCode(challenge.challenge_id, value),
        wait(MIN_CHECK_MS),
      ]);
      setPhase('merging');
      await wait(MERGE_MS);
      setPhase('done');
      await wait(DONE_MS);
      await onSuccess(res);
    } catch (err: any) {
      setPhase('error');
      setError(mapError(err?.message || ''));
      await wait(ERROR_MS);
      setCode('');
      setPhase('idle');
      focusInput();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (busy || expired) return;
    const value = e.target.value.replace(/\D/g, '').slice(0, LENGTH);
    setCode(value);
    if (error) setError(null);
    if (value.length === LENGTH) verify(value);
  };

  const resend = async () => {
    if (resendIn > 0 || busy) return;
    setError(null);
    try {
      const res = await apiService.resendLoginCode(challenge.challenge_id);
      setExpiresAt(Date.now() + res.expires_in * 1000);
      setResendAt(Date.now() + res.resend_in * 1000);
      setCode('');
      setPhase('idle');
      setInfo(t('loginCode.resent'));
      focusInput();
    } catch (err: any) {
      setError(mapError(err?.message || ''));
    }
  };

  // Белсенді квадрат — келесі енгізілетін сан (бәрі толса — соңғысы)
  const activeIndex = Math.min(code.length, LENGTH - 1);

  return (
    <form onSubmit={(e) => e.preventDefault()} className="auth-form">
      <p className="auth-code-hint">
        {challenge.reason === 'new_device' ? t('loginCode.newDevice') : t('loginCode.login')}
      </p>
      <p className="auth-code-email">{challenge.email}</p>

      <div
        className={`otp otp--${phase}${expired ? ' otp--expired' : ''}`}
        onClick={focusInput}
        role="group"
        aria-label={t('loginCode.title')}
      >
        <input
          ref={inputRef}
          className="otp__input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          value={code}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
          disabled={expired || busy}
          aria-label={t('loginCode.title')}
        />
        {Array.from({ length: LENGTH }, (_, i) => {
          const filled = i < code.length;
          const active = phase === 'idle' && focused && !expired && i === activeIndex;
          return (
            <span
              key={i}
              className={`otp__cell${filled ? ' is-filled' : ''}${active ? ' is-active' : ''}${i === CENTER ? ' is-center' : ''}`}
              style={{ '--i': i, '--shift': (LENGTH - 1) / 2 - i, '--dist': Math.abs((LENGTH - 1) / 2 - i) } as React.CSSProperties}
              aria-hidden="true"
            >
              <span className="otp__digit">{code[i] ?? ''}</span>
              {i === CENTER && (
                <svg className="otp__check" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 12.4l3.9 3.9L18 8.2" pathLength={1} />
                </svg>
              )}
            </span>
          );
        })}
      </div>

      <div className="auth-code-info otp-timer">
        {expired ? t('loginCode.expired') : t('loginCode.validFor', { time: fmt(left) })}
      </div>

      {error && <div className="form-error">{error}</div>}
      {info && !error && <div className="auth-code-info">{info}</div>}

      <div className="auth-code-actions">
        <button type="button" className="auth-code-link" onClick={resend} disabled={resendIn > 0 || busy}>
          {resendIn > 0 ? t('register.resendIn', { seconds: resendIn }) : t('register.resendCode')}
        </button>
        <button type="button" className="auth-code-link" onClick={onCancel} disabled={busy}>
          {t('loginCode.back')}
        </button>
      </div>
    </form>
  );
};

export default LoginCodeStep;
