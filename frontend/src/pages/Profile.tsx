import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faLaptop, faHeart, faComment, faEye, faFileAlt, faImage, faPen, faCopy, faCheck,
  faArrowLeft, faPlus, faUpload, faGear, faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { User, CodeFile } from '../utils/api';
import { apiService } from '../utils/api';
import { ensureNumericId } from '../utils/idConverter';
import { imageStorage } from '../utils/imageStorage';
import CodeTile from '../components/codes/CodeTile';
import ViewToggle from '../components/codes/ViewToggle';
import { ViewMode, readViewMode, saveViewMode } from '../components/codes/codeUtils';
import { monogram } from '../components/home/monogram';
import EditProfileModal from '../components/modals/EditProfileModal';
import ChangeBackgroundModal from '../components/modals/ChangeBackgroundModal';
// Код карталары (.cdx-card) мен тор/тізім ауыстырғышы (.cdx-seg) — кодтар бетінің стильдері
import './CodesPage.css';
import './Profile.css';

// Модуль деңгейіндегі кэш: Profile-ға қайта оралғанда loading spinner
// флешы көрінбеуі үшін — бұрын жүктелген деректі бірден көрсетіп, фонда жаңартамыз.
interface ProfileCache {
  user: User;
  userCodes: CodeFile[];
  stats: { totalLikes: number; totalComments: number; totalViews: number };
}
const profileCache: Record<string, ProfileCache> = {};

const profileCacheKey = (username: string | undefined): string =>
  username ? `@${username}` : '@me';

const computeStats = (filteredCodes: CodeFile[]) => {
  const totalLikes = filteredCodes.reduce((sum, code) => sum + (code.likes?.length || 0), 0);
  const totalComments = filteredCodes.reduce((sum, code) => {
    const commentCount = code.comments?.length || 0;
    const replyCount = code.comments?.reduce((replySum, comment) => {
      return replySum + (comment.replies?.length || 0);
    }, 0) || 0;
    return sum + commentCount + replyCount;
  }, 0);
  const totalViews = filteredCodes.reduce((sum, code) => sum + (code.views || 0), 0);
  return { totalLikes, totalComments, totalViews };
};

interface ProfileBackground {
  image: string | null;
  position: { x: number; y: number };
  zoom: number;
}

const DEFAULT_BACKGROUND: ProfileBackground = { image: null, position: { x: 50, y: 50 }, zoom: 100 };

// Мұқаба суреті imageStorage-та, орны мен масштабы localStorage-та сақталады
async function readProfileBackground(userId: string): Promise<ProfileBackground> {
  try {
    const image = (await imageStorage.getImage(`profile-bg-${userId}`)) || null;
    let position = DEFAULT_BACKGROUND.position;
    let zoom = DEFAULT_BACKGROUND.zoom;
    try {
      const savedPosition = localStorage.getItem(`profile-bg-position-${userId}`);
      if (savedPosition) position = JSON.parse(savedPosition);
    } catch {
      // Бүлінген мән — әдепкі орын
    }
    const savedZoom = parseFloat(localStorage.getItem(`profile-bg-zoom-${userId}`) || '');
    if (!Number.isNaN(savedZoom)) zoom = Math.max(50, Math.min(200, savedZoom));
    return { image, position, zoom };
  } catch (err) {
    console.error('Failed to load background image:', err);
    return DEFAULT_BACKGROUND;
  }
}

// Аватар 'stored' белгісімен келсе — суреттің өзі imageStorage-та
async function resolveAvatar<T extends { id?: string; avatar?: string }>(userData: T): Promise<T> {
  if (!userData.id) return userData;
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
  return userData;
}

const Profile: React.FC = () => {
  const { t } = useTranslation();
  const { username: urlUsername } = useParams<{ username?: string }>();
  const navigate = useNavigate();
  const _cacheKey = profileCacheKey(urlUsername);
  const _cached = profileCache[_cacheKey];
  const [user, setUser] = useState<User | null>(_cached?.user ?? null);
  const [userCodes, setUserCodes] = useState<CodeFile[]>(_cached?.userCodes ?? []);
  const [error, setError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isChangeBackgroundModalOpen, setIsChangeBackgroundModalOpen] = useState(false);
  const [background, setBackground] = useState<ProfileBackground>(DEFAULT_BACKGROUND);
  const [stats, setStats] = useState(_cached?.stats ?? {
    totalLikes: 0,
    totalComments: 0,
    totalViews: 0,
  });
  const [isIdCopied, setIsIdCopied] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<ViewMode>(readViewMode);

  useEffect(() => {
    // Кэш бар болса — фонда жаңартамыз (silent), әйтпесе толық жүктеу.
    loadProfile(profileCache[_cacheKey] !== undefined);
    // Load current user from localStorage
    const loadCurrentUser = async () => {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          setCurrentUser(await resolveAvatar(JSON.parse(storedUser)));
        } catch (err) {
          console.error('Failed to parse stored user:', err);
        }
      }
    };
    loadCurrentUser();
  }, [urlUsername]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isEditModalOpen || isChangeBackgroundModalOpen) {
      // Save current scroll position
      const scrollY = window.scrollY;
      // Disable scroll
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';

      return () => {
        // Restore scroll when modal closes
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isEditModalOpen, isChangeBackgroundModalOpen]);

  const reloadBackground = useCallback(async () => {
    if (!user?.id) return;
    setBackground(await readProfileBackground(user.id));
  }, [user?.id]);

  // Мұқабаны жүктеу және басқа жерде өзгерсе — жаңарту
  useEffect(() => {
    reloadBackground();
    window.addEventListener('profileBackgroundUpdated', reloadBackground);
    return () => window.removeEventListener('profileBackgroundUpdated', reloadBackground);
  }, [reloadBackground]);

  const copyId = async () => {
    if (user?.id) {
      try {
        const numericId = ensureNumericId(user.id);
        await navigator.clipboard.writeText(numericId);
        setIsIdCopied(true);
        setTimeout(() => setIsIdCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy ID:', err);
      }
    }
  };

  const changeView = (value: ViewMode) => {
    setView(value);
    saveViewMode(value);
  };

  const loadProfile = async (silent: boolean = false) => {
    try {
      let userData: User;

      // If username is provided in URL, load that user's profile
      if (urlUsername) {
        try {
          userData = await apiService.getUserByUsername(urlUsername);
        } catch (err: any) {
          console.error('Failed to load user by username:', err);
          setError(t('profile.userNotFound'));
          return;
        }
      } else {
        // Try to get user from localStorage first
        const storedUser = localStorage.getItem('user');

        if (storedUser) {
          userData = JSON.parse(storedUser);
          // Always verify user exists in backend using stored email and id
          // Never call getCurrentUser() without parameters to avoid getting wrong user
          try {
            const verifiedUser = await apiService.getCurrentUser(userData.email, userData.id);
            userData = verifiedUser;
          } catch (err: any) {
            // Only redirect to login on a genuine "user not found" (HTTP 404).
            // Transient errors (401, network, timeout, server down) must NOT
            // log the user out — keep the cached user so the profile still
            // renders while the session recovers in the background.
            const status = err?.status;
            const msg = String(err?.message || '');
            const isUserGone =
              status === 404 ||
              /not found|табылмады|ne найден/i.test(msg);
            if (isUserGone) {
              console.warn('User no longer exists in backend, redirecting to login');
              localStorage.removeItem('user');
              navigate('/login');
              return;
            }
            // Transient failure — keep the stored user and continue.
            console.warn('getCurrentUser transient failure, using cached user:', err);
          }
        } else {
          // No stored user - redirect to login instead of trying to get random user
          if (!silent) navigate('/login');
          return;
        }
      }

      userData = await resolveAvatar(userData);

      const codesResponse = await apiService.getCodeFiles(undefined, 1000, 0, false);
      setUser(userData);
      // Пайдаланушының кодтарын сүзгілеу
      const filteredCodes = codesResponse.codes.filter((code) => code.author === userData.username);
      setUserCodes(filteredCodes);

      // Статистикаларды есептеу
      const newStats = computeStats(filteredCodes);
      setStats(newStats);

      // Модуль кэшін жаңарту — келесі рет Profile-ға кіргенде бірден көрсету үшін.
      profileCache[profileCacheKey(urlUsername)] = {
        user: userData,
        userCodes: filteredCodes,
        stats: newStats,
      };

      setError(null);
    } catch (err) {
      // Silent фонда жаңарту кезіндегі қатені ескі деректі қайтармашылық ету.
      if (!silent) {
        setError(err instanceof Error ? err.message : t('profile.errorTitle'));
      } else {
        console.warn('Silent profile refresh failed, keeping cached data:', err);
      }
    }
  };

  // Loading spinner жоқ — кэштелген дерек бірден көрінеді, алғашқы жүктеуде
  // қара бос бет шығып, дерек келгенде мазмұн қосылады.
  if (error && !user) {
    return (
      <div className="profile-page">
        <div className="prf-error" role="alert">
          <span className="prf-error__icon">
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </span>
          <p className="prf-error__title">{t('profile.errorTitle')}</p>
          <p className="prf-error__text">{error}</p>
          <button type="button" className="prf-btn prf-btn--ghost" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowLeft} />
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <div className="profile-page" />;
  }

  const isOwnProfile = !!currentUser && currentUser.username === user.username;
  const statItems = [
    { key: 'codes', icon: faLaptop, value: userCodes.length, label: t('profile.codeFiles') },
    { key: 'likes', icon: faHeart, value: stats.totalLikes, label: t('profile.likes') },
    { key: 'comments', icon: faComment, value: stats.totalComments, label: t('profile.comments') },
    { key: 'views', icon: faEye, value: stats.totalViews, label: t('profile.views') },
  ];

  // Басты беттің дизайн тілінде: сол жақта профиль панелі, оң жақта кодтар панелі
  // Модалдар .profile-page-тен тыс — беттің қара палитра айнымалылары оларға әсер етпесін
  return (
    <>
      <div className="profile-page">
        <div className="prf-layout">
          <aside className="prf-side" aria-label={user.username}>
            <div
              className={`prf-cover ${background.image ? 'has-image' : ''}`}
              style={background.image ? {
                backgroundImage: `url(${background.image})`,
                backgroundSize: `${background.zoom}%`,
                backgroundPosition: `${background.position.x}% ${background.position.y}%`,
              } : undefined}
            >
              {currentUser && !isOwnProfile && (
                <button
                  type="button"
                  className="prf-cover__btn prf-cover__btn--left"
                  onClick={() => navigate(-1)}
                  title={t('common.back')}
                  aria-label={t('common.back')}
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
              )}
              {isOwnProfile && (
                <button
                  type="button"
                  className="prf-cover__btn"
                  onClick={() => setIsChangeBackgroundModalOpen(true)}
                  title={t('profile.changeBackground')}
                  aria-label={t('profile.changeBackground')}
                >
                  <FontAwesomeIcon icon={faImage} />
                </button>
              )}
            </div>

            <div className="prf-id">
              <span className="prf-avatar">
                {user.avatar ? <img src={user.avatar} alt={user.username} /> : monogram(user.username)}
              </span>
              <h1 className="prf-name">{user.username}</h1>
              <button
                type="button"
                className={`prf-chip ${isIdCopied ? 'is-done' : ''}`}
                onClick={copyId}
                title={isIdCopied ? t('profile.copied') : t('profile.copyId')}
              >
                ID {ensureNumericId(user.id)}
                <FontAwesomeIcon icon={isIdCopied ? faCheck : faCopy} />
              </button>
              {user.bio && user.bio.trim() && <p className="prf-bio">{user.bio}</p>}
            </div>

            <div className="prf-stats">
              {statItems.map((stat, i) => (
                <div key={stat.key} className="prf-stat" style={{ '--d': i } as React.CSSProperties}>
                  <span className="prf-stat__icon">
                    <FontAwesomeIcon icon={stat.icon} />
                  </span>
                  <span className="prf-stat__value">{stat.value}</span>
                  <span className="prf-stat__label">{stat.label}</span>
                </div>
              ))}
            </div>

            {isOwnProfile && (
              <div className="prf-actions">
                <button type="button" className="prf-btn prf-btn--primary" onClick={() => setIsEditModalOpen(true)}>
                  <FontAwesomeIcon icon={faPen} />
                  {t('profile.editProfile')}
                </button>
                <button
                  type="button"
                  className="prf-btn prf-btn--ghost prf-btn--icon"
                  onClick={() => navigate('/settings')}
                  title={t('common.settings')}
                  aria-label={t('common.settings')}
                >
                  <FontAwesomeIcon icon={faGear} />
                </button>
              </div>
            )}
          </aside>

          <main className="prf-main">
            <header className="prf-main__head">
              <h2 className="prf-main__title">
                {isOwnProfile ? t('profile.myCodeFiles') : t('profile.codeFiles')}
                <span className="prf-main__count">{userCodes.length}</span>
              </h2>
              <div className="prf-main__tools">
                {userCodes.length > 0 && <ViewToggle value={view} onChange={changeView} />}
                {isOwnProfile && (
                  <button type="button" className="prf-btn prf-btn--primary" onClick={() => navigate('/upload')}>
                    <FontAwesomeIcon icon={faPlus} />
                    <span className="prf-btn__text">{t('profile.createNewProject')}</span>
                  </button>
                )}
              </div>
            </header>

            <div className="prf-main__body">
              {userCodes.length === 0 ? (
                <div className="prf-empty">
                  <span className="prf-empty__icon">
                    <FontAwesomeIcon icon={faFileAlt} />
                  </span>
                  <p className="prf-empty__title">{t('profile.noCodeFiles')}</p>
                  <p className="prf-empty__text">{t('profile.noCodeFilesDescription')}</p>
                  {isOwnProfile && (
                    <div className="prf-empty__actions">
                      <button type="button" className="prf-btn prf-btn--primary" onClick={() => navigate('/upload')}>
                        <FontAwesomeIcon icon={faPlus} />
                        {t('profile.createNewProject')}
                      </button>
                      <button type="button" className="prf-btn prf-btn--ghost" onClick={() => navigate('/upload')}>
                        <FontAwesomeIcon icon={faUpload} />
                        {t('profile.importCode')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className={`cdx-grid cdx-grid--${view}`}>
                  {userCodes.map((code, i) => (
                    <CodeTile key={code.id} code={code} index={i} view={view} />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {isOwnProfile && (
        <>
          <EditProfileModal
            isOpen={isEditModalOpen}
            onClose={() => {
              setIsEditModalOpen(false);
              // Reload profile to ensure we have latest data
              loadProfile();
            }}
            user={user}
            onUpdate={(updatedUser) => {
              setUser(updatedUser);
              setCurrentUser((prev) =>
                prev && prev.id === updatedUser.id
                  ? {
                      ...prev,
                      username: updatedUser.username,
                      email: updatedUser.email,
                      bio: updatedUser.bio,
                      avatar: updatedUser.avatar ?? prev.avatar,
                    }
                  : prev
              );
              setIsEditModalOpen(false);
              // Reload profile to ensure consistency
              loadProfile();
            }}
          />
          <ChangeBackgroundModal
            isOpen={isChangeBackgroundModalOpen}
            onClose={() => setIsChangeBackgroundModalOpen(false)}
            user={user}
            onUpdate={async () => {
              await reloadBackground();
              setIsChangeBackgroundModalOpen(false);
            }}
          />
        </>
      )}
    </>
  );
};

export default Profile;
