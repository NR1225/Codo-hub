import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faXmark, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { apiService } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { GITHUB_CHANNEL } from '../hooks/useGithubConnection';
import './Settings.css';
import './CliLoginPage.css';

/** GitHub OAuth-тан оралатын бет (/github/callback?code=…&state=…).
 *  Код серверде токенге айырбасталады; жеке терезеде ашылған болса — ашқан қойындыға хабарлап, жабылады */
const GithubCallbackPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');
  const [login, setLogin] = useState<string | null>(null);
  // StrictMode-та эффект екі рет жүреді, ал GitHub коды бір реттік
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const notify = () => {
      try {
        const channel = new BroadcastChannel(GITHUB_CHANNEL);
        channel.postMessage('done');
        channel.close();
      } catch {
        /* ескі браузер — ашқан қойынды күйді фокус кезінде тексереді */
      }
    };

    const code = params.get('code');
    const oauthState = params.get('state');
    if (!code || !oauthState) {
      // error=access_denied — қолданушы GitHub-та «Cancel» басты
      setError(t(params.get('error') === 'access_denied' ? 'githubConnect.denied' : 'githubConnect.failed'));
      setState('error');
      notify();
      return;
    }

    apiService
      .completeGithubConnect(code, oauthState)
      .then((res) => {
        setLogin(res.login);
        setState('done');
        notify();
        if (res.popup) {
          window.setTimeout(() => window.close(), 900);
        } else {
          window.setTimeout(() => navigate(res.returnTo || '/', { replace: true }), 900);
        }
      })
      .catch((err) => {
        console.error('GitHub callback failed:', err);
        setError(t('githubConnect.failed'));
        setState('error');
        notify();
      });
  }, [params, navigate, t]);

  const username = user?.username ?? '';

  return (
    <div className="settings-page cli-login">
      <div className="cli-login__glow" aria-hidden="true" />
      <section className={`cli-login__card cli-login__card--${state}`}>
        <div className="cli-login__link" aria-hidden="true">
          <span className="cli-login__node">
            <FontAwesomeIcon icon={faGithub} />
          </span>
          <span className="cli-login__wire">
            <span className="cli-login__wire-dot" />
            <span className="cli-login__badge">
              <FontAwesomeIcon icon={state === 'done' ? faCheck : state === 'error' ? faXmark : faShieldHalved} />
            </span>
          </span>
          <span className="cli-login__node cli-login__node--user">
            {user?.avatar ? <img src={user.avatar} alt="" /> : <span>{username.slice(0, 1).toUpperCase() || '?'}</span>}
          </span>
        </div>

        <header className="cli-login__head">
          <h1 className="cli-login__title">
            {state === 'done' ? t('githubConnect.doneTitle') : state === 'error' ? t('githubConnect.errorTitle') : t('githubConnect.connecting')}
          </h1>
          {state === 'done' && <p className="cli-login__lead">{t('githubConnect.doneText', { login: login ?? '' })}</p>}
          {state === 'error' && <p className="cli-login__lead cli-login__lead--error">{error}</p>}
        </header>

        {state === 'loading' && (
          <div className="cli-login__skeleton" aria-label={t('common.loading')}>
            <span /><span /><span />
          </div>
        )}

        {state === 'error' && (
          <div className="cli-login__actions">
            <Link to="/settings/account" className="stg-btn stg-btn--ghost cli-login__approve">{t('githubConnect.toSettings')}</Link>
          </div>
        )}
      </section>
    </div>
  );
};

export default GithubCallbackPage;
