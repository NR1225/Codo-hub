import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBook, faList, faLock, faArrowRight } from '@fortawesome/free-solid-svg-icons';

/* «Біз жайлы» → Біз туралы / Пайдалану шарттары / Құпиялылық саясаты.
   Мазмұн аудармада: settings.docs.<doc>.sections — { title, text?, items?, link? }[] */

export type ArticleDoc = 'about' | 'terms' | 'privacy';

interface Section {
  title: string;
  text?: string;
  items?: string[];
  link?: 'contact';
}

const ICONS: Record<ArticleDoc, IconDefinition> = {
  about: faBook,
  terms: faList,
  privacy: faLock,
};

const DocArticle: React.FC<{ doc: ArticleDoc }> = ({ doc }) => {
  const { t } = useTranslation();
  const raw = t(`settings.docs.${doc}.sections`, { returnObjects: true });
  const sections: Section[] = Array.isArray(raw) ? raw : [];
  // Құқықтық құжаттар нөмірленеді әрі жаңарту күні көрсетіледі
  const legal = doc !== 'about';

  return (
    <article className="stg-article">
      <header className="stg-article__hero">
        <span className="stg-article__icon"><FontAwesomeIcon icon={ICONS[doc]} /></span>
        <div className="stg-article__intro">
          <h1 className="stg-article__title">{t(`settings.docs.${doc}.title`)}</h1>
          <p className="stg-article__lead">{t(`settings.docs.${doc}.lead`)}</p>
          {legal && <p className="stg-article__meta">{t('settings.docs.updated')}</p>}
        </div>
      </header>

      <div className="stg-article__sections">
        {sections.map((s, i) => (
          <section key={s.title} className="stg-article__section" style={{ '--d': i } as React.CSSProperties}>
            <h2 className="stg-article__h2">
              {legal && <span className="stg-article__num">{i + 1}</span>}
              {s.title}
            </h2>
            {s.text && <p className="stg-article__text">{s.text}</p>}
            {s.items && (
              <ul className="stg-article__list">
                {s.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            {s.link === 'contact' && (
              <Link to="/settings/info/contact" className="stg-article__link">
                {t('settings.docs.toContact')} <FontAwesomeIcon icon={faArrowRight} />
              </Link>
            )}
          </section>
        ))}
      </div>
    </article>
  );
};

export default DocArticle;
