import React, { useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm, LOGOUT_ICON } from '../../contexts/ToastContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCog, 
  faSignOutAlt, 
  faMoon,
  faCloudSun,
  faUser,
  faBook
} from '@fortawesome/free-solid-svg-icons';
import { useTheme } from '../../contexts/ThemeContext';
import './ProfileModal.css';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement>;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, buttonRef }) => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle click outside - must be before any early returns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef?.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, buttonRef]);

  // Calculate position and width for dropdown - must be before any early returns
  useEffect(() => {
    if (isOpen && buttonRef?.current && dropdownRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdown = dropdownRef.current;
      dropdown.style.top = `${rect.bottom + 8}px`;
      dropdown.style.right = `${window.innerWidth - rect.right}px`;
      dropdown.style.width = 'auto';
    }
  }, [isOpen, buttonRef]);

  const handleLogout = async () => {
    const confirmed = await confirm({
      title: t('settings.logoutConfirm'),
      message: t('settings.logoutConfirmMessage'),
      confirmText: t('settings.logout'),
      danger: true,
      icon: LOGOUT_ICON,
    });
    
    if (!confirmed) {
      return;
    }

    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user.email) {
          localStorage.setItem('savedEmail', user.email);
        }
        if (user.username) {
          localStorage.setItem('savedUsername', user.username);
        }
      } catch (err) {
        console.error('Error parsing user data:', err);
      }
    }

    localStorage.removeItem('user');
    // Note: refresh_token is now in HttpOnly cookie, cleared by backend logout endpoint
    onClose();
    window.location.href = '/login';
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    onClose();
  };

  const menuItems = [
    { path: '/notes', label: t('notes.title'), icon: <FontAwesomeIcon icon={faBook} /> },
    { path: '/settings', label: t('sidebar.settings'), icon: <FontAwesomeIcon icon={faCog} /> },
  ];

  const isLoggedIn = !!localStorage.getItem('user');

  const handleProfileClick = () => {
    navigate('/profile');
    onClose();
  };

  // Early return after all hooks
  if (!isOpen) return null;

  return (
    <div 
      ref={dropdownRef}
      className="profile-dropdown"
    >
      <div className="profile-dropdown-content">
        {/* Profile Button */}
        {isLoggedIn && (
          <button
            className={`profile-dropdown-item ${location.pathname === '/profile' ? 'active' : ''}`}
            onClick={handleProfileClick}
          >
            <span className="nav-icon"><FontAwesomeIcon icon={faUser} /></span>
            <span className="nav-label">{t('sidebar.profile')}</span>
          </button>
        )}

        {/* Navigation */}
        {menuItems.map((item) => (
          <button
            key={item.path}
            onClick={() => handleNavClick(item.path)}
            className={`profile-dropdown-item ${location.pathname === item.path ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}

        {/* Divider */}
        <div className="profile-dropdown-divider"></div>

        {/* Theme Toggle */}
        <button
          className="profile-dropdown-item"
          onClick={toggleTheme}
        >
          <span className="theme-icon">
            <FontAwesomeIcon icon={theme === 'light' ? faCloudSun : faMoon} />
          </span>
          <span className="nav-label">
            {theme === 'light' ? t('header.currentThemeLight') : t('header.currentThemeDark')}
          </span>
        </button>

        {/* Logout */}
        {isLoggedIn && (
          <>
            <div className="profile-dropdown-divider"></div>
            <button
              className="profile-dropdown-item logout-item"
              onClick={handleLogout}
            >
              <span className="nav-icon"><FontAwesomeIcon icon={faSignOutAlt} /></span>
              <span className="nav-label">{t('sidebar.logout')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ProfileModal;

