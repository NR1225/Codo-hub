import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiService, LoginChallenge } from '../../utils/api';
import Button from '../ui/Button';

/* Кірудің екінші қадамы (құпия сөз жоқ): поштаға келген 6 таңбалы код.
   Код 3 минут жарамды. Қайта сұралса, алдыңғы код серверде бірден жарамсыз болады. */

interface Props {
  challenge: LoginChallenge;
  onSuccess: (response: any) => Promise<void> | void;
  onCancel: () => void;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const LoginCodeStep: React.FC<Props> = ({ challenge, onSuccess, onCancel }) => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  const mapError = (msg: string) => {
    if (msg.includes('Invalid login code')) return t('loginCode.invalid');
    if (msg.includes('Too many')) return t('loginCode.tooMany');
    if (msg.includes('expired')) return t('loginCode.expired');
    if (msg.includes('wait')) return t('loginCode.wait', { seconds: resendIn || 60 });
    return msg || t('login.error');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code) || expired) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.verifyLoginCode(challenge.challenge_id, code);
      await onSuccess(res);
    } catch (err: any) {
      setError(mapError(err?.message || ''));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setError(null);
    try {
      const res = await apiService.resendLoginCode(challenge.challenge_id);
      setExpiresAt(Date.now() + res.expires_in * 1000);
      setResendAt(Date.now() + res.resend_in * 1000);
      setCode('');
      setInfo(t('loginCode.resent'));
    } catch (err: any) {
      setError(mapError(err?.message || ''));
    }
  };

  return (
    <form onSubmit={submit} className="auth-form">
      <p className="auth-code-hint">
        {challenge.reason === 'new_device' ? t('loginCode.newDevice') : t('loginCode.login')}
        <br />
        {t('loginCode.sentTo')} <strong>{challenge.email}</strong>
      </p>

      <div className="form-group">
        <input
          className="auth-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          autoFocus
          disabled={expired}
          aria-label={t('loginCode.title')}
        />
      </div>

      <div className="auth-code-info" style={{ textAlign: 'center' }}>
        {expired ? t('loginCode.expired') : t('loginCode.validFor', { time: fmt(left) })}
      </div>

      {error && <div className="form-error">{error}</div>}
      {info && !error && <div className="auth-code-info">{info}</div>}

      <Button type="submit" variant="primary" fullWidth disabled={loading || code.length !== 6 || expired}>
        {loading ? t('register.verifying') : t('loginCode.submit')}
      </Button>

      <div className="auth-code-actions">
        <button type="button" className="auth-code-link" onClick={resend} disabled={resendIn > 0}>
          {resendIn > 0 ? t('register.resendIn', { seconds: resendIn }) : t('register.resendCode')}
        </button>
        <button type="button" className="auth-code-link" onClick={onCancel}>
          {t('loginCode.back')}
        </button>
      </div>
    </form>
  );
};

export default LoginCodeStep;
