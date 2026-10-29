import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import type { InfoDoc } from './infoDocs';
import DocArticle from './docs/DocArticle';
import ContactDoc from './docs/ContactDoc';
import './docs/SettingsDocs.css';

/* «Біз жайлы» қойындысының ішкі беттері: /settings/info/<doc>.
   Бұрынғы /about, /terms, /privacy, /contact адрестері осында бағытталады. */

const SettingsInfoDoc: React.FC<{ doc: InfoDoc }> = ({ doc }) => {
  const { t } = useTranslation();

  // Тізімнің ортасынан ашылса да, бет басынан басталсын
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [doc]);

  return (
    <div className="stg-grid stg-grid--info">
      <section className="stg-card stg-card--wide stg-doc">
        <div className="stg-doc__bar">
          <Link to="/settings/info" className="stg-btn stg-btn--ghost stg-doc__back">
            <FontAwesomeIcon icon={faArrowLeft} /> {t('settings.info.back')}
          </Link>
        </div>
        {doc === 'contact' ? <ContactDoc /> : <DocArticle doc={doc} />}
      </section>
    </div>
  );
};

export default SettingsInfoDoc;
