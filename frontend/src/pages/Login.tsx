import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiService } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Turnstile, { TURNSTILE_ENABLED } from '../components/ui/Turnstile';
import GoogleSignInButton from '../components/ui/GoogleSignInButton';
import AuthBackdrop from '../components/auth/AuthBackdrop';
import { imageStorage } from '../utils/imageStorage';
import type { LoginChallenge } from '../utils/api';
import LoginCodeStep from '../components/auth/LoginCodeStep';
import './Auth.css';
import './AuthV2.css';

// Код қадамының өз жолы бар: /login/code. Бет жаңартылса да challenge сақталады
export const LOGIN_CODE_PATH = '/login/code';
const CHALLENGE_KEY = 'loginChallenge';

const saveChallenge = (c: LoginChallenge) => {
  try {
    sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify({ c, at: Date.now() }));
  } catch {}
};

const loadChallenge = (): LoginChallenge | null => {
  try {
    const raw = sessionStorage.getItem(CHALLENGE_KEY);
    if (!raw) return null;
    const { c, at } = JSON.parse(raw) as { c: LoginChallenge; at: number };
    const passed = Math.floor((Date.now() - at) / 1000);
    if (passed >= c.expires_in) return null;
    return { ...c, expires_in: c.expires_in - passed, resend_in: Math.max(0, c.resend_in - passed) };
  } catch {
    return null;
  }
};

const clearChallenge = () => {
  try {
    sessionStorage.removeItem(CHALLENGE_KEY);
  } catch {}
};

const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Тіркелу email кодымен расталғаннан кейін осы бетке келеміз
  const routeState = location.state as {
    registeredEmail?: string;
    emailChallenge?: LoginChallenge;
    googleTempToken?: string;
    from?: { pathname: string; search?: string };
  } | null;
  // ProtectedRoute жіберген бет (мыс. терминалдағы codo login ашқан /cli/login?code=…)
  const redirectTo = routeState?.from ? `${routeState.from.pathname}${routeState.from.search ?? ''}` : '/';
  const registeredEmail = routeState?.registeredEmail || '';
  // Тіркелу бетіндегі Google батырмасы 2FA қосулы аккаунтқа тап болса, кодты осында сұраймыз
  const googleTempToken = routeState?.googleTempToken || '';
  const { login, isAuthenticated, isLoading } = useAuth();

  // Already logged in? Skip the login page and go home.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(redirectTo, { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate, redirectTo]);
  
  // Сақталған логин деректерін жүктеу
  const savedEmail = localStorage.getItem('savedEmail') || '';
  const savedUsername = localStorage.getItem('savedUsername') || '';
  const savedLogin = savedEmail || savedUsername;
  
  const [formData, setFormData] = useState({
    emailOrUsername: registeredEmail || savedLogin,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [requires2FA, setRequires2FA] = useState(!!googleTempToken);
  const [tempToken, setTempToken] = useState(googleTempToken);
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFAError, setTwoFAError] = useState('');
  // Жаңа құрылғы не әр 5 кіруден кейін: поштаға келген код — /login/code жолында
  // Тіркелу бетіндегі Google батырмасы код сұраса — осында жалғасады
  const isCodePath = location.pathname === LOGIN_CODE_PATH;
  const [emailChallenge, setEmailChallengeState] = useState<LoginChallenge | null>(
    () => routeState?.emailChallenge || (isCodePath ? loadChallenge() : null),
  );

  const setEmailChallenge = (c: LoginChallenge | null) => {
    setEmailChallengeState(c);
    if (c) {
      saveChallenge(c);
      if (!isCodePath) navigate(LOGIN_CODE_PATH, { state: { from: routeState?.from } });
    } else {
      clearChallenge();
      if (isCodePath) navigate('/login', { replace: true, state: { from: routeState?.from } });
    }
  };

  // Register бетінен state-пен келсе — сақтап, /login/code-қа ауысамыз
  useEffect(() => {
    if (routeState?.emailChallenge && !isCodePath) {
      saveChallenge(routeState.emailChallenge);
      navigate(LOGIN_CODE_PATH, { replace: true, state: { from: routeState.from } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Артқа батырмасы /login-ге қайтарса не жолдан тікелей кірсе — күйді URL-мен үйлестіреміз
  useEffect(() => {
    if (isCodePath) {
      const c = emailChallenge || loadChallenge();
      if (!c) {
        navigate('/login', { replace: true, state: { from: routeState?.from } });
      } else if (!emailChallenge) {
        setEmailChallengeState(c);
      }
    } else if (emailChallenge && !routeState?.emailChallenge) {
      setEmailChallengeState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCodePath]);

  // Set up auth page layout on mount
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyHeight = document.body.style.height;
    const originalHtmlHeight = document.documentElement.style.height;

    // Allow vertical scroll on mobile (for keyboard), hide horizontal scrollbar
    document.body.style.overflow = 'auto';
    document.body.style.minHeight = '100dvh';
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.minHeight = '100dvh';

    return () => {
      // Restore original styles on unmount
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.height = originalBodyHeight;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.height = originalHtmlHeight;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!formData.emailOrUsername.trim()) {
      setError(t('login.enterIdentifier'));
      return;
    }

    setLoading(true);

    try {
      // Login with backend API
      // Құпия сөз жоқ: пошта не логин → поштаға код
      const response = await apiService.login(formData.emailOrUsername, captchaToken);

      // Поштаға код жіберілді — екінші қадам
      if (response.requires_email_code) {
        setEmailChallenge(response as LoginChallenge);
        setLoading(false);
        return;
      }

      // Check if 2FA is required
      if (response.requires_2fa) {
        setRequires2FA(true);
        setTempToken(response.temp_token);
        setLoading(false);
        return;
      }

      // Save tokens and user via AuthContext
      const userData = response.user;

      // Save avatar separately using imageStorage if present
      if (userData.avatar && userData.avatar.trim() !== '') {
        try {
          await imageStorage.saveImage(`avatar-${userData.id}`, userData.avatar);
        } catch (err: any) {
          console.error('Error saving avatar to imageStorage:', err);
        }
      }

      const { avatar, ...userWithoutAvatar } = userData;
      const userForStorage = {
        ...userWithoutAvatar,
        avatar: avatar ? 'stored' : undefined,
      };

      login(
        { access_token: response.access_token, token_type: response.token_type },
        userForStorage,
      );

      // Dispatch custom event to notify other components of login
      window.dispatchEvent(new Event('userProfileUpdated'));

      // Redirect to home (or the page that sent us here)
      navigate(redirectTo);
    } catch (err: any) {
      console.error('Login error:', err);
      // Turnstile токені бір рет қана жарамды — келесі әрекетке жаңасын аламыз
      setCaptchaResetKey((k) => k + 1);
      
      let errorMessage = t('login.error');
      const invalidCred = t('apiErrors.invalidCredentials');

      if (err.message) {
        if (err.message.includes('Captcha')) {
          errorMessage = t('login.captchaFailed');
        } else if (
          err.message === invalidCred ||
          err.message.includes('Invalid credentials') ||
          err.message.includes('User not found')
        ) {
          errorMessage = invalidCred;
        } else if (err.message.includes('QuotaExceededError') || err.message.includes('quota')) {
          errorMessage = t('editProfile.storageQuotaExceeded');
        } else {
          errorMessage = err.message;
        }
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-page auth-v2">
      <AuthBackdrop />

      <div className="landing-auth">
          <div className="auth-card auth-card--glass">
            {!emailChallenge && <h2 className="auth-title auth-title--center">{t('login.title')}</h2>}

            {emailChallenge ? (
              <LoginCodeStep
                challenge={emailChallenge}
                onCancel={() => {
                  setEmailChallenge(null);
                  setCaptchaResetKey((k) => k + 1);
                }}
                onSuccess={async (res) => {
                  // Email коды расталды, бірақ аккаунтта TOTP қосулы — Authenticator коды
                  if (res.requires_2fa) {
                    // /login-ге қайтамыз; бет қайта құрылса да temp token state арқылы жетеді
                    clearChallenge();
                    setEmailChallengeState(null);
                    setTempToken(res.temp_token);
                    setRequires2FA(true);
                    navigate('/login', { replace: true, state: { googleTempToken: res.temp_token, from: routeState?.from } });
                    return;
                  }
                  const userData = res.user;
                  if (userData.avatar && userData.avatar.trim() !== '') {
                    try {
                      await imageStorage.saveImage(`avatar-${userData.id}`, userData.avatar);
                    } catch {}
                  }
                  const { avatar, ...userWithoutAvatar } = userData;
                  login(
                    { access_token: res.access_token, token_type: res.token_type },
                    { ...userWithoutAvatar, avatar: avatar ? 'stored' : undefined },
                  );
                  clearChallenge();
                  window.dispatchEvent(new Event('userProfileUpdated'));
                  navigate(redirectTo, { replace: true });
                }}
              />
            ) : (
            <form onSubmit={handleSubmit} className="auth-form">

            <div className="form-group">
              <input
                id="emailOrUsername"
                type="text"
                value={formData.emailOrUsername}
                onChange={(e) => setFormData({ ...formData, emailOrUsername: e.target.value })}
                placeholder={t('login.identifierPlaceholder')}
                required
              />
            </div>

            <Turnstile onToken={setCaptchaToken} resetKey={captchaResetKey} />

            {registeredEmail && !error && (
              <div className="auth-code-info">{t('register.successLogin')}</div>
            )}

            {error && (
              <div className="form-error">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" fullWidth disabled={loading || (TURNSTILE_ENABLED && !captchaToken)}>
              {loading ? t('login.submitting') : t('login.submit')}
            </Button>

            {requires2FA && (
              <div className="twofa-section" style={{ marginTop: '1rem' }}>
                <h3>{t('auth.2fa.required')}</h3>
                <p>{t('auth.2fa.enterCode')}</p>
                <input
                  type="text"
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="twofa-input"
                />
                {twoFAError && <div className="form-error">{twoFAError}</div>}
                <Button
                  variant="primary"
                  fullWidth
                  disabled={twoFACode.length !== 6}
                  onClick={async () => {
                    try {
                      const res = await apiService.verify2FALogin(tempToken, twoFACode);
                      const userData = res.user;
                      if (userData.avatar && userData.avatar.trim() !== '') {
                        try {
                          await imageStorage.saveImage(`avatar-${userData.id}`, userData.avatar);
                        } catch {}
                      }
                      const { avatar, ...userWithoutAvatar } = userData;
                      const userForStorage = { ...userWithoutAvatar, avatar: avatar ? 'stored' : undefined };
                      login({ access_token: res.access_token, token_type: res.token_type }, userForStorage);
                      window.dispatchEvent(new Event('userProfileUpdated'));
                      navigate(redirectTo);
                    } catch (err: any) {
                      setTwoFAError(err?.message || t('auth.2fa.wrongCode'));
                    }
                  }}
                >
                  {t('auth.2fa.enterCode')}
                </Button>
              </div>
            )}

          </form>
            )}

          {!requires2FA && !emailChallenge && (
            <GoogleSignInButton
              onRequires2FA={(token) => {
                setTempToken(token);
                setRequires2FA(true);
              }}
              onRequiresEmailCode={setEmailChallenge}
              onError={setError}
            />
          )}
          
          {!emailChallenge && (
            <Link to="/register" className="auth-switch-chip">{t('register.submit')}</Link>
          )}
          </div>
      </div>
    </div>
  );
};

export default Login;
