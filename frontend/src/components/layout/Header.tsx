import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLock, faUser, faLayerGroup, faLaptopCode } from '@fortawesome/free-solid-svg-icons';
import { faComments } from '@fortawesome/free-regular-svg-icons';
import ProfileModal from '../modals/ProfileModal';
// Хедер батырмаларының (.btn-secondary) көрінісі осы стильдерге тәуелді —
// UploadModal алынғанда да сақталуы үшін тікелей импорттаймыз.
import '../modals/UploadModal.css';
import LinkButton from '../ui/LinkButton';
import { apiService, User } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { imageStorage } from '../../utils/imageStorage';
import './Header.css';

// Vibecoding бетіндегі хедер биіктігі (px): 0 — толық жиналған
const VIBE_HEADER_KEY = 'vibecoding.headerHeight';
const VIBE_HEADER_DEFAULT = 64;
const VIBE_HEADER_MIN = 0;
const VIBE_HEADER_LIMIT = 96;
const clampHeaderH = (h: number) => {
  const v = Math.round(Math.min(VIBE_HEADER_LIMIT, Math.max(VIBE_HEADER_MIN, h)));
  return v < 14 ? 0 : v; // кішкене қалдық — толық жинаймыз
};

const Header: React.FC = () => {
  const { t } = useTranslation();
  const { user: authUser, isAuthenticated } = useAuth();
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [incomingRequestCount, setIncomingRequestCount] = useState(0);
  const [displayUser, setDisplayUser] = useState<User | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Хедердің нақты биіктігін --header-h айнымалысына жазамыз: беттер «100vh − хедер»
  // биіктігін дәл есептейді (қолмен жазылған 64px бөлшек пиксельге қате кетіріп,
  // артық айналдыру жолағын шығаратын)
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--header-h', `${el.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--header-h');
    };
  }, []);

  // Vibecoding бетінде ғана хедердің биіктігін сүйреп өзгертуге болады.
  // Өлшем localStorage-та сақталады: басқа беттерде хедер қалыпты, қайтқанда сол өлшем.
  const { pathname } = useLocation();
  const isVibePage = pathname === '/vibecoding';
  const [vibeHeaderH, setVibeHeaderH] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(VIBE_HEADER_KEY));
      return Number.isFinite(v) && localStorage.getItem(VIBE_HEADER_KEY) !== null ? clampHeaderH(v) : null;
    } catch {
      return null;
    }
  });
  const [isResizing, setIsResizing] = useState(false);

  const saveVibeHeaderH = useCallback((h: number | null) => {
    setVibeHeaderH(h);
    try {
      if (h === null) localStorage.removeItem(VIBE_HEADER_KEY);
      else localStorage.setItem(VIBE_HEADER_KEY, String(h));
    } catch { /* сақтау мүмкін емес — тек осы сессияда */ }
  }, []);

  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = headerRef.current?.getBoundingClientRect().height ?? VIBE_HEADER_DEFAULT;
    let last = startH;
    setIsResizing(true);
    const onMove = (ev: PointerEvent) => {
      last = clampHeaderH(startH + ev.clientY - startY);
      setVibeHeaderH(last);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setIsResizing(false);
      saveVibeHeaderH(last);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [saveVibeHeaderH]);

  const onResizeKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const cur = vibeHeaderH ?? headerRef.current?.getBoundingClientRect().height ?? VIBE_HEADER_DEFAULT;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      saveVibeHeaderH(clampHeaderH(cur + (e.key === 'ArrowUp' ? -8 : 8)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      saveVibeHeaderH(0);
    } else if (e.key === 'End' || e.key === 'Enter') {
      e.preventDefault();
      saveVibeHeaderH(null);
    }
  }, [vibeHeaderH, saveVibeHeaderH]);

  const resizable = isVibePage && vibeHeaderH !== null;

  // Load avatar from imageStorage for display
  const loadDisplayUser = useCallback(async () => {
    if (!authUser?.id) {
      setDisplayUser(null);
      return;
    }

    const userData = { ...authUser };

    // Load avatar from imageStorage if it exists
    try {
      const avatarFromStorage = await imageStorage.getImage(`avatar-${userData.id}`);
      if (avatarFromStorage) {
        userData.avatar = avatarFromStorage;
      } else if (userData.avatar === 'stored') {
        userData.avatar = undefined;
      }
    } catch {
      if (userData.avatar === 'stored') {
        userData.avatar = undefined;
      }
    }

    setDisplayUser(userData);
  }, [authUser]);

  useEffect(() => {
    loadDisplayUser();
  }, [loadDisplayUser]);

  const loadIncomingRequestCount = useCallback(async () => {
    if (!authUser?.id) return;
    try {
      const { incomingRequestCount } = await apiService.getIncomingFriendRequestCount(authUser.id);
      setIncomingRequestCount(incomingRequestCount);
    } catch {
      // Silently ignore — non-critical feature
    }
  }, [authUser?.id]);

  useEffect(() => {
    if (isAuthenticated && authUser?.id) {
      loadIncomingRequestCount();

      let interval: NodeJS.Timeout | null = null;

      const startPolling = () => {
        if (document.visibilityState === 'visible') {
          interval = setInterval(loadIncomingRequestCount, 10000);
        }
      };

      const stopPolling = () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      };

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          loadIncomingRequestCount();
          startPolling();
        } else {
          stopPolling();
        }
      };

      if (document.visibilityState === 'visible') {
        startPolling();
      }

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        stopPolling();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [isAuthenticated, authUser?.id, loadIncomingRequestCount]);

  // Listen for profile update events — reload avatar from imageStorage
  // (e.g. after editing profile in EditProfileModal, which saves the new
  // avatar to imageStorage and dispatches this event)
  useEffect(() => {
    const handleProfileUpdate = () => {
      loadDisplayUser();
    };

    window.addEventListener('userProfileUpdated', handleProfileUpdate);

    return () => {
      window.removeEventListener('userProfileUpdated', handleProfileUpdate);
    };
  }, [loadDisplayUser]);

  return (
    <header
      ref={headerRef}
      style={resizable ? { height: vibeHeaderH!, paddingTop: 0, paddingBottom: 0 } : undefined}
      className={`${resizable ? 'site-header--sized ' : ''}${isResizing ? 'site-header--resizing ' : ''}${resizable && vibeHeaderH! < 40 ? 'site-header--compact ' : ''}site-header relative border-b border-border py-[2.6px] sticky top-0 z-[9999] backdrop-blur-[20.5px] backdrop-saturate-[180%] transition-all w-full max-w-full before:absolute before:inset-0 before:bg-bg-primary before:opacity-95 dark:before:opacity-85 before:-z-10`}
    >
      <div className="w-full m-0 pr-4 pl-4 flex items-center justify-between gap-4 relative flex-nowrap max-[491.5px]:pr-3 max-[491.5px]:pl-3 min-h-[58px]">
        {/* Сайт атауы */}
        <Link
          to="/"
          className="flex items-center gap-2 sm:gap-3 flex-shrink-0 m-0 p-1 no-underline rounded-[7.7px] text-text-primary"
          aria-label={t('header.appName')}
        >
          <img
            src="/logo.png"
            alt=""
            className="site-logo w-[34px] h-[25px] sm:w-[42px] sm:h-[34px]"
          />
          <span className="site-brand text-sky-400 dark:text-sky-300 font-extrabold text-[21px] sm:text-[25px] tracking-[-0.32px] truncate">
            {t('header.appName')}
          </span>
        </Link>
        {/* Батырмалар - оң жақта */}
        <div className="flex gap-2 sm:gap-3 items-center flex-shrink-0 flex-nowrap flex-row">
          {/* Кодтар батырмасы — барлық жүктелген кодтар беті */}
          <LinkButton
            to="/codes"
            variant="secondary"
            className="h-[34px] sm:h-[38px] text-[13px] sm:text-[14px] px-3.5 sm:px-4 py-0 gap-2 header-btn-upload header-nav-btn"
            title={t('header.codes')}
            icon={<FontAwesomeIcon icon={faLayerGroup} />}
          >
            <span className="max-[360px]:hidden">{t('header.codes')}</span>
          </LinkButton>

          {/* Chat батырмасы */}
          {isAuthenticated && (
            <LinkButton
              to="/chat"
              variant="secondary"
              className="relative h-[34px] sm:h-[38px] text-[13px] sm:text-[14px] px-3.5 sm:px-4 py-0 gap-2 header-btn-chat header-nav-btn"
              title={t('header.chat')}
              icon={
                <>
                  <FontAwesomeIcon icon={faComments} />
                  {incomingRequestCount > 0 && (
                    <span className="absolute -top-[5.1px] -right-[5.1px] bg-error text-white rounded-full w-[12.8px] h-[12.8px] flex items-center justify-center text-[0.7rem] font-semibold border-[1.3px] border-bg-primary shadow-[0_1.3px_2.6px_rgba(0,0,0,0.2)]">
                      {incomingRequestCount > 99 ? '99+' : incomingRequestCount}
                    </span>
                  )}
                </>
              }
            >
              <span className="max-[360px]:hidden">{t('header.chat')}</span>
            </LinkButton>
          )}

          {/* Vibecoding батырмасы */}
          <LinkButton
            to="/vibecoding"
            variant="secondary"
            className="h-[34px] sm:h-[38px] text-[13px] sm:text-[14px] px-3.5 sm:px-4 py-0 gap-2 header-btn-vibecoding header-nav-btn"
            title={t('vibecoding.title', 'Vibecoding')}
            icon={<FontAwesomeIcon icon={faLaptopCode} />}
          >
            <span className="max-[360px]:hidden">{t('vibecoding.title', 'Vibecoding')}</span>
          </LinkButton>

          {/* Профиль батырмасы - ең оң жақта */}
          {isAuthenticated && displayUser && (
            <button
              ref={profileButtonRef}
              onClick={() => setIsProfileModalOpen(!isProfileModalOpen)}
              className="flex items-center justify-center gap-0 p-0 rounded-full no-underline text-text-primary transition-all bg-transparent border-none relative overflow-visible cursor-pointer w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] box-border font-inherit text-inherit dark:bg-gradient-to-br dark:from-[rgba(0,153,204,0.08)] dark:to-[rgba(0,175,202,0.05)] hover:-translate-y-[1.3px] header-btn-profile"
            >
              <div className="w-[30px] h-[30px] sm:w-[34px] sm:h-[34px] rounded-full bg-[#0d0d0d] flex items-center justify-center text-[14px] font-semibold tracking-[0.02em] text-white flex-shrink-0 shadow-md drop-shadow-[0_0_12.8px_rgba(0,175,202,0.3)] transition-all overflow-hidden relative border-[1.3px] border-[rgba(0,175,202,0.3)] hover:shadow-lg hover:drop-shadow-[0_0_19.2px_rgba(0,175,202,0.5)] hover:border-primary hover:scale-105">
                {displayUser.avatar ? (
                  <img
                    src={displayUser.avatar}
                    alt={displayUser.username || 'User'}
                    className="w-full h-full object-cover rounded-full transition-transform hover:scale-110"
                  />
                ) : (
                  <span className="flex items-center justify-center w-full h-full transition-transform hover:scale-110">
                    {displayUser.username?.[0]?.toUpperCase() || <FontAwesomeIcon icon={faUser} />}
                  </span>
                )}
              </div>
            </button>
          )}

          {/* Login батырмасы (егер кіру жасамаған болса) */}
          {!isAuthenticated && (
            <LinkButton
              to="/login"
              variant="secondary"
              className="h-[32px] sm:h-[36px] text-[12.5px] sm:text-[14.5px] px-2 sm:px-3 py-0.5 header-btn-login"
              icon={<FontAwesomeIcon icon={faLock} />}
            >
              <span className="max-[360px]:hidden">{t('common.login')}</span>
            </LinkButton>
          )}
        </div>
      </div>
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        buttonRef={profileButtonRef}
      />
      {isVibePage && (
        <div
          className="site-header__resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('header.resize', 'Хедер биіктігі')}
          aria-valuemin={VIBE_HEADER_MIN}
          aria-valuemax={VIBE_HEADER_LIMIT}
          aria-valuenow={vibeHeaderH ?? VIBE_HEADER_DEFAULT}
          tabIndex={0}
          title={t('header.resizeHint', 'Сүйреп хедер биіктігін өзгертіңіз · екі рет басу — бастапқы өлшем')}
          onPointerDown={onResizeStart}
          onDoubleClick={() => saveVibeHeaderH(null)}
          onKeyDown={onResizeKey}
        />
      )}
    </header>
  );
};

export default Header;