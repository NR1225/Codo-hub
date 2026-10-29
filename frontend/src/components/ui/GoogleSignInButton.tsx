import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiService } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteConfig } from '../../contexts/SiteConfigContext';
import { signInWithGoogle } from '../../utils/firebase';
import { imageStorage } from '../../utils/imageStorage';

interface GoogleSignInButtonProps {
  /** Аккаунтта 2FA қосулы болса — temp token-мен код сұрау керек */
  onRequires2FA: (tempToken: string) => void;
  onError: (message: string | null) => void;
}

// Пайдаланушы терезені өзі жапқанда қате көрсетпейміз
const SILENT_FIREBASE_ERRORS = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

const GoogleIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({ onRequires2FA, onError }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const { config } = useSiteConfig();
  const [loading, setLoading] = useState(false);

  // Firebase конфигі backend-те жоқ болса, батырманы көрсетпейміз
  if (!config?.firebaseConfig) return null;

  const handleClick = async () => {
    onError(null);
    setLoading(true);
    try {
      const idToken = await signInWithGoogle();
      const response = await apiService.firebaseLogin(idToken);

      if (response.requires_2fa) {
        onRequires2FA(response.temp_token);
        return;
      }

      const userData = response.user;
      if (userData.avatar && userData.avatar.trim() !== '') {
        try {
          await imageStorage.saveImage(`avatar-${userData.id}`, userData.avatar);
        } catch (err: any) {
          console.error('Error saving avatar to imageStorage:', err);
        }
      }
      const { avatar, ...userWithoutAvatar } = userData;
      login(
        { access_token: response.access_token, token_type: response.token_type },
        { ...userWithoutAvatar, avatar: avatar ? 'stored' : undefined },
      );
      window.dispatchEvent(new Event('userProfileUpdated'));
      navigate('/');
    } catch (err: any) {
      if (SILENT_FIREBASE_ERRORS.includes(err?.code)) return;
      console.error('Google sign-in error:', err);
      onError(err?.code === 'auth/popup-blocked' ? t('auth.googlePopupBlocked') : t('auth.googleFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="auth-divider"><span>{t('auth.or')}</span></div>
      <button type="button" className="btn-google" onClick={handleClick} disabled={loading}>
        <GoogleIcon />
        {loading ? t('auth.googleLoading') : t('auth.continueWithGoogle')}
      </button>
    </>
  );
};

export default GoogleSignInButton;
