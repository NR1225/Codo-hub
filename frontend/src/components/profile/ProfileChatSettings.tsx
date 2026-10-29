import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faLockOpen, faLock, faUserGroup, faCheck, faInbox } from '@fortawesome/free-solid-svg-icons';
import { apiService, DmPrivacy } from '../../utils/api';
import './ProfileChatSettings.css';

/* Профильдегі «Чат» табы: маған кім жаза алады.
   open — бәрі тікелей чатқа, closed — бейтаныстар «Сұрауларға», friends — тек достар */

const OPTIONS: { key: DmPrivacy; icon: IconDefinition }[] = [
  { key: 'open', icon: faLockOpen },
  { key: 'closed', icon: faLock },
  { key: 'friends', icon: faUserGroup },
];

const ProfileChatSettings: React.FC = () => {
  const { t } = useTranslation();
  const [value, setValue] = useState<DmPrivacy | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    apiService.getChatSettings().then((s) => setValue(s.dmPrivacy), () => setStatus('error'));
  }, []);

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
    <div className="pcs">
      <section className="pcs__card">
        <header className="pcs__head">
          <h3 className="pcs__title">{t('profile.chatSettings.title')}</h3>
          <span className={`pcs__status is-${status}`} role="status">
            {status === 'saved' && <><FontAwesomeIcon icon={faCheck} /> {t('profile.chatSettings.saved')}</>}
            {status === 'error' && t('profile.chatSettings.error')}
          </span>
        </header>
        <p className="pcs__desc">{t('profile.chatSettings.desc')}</p>

        <div className="pcs__options" role="radiogroup" aria-label={t('profile.chatSettings.title')}>
          {OPTIONS.map((opt) => (
            <button key={opt.key} type="button" role="radio" aria-checked={value === opt.key}
              className={`pcs__option ${value === opt.key ? 'is-on' : ''}`} onClick={() => choose(opt.key)}
              disabled={value === null}>
              <span className="pcs__icon"><FontAwesomeIcon icon={opt.icon} /></span>
              <span className="pcs__text">
                <span className="pcs__label">{t(`profile.chatSettings.${opt.key}`)}</span>
                <span className="pcs__hint">{t(`profile.chatSettings.${opt.key}Desc`)}</span>
              </span>
              <span className="pcs__radio" aria-hidden />
            </button>
          ))}
        </div>

        <p className="pcs__note">{t('profile.chatSettings.note')}</p>
        <Link to="/chat" className="pcs__link">
          <FontAwesomeIcon icon={faInbox} /> {t('profile.chatSettings.openRequests')}
        </Link>
      </section>
    </div>
  );
};

export default ProfileChatSettings;
