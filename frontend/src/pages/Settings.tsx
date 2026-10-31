import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm, LOGOUT_ICON } from '../contexts/ToastContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faFolder, faInfoCircle, faFolderOpen, faBook, faList, faLock, faEnvelope,
  faSliders, faUserShield, faTriangleExclamation, faRightFromBracket, faChevronRight, faGlobe,
  faCircleHalfStroke, faBell, faShieldHalved, faArrowUpRightFromSquare, faTerminal, faComments,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { useAuth } from '../contexts/AuthContext';
import SettingsEmailChange from '../components/settings/SettingsEmailChange';
import { useTheme } from '../contexts/ThemeContext';
import { apiService, SiteConfig } from '../utils/api';
import { monogram } from '../components/home/monogram';
import SettingsInfoGuide from '../components/settings/SettingsInfoGuide';
import SettingsInfoDoc from '../components/settings/SettingsInfoDoc';
import SettingsCliTokens from '../components/settings/SettingsCliTokens';
import SettingsChat from '../components/settings/SettingsChat';
import SettingsGithub from '../components/settings/SettingsGithub';
import SettingsProjects from '../components/settings/SettingsProjects';
import { isInfoDoc } from '../components/settings/infoDocs';
import './Settings.css';

// Әр қойындының өз адресі бар: /settings/<tab>; жай /settings — «Жалпы»
const SETTINGS_TABS = ['general', 'account', 'chat', 'folders', 'terminal', 'info'] as const;
type SettingsTab = typeof SETTINGS_TABS[number];

// «Аккаунт» қойындысының бір карточкадағы бөлімдері (бөлек адресі жоқ)
type AccountSection = 'email' | '2fa' | 'github' | 'delete';

const isSettingsTab = (value: string | undefined): value is SettingsTab =>
  SETTINGS_TABS.includes(value as SettingsTab);

const Settings: React.FC = () => {
  const { i18n, t } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const { preference, setThemePreference } = useTheme();

  const { tab: tabParam, doc: docParam } = useParams<{ tab?: string; doc?: string }>();
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : 'general';
  const [openSection, setOpenSection] = useState<AccountSection | null>(null);
  const [language, setLanguage] = useState(i18n.language || 'kk');
  const [notifications, setNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);


  // 2FA
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [twoFASecret, setTwoFASecret] = useState('');
  const [twoFAUri, setTwoFAUri] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFARecoveryCodes, setTwoFARecoveryCodes] = useState<string[]>([]);
  const [twoFAError, setTwoFAError] = useState('');
  const [twoFADisableCode, setTwoFADisableCode] = useState('');
  const [show2FADisable, setShow2FADisable] = useState(false);

  // Delete account
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Site config (footer мазмұнын көрсету үшін)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    apiService.getConfig().then(setSiteConfig).catch((err) => {
      console.error('Failed to load config:', err);
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    const savedLanguage = localStorage.getItem('i18nextLng') || i18n.language || 'kk';
    setLanguage(savedLanguage);
  }, [i18n.language]);

  useEffect(() => {
    if (user?.totp_enabled !== undefined) {
      setTotpEnabled(user.totp_enabled);
    }
  }, [user]);

  // Мобильде навигация көлденең жолақ — белсенді қойынды (мысалы, соңғы «Қауіпті аймақ») экраннан тыс қалмасын
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.stg-row.is-active');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({
      left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2,
      behavior: 'smooth',
    });
  }, [activeTab]);

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem('i18nextLng', value);
    setLanguage(value);
  };

  const handle2FASetup = async () => {
    try {
      const res = await apiService.setup2FA();
      setTwoFASecret(res.secret);
      setTwoFAUri(res.uri);
      setShow2FASetup(true);
      setTwoFACode('');
      setTwoFAError('');
    } catch (err: any) {
      setTwoFAError(err?.message || 'Error');
    }
  };

  const handle2FAVerifySetup = async () => {
    try {
      const res = await apiService.verify2FASetup(twoFACode);
      setTotpEnabled(true);
      setTwoFARecoveryCodes(res.recovery_codes);
      setShow2FASetup(false);
      setTwoFACode('');
      if (user) {
        const updatedUser = { ...user, totp_enabled: true };
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
    } catch (err: any) {
      setTwoFAError(err?.message || t('auth.2fa.wrongCode'));
    }
  };

  const handle2FADisable = async () => {
    try {
      await apiService.disable2FA(twoFADisableCode);
      setTotpEnabled(false);
      setShow2FADisable(false);
      setTwoFADisableCode('');
      if (user) {
        const updatedUser = { ...user, totp_enabled: false };
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
    } catch (err: any) {
      setTwoFAError(err?.message || 'Error');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmStep < 2) {
      setDeleteConfirmStep(prev => prev + 1);
      return;
    }
    setDeleteLoading(true);
    try {
      await apiService.deleteAccount();
      await logout();
      navigate('/login');
    } catch (err: any) {
      alert(t('settings.deleteAccountError'));
    } finally {
      setDeleteLoading(false);
      setDeleteConfirmStep(0);
    }
  };

  if (!isAuthenticated) return null;
  // Бұрынғы «Қауіпті аймақ» қойындысы «Аккаунт» ішіне көшті
  if (tabParam === 'danger') return <Navigate to="/settings/account" replace />;
  // Белгісіз қойынды адресі — негізгі баптауларға
  if (tabParam !== undefined && !isSettingsTab(tabParam)) return <Navigate to="/settings" replace />;
  // Ішкі бет тек «Біз жайлы» қойындысында бар: /settings/info/<about|terms|privacy|contact>
  if (docParam !== undefined && (tabParam !== 'info' || !isInfoDoc(docParam))) {
    return <Navigate to={tabParam === 'info' ? '/settings/info' : `/settings/${tabParam}`} replace />;
  }
  const infoDoc = isInfoDoc(docParam) ? docParam : null;

  const tabs: { key: SettingsTab; label: string; desc: string; icon: IconDefinition }[] = [
    { key: 'general', label: t('settings.general'), desc: t('settings.generalDesc'), icon: faSliders },
    { key: 'account', label: t('settings.account'), desc: t('settings.accountDesc'), icon: faUserShield },
    { key: 'chat', label: t('settings.chatTab'), desc: t('settings.chatDesc'), icon: faComments },
    { key: 'folders', label: t('settings.folderTab'), desc: t('settings.folderDesc'), icon: faFolder },
    { key: 'terminal', label: t('settings.cli.tab'), desc: t('settings.cli.desc'), icon: faTerminal },
    { key: 'info', label: t('settings.infoTab'), desc: t('settings.infoDesc'), icon: faInfoCircle },
  ];
  const accountSections: { key: AccountSection; label: string; icon: IconDefinition }[] = [
    { key: 'email', label: t('emailChange.title'), icon: faEnvelope },
    { key: '2fa', label: t('settings.twoFactorAuth'), icon: faShieldHalved },
    { key: 'github', label: 'GitHub', icon: faGithub },
    { key: 'delete', label: t('settings.deleteAccountButton'), icon: faTriangleExclamation },
  ];
  const currentTab = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  const appName = siteConfig?.appName ?? t('header.appName');
  const externalLinks = siteConfig?.externalLinks ?? [];
  const currentYear = new Date().getFullYear();

  const languageOptions = [
    { value: 'kk', label: t('settings.languageKazakh') },
    { value: 'ru', label: t('settings.languageRussian') },
    { value: 'en', label: t('settings.languageEnglish') },
  ];
  const themeOptions: { value: 'auto' | 'light' | 'dark'; label: string }[] = [
    { value: 'auto', label: t('settings.themeAuto') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];

  const handleLogout = async () => {
    if (await confirm({
      title: t('settings.logoutConfirm'),
      message: t('settings.logoutConfirmMessage'),
      confirmText: t('settings.logout'),
      danger: true,
      icon: LOGOUT_ICON,
    })) {
      await logout();
      navigate('/login');
    }
  };

  // Басты беттің дизайн тілінде: қара фон, сол жақта навигация панелі, оң жақта мазмұн панелі
  return (
    <div className="settings-page">
      <div className="stg-layout">
        <aside className="stg-side" aria-label={t('common.settings')}>
          <div className="stg-side__head">
            <span className="stg-side__avatar" aria-hidden="true">
              {user?.avatar ? <img src={user.avatar} alt="" /> : monogram(user?.username || '?')}
            </span>
            <div className="stg-side__who">
              <span className="stg-side__name">{user?.username}</span>
              {user?.email && <span className="stg-side__email">{user.email}</span>}
            </div>
          </div>

          <div className="stg-side__divider" role="separator" />

          <nav ref={navRef} className="stg-nav" role="tablist" aria-orientation="vertical">
            {tabs.map((tab, i) => (
              <Link
                key={tab.key}
                to={`/settings/${tab.key}`}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-current={activeTab === tab.key ? 'page' : undefined}
                className={`stg-row ${activeTab === tab.key ? 'is-active' : ''}`}
                style={{ '--d': i } as React.CSSProperties}
              >
                <span className="stg-row__slot">
                  <FontAwesomeIcon icon={tab.icon} />
                </span>
                <span className="stg-row__label">{tab.label}</span>
              </Link>
            ))}
          </nav>

          <button type="button" className="stg-row stg-row--ghost stg-side__logout" onClick={handleLogout}>
            <span className="stg-row__slot">
              <FontAwesomeIcon icon={faRightFromBracket} />
            </span>
            <span className="stg-row__label">{t('settings.logout')}</span>
          </button>
        </aside>

        <main className="stg-main">
          <header className="stg-main__head">
            <span className="stg-main__badge" aria-hidden="true">
              <FontAwesomeIcon icon={currentTab.icon} />
            </span>
            <div>
              <h1 className="stg-main__title">{currentTab.label}</h1>
              <p className="stg-main__desc">{currentTab.desc}</p>
            </div>
          </header>

          {/* key — қойынды ауысқанда кіру анимациясы қайта ойнайды */}
          <div className="stg-main__body" key={`${activeTab}/${infoDoc ?? ''}`} role="tabpanel">
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="stg-grid">
                <section className="stg-card">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faGlobe} /> {t('settings.language')}
                  </h2>
                  <div className="stg-segment" role="radiogroup" aria-label={t('settings.language')}>
                    {languageOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={language === opt.value}
                        className={`stg-segment__btn ${language === opt.value ? 'is-active' : ''}`}
                        onClick={() => handleLanguageChange(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="stg-card">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faCircleHalfStroke} /> {t('settings.theme')}
                  </h2>
                  <div className="stg-segment" role="radiogroup" aria-label={t('settings.theme')}>
                    {themeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={preference === opt.value}
                        className={`stg-segment__btn ${preference === opt.value ? 'is-active' : ''}`}
                        onClick={() => setThemePreference(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="stg-card stg-card--wide">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faBell} /> {t('settings.notifications')}
                  </h2>
                  <label className="stg-switch-row">
                    <span>{t('settings.enableNotifications')}</span>
                    <input
                      type="checkbox"
                      className="stg-switch"
                      checked={notifications}
                      onChange={(e) => setNotifications(e.target.checked)}
                    />
                  </label>
                  <label className="stg-switch-row">
                    <span>{t('settings.emailNotifications')}</span>
                    <input
                      type="checkbox"
                      className="stg-switch"
                      checked={emailNotifications}
                      onChange={(e) => setEmailNotifications(e.target.checked)}
                    />
                  </label>
                </section>
              </div>
            )}

            {/* Account Tab — барлық бөлім бір карточкада, әрқайсысы өз орнында ашылады */}
            {activeTab === 'account' && (
              <section className="stg-card stg-acc">
                {accountSections.map((section) => {
                  const isOpen = openSection === section.key;
                  return (
                    <div key={section.key} className={`stg-acc__item ${isOpen ? 'is-open' : ''}`}>
                      <button
                        type="button"
                        className={`stg-row stg-acc__head ${section.key === 'delete' ? 'stg-row--danger' : ''}`}
                        aria-expanded={isOpen}
                        onClick={() => setOpenSection(isOpen ? null : section.key)}
                      >
                        <span className="stg-row__slot">
                          <FontAwesomeIcon icon={section.icon} />
                        </span>
                        <span className="stg-row__label">{section.label}</span>
                        {section.key === '2fa' && (
                          <span className={`stg-pill ${totpEnabled ? 'is-on' : ''}`}>{totpEnabled ? 'ON' : 'OFF'}</span>
                        )}
                        <span className="stg-row__arrow"><FontAwesomeIcon icon={faChevronRight} /></span>
                      </button>

                      {isOpen && section.key === 'email' && <SettingsEmailChange />}

                      {isOpen && section.key === '2fa' && (
                        <div className="stg-acc__body">
                          {twoFARecoveryCodes.length > 0 && (
                            <div className="stg-recovery">
                              <p className="stg-msg stg-msg--success">{t('auth.2fa.recoveryCodes')}:</p>
                              <div className="stg-recovery__grid">
                                {twoFARecoveryCodes.map((code, i) => (
                                  <span key={i} className="stg-recovery__code">{code}</span>
                                ))}
                              </div>
                              <p className="stg-msg stg-msg--warning">{t('auth.2fa.recoveryCodesWarning')}</p>
                            </div>
                          )}
                          {totpEnabled ? (
                            <>
                              <p className="stg-msg stg-msg--success">{t('auth.2fa.enabled')}</p>
                              {show2FADisable ? (
                                <div className="stg-inline">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    className="stg-input"
                                    placeholder={t('auth.2fa.disableCodePlaceholder')}
                                    value={twoFADisableCode}
                                    onChange={(e) => setTwoFADisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                  />
                                  <button type="button" className="stg-btn stg-btn--primary" onClick={handle2FADisable} disabled={twoFADisableCode.length !== 6}>
                                    {t('auth.2fa.disableTitle')}
                                  </button>
                                </div>
                              ) : (
                                <div className="stg-actions">
                                  <button type="button" className="stg-btn stg-btn--ghost" onClick={() => setShow2FADisable(true)}>
                                    {t('settings.disable2FA')}
                                  </button>
                                </div>
                              )}
                              {twoFAError && <p className="stg-msg stg-msg--error">{twoFAError}</p>}
                            </>
                          ) : show2FASetup ? (
                            <div className="stg-twofa">
                              <p className="stg-text">{t('auth.2fa.scanQR')}</p>
                              {twoFAUri && (
                                <a href={twoFAUri} target="_blank" rel="noopener noreferrer" className="stg-link">
                                  {t('auth.2fa.scanQR')} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                </a>
                              )}
                              <code className="stg-secret">{twoFASecret}</code>
                              <div className="stg-inline">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="stg-input stg-input--code"
                                  placeholder="000000"
                                  maxLength={6}
                                  value={twoFACode}
                                  onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                />
                                <button
                                  type="button"
                                  className="stg-btn stg-btn--primary"
                                  onClick={handle2FAVerifySetup}
                                  disabled={twoFACode.length !== 6}
                                >
                                  {t('auth.2fa.enterCode')}
                                </button>
                              </div>
                              {twoFAError && <p className="stg-msg stg-msg--error">{twoFAError}</p>}
                            </div>
                          ) : (
                            <>
                              <div className="stg-actions">
                                <button type="button" className="stg-btn stg-btn--primary" onClick={handle2FASetup}>
                                  {t('settings.enable2FA')}
                                </button>
                              </div>
                              {twoFAError && <p className="stg-msg stg-msg--error">{twoFAError}</p>}
                            </>
                          )}
                        </div>
                      )}

                      {isOpen && section.key === 'github' && (
                        <div className="stg-acc__body">
                          <SettingsGithub />
                        </div>
                      )}

                      {isOpen && section.key === 'delete' && (
                        <div className="stg-acc__body">
                          <p className="stg-text">{t('settings.dangerZoneDescription')}</p>
                          <ul className="stg-warnings">
                            {[1, 2, 3, 4].map((n) => (
                              <li key={n}>
                                <span className="stg-warnings__x" aria-hidden="true">&times;</span>
                                {t(`settings.deleteAccountWarning${n}`)}
                              </li>
                            ))}
                          </ul>
                          <div className="stg-actions">
                            <button
                              type="button"
                              className={`stg-btn stg-btn--danger ${deleteConfirmStep > 0 ? 'is-armed' : ''}`}
                              onClick={handleDeleteAccount}
                              disabled={deleteLoading}
                            >
                              {deleteLoading
                                ? t('settings.deletingAccount')
                                : deleteConfirmStep === 0
                                  ? t('settings.deleteAccountButton')
                                  : deleteConfirmStep === 1
                                    ? t('settings.deleteAccountConfirm')
                                    : t('settings.deleteAccountDoubleConfirm')}
                            </button>
                            {deleteConfirmStep > 0 && !deleteLoading && (
                              <button type="button" className="stg-btn stg-btn--ghost" onClick={() => setDeleteConfirmStep(0)}>
                                {t('common.cancel')}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Жобалар — ашу/жабу, әдепкі жабық баптауы */}
            {activeTab === 'folders' && <SettingsProjects />}

            {/* Chat Tab — маған кім жаза алады (профильдегі «Чат» табымен бір компонент) */}
            {activeTab === 'chat' && <SettingsChat />}

            {/* Terminal Tab — codo CLI арқылы жоба жүктеу */}
            {activeTab === 'terminal' && <SettingsCliTokens />}

            {/* Info Tab (футердің орнына баптау бетіне көшірілді) */}
            {activeTab === 'info' && infoDoc && <SettingsInfoDoc doc={infoDoc} />}

            {activeTab === 'info' && !infoDoc && (
              <div className="stg-grid stg-grid--even stg-grid--info">
                {/* Мүмкіндіктер мен пернетақта тіркесімдері */}
                <SettingsInfoGuide />

                <section className="stg-card stg-card--compact">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faFolderOpen} /> {t('footer.links')}
                  </h2>
                  {externalLinks.length === 0 ? (
                    <p className="stg-text">{t('common.loading')}</p>
                  ) : (
                    <ul className="stg-links stg-links--dense">
                      {externalLinks.map((link) => (
                        <li key={link.url}>
                          <a href={link.url} target="_blank" rel="noopener noreferrer" className="stg-row stg-row--link">
                            <span className="stg-row__slot">
                              {link.iconUrl ? (
                                <img src={link.iconUrl} alt="" className="stg-links__img" />
                              ) : (
                                <FontAwesomeIcon icon={faFolderOpen} />
                              )}
                            </span>
                            <span className="stg-row__label">{link.name}</span>
                            <span className="stg-row__arrow"><FontAwesomeIcon icon={faArrowUpRightFromSquare} /></span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="stg-card stg-card--compact">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faInfoCircle} /> {t('footer.info')}
                  </h2>
                  <ul className="stg-links stg-links--dense">
                    {[
                      { to: '/settings/info/about', icon: faBook, label: t('footer.about') },
                      { to: '/settings/info/terms', icon: faList, label: t('footer.terms') },
                      { to: '/settings/info/privacy', icon: faLock, label: t('footer.privacy') },
                      { to: '/settings/info/contact', icon: faEnvelope, label: t('footer.contact') },
                    ].map((item) => (
                      <li key={item.to}>
                        <Link to={item.to} className="stg-row stg-row--link">
                          <span className="stg-row__slot"><FontAwesomeIcon icon={item.icon} /></span>
                          <span className="stg-row__label">{item.label}</span>
                          <span className="stg-row__arrow"><FontAwesomeIcon icon={faChevronRight} /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>

                <p className="stg-copy">&copy; {currentYear} {appName}. {t('footer.copyright')}</p>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
};

export default Settings;
