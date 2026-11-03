import React, { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faLaptopCode,
  faWandMagicSparkles,
  faCodeBranch,
  faStickyNote,
  faTerminal,
  faArrowRight,
  faArrowDown,
  faLayerGroup,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import { faComments } from '@fortawesome/free-regular-svg-icons';
import { useAuth } from '../contexts/AuthContext';
import { markWelcomeSeen } from '../utils/welcome';
// .home-btn батырма стильдері — Home.css-те
import './Home.css';
import './WelcomePage.css';

// Қарсы алу беті — толық экранда, сайт хедерінсіз (App.tsx), басты беттің
// қара монохром палитрасында. Кірмеген қолданушыға бір рет көрсетіледі.
const FEATURES = [
  { key: 'vibe', icon: faLaptopCode, wide: true },
  { key: 'ai', icon: faWandMagicSparkles },
  { key: 'share', icon: faCodeBranch },
  { key: 'chat', icon: faComments },
  { key: 'notes', icon: faStickyNote },
  { key: 'cli', icon: faTerminal, wide: true },
] as const;

const STEPS = ['s1', 's2', 's3'] as const;

const WelcomePage: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    markWelcomeSeen();
  }, []);

  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="welcome-page">
      {/* ---------- Навигация ---------- */}
      <nav className="wl-nav">
        <Link to="/" className="wl-brand">
          <img src="/logo.png" alt="" className="wl-brand-logo" />
          <span>Codo Hub</span>
        </Link>
        <div className="wl-nav-links">
          <Link to="/codes" className="wl-nav-link">
            <FontAwesomeIcon icon={faLayerGroup} />
            <span>{t('header.codes')}</span>
          </Link>
          <Link to="/" className="wl-nav-link" aria-label={t('welcome.viewSite')} title={t('welcome.viewSite')}>
            <FontAwesomeIcon icon={faEye} />
            <span>{t('welcome.viewSite')}</span>
          </Link>
          <Link to="/login" className="home-btn home-btn--ghost wl-nav-btn">
            {t('common.login')}
          </Link>
          <Link to="/register" className="home-btn home-btn--primary wl-nav-btn">
            {t('common.register')}
          </Link>
        </div>
      </nav>

      {/* ---------- Hero: бүкіл экран ---------- */}
      <section className="wl-hero">
        <div className="wl-hero-bg" aria-hidden="true" />
        <div className="wl-hero-inner">
          <div className="wl-hero-text">
            <span className="wl-badge">
              <span className="wl-badge-dot" />
              {t('welcome.badge')}
            </span>
            <h1 className="wl-title">
              <span>{t('welcome.titleA')}</span>
              <span>{t('welcome.titleB')}</span>
              <span className="wl-title-muted">{t('welcome.titleC')}</span>
            </h1>
            <p className="wl-subtitle">{t('welcome.subtitle')}</p>
            <div className="wl-actions">
              <Link to="/register" className="home-btn home-btn--primary wl-btn">
                {t('welcome.start')}
                <FontAwesomeIcon icon={faArrowRight} />
              </Link>
              <Link to="/" className="home-btn home-btn--ghost wl-btn">
                <FontAwesomeIcon icon={faEye} />
                {t('welcome.viewSite')}
              </Link>
            </div>
          </div>

          {/* Редактор терезесі мен Codo хабарламасы — декоративті */}
          <div className="wl-visual" aria-hidden="true">
            <div className="wl-window">
              <div className="wl-window-bar">
                <span className="wl-dot" />
                <span className="wl-dot" />
                <span className="wl-dot" />
                <span className="wl-window-name">main.py</span>
              </div>
              <pre className="wl-code">
                <code>
                  <span className="wl-ln">1</span><span className="wl-c-comment">{t('welcome.codeComment')}</span>
                  {'\n'}
                  <span className="wl-ln">2</span><span className="wl-c-key">def</span> <span className="wl-c-fn">salem</span>(aty):
                  {'\n'}
                  <span className="wl-ln">3</span>{'    '}<span className="wl-c-key">return</span> <span className="wl-c-str">f"Сәлем, {'{'}aty{'}'}!"</span>
                  {'\n'}
                  <span className="wl-ln">4</span>
                  {'\n'}
                  <span className="wl-ln">5</span><span className="wl-c-fn">print</span>(<span className="wl-c-fn">salem</span>(<span className="wl-c-str">"Codo Hub"</span>))
                </code>
              </pre>
              <div className="wl-terminal">
                <span className="wl-c-comment">$</span> python main.py
                {'\n'}Сәлем, Codo Hub!<span className="wl-cursor" />
              </div>
            </div>
            <div className="wl-ai-bubble">
              <span className="wl-ai-icon">
                <FontAwesomeIcon icon={faWandMagicSparkles} />
              </span>
              <div>
                <strong>{t('welcome.f_ai_title')}</strong>
                <p>{t('welcome.aiBubble')}</p>
              </div>
            </div>
          </div>
        </div>

        <a href="#wl-features" className="wl-scroll" aria-label={t('welcome.featuresTitle')}>
          <FontAwesomeIcon icon={faArrowDown} />
        </a>
      </section>

      {/* ---------- Мүмкіндіктер ---------- */}
      <section id="wl-features" className="wl-section wl-section--band">
        <div className="wl-section-head">
          <h2 className="wl-h2">{t('welcome.featuresTitle')}</h2>
          <p className="wl-section-sub">{t('welcome.featuresSubtitle')}</p>
        </div>
        <div className="wl-bento">
          {FEATURES.map((f) => (
            <article key={f.key} className={`wl-card${'wide' in f && f.wide ? ' wl-card--wide' : ''}`}>
              <span className="wl-icon">
                <FontAwesomeIcon icon={f.icon} />
              </span>
              <h3 className="wl-card-title">{t(`welcome.f_${f.key}_title`)}</h3>
              <p className="wl-card-desc">{t(`welcome.f_${f.key}_desc`)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- Қадамдар ---------- */}
      <section className="wl-section">
        <div className="wl-section-head">
          <h2 className="wl-h2">{t('welcome.stepsTitle')}</h2>
        </div>
        <ol className="wl-steps">
          {STEPS.map((key, i) => (
            <li key={key} className="wl-step">
              <span className="wl-step-num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="wl-card-title">{t(`welcome.${key}_title`)}</h3>
              <p className="wl-card-desc">{t(`welcome.${key}_desc`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Соңғы шақыру ---------- */}
      <section className="wl-cta">
        <div className="wl-hero-bg" aria-hidden="true" />
        <h2 className="wl-cta-title">{t('welcome.ctaTitle')}</h2>
        <p className="wl-section-sub">{t('welcome.ctaSubtitle')}</p>
        <div className="wl-actions wl-actions--center">
          <Link to="/register" className="home-btn home-btn--primary wl-btn">
            {t('welcome.start')}
            <FontAwesomeIcon icon={faArrowRight} />
          </Link>
          <Link to="/login" className="home-btn home-btn--ghost wl-btn">
            {t('welcome.login')}
          </Link>
          <Link to="/" className="home-btn home-btn--ghost wl-btn">
            <FontAwesomeIcon icon={faEye} />
            {t('welcome.viewSite')}
          </Link>
        </div>
      </section>

      <footer className="wl-footer">
        <span>© {new Date().getFullYear()} Codo Hub</span>
        <nav>
          <Link to="/terms">{t('footer.terms')}</Link>
          <Link to="/privacy">{t('footer.privacy')}</Link>
          <Link to="/contact">{t('footer.contact')}</Link>
        </nav>
      </footer>
    </div>
  );
};

export default WelcomePage;
