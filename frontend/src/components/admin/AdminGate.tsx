import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShieldHalved, faKey, faEnvelope } from '@fortawesome/free-solid-svg-icons';
import { apiService, AdminMe } from '../../utils/api';
import { errText } from './adminApi';

/* Әкімші панеліне кірер алдындағы қорғаныс экрандары:
   - 2FA қосылмаған → баптауларға сілтеме
   - 2FA қосулы → authenticator коды (немесе поштаға келген код) сұралады */

export const TwoFactorRequired: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="adm-gate">
      <FontAwesomeIcon icon={faShieldHalved} className="adm-gate__icon" />
      <h1>{t('admin.gate.need2faTitle')}</h1>
      <p>{t('admin.gate.need2faText')}</p>
      <Link to="/settings/account" className="mon__btn adm__primary">{t('admin.gate.open2fa')}</Link>
    </div>
  );
};

export const StepUp: React.FC<{ me: AdminMe; onVerified: () => void }> = ({ me, onVerified }) => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEmail = me.method === 'email';

  const send = async () => {
    setError(null);
    try {
      await apiService.adminStepUpStart();
      setSent(true);
    } catch (e) {
      setError(errText(e));
    }
  };

  useEffect(() => {
    if (isEmail) send();
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmail]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await apiService.adminStepUpVerify(code);
      onVerified();
    } catch (err) {
      setError(errText(err));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="adm-gate" onSubmit={submit}>
      <FontAwesomeIcon icon={isEmail ? faEnvelope : faKey} className="adm-gate__icon" />
      <h1>{t('admin.gate.title')}</h1>
      <p>{isEmail ? t('admin.gate.emailText') : t('admin.gate.totpText')}</p>
      <input
        ref={inputRef}
        className="adm-gate__code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        aria-label={t('admin.gate.code')}
      />
      {error && <div className="mon__error">{error}</div>}
      <button type="submit" className="mon__btn adm__primary" disabled={busy || code.length < 6}>{t('admin.gate.verify')}</button>
      {isEmail && (
        <button type="button" className="adm__person" onClick={send}>{sent ? t('admin.gate.resend') : t('admin.gate.send')}</button>
      )}
      <p className="adm__muted adm-gate__hint">{t('admin.gate.hint')}</p>
    </form>
  );
};
