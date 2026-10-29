import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiService } from '../utils/api';
import Button from '../components/ui/Button';
import Parallax from 'parallax-js';
import './Auth.css';

const ForgotPassword: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const heroRef = useRef<HTMLDivElement>(null);
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
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.height = originalBodyHeight;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.height = originalHtmlHeight;
    };
  }, []);

  // Initialize Parallax effect (same as Login page)
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
          } catch {}
          parallaxRef.current = null;
        }
      };
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');

    try {
      await apiService.forgotPassword(email.trim());
      setSent(true);
    } catch (err: any) {
      setError(err?.message || t('auth.resetPasswordExpired'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-page">
      <div className="landing-hero" ref={heroRef}>
        <div id="parallax-scene" ref={parallaxSceneRef}>
          <div data-depth="0.05" className="parallax-layer">
            <div className="meteor-deep-space"></div>
          </div>
          <div data-depth="0.1" className="parallax-layer">
            <div className="meteor-stars-field">
              <div className="star-layer star-layer-1"></div>
              <div className="star-layer star-layer-2"></div>
              <div className="star-layer star-layer-3"></div>
            </div>
          </div>
          <div data-depth="0.2" className="parallax-layer">
            <div className="meteor-shower meteor-shower-1">
              <div className="meteor meteor-1"></div>
              <div className="meteor meteor-2"></div>
              <div className="meteor meteor-3"></div>
            </div>
          </div>
          <div data-depth="0.4" className="parallax-layer">
            <div className="meteor-shower meteor-shower-2">
              <div className="meteor meteor-4"></div>
              <div className="meteor meteor-5"></div>
              <div className="meteor meteor-6"></div>
              <div className="meteor meteor-7"></div>
            </div>
          </div>
          <div data-depth="0.8" className="parallax-layer">
            <div className="meteor-shower meteor-shower-3">
              <div className="meteor meteor-8"></div>
              <div className="meteor meteor-9"></div>
              <div className="meteor meteor-10"></div>
              <div className="meteor meteor-11"></div>
              <div className="meteor meteor-12"></div>
            </div>
          </div>
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
          <h2 className="auth-title">{t('auth.resetPassword')}</h2>

          {sent ? (
            <>
              <div className="auth-success" style={{ textAlign: 'center', padding: '1rem 0' }}>
                <p>{t('auth.resetPasswordSent')}</p>
              </div>
              <Button
                variant="primary"
                fullWidth
                onClick={() => navigate('/login')}
              >
                {t('login.title')}
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('register.email')}
                  required
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <Button type="submit" variant="primary" fullWidth disabled={loading}>
                {loading ? '...' : t('auth.forgotPassword')}
              </Button>

              <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
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
                  {t('login.title')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;