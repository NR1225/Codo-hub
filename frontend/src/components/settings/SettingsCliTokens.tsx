import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTerminal, faLaptop, faTrash, faCopy, faCheck } from '@fortawesome/free-solid-svg-icons';
import { apiService, CliToken } from '../../utils/api';
import { API_BASE_URL } from '../../utils/constants';
import { formatDate, formatDateTime } from '../../utils/dateFormatter';
import { useConfirm } from '../../contexts/ToastContext';

// API_BASE_URL салыстырмалы болуы мүмкін (/api) — терминалға толық адрес керек
const apiUrl = new URL(API_BASE_URL, window.location.href).href.replace(/\/$/, '');
const scriptUrl = `${apiUrl}/cli/codo.py`;

type Os = 'windows' | 'unix';
const OS_LABELS: Record<Os, string> = { windows: 'Windows', unix: 'macOS / Linux' };
const detectOs = (): Os => (/win/i.test(navigator.userAgent) ? 'windows' : 'unix');

/** codo-ны бір рет орнату (backend/cli/codo.py install) — кілтсіз; кіру кейін `codo login` арқылы.
 *  curl.exe — cmd-да да, PowerShell-де де бірдей (PowerShell 5.1-де «curl» — Invoke-WebRequest) */
const installCommand = (os: Os) =>
  os === 'windows'
    ? `curl.exe -fsSL ${scriptUrl} | python - install`
    : `curl -fsSL ${scriptUrl} | python3 - install`;

/** Көшіру батырмасы бар бір жолдық команда */
const CommandLine: React.FC<{ command: string }> = ({ command }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard рұқсаты жоқ — қолмен көшіреді */ }
  };
  return (
    <div className="stg-cmd">
      <code className="stg-cmd__text">{command}</code>
      <button
        type="button"
        className="stg-icon-btn"
        onClick={copy}
        title={t('settings.cli.copy')}
        aria-label={t('settings.cli.copy')}
      >
        <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
      </button>
    </div>
  );
};

/** Баптаулар → Терминал: git сияқты нұсқаулық (орнату → login → add → commit → push) және кірген құрылғылар */
const SettingsCliTokens: React.FC = () => {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [os, setOs] = useState<Os>(detectOs);
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const errorText = useCallback(
    (err: unknown) => (err instanceof Error && err.message) || t('common.error'),
    [t],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiService.getCliTokens();
      setTokens(res.tokens);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [errorText]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async (token: CliToken) => {
    if (!(await confirm({
      title: t('settings.cli.revokeConfirm'),
      message: t('settings.cli.revokeConfirmMessage', { name: token.name }),
      confirmText: t('settings.cli.revoke'),
      danger: true,
    }))) return;
    try {
      await apiService.revokeCliToken(token.id);
      setTokens((prev) => prev.filter((item) => item.id !== token.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="stg-grid">
      <section className="stg-card stg-card--wide">
        <h2 className="stg-card__title">
          <FontAwesomeIcon icon={faTerminal} /> {t('settings.cli.howTitle')}
        </h2>
        <p className="stg-text">{t('settings.cli.howText')}</p>

        <div className="stg-segment" role="radiogroup" aria-label={t('settings.cli.os')}>
          {(Object.keys(OS_LABELS) as Os[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={os === value}
              className={`stg-segment__btn ${os === value ? 'is-active' : ''}`}
              onClick={() => setOs(value)}
            >
              {OS_LABELS[value]}
            </button>
          ))}
        </div>

        <ol className="stg-steps">
          <li>
            <span className="stg-text">{t('settings.cli.step1')}</span>
            <CommandLine command={installCommand(os)} />
          </li>
          <li>
            <span className="stg-text">{t('settings.cli.step2')}</span>
            <CommandLine command="codo login" />
          </li>
          <li>
            <span className="stg-text">{t('settings.cli.step3')}</span>
            <CommandLine command="codo add ." />
            <CommandLine command={'codo commit -m "алғашқы нұсқа"'} />
            <CommandLine command="codo push" />
          </li>
        </ol>
        <p className="stg-text stg-text--muted">{t('settings.cli.note')}</p>
      </section>

      <section className="stg-card stg-card--wide">
        <h2 className="stg-card__title">
          <FontAwesomeIcon icon={faLaptop} /> {t('settings.cli.tokensTitle')}
        </h2>
        {error && <p className="stg-msg stg-msg--error">{error}</p>}
        {loading ? (
          <p className="stg-text">{t('common.loading')}</p>
        ) : tokens.length === 0 ? (
          <p className="stg-text">{t('settings.cli.noTokens')}</p>
        ) : (
          <ul className="stg-tokens">
            {tokens.map((token) => (
              <li key={token.id} className="stg-token">
                <div className="stg-token__info">
                  <span className="stg-token__name">{token.name}</span>
                  <span className="stg-folder__meta">
                    {token.createdAt && <>{t('settings.cli.created')} {formatDate(token.createdAt, i18n.language)}</>}
                    {' · '}
                    {token.lastUsedAt
                      ? <>{t('settings.cli.lastUsed')} {formatDateTime(token.lastUsedAt, i18n.language)}</>
                      : t('settings.cli.neverUsed')}
                  </span>
                </div>
                <button
                  type="button"
                  className="stg-icon-btn stg-icon-btn--danger"
                  onClick={() => handleRevoke(token)}
                  title={t('settings.cli.revoke')}
                  aria-label={t('settings.cli.revoke')}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default SettingsCliTokens;
