import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Turnstile, { TURNSTILE_ENABLED } from '../components/ui/Turnstile';
import Parallax from 'parallax-js';
import { imageStorage } from '../utils/imageStorage';
import './Auth.css';

const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, isAuthenticated, isLoading } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);

  // Already logged in? Skip the login page and go home.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);
  
  // Сақталған логин деректерін жүктеу
  const savedEmail = localStorage.getItem('savedEmail') || '';
  const savedUsername = localStorage.getItem('savedUsername') || '';
  const savedLogin = savedEmail || savedUsername;
  
  const [formData, setFormData] = useState({
    emailOrUsername: savedLogin,
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [showLoginForm, setShowLoginForm] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFAError, setTwoFAError] = useState('');
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

  // Clear password when form is closed
  useEffect(() => {
    if (!showLoginForm) {
      setFormData(prev => ({ ...prev, password: '' }));
      setShowPassword(false);
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

    if (!formData.password.trim()) {
      setError(t('login.enterPassword'));
      return;
    }

    setLoading(true);

    try {
      // Login with backend API
      const response = await apiService.login(formData.emailOrUsername, formData.password, captchaToken);

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

      // Redirect to home
      navigate('/');
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
            <h2 className="auth-title">{t('login.title')}</h2>

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

            <div className="form-group password-group">
              <div className="password-input-wrapper">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('login.passwordHide') : t('login.passwordShow')}
                >
                  <FontAwesomeIcon icon={showPassword ? faEye : faEyeSlash} />
                </button>
              </div>
            </div>

            <Turnstile onToken={setCaptchaToken} resetKey={captchaResetKey} />

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
                      navigate('/');
                    } catch (err: any) {
                      setTwoFAError(err?.message || t('auth.2fa.wrongCode'));
                    }
                  }}
                >
                  {t('auth.2fa.enterCode')}
                </Button>
              </div>
            )}

            {!requires2FA && (
              <div style={{ marginTop: '0.5rem', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    textDecoration: 'underline',
                  }}
                >
                  {t('auth.forgotPassword')}
                </button>
              </div>
            )}
          </form>
          
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => navigate('/register')}
              style={{
                background: 'white',
                border: 'none',
                color: 'black',
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
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'white';
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
