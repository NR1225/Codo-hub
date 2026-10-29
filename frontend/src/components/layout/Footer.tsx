import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle, faFolderOpen, faBook, faList, faLock, faRocket, faLaptop, faEnvelope } from '@fortawesome/free-solid-svg-icons';
import { apiService, SiteConfig } from '../../utils/api';
import './Footer.css';

const Footer: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [config, setConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    apiService.getConfig().then(setConfig).catch((err) => {
      console.error('Failed to load config:', err);
    });
  }, []);

  const appName = config?.appName ?? t('header.appName');
  const externalLinks = config?.externalLinks ?? [];

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-content">
          <div className="footer-section">
            <div className="footer-logo-section">
              <h3 className="footer-title">{appName}</h3>
              <p className="footer-description">
                {t('footer.description')}
              </p>
            </div>
            <div className="footer-features">
              <button 
                className="footer-features-title"
                onClick={() => navigate('/features')}
              >
                {t('footer.features')}
              </button>
            </div>
          </div>

          <div className="footer-section">
            <h4 className="footer-heading">
              <span className="heading-icon"><FontAwesomeIcon icon={faFolderOpen} /></span>
              {t('footer.links')}
            </h4>
            <ul className="footer-links">
              {externalLinks.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    <span className="link-icon link-icon-svg">
                      {link.iconUrl ? (
                        <img src={link.iconUrl} alt={link.name} style={{ width: '18px', height: '18px', objectFit: 'contain' }} />
                      ) : (
                        <FontAwesomeIcon icon={faFolderOpen} />
                      )}
                    </span>
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="footer-section">
            <h4 className="footer-heading">
              <span className="heading-icon"><FontAwesomeIcon icon={faInfoCircle} /></span>
              {t('footer.info')}
            </h4>
            <ul className="footer-links">
              <li>
                <Link to="/settings/info/about">
                  <span className="link-icon"><FontAwesomeIcon icon={faBook} /></span>
                  {t('footer.about')}
                </Link>
              </li>
              <li>
                <Link to="/settings/info/terms">
                  <span className="link-icon"><FontAwesomeIcon icon={faList} /></span>
                  {t('footer.terms')}
                </Link>
              </li>
              <li>
                <Link to="/settings/info/privacy">
                  <span className="link-icon"><FontAwesomeIcon icon={faLock} /></span>
                  {t('footer.privacy')}
                </Link>
              </li>
              <li>
                <Link to="/settings/info/contact">
                  <span className="link-icon"><FontAwesomeIcon icon={faEnvelope} /></span>
                  {t('footer.contact')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-bottom-content">
            <p>&copy; {currentYear} {appName}. {t('footer.copyright')}</p>
            <div className="footer-badges">
              <span className="badge"><FontAwesomeIcon icon={faRocket} /> {t('footer.kazakhstan')}</span>
              <span className="badge"><FontAwesomeIcon icon={faLaptop} /> {t('footer.openSource')}</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

