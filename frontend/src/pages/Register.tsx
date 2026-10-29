import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Turnstile, { TURNSTILE_ENABLED } from '../components/ui/Turnstile';
import GoogleSignInButton from '../components/ui/GoogleSignInButton';
import Parallax from 'parallax-js';
import './Auth.css';

const Register: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, isAuthenticated, isLoading } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);

  // Already logged in? Skip the register page and go home.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);
  const parallaxRef = useRef<Parallax | null>(null);
  const parallaxSceneRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Email кодымен растау қадамы
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

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
      const initTimer = setTimeout(() => {
        try {
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
        } catch (error) {
          console.error('Parallax initialization error:', error);
        }
      }, 100);

      return () => {
        clearTimeout(initTimer);
        if (parallaxRef.current) {
          try {
            parallaxRef.current.destroy();
          } catch (error) {
            console.error('Parallax destroy error:', error);
          }
          parallaxRef.current = null;
        }
      };
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.password !== formData.confirmPassword) {
      setError(t('register.passwordMismatch'));
      return;
    }

    if (formData.password.length < 8) {
      setError(t('register.passwordMinLength'));
      return;
    }

    if (!/[A-ZА-ЯЁҰҒҚҢҺҮІ]/.test(formData.password)) {
      setError(t('register.passwordUppercase'));
      return;
    }

    if (!/[0-9]/.test(formData.password)) {
      setError(t('register.passwordDigit'));
      return;
    }

    if (!formData.username.trim()) {
      setError(t('register.usernameRequired'));
      return;
    }

    if (!formData.email.trim()) {
      setError(t('register.emailRequired'));
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError(t('register.emailInvalid'));
      return;
    }

    setLoading(true);

    try {
      // Аккаунт әлі ашылмайды — backend email-ге код жібереді
      const response = await apiService.register(
        formData.username,
        formData.email,
        formData.password,
        captchaToken,
      );
      setPendingEmail(response.email);
      setCode('');
      setInfo(null);
      setResendIn(60);
    } catch (err: any) {
      console.error('Registration error:', err);
      // Turnstile токені бір рет қана жарамды — келесі әрекетке жаңасын аламыз
      setCaptchaResetKey((k) => k + 1);

      let errorMessage = t('register.error');

      if (err.message) {
        if (err.message.includes('Captcha')) {
          errorMessage = t('register.captchaFailed');
        } else if (err.message.includes('already exists') || err.message.includes('User already exists')) {
          errorMessage = t('register.accountExists');
        } else if (err.message.includes('Password must be at least')) {
          errorMessage = t('register.passwordMinLength');
        } else if (err.message.includes('required')) {
          errorMessage = t('register.allFieldsRequired');
        } else {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEmail) return;
    setError(null);
    setInfo(null);

    if (!/^\d{6}$/.test(code)) {
      setError(t('register.codeInvalid'));
      return;
    }

    setLoading(true);

    try {
      const response = await apiService.verifyRegistration(pendingEmail, code);

      // Email расталды — аккаунт ашылды, логин/құпия сөзді қайта сұрамай бірден кіргіземіз
      // (жаңа аккаунттың аватары жоқ, сондықтан imageStorage керек емес)
      login(
        { access_token: response.access_token, token_type: response.token_type },
        { ...response.user, avatar: undefined },
      );
      window.dispatchEvent(new Event('userProfileUpdated'));
      navigate('/', { replace: true });
    } catch (err: any) {
      console.error('Registration verify error:', err);
      const msg: string = err.message || '';
      if (msg.includes('Invalid verification code')) {
        setError(t('register.codeInvalid'));
      } else if (msg.includes('expired')) {
        setError(t('register.codeExpired'));
      } else if (msg.includes('Too many attempts')) {
        setError(t('register.codeTooManyAttempts'));
      } else if (msg.includes('already exists')) {
        setError(t('register.accountExists'));
      } else if (msg.includes('QuotaExceededError') || msg.includes('quota')) {
        setError(t('register.quotaExceeded'));
      } else {
        setError(msg || t('register.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!pendingEmail || resendIn > 0) return;
    setError(null);
    setInfo(null);
    try {
      await apiService.resendRegistrationCode(pendingEmail);
      setCode('');
      setInfo(t('register.codeResent'));
      setResendIn(60);
    } catch (err: any) {
      const msg: string = err.message || '';
      const wait = msg.match(/wait (\d+) seconds/);
      if (wait) {
        setResendIn(Number(wait[1]));
      } else if (msg.includes('expired')) {
        setError(t('register.codeExpired'));
      } else {
        setError(msg || t('register.error'));
      }
    }
  };

  const handleChangeEmail = () => {
    setPendingEmail(null);
    setCode('');
    setError(null);
    setInfo(null);
    setCaptchaResetKey((k) => k + 1);
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
      </div>

      <div className="landing-auth">
        <div className="auth-card">
          <h2 className="auth-title">{pendingEmail ? t('register.verifyTitle') : t('register.title')}</h2>

          {pendingEmail ? (
          <form onSubmit={handleVerify} className="auth-form">
            <p className="auth-code-hint">
              {t('register.codeSentTo')} <strong>{pendingEmail}</strong>
            </p>

            <div className="form-group">
              <input
                id="code"
                className="auth-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                required
              />
            </div>

            {error && (
              <div className="form-error">
                {error}
              </div>
            )}
            {info && !error && <div className="auth-code-info">{info}</div>}

            <Button type="submit" variant="primary" fullWidth disabled={loading || code.length !== 6}>
              {loading ? t('register.verifying') : t('register.verify')}
            </Button>

            <div className="auth-code-actions">
              <button type="button" className="auth-code-link" onClick={handleResend} disabled={resendIn > 0}>
                {resendIn > 0 ? t('register.resendIn', { seconds: resendIn }) : t('register.resendCode')}
              </button>
              <button type="button" className="auth-code-link" onClick={handleChangeEmail}>
                {t('register.changeEmail')}
              </button>
            </div>
          </form>
          ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@example.com"
                required
              />
            </div>

            <div className="form-group">
              <input
                id="username"
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder={t('register.enterUsername')}
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
                  placeholder={t('register.password')}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('register.passwordHide') : t('register.passwordShow')}
                >
                  <FontAwesomeIcon icon={showPassword ? faEye : faEyeSlash} />
                </button>
              </div>
            </div>

            <div className="form-group password-group">
              <div className="password-input-wrapper">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder={t('register.confirmPassword')}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? t('register.passwordHide') : t('register.passwordShow')}
                >
                  <FontAwesomeIcon icon={showConfirmPassword ? faEye : faEyeSlash} />
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
              {loading ? t('register.submitting') : t('register.title')}
            </Button>
          </form>
          )}

          {!pendingEmail && (
            <GoogleSignInButton
              onRequires2FA={(token) => navigate('/login', { state: { googleTempToken: token } })}
              onError={setError}
            />
          )}

          <p className="auth-footer">
            <Link to="/login" className="auth-footer-link-black">{t('register.login')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
