import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons';
import { useGithubConnection } from '../../hooks/useGithubConnection';

/** Баптаулар → Аккаунт → GitHub: жабық репоны жүктеу үшін профильді қосу/ажырату */
const SettingsGithub: React.FC = () => {
  const { t } = useTranslation();
  const { status, connecting, error, connect, disconnect } = useGithubConnection();
  const [busy, setBusy] = useState(false);

  if (!status) return <p className="stg-text">{t('common.loading')}</p>;
  if (!status.configured) return <p className="stg-text">{t('githubConnect.notConfigured')}</p>;

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="stg-text">
        {status.connected ? t('githubConnect.connectedAs', { login: status.login }) : t('githubConnect.description')}
      </p>
      <div className="stg-actions">
        {status.connected ? (
          <button type="button" className="stg-btn stg-btn--ghost" onClick={handleDisconnect} disabled={busy}>
            {busy && <FontAwesomeIcon icon={faSpinner} spin />} {t('githubConnect.disconnect')}
          </button>
        ) : (
          <button type="button" className="stg-btn stg-btn--primary" onClick={connect} disabled={connecting}>
            {connecting && <FontAwesomeIcon icon={faSpinner} spin />} {t('githubConnect.connect')}
          </button>
        )}
      </div>
      {error && <p className="stg-msg stg-msg--error">{t('githubConnect.failed')}</p>}
    </>
  );
};

export default SettingsGithub;
