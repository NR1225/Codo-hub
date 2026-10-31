import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiService } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Turnstile, { TURNSTILE_ENABLED } from '../components/ui/Turnstile';
import GoogleSignInButton from '../components/ui/GoogleSignInButton';
import Parallax from 'parallax-js';
import { imageStorage } from '../utils/imageStorage';
import type { LoginChallenge } from '../utils/api';
import LoginCodeStep from '../components/auth/LoginCodeStep';
import './Auth.css';

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
  const heroRef = useRef<HTMLDivElement>(null);

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
  const [showLoginForm, setShowLoginForm] = useState(true);
  const [requires2FA, setRequires2FA] = useState(!!googleTempToken);
  const [tempToken, setTempToken] = useState(googleTempToken);
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFAError, setTwoFAError] = useState('');
  // Жаңа құрылғы не әр 5 кіруден кейін: поштаға келген код
  // Тіркелу бетіндегі Google батырмасы код сұраса — осында жалғасады
  const [emailChallenge, setEmailChallenge] = useState<LoginChallenge | null>(routeState?.emailChallenge || null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parallaxRef = useRef<Parallax | null>(null);
  const parallaxSceneRef = useRef<HTMLDivElement>(null);

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

  // Initialize Parallax effect on landing-hero
  useEffect(() => {
    const sceneElement = parallaxSceneRef.current;
    const heroElement = heroRef.current;
    
    if (sceneElement && heroElement && !parallaxRef.current) {
      // Small delay to ensure DOM is ready
      const initTimer = setTimeout(() => {
        try {
          // Initialize parallax with hero element as input container
          parallaxRef.current = new Parallax(sceneElement, {
            relativeInput: true,
            hoverOnly: false,
            inputElement: heroElement,
            scalarX: 50.0,
            scalarY: 50.0,
            frictionX: 0.1,
            frictionY: 0.1,
            limitX: false,
            limitY: false,
            invertX: false,
            invertY: false,
            pointerEvents: true,
            clipRelativeInput: false,
            precision: 1,
          });
          console.log('✅ Parallax initialized successfully', {
            scene: sceneElement,
            input: heroElement,
            instance: parallaxRef.current
          });
        } catch (error) {
          console.error('❌ Parallax initialization error:', error);
        }
      }, 100);

      return () => {
        clearTimeout(initTimer);
        if (parallaxRef.current) {
          try {
            parallaxRef.current.destroy();
            console.log('Parallax destroyed');
          } catch (error) {
            console.error('Parallax destroy error:', error);
          }
          parallaxRef.current = null;
        }
      };
    }
  }, []);

  useEffect(() => {
    if (!showLoginForm) {
      setError(null);
    }
  }, [showLoginForm]);

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
    <div className="landing-page">
      <div className="landing-hero" ref={heroRef}>
        <div id="parallax-scene" ref={parallaxSceneRef}>
          {/* Deep space background */}
          <div data-depth="0.05" className="parallax-layer">
            <div className="meteor-deep-space"></div>
          </div>
          
          {/* Stars field - background layer */}
          <div data-depth="0.1" className="parallax-layer">
            <div className="meteor-stars-field">
              <div className="star-layer star-layer-1"></div>
              <div className="star-layer star-layer-2"></div>
              <div className="star-layer star-layer-3"></div>
            </div>
          </div>
          
          {/* Slow meteors - far background */}
          <div data-depth="0.2" className="parallax-layer">
            <div className="meteor-shower meteor-shower-1">
              <div className="meteor meteor-1"></div>
              <div className="meteor meteor-2"></div>
              <div className="meteor meteor-3"></div>
            </div>
          </div>
          
          {/* Medium speed meteors - middle layer */}
          <div data-depth="0.4" className="parallax-layer">
            <div className="meteor-shower meteor-shower-2">
              <div className="meteor meteor-4"></div>
              <div className="meteor meteor-5"></div>
              <div className="meteor meteor-6"></div>
              <div className="meteor meteor-7"></div>
            </div>
          </div>
          
          {/* Fast meteors - foreground */}
          <div data-depth="0.8" className="parallax-layer">
            <div className="meteor-shower meteor-shower-3">
              <div className="meteor meteor-8"></div>
              <div className="meteor meteor-9"></div>
              <div className="meteor meteor-10"></div>
              <div className="meteor meteor-11"></div>
              <div className="meteor meteor-12"></div>
            </div>
          </div>
          
          {/* Bright foreground meteors */}
          <div data-depth="1.0" className="parallax-layer">
            <div className="meteor-shower meteor-shower-4">
              <div className="meteor meteor-13"></div>
              <div className="meteor meteor-14"></div>
              <div className="meteor meteor-15"></div>
            </div>
          </div>
        </div>
        
        {/* Hero content - outside parallax scene, always visible */}
      </div>
      
      <div className="landing-auth">
        {!showLoginForm ? (
          <button 
            className="login-trigger-btn"
            onMouseEnter={() => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
              }
              hoverTimeoutRef.current = setTimeout(() => {
                setShowLoginForm(true);
              }, 300); // 300ms delay for hover
            }}
            onMouseLeave={() => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
              }
            }}
            onClick={() => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
              }
              setShowLoginForm(true);
            }}
          >
            {t('login.title')}
          </button>
        ) : (
          <div 
            className="auth-card"
          >
            <h2 className="auth-title">{emailChallenge ? t('loginCode.title') : t('login.title')}</h2>

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
                    setEmailChallenge(null);
                    setTempToken(res.temp_token);
                    setRequires2FA(true);
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
                  window.dispatchEvent(new Event('userProfileUpdated'));
                  navigate(redirectTo);
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
          
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => navigate('/register')}
              style={{
                background: 'var(--auth-switch-bg)',
                border: 'none',
                color: 'var(--auth-switch-fg)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '600',
                padding: '0.25rem 1.5rem',
                borderRadius: '8px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                minWidth: '120px',
                textAlign: 'center',
                width: 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--auth-switch-hover)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--auth-switch-bg)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {t('register.submit')}
            </button>
          </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
