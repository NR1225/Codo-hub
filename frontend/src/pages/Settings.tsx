import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm, LOGOUT_ICON } from '../contexts/ToastContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faFolder, faTrash, faEye, faInfoCircle, faFolderOpen, faBook, faList, faLock, faRocket, faLaptop, faEnvelope,
  faSliders, faUserShield, faTriangleExclamation, faRightFromBracket, faChevronRight, faGlobe,
  faCircleHalfStroke, faBell, faKey, faShieldHalved, faDesktop, faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiService, CodeFile, SiteConfig } from '../utils/api';
import { formatDate } from '../utils/dateFormatter';
import { monogram } from '../components/home/monogram';
import './Settings.css';

// Әр қойындының өз адресі бар: /settings/<tab>; жай /settings — «Жалпы»
const SETTINGS_TABS = ['general', 'account', 'folders', 'info', 'danger'] as const;
type SettingsTab = typeof SETTINGS_TABS[number];

const isSettingsTab = (value: string | undefined): value is SettingsTab =>
  SETTINGS_TABS.includes(value as SettingsTab);

const Settings: React.FC = () => {
  const { i18n, t } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const { preference, setThemePreference } = useTheme();

  const { tab: tabParam } = useParams<{ tab?: string }>();
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : 'general';
  const [language, setLanguage] = useState(i18n.language || 'kk');
  const [notifications, setNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // 2FA
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [twoFASecret, setTwoFASecret] = useState('');
  const [twoFAUri, setTwoFAUri] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFARecoveryCodes, setTwoFARecoveryCodes] = useState<string[]>([]);
  const [twoFAError, setTwoFAError] = useState('');
  const [twoFADisablePassword, setTwoFADisablePassword] = useState('');
  const [show2FADisable, setShow2FADisable] = useState(false);

  // Delete account
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Folders
  const [folders, setFolders] = useState<CodeFile[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderError, setFolderError] = useState('');

  // Site config (footer мазмұнын көрсету үшін)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    apiService.getConfig().then(setSiteConfig).catch((err) => {
      console.error('Failed to load config:', err);
    });
  }, []);

  const loadFolders = useCallback(async () => {
    if (!user?.username) return;
    setFoldersLoading(true);
    setFolderError('');
    try {
      const codesResponse = await apiService.getCodeFiles(undefined, 1000, 0, false);
      const userFolders = codesResponse.codes.filter(
        (code) => code.author === user.username && code.language === 'folder'
      );
      setFolders(userFolders);
    } catch (err: any) {
      setFolderError(err?.message || t('common.error'));
    } finally {
      setFoldersLoading(false);
    }
  }, [user?.username, t]);

  const handleDeleteFolder = async (folderId: string, folderTitle: string) => {
    if (!window.confirm(t('viewCode.folderDeleteConfirm') + ` "${folderTitle}"?`)) return;
    try {
      await apiService.deleteCodeFile(folderId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
    } catch (err: any) {
      setFolderError(err?.message || t('viewCode.errorDeleteCode'));
    }
  };

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

  useEffect(() => {
    if (activeTab === 'folders' && user?.username) {
      loadFolders();
    }
  }, [activeTab, user?.username, loadFolders]);

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

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (!currentPassword) {
      setPasswordError(t('settings.currentPassword') + ' is required');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t('register.passwordMinLength'));
      return;
    }
    if (!/[A-ZА-ЯЁҰҒҚҢҺҮІ]/.test(newPassword)) {
      setPasswordError(t('register.passwordUppercase'));
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setPasswordError(t('register.passwordDigit'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(t('register.passwordMismatch'));
      return;
    }
    setPasswordLoading(true);
    try {
      await apiService.changePassword(currentPassword, newPassword);
      setPasswordSuccess(t('common.success'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setPasswordError(err?.message || 'Error');
    } finally {
      setPasswordLoading(false);
    }
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
      await apiService.disable2FA(twoFADisablePassword);
      setTotpEnabled(false);
      setShow2FADisable(false);
      setTwoFADisablePassword('');
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
  // Белгісіз қойынды адресі — негізгі баптауларға
  if (tabParam !== undefined && !isSettingsTab(tabParam)) return <Navigate to="/settings" replace />;

  const tabs: { key: SettingsTab; label: string; desc: string; icon: IconDefinition }[] = [
    { key: 'general', label: t('settings.general'), desc: t('settings.generalDesc'), icon: faSliders },
    { key: 'account', label: t('settings.account'), desc: t('settings.accountDesc'), icon: faUserShield },
    { key: 'folders', label: t('settings.folderTab'), desc: t('settings.folderDesc'), icon: faFolder },
    { key: 'info', label: t('settings.infoTab'), desc: t('settings.infoDesc'), icon: faInfoCircle },
    { key: 'danger', label: t('settings.dangerZone'), desc: t('settings.dangerDesc'), icon: faTriangleExclamation },
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
                className={`stg-row ${activeTab === tab.key ? 'is-active' : ''} ${tab.key === 'danger' ? 'stg-row--danger' : ''}`}
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
            <span className={`stg-main__badge ${activeTab === 'danger' ? 'is-danger' : ''}`} aria-hidden="true">
              <FontAwesomeIcon icon={currentTab.icon} />
            </span>
            <div>
              <h1 className="stg-main__title">{currentTab.label}</h1>
              <p className="stg-main__desc">{currentTab.desc}</p>
            </div>
          </header>

          {/* key — қойынды ауысқанда кіру анимациясы қайта ойнайды */}
          <div className="stg-main__body" key={activeTab} role="tabpanel">
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

            {/* Account Tab */}
            {activeTab === 'account' && (
              <div className="stg-grid stg-grid--even">
                <section className="stg-card">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faKey} /> {t('settings.changePassword')}
                  </h2>
                  <label className="stg-field">
                    <span className="stg-field__label">{t('settings.currentPassword')}</span>
                    <input
                      type="password"
                      className="stg-input"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <label className="stg-field">
                    <span className="stg-field__label">{t('settings.newPassword')}</span>
                    <input
                      type="password"
                      className="stg-input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="stg-field">
                    <span className="stg-field__label">{t('settings.confirmNewPassword')}</span>
                    <input
                      type="password"
                      className="stg-input"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </label>
                  {passwordError && <p className="stg-msg stg-msg--error">{passwordError}</p>}
                  {passwordSuccess && <p className="stg-msg stg-msg--success">{passwordSuccess}</p>}
                  <div className="stg-actions">
                    <button type="button" className="stg-btn stg-btn--primary" onClick={handleChangePassword} disabled={passwordLoading}>
                      {passwordLoading ? '...' : t('common.save')}
                    </button>
                  </div>
                </section>

                <div className="stg-stack">
                  <section className="stg-card">
                    <h2 className="stg-card__title">
                      <FontAwesomeIcon icon={faShieldHalved} /> {t('settings.twoFactorAuth')}
                      <span className={`stg-pill ${totpEnabled ? 'is-on' : ''}`}>{totpEnabled ? 'ON' : 'OFF'}</span>
                    </h2>
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
                              type="password"
                              className="stg-input"
                              placeholder={t('settings.currentPassword')}
                              value={twoFADisablePassword}
                              onChange={(e) => setTwoFADisablePassword(e.target.value)}
                            />
                            <button type="button" className="stg-btn stg-btn--primary" onClick={handle2FADisable}>
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
                  </section>

                  <section className="stg-card">
                    <h2 className="stg-card__title">
                      <FontAwesomeIcon icon={faDesktop} /> {t('settings.activeSession')}
                    </h2>
                    <p className="stg-text">{t('settings.singleSessionNote')}</p>
                  </section>
                </div>
              </div>
            )}

            {/* Folder Tab */}
            {activeTab === 'folders' && (
              foldersLoading ? (
                <div className="stg-folders">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="stg-folder stg-folder--skeleton" />
                  ))}
                </div>
              ) : folderError ? (
                <p className="stg-msg stg-msg--error">{folderError}</p>
              ) : folders.length === 0 ? (
                <div className="stg-empty">
                  <span className="stg-empty__icon">
                    <FontAwesomeIcon icon={faFolder} />
                  </span>
                  <p className="stg-empty__title">{t('settings.noFolders')}</p>
                  <p className="stg-text">{t('settings.noFoldersDescription')}</p>
                </div>
              ) : (
                <div className="stg-folders">
                  {folders.map((folder, i) => (
                    <article key={folder.id} className="stg-folder" style={{ '--d': Math.min(i, 12) } as React.CSSProperties}>
                      <div className="stg-folder__head">
                        <span className="stg-folder__icon">
                          <FontAwesomeIcon icon={faFolder} />
                        </span>
                        <span className="stg-folder__title">{folder.title}</span>
                      </div>
                      {folder.description && <p className="stg-folder__desc">{folder.description}</p>}
                      <div className="stg-folder__foot">
                        <span className="stg-folder__meta">
                          {formatDate(folder.createdAt, i18n.language)}
                          {folder.folderStructure && (
                            <> · {Object.keys(folder.folderStructure).length} {t('settings.files')}</>
                          )}
                        </span>
                        <div className="stg-folder__actions">
                          <button
                            type="button"
                            className="stg-icon-btn"
                            onClick={() => navigate(`/view/${folder.id}`)}
                            title={t('viewCode.title')}
                            aria-label={t('viewCode.title')}
                          >
                            <FontAwesomeIcon icon={faEye} />
                          </button>
                          <button
                            type="button"
                            className="stg-icon-btn stg-icon-btn--danger"
                            onClick={() => handleDeleteFolder(folder.id, folder.title)}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )
            )}

            {/* Info Tab (футердің орнына баптау бетіне көшірілді) */}
            {activeTab === 'info' && (
              <div className="stg-grid stg-grid--even">
                <section className="stg-card stg-card--wide stg-card--hero">
                  <div className="stg-hero__text">
                    <h2 className="stg-card__title stg-card__title--lg">{appName}</h2>
                    <p className="stg-text">{t('footer.description')}</p>
                    <div className="stg-badges">
                      <span className="stg-badge"><FontAwesomeIcon icon={faRocket} /> {t('footer.kazakhstan')}</span>
                      <span className="stg-badge"><FontAwesomeIcon icon={faLaptop} /> {t('footer.openSource')}</span>
                    </div>
                  </div>
                  <div className="stg-actions">
                    <button type="button" className="stg-btn stg-btn--ghost" onClick={() => navigate('/features')}>
                      {t('footer.features')}
                    </button>
                  </div>
                </section>

                <section className="stg-card">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faFolderOpen} /> {t('footer.links')}
                  </h2>
                  {externalLinks.length === 0 ? (
                    <p className="stg-text">{t('common.loading')}</p>
                  ) : (
                    <ul className="stg-links">
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

                <section className="stg-card">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faInfoCircle} /> {t('footer.info')}
                  </h2>
                  <ul className="stg-links">
                    {[
                      { to: '/about', icon: faBook, label: t('footer.about') },
                      { to: '/terms', icon: faList, label: t('footer.terms') },
                      { to: '/privacy', icon: faLock, label: t('footer.privacy') },
                      { to: '/contact', icon: faEnvelope, label: t('footer.contact') },
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

            {/* Danger Zone Tab */}
            {activeTab === 'danger' && (
              <div className="stg-grid stg-grid--even stg-grid--danger">
                <section className="stg-card stg-card--danger">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faTriangleExclamation} /> {t('settings.deleteAccountButton')}
                  </h2>
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
                </section>

                <section className="stg-card">
                  <h2 className="stg-card__title">
                    <FontAwesomeIcon icon={faRightFromBracket} /> {t('settings.logout')}
                  </h2>
                  <p className="stg-text">{t('settings.logoutDescription')}</p>
                  <div className="stg-actions">
                    <button type="button" className="stg-btn stg-btn--ghost" onClick={handleLogout}>
                      {t('settings.logout')}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Settings;
