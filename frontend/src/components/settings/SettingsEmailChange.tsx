import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiService } from '../../utils/api';
import type { EmailChangePending } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

/* Поштаны ауыстыру: код ҚАЗІРГІ поштаға да, ЖАҢА поштаға да келеді — екеуін енгізгенде ғана ауысады.
   Кіру тек email кодымен, сондықтан бұл аккаунттың ең маңызды баптауы. */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const SettingsEmailChange: React.FC = () => {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [pending, setPending] = useState<EmailChangePending | null>(null);
  const [oldCode, setOldCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  const arm = (p: EmailChangePending) => {
    setPending(p);
    setExpiresAt(Date.now() + p.expires_in * 1000);
    setResendAt(Date.now() + p.resend_in * 1000);
  };

  useEffect(() => {
    apiService.getEmailChange().then((r) => r.pending && arm(r.pending)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [pending]);

  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const mapError = (msg: string) => {
    if (msg.includes('already in use')) return t('emailChange.taken');
    if (msg.includes('already your email')) return t('emailChange.same');
    if (msg.includes('Invalid email')) return t('register.emailInvalid');
    if (msg.includes('Invalid confirmation code')) return t('emailChange.invalid');
    if (msg.includes('expired')) return t('emailChange.expired');
    if (msg.includes('Too many')) return t('emailChange.tooMany');
    if (msg.includes('wait')) return t('emailChange.wait');
    return msg || 'Error';
  };

  const start = async () => {
    setError(null);
    setSuccess(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setError(t('register.emailInvalid'));
      return;
    }
    setBusy(true);
    try {
      arm(await apiService.startEmailChange(newEmail.trim()));
      setOldCode('');
      setNewCode('');
    } catch (e: any) {
      setError(mapError(e?.message || ''));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      arm(await apiService.resendEmailChange());
      setOldCode('');
      setNewCode('');
    } catch (e: any) {
      setError(mapError(e?.message || ''));
    }
  };

  const cancel = async () => {
    await apiService.cancelEmailChange().catch(() => {});
    setPending(null);
    setError(null);
  };

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const updated = await apiService.confirmEmailChange(oldCode, newCode);
      if (user) setUser({ ...user, email: updated.email });
      setPending(null);
      setNewEmail('');
      setSuccess(t('emailChange.done', { email: updated.email }));
    } catch (e: any) {
      setError(mapError(e?.message || ''));
    } finally {
      setBusy(false);
    }
  };

  const codeInput = (value: string, set: (v: string) => void, label: string) => (
    <label className="stg-field">
      <span className="stg-field__label">{label}</span>
      <input
        className="stg-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={left === 0}
      />
    </label>
  );

  return (
    <div className="stg-acc__body">
      <p className="stg-text">{t('emailChange.current')}: <strong>{user?.email}</strong></p>
      {!pending ? (
        <>
          <label className="stg-field">
            <span className="stg-field__label">{t('emailChange.newEmail')}</span>
            <input
              className="stg-input"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </label>
          <p className="stg-text">{t('emailChange.hint')}</p>
          <div className="stg-actions">
            <button type="button" className="stg-btn stg-btn--primary" onClick={start} disabled={busy || !newEmail.trim()}>
              {busy ? '...' : t('emailChange.sendCodes')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="stg-text">{t('emailChange.sent', { oldEmail: pending.oldEmail, newEmail: pending.newEmail })}</p>
          {codeInput(oldCode, setOldCode, t('emailChange.oldCode', { email: pending.oldEmail }))}
          {codeInput(newCode, setNewCode, t('emailChange.newCode', { email: pending.newEmail }))}
          <p className="stg-text">{left > 0 ? t('loginCode.validFor', { time: fmt(left) }) : t('emailChange.expired')}</p>
          <div className="stg-actions">
            <button type="button" className="stg-btn stg-btn--primary" onClick={confirm}
              disabled={busy || left === 0 || oldCode.length !== 6 || newCode.length !== 6}>
              {busy ? '...' : t('emailChange.confirm')}
            </button>
            <button type="button" className="stg-btn stg-btn--ghost" onClick={resend} disabled={resendIn > 0}>
              {resendIn > 0 ? t('register.resendIn', { seconds: resendIn }) : t('register.resendCode')}
            </button>
            <button type="button" className="stg-btn stg-btn--ghost" onClick={cancel}>{t('common.cancel')}</button>
          </div>
        </>
      )}
      {error && <p className="stg-msg stg-msg--error">{error}</p>}
      {success && <p className="stg-msg stg-msg--success">{success}</p>}
    </div>
  );
};

export default SettingsEmailChange;
