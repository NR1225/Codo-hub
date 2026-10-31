import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faLockOpen,
  faLock,
  faUserGroup,
  faCheck,
  faInbox,
  faShieldHalved,
  faCircleInfo,
  faChevronRight,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, DmPrivacy } from '../../utils/api';

/* Баптаулар → «Чат»: маған кім жаза алады.
   open — бәрі тікелей чатқа, closed — бейтаныстар «Сұрауларға», friends — тек достар */

const OPTIONS: { key: DmPrivacy; icon: IconDefinition }[] = [
  { key: 'open', icon: faLockOpen },
  { key: 'closed', icon: faLock },
  { key: 'friends', icon: faUserGroup },
];

type Status = 'idle' | 'saving' | 'saved' | 'error';

const SettingsChat: React.FC = () => {
  const { t } = useTranslation();
  const [value, setValue] = useState<DmPrivacy | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    apiService.getChatSettings().then((s) => setValue(s.dmPrivacy), () => setStatus('error'));
  }, []);

  // «Сақталды» белгісі біраздан соң жоғалады
  useEffect(() => {
    if (status !== 'saved') return;
    const id = window.setTimeout(() => setStatus('idle'), 2200);
    return () => window.clearTimeout(id);
  }, [status]);

  const choose = async (next: DmPrivacy) => {
    if (next === value || status === 'saving') return;
    const prev = value;
    setValue(next);
    setStatus('saving');
    try {
      await apiService.updateChatSettings(next);
      setStatus('saved');
    } catch {
      setValue(prev);
      setStatus('error');
    }
  };

  return (
    <div className="stg-grid">
      <section className="stg-card stg-card--wide">
        <div className="stg-card__head stg-card__head--row">
          <div>
            <h2 className="stg-card__title">
              <FontAwesomeIcon icon={faShieldHalved} /> {t('profile.chatSettings.title')}
            </h2>
            <p className="stg-text stg-text--muted">{t('profile.chatSettings.desc')}</p>
          </div>
          <span className={`stg-chat__status is-${status}`} role="status" aria-live="polite">
            {status === 'saving' && <FontAwesomeIcon icon={faSpinner} spin />}
            {status === 'saved' && <><FontAwesomeIcon icon={faCheck} /> {t('profile.chatSettings.saved')}</>}
            {status === 'error' && t('profile.chatSettings.error')}
          </span>
        </div>

        <div className="stg-chat__options" role="radiogroup" aria-label={t('profile.chatSettings.title')}>
          {OPTIONS.map((opt) => {
            const on = value === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={on}
                className={`stg-chat__option ${on ? 'is-on' : ''}`}
                onClick={() => choose(opt.key)}
                disabled={value === null}
              >
                <span className="stg-chat__top">
                  <span className="stg-chat__icon"><FontAwesomeIcon icon={opt.icon} /></span>
                  <span className="stg-chat__radio" aria-hidden />
                </span>
                <span className="stg-chat__label">{t(`profile.chatSettings.${opt.key}`)}</span>
                <span className="stg-chat__hint">{t(`profile.chatSettings.${opt.key}Desc`)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="stg-card stg-card--wide stg-card--compact stg-chat__info">
        <p className="stg-text">
          <FontAwesomeIcon icon={faCircleInfo} className="stg-chat__info-icon" />
          {t('profile.chatSettings.note')}
        </p>
        <Link to="/chat" className="stg-row stg-chat__link">
          <span className="stg-row__slot"><FontAwesomeIcon icon={faInbox} /></span>
          <span className="stg-row__label">{t('profile.chatSettings.openRequests')}</span>
          <FontAwesomeIcon icon={faChevronRight} className="stg-row__arrow" />
        </Link>
      </section>
    </div>
  );
};

export default SettingsChat;
