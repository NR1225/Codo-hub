import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../utils/api';
import { sendFirebaseSmsCode, confirmFirebaseSmsCode } from '../utils/firebase';
import type { ConfirmationResult } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Parallax from 'parallax-js';
import { imageStorage } from '../utils/imageStorage';
import './Auth.css';

const Register: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login: authLogin, isAuthenticated, isLoading } = useAuth();
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
    phone: '',
    smsCode: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // SMS verification state. `smsProvider` decides who sends the code:
  // Firebase (from the browser) or our backend (Mobizon / console).
  const [smsProvider, setSmsProvider] = useState<'firebase' | 'backend'>('backend');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [phoneToken, setPhoneToken] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const firebaseConfirmation = useRef<ConfirmationResult | null>(null);

  useEffect(() => {
    apiService.getSmsConfig()
      .then((cfg) => setSmsProvider(cfg.provider))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Normalise to E.164 the same way the backend does (KZ default).
  const normalizePhone = (raw: string): string | null => {
    let digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
    else if (digits.length === 10 && digits.startsWith('7')) digits = '7' + digits;
    if (digits.length < 10 || digits.length > 15) return null;
    return '+' + digits;
  };

  const handlePhoneChange = (value: string) => {
    setFormData({ ...formData, phone: value, smsCode: '' });
    // A new number invalidates any earlier verification.
    if (codeSent || phoneToken) {
      setCodeSent(false);
      setPhoneToken(null);
      setVerifiedPhone(null);
      firebaseConfirmation.current = null;
    }
  };

  const handleSendCode = async () => {
    setError(null);
    const phone = normalizePhone(formData.phone);
    if (!phone) {
      setError(t('register.phoneInvalid'));
      return;
    }
    setSendingCode(true);
    try {
      if (smsProvider === 'firebase') {
        firebaseConfirmation.current = await sendFirebaseSmsCode(phone, 'recaptcha-container');
        setResendIn(60);
      } else {
        const res = await apiService.sendSmsCode(phone);
        setResendIn(res.resend_after);
      }
      setCodeSent(true);
    } catch (err: any) {
      console.error('Send SMS error:', err);
      if (err?.status === 409 || err?.message?.includes('Phone already registered')) {
        setError(t('register.phoneInUse'));
      } else if (err?.status === 429 || err?.code === 'auth/too-many-requests') {
        setError(t('register.smsTooMany'));
      } else {
        setError(t('register.smsSendFailed'));
      }
    } finally {
      setSendingCode(false);
    }
  };

  // Turn the typed SMS code into a backend phone_token (cached for retries).
  const getPhoneToken = async (): Promise<string> => {
    const phone = normalizePhone(formData.phone);
    if (phoneToken && verifiedPhone === phone) return phoneToken;

    let res: { phone_token: string; phone: string };
    if (smsProvider === 'firebase') {
      if (!firebaseConfirmation.current) throw new Error(t('register.smsNotSent'));
      const idToken = await confirmFirebaseSmsCode(firebaseConfirmation.current, formData.smsCode);
      res = await apiService.verifyFirebasePhone(idToken);
    } else {
      res = await apiService.verifySmsCode(phone!, formData.smsCode);
    }
    setPhoneToken(res.phone_token);
    setVerifiedPhone(phone);
    return res.phone_token;
  };

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

    if (!codeSent && !phoneToken) {
      setError(t('register.smsNotSent'));
      return;
    }

    if (!phoneToken && !/^\d{6}$/.test(formData.smsCode)) {
      setError(t('register.smsCodeInvalid'));
      return;
    }

    setLoading(true);

    let verifiedToken: string;
    try {
      verifiedToken = await getPhoneToken();
    } catch (err: any) {
      console.error('SMS verify error:', err);
      if (err?.status === 409 || err?.message?.includes('Phone already registered')) {
        setError(t('register.phoneInUse'));
      } else if (err?.message?.includes('expired')) {
        setError(t('register.smsCodeExpired'));
      } else {
        setError(t('register.smsCodeWrong'));
      }
      setLoading(false);
      return;
    }

    try {
      // Register user with backend API
      const response = await apiService.register(
        formData.username,
        formData.email,
        formData.password,
        verifiedToken,
      );
      
      // Save user to localStorage
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

      // Save via AuthContext
      authLogin(
        { access_token: response.access_token, token_type: response.token_type },
        userForStorage,
      );

      // Dispatch custom event to notify other components of registration
      window.dispatchEvent(new Event('userProfileUpdated'));
      
      // Redirect to home
      navigate('/');
    } catch (err: any) {
      console.error('Registration error:', err);
      
      let errorMessage = t('register.error');
      
      if (err.message) {
        if (err.message.includes('already exists') || err.message.includes('User already exists')) {
          errorMessage = t('register.accountExists');
        } else if (err.message.includes('Phone already registered')) {
          errorMessage = t('register.phoneInUse');
        } else if (err.message.includes('Phone verification')) {
          // phone_token expired: make the user verify again
          setPhoneToken(null);
          setCodeSent(false);
          errorMessage = t('register.smsCodeExpired');
        } else if (err.message.includes('Password must be at least')) {
          errorMessage = t('register.passwordMinLength');
        } else if (err.message.includes('required')) {
          errorMessage = t('register.allFieldsRequired');
        } else if (err.message.includes('QuotaExceededError') || err.message.includes('quota')) {
          errorMessage = t('register.quotaExceeded');
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
      </div>
      
      <div className="landing-auth">
        <div className="auth-card">
          <h2 className="auth-title">{t('register.title')}</h2>

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

            <div className="form-group">
              <div className="phone-input-row">
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={formData.phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="+7 701 123 45 67"
                  required
                  disabled={!!phoneToken}
                />
                <button
                  type="button"
                  className="sms-send-btn"
                  onClick={handleSendCode}
                  disabled={sendingCode || resendIn > 0 || !!phoneToken || !formData.phone.trim()}
                >
                  {phoneToken
                    ? t('register.phoneVerified')
                    : sendingCode
                      ? t('register.smsSending')
                      : resendIn > 0
                        ? `${resendIn}s`
                        : codeSent
                          ? t('register.smsResend')
                          : t('register.smsSend')}
                </button>
              </div>
            </div>

            {codeSent && !phoneToken && (
              <div className="form-group">
                <input
                  id="smsCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={formData.smsCode}
                  onChange={(e) => setFormData({ ...formData, smsCode: e.target.value.replace(/\D/g, '') })}
                  placeholder={t('register.smsCodePlaceholder')}
                  required
                />
              </div>
            )}

            {/* Invisible reCAPTCHA host for Firebase phone auth */}
            <div id="recaptcha-container" />

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

            {error && (
              <div className="form-error">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" fullWidth disabled={loading}>
              {loading ? t('register.submitting') : t('register.title')}
            </Button>
          </form>

          <p className="auth-footer">
            <Link to="/login" className="auth-footer-link-black">{t('register.login')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
