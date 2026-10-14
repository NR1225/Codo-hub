import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faTrash, faEye, faInfoCircle, faFolderOpen, faBook, faList, faLock, faRocket, faLaptop, faEnvelope } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiService, CodeFile, SiteConfig } from '../utils/api';
import { formatDate } from '../utils/dateFormatter';
import Button from '../components/ui/Button';
import './Settings.css';

type SettingsTab = 'general' | 'account' | 'folder' | 'info' | 'danger';

const Settings: React.FC = () => {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const { preference, setThemePreference } = useTheme();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
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
    if (activeTab === 'folder' && user?.username) {
      loadFolders();
    }
  }, [activeTab, user?.username, loadFolders]);

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

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: t('settings.general') },
    { key: 'account', label: t('settings.account') },
    { key: 'folder', label: t('settings.folderTab') },
    { key: 'info', label: t('settings.infoTab') },
    { key: 'danger', label: t('settings.dangerZone') },
  ];

  const appName = siteConfig?.appName ?? t('header.appName');
  const externalLinks = siteConfig?.externalLinks ?? [];
  const currentYear = new Date().getFullYear();

  return (
    <div className="settings-container">
      <h1 className="settings-title">{t('common.settings')}</h1>

      <div className="settings-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`settings-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {/* General Tab */}
        {activeTab === 'general' && (
          <>
            <div className="settings-section">
              <h2 className="section-title">{t('settings.general')}</h2>
              <div className="setting-item">
                <label className="setting-label">{t('settings.language')}</label>
                <select
                  className="setting-input"
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                >
                  <option value="kk">{t('settings.languageKazakh')}</option>
                  <option value="ru">{t('settings.languageRussian')}</option>
                  <option value="en">{t('settings.languageEnglish')}</option>
                </select>
              </div>
              <div className="setting-item">
                <label className="setting-label">{t('settings.theme')}</label>
                <select
                  className="setting-input"
                  value={preference}
                  onChange={(e) => setThemePreference(e.target.value as 'auto' | 'light' | 'dark')}
                >
                  <option value="auto">{t('settings.themeAuto')}</option>
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="dark">{t('settings.themeDark')}</option>
                </select>
              </div>
            </div>

            <div className="settings-section">
              <h2 className="section-title">{t('settings.notifications')}</h2>
              <div className="setting-item">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={notifications}
                    onChange={(e) => setNotifications(e.target.checked)}
                  />
                  <span>{t('settings.enableNotifications')}</span>
                </label>
              </div>
              <div className="setting-item">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={emailNotifications}
                    onChange={(e) => setEmailNotifications(e.target.checked)}
                  />
                  <span>{t('settings.emailNotifications')}</span>
                </label>
              </div>
            </div>
          </>
        )}

        {/* Account Tab */}
        {activeTab === 'account' && (
          <>
            <div className="settings-section">
              <h2 className="section-title">{t('settings.changePassword')}</h2>
              <div className="setting-item">
                <label className="setting-label">{t('settings.currentPassword')}</label>
                <input
                  type="password"
                  className="setting-input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="setting-item">
                <label className="setting-label">{t('settings.newPassword')}</label>
                <input
                  type="password"
                  className="setting-input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                />
              </div>
              <div className="setting-item">
                <label className="setting-label">{t('settings.confirmNewPassword')}</label>
                <input
                  type="password"
                  className="setting-input"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  minLength={8}
                />
              </div>
              {passwordError && <p className="settings-error">{passwordError}</p>}
              {passwordSuccess && <p className="settings-success">{passwordSuccess}</p>}
              <div className="settings-actions">
                <Button variant="primary" onClick={handleChangePassword} disabled={passwordLoading}>
                  {passwordLoading ? '...' : t('common.save')}
                </Button>
              </div>
            </div>

            <div className="settings-section">
              <h2 className="section-title">{t('settings.twoFactorAuth')}</h2>
              {twoFARecoveryCodes.length > 0 && (
                <div className="twofa-recovery-codes">
                  <p className="settings-success">{t('auth.2fa.recoveryCodes')}:</p>
                  <div className="recovery-codes-grid">
                    {twoFARecoveryCodes.map((code, i) => (
                      <span key={i} className="recovery-code">{code}</span>
                    ))}
                  </div>
                  <p className="settings-warning">{t('auth.2fa.recoveryCodesWarning')}</p>
                </div>
              )}
              {totpEnabled ? (
                <div className="twofa-status">
                  <p className="settings-success">{t('auth.2fa.enabled')}</p>
                  {show2FADisable ? (
                    <div className="twofa-disable-form">
                      <input
                        type="password"
                        className="setting-input"
                        placeholder={t('settings.currentPassword')}
                        value={twoFADisablePassword}
                        onChange={(e) => setTwoFADisablePassword(e.target.value)}
                      />
                      <Button variant="primary" onClick={handle2FADisable}>
                        {t('auth.2fa.disableTitle')}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={() => setShow2FADisable(true)}>
                      {t('settings.disable2FA')}
                    </Button>
                  )}
                </div>
              ) : show2FASetup ? (
                <div className="twofa-setup">
                  <p>{t('auth.2fa.scanQR')}</p>
                  <div className="twofa-qr-container">
                    {twoFAUri && (
                      <a href={twoFAUri} target="_blank" rel="noopener noreferrer" className="twofa-qr-link">
                        {t('auth.2fa.scanQR')}
                      </a>
                    )}
                    <p className="twofa-secret">Secret: {twoFASecret}</p>
                  </div>
                  <div className="twofa-verify">
                    <input
                      type="text"
                      className="setting-input twofa-code-input"
                      placeholder="000000"
                      maxLength={6}
                      value={twoFACode}
                      onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                    <Button
                      variant="primary"
                      onClick={handle2FAVerifySetup}
                      disabled={twoFACode.length !== 6}
                    >
                      {t('auth.2fa.enterCode')}
                    </Button>
                  </div>
                  {twoFAError && <p className="settings-error">{twoFAError}</p>}
                </div>
              ) : (
                <Button variant="primary" onClick={handle2FASetup}>
                  {t('settings.enable2FA')}
                </Button>
              )}
            </div>

            <div className="settings-section">
              <h2 className="section-title">{t('settings.activeSession')}</h2>
              <p className="setting-info">{t('settings.singleSessionNote')}</p>
            </div>
          </>
        )}

        {/* Folder Tab */}
        {activeTab === 'folder' && (
          <>
            <div className="settings-section">
              <h2 className="section-title">{t('settings.myFolders')}</h2>
              {foldersLoading ? (
                <p className="setting-info">{t('common.loading')}</p>
              ) : folderError ? (
                <p className="settings-error">{folderError}</p>
              ) : folders.length === 0 ? (
                <div className="settings-folder-empty">
                  <FontAwesomeIcon icon={faFolder} className="settings-folder-empty-icon" />
                  <p className="setting-info">{t('settings.noFolders')}</p>
                  <p className="setting-info">{t('settings.noFoldersDescription')}</p>
                </div>
              ) : (
                <div className="settings-folder-list">
                  {folders.map((folder) => (
                    <div key={folder.id} className="settings-folder-item">
                      <div className="settings-folder-info">
                        <div className="settings-folder-header">
                          <FontAwesomeIcon icon={faFolder} className="settings-folder-icon" />
                          <span className="settings-folder-title">{folder.title}</span>
                        </div>
                        {folder.description && (
                          <p className="settings-folder-description">{folder.description}</p>
                        )}
                        <div className="settings-folder-meta">
                          <span>{formatDate(folder.createdAt, i18n.language)}</span>
                          {folder.folderStructure && (
                            <span>{Object.keys(folder.folderStructure).length} {t('settings.files')}</span>
                          )}
                        </div>
                      </div>
                      <div className="settings-folder-actions">
                        <button
                          className="settings-folder-btn view"
                          onClick={() => navigate(`/view/${folder.id}`)}
                          title={t('viewCode.title')}
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </button>
                        <button
                          className="settings-folder-btn delete"
                          onClick={() => handleDeleteFolder(folder.id, folder.title)}
                          title={t('common.delete')}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Info Tab (футердің орнына баптау бетіне көшірілді) */}
        {activeTab === 'info' && (
          <>
            <div className="settings-section">
              <h2 className="section-title">{appName}</h2>
              <p className="setting-info">{t('footer.description')}</p>
              <div className="settings-actions">
                <Button variant="secondary" onClick={() => navigate('/features')}>
                  {t('footer.features')}
                </Button>
              </div>
            </div>

            <div className="settings-section">
              <h2 className="section-title">
                <FontAwesomeIcon icon={faFolderOpen} style={{ marginRight: '0.5rem' }} />
                {t('footer.links')}
              </h2>
              {externalLinks.length === 0 ? (
                <p className="setting-info">{t('common.loading')}</p>
              ) : (
                <ul className="settings-info-links">
                  {externalLinks.map((link) => (
                    <li key={link.url}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        <span className="link-icon">
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
              )}
            </div>

            <div className="settings-section">
              <h2 className="section-title">
                <FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: '0.5rem' }} />
                {t('footer.info')}
              </h2>
              <ul className="settings-info-links">
                <li>
                  <Link to="/about">
                    <span className="link-icon"><FontAwesomeIcon icon={faBook} /></span>
                    {t('footer.about')}
                  </Link>
                </li>
                <li>
                  <Link to="/terms">
                    <span className="link-icon"><FontAwesomeIcon icon={faList} /></span>
                    {t('footer.terms')}
                  </Link>
                </li>
                <li>
                  <Link to="/privacy">
                    <span className="link-icon"><FontAwesomeIcon icon={faLock} /></span>
                    {t('footer.privacy')}
                  </Link>
                </li>
                <li>
                  <Link to="/contact">
                    <span className="link-icon"><FontAwesomeIcon icon={faEnvelope} /></span>
                    {t('footer.contact')}
                  </Link>
                </li>
              </ul>
            </div>

            <div className="settings-section">
              <p className="setting-info">&copy; {currentYear} {appName}. {t('footer.copyright')}</p>
              <div className="settings-info-badges">
                <span className="badge"><FontAwesomeIcon icon={faRocket} /> {t('footer.kazakhstan')}</span>
                <span className="badge"><FontAwesomeIcon icon={faLaptop} /> {t('footer.openSource')}</span>
              </div>
            </div>
          </>
        )}

        {/* Danger Zone Tab */}
        {activeTab === 'danger' && (
          <>
            <div className="settings-danger-zone">
              <div className="danger-zone-header">
                <div className="danger-zone-icon">!</div>
                <h2 className="danger-zone-title">{t('settings.dangerZone')}</h2>
              </div>
              <p className="danger-zone-description">
                {t('settings.dangerZoneDescription')}
              </p>
              <div className="danger-zone-warning">
                <div className="warning-item">
                  <span className="warning-icon">&times;</span>
                  <span>{t('settings.deleteAccountWarning1')}</span>
                </div>
                <div className="warning-item">
                  <span className="warning-icon">&times;</span>
                  <span>{t('settings.deleteAccountWarning2')}</span>
                </div>
                <div className="warning-item">
                  <span className="warning-icon">&times;</span>
                  <span>{t('settings.deleteAccountWarning3')}</span>
                </div>
                <div className="warning-item">
                  <span className="warning-icon">&times;</span>
                  <span>{t('settings.deleteAccountWarning4')}</span>
                </div>
              </div>
              <button
                className="btn-delete-account"
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
            </div>

            <div className="settings-section" style={{ marginTop: '1.5rem' }}>
              <h2 className="section-title">{t('settings.logout')}</h2>
              <p className="setting-info">{t('settings.logoutDescription')}</p>
              <div className="settings-actions">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (window.confirm(t('settings.logoutConfirm'))) {
                      await logout();
                      navigate('/login');
                    }
                  }}
                >
                  {t('settings.logout')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;