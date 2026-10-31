import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTerminal, faCheck, faXmark, faLaptop, faCloudArrowUp, faBan, faShieldHalved, faTriangleExclamation, faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import './Settings.css';
import './CliLoginPage.css';

/** `codo login` ашатын бет (/cli/login?code=XXXX-XXXX): терминалға аккаунтқа кіруге рұқсат беру.
 *  Код терминалдағымен бірдей екенін тексеріп, «Рұқсат беру» басу жеткілікті (GitHub CLI сияқты) */
const CliLoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const code = (params.get('code') || '').toUpperCase();
  const [deviceName, setDeviceName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'approving' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) {
      setState('error');
      setError(t('cliLogin.noCode'));
      return;
    }
    apiService.getCliLogin(code)
      .then((info) => {
        setDeviceName(info.deviceName);
        setState(info.approved ? 'done' : 'ready');
      })
      .catch((err) => {
        setState('error');
        setError((err instanceof Error && err.message) || t('common.error'));
      });
  }, [code, t]);

  const approve = async () => {
    setState('approving');
    try {
      await apiService.approveCliLogin(code);
      setState('done');
    } catch (err) {
      setState('error');
      setError((err instanceof Error && err.message) || t('common.error'));
    }
  };

  const username = user?.username ?? '';
  const pending = state === 'ready' || state === 'approving';

  return (
    <div className="settings-page cli-login">
      <div className="cli-login__glow" aria-hidden="true" />

      <section className={`cli-login__card cli-login__card--${state}`}>
        {/* Терминал ↔ аккаунт байланысы */}
        <div className="cli-login__link" aria-hidden="true">
          <span className="cli-login__node">
            <FontAwesomeIcon icon={faTerminal} />
          </span>
          <span className="cli-login__wire">
            <span className="cli-login__wire-dot" />
            <span className="cli-login__badge">
              <FontAwesomeIcon
                icon={state === 'done' ? faCheck : state === 'error' ? faXmark : faShieldHalved}
              />
            </span>
          </span>
          <span className="cli-login__node cli-login__node--user">
            {user?.avatar ? <img src={user.avatar} alt="" /> : <span>{username.slice(0, 1).toUpperCase() || '?'}</span>}
          </span>
        </div>

        <header className="cli-login__head">
          <h1 className="cli-login__title">
            {state === 'done' ? t('cliLogin.doneTitle') : state === 'error' ? t('cliLogin.errorTitle') : t('cliLogin.title')}
          </h1>
          {pending && (
            <p className="cli-login__lead">
              {t('cliLogin.text', { device: deviceName, username })}
            </p>
          )}
          {state === 'done' && <p className="cli-login__lead">{t('cliLogin.doneText')}</p>}
          {state === 'error' && <p className="cli-login__lead cli-login__lead--error">{error}</p>}
        </header>

        {state === 'loading' && (
          <div className="cli-login__skeleton" aria-label={t('common.loading')}>
            <span /><span /><span />
          </div>
        )}

        {pending && (
          <>
            <div className="cli-login__block">
              <span className="cli-login__label">{t('cliLogin.checkCode')}</span>
              <div className="cli-login__code" aria-label={code}>
                {code.split('').map((ch, i) => (
                  ch === '-'
                    ? <span key={i} className="cli-login__dash" />
                    : <span key={i} className="cli-login__char" style={{ animationDelay: `${i * 40}ms` }}>{ch}</span>
                ))}
              </div>
            </div>

            <dl className="cli-login__meta">
              <div>
                <dt><FontAwesomeIcon icon={faLaptop} /> {t('cliLogin.deviceLabel')}</dt>
                <dd>{deviceName || '—'}</dd>
              </div>
              <div>
                <dt>@ {t('cliLogin.accountLabel')}</dt>
                <dd>{username}</dd>
              </div>
            </dl>

            <ul className="cli-login__perms">
              <li className="cli-login__perm cli-login__perm--yes">
                <FontAwesomeIcon icon={faCloudArrowUp} /> {t('cliLogin.permUpload')}
              </li>
              <li className="cli-login__perm cli-login__perm--no">
                <FontAwesomeIcon icon={faBan} /> {t('cliLogin.permNoAccount')}
              </li>
            </ul>

            <div className="cli-login__actions">
              <button
                type="button"
                className="stg-btn stg-btn--primary cli-login__approve"
                onClick={approve}
                disabled={state === 'approving'}
              >
                {state === 'approving' && <FontAwesomeIcon icon={faSpinner} spin />}
                {t('cliLogin.approve')}
              </button>
              <Link to="/" className="stg-btn stg-btn--ghost">{t('common.cancel')}</Link>
            </div>

            <p className="cli-login__warning">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{t('cliLogin.warning')}</span>
            </p>
          </>
        )}

        {state === 'done' && (
          <div className="cli-login__terminal" aria-hidden="true">
            <span className="cli-login__prompt">$</span> codo push
            <span className="cli-login__caret" />
          </div>
        )}

        {state === 'error' && (
          <div className="cli-login__actions">
            <Link to="/" className="stg-btn stg-btn--ghost cli-login__approve">{t('cliLogin.backHome')}</Link>
          </div>
        )}
      </section>
    </div>
  );
};

export default CliLoginPage;
