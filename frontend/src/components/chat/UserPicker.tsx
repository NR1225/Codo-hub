import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiService, GroupUser } from '../../utils/api';
import { CheckSmallIcon, CloseIcon, SearchIcon, UserPlusIcon } from '../home/icons';
import { monogram } from '../home/monogram';

/* Қолданушыларды іздеп таңдау: топ құру мен мүше қосуда ортақ.
   Кез келген қолданушыны қосуға болады; достар — жылдам ұсыныс ретінде. */

interface UserPickerProps {
  selected: GroupUser[];
  onChange: (users: GroupUser[]) => void;
  /** Тізімде көрсетпеу (мысалы, өзім немесе бұрыннан мүше) */
  excludeIds?: string[];
  suggestions?: GroupUser[];
  autoFocus?: boolean;
}

export const Avatar: React.FC<{ user?: GroupUser | null; className?: string }> = ({ user, className = '' }) => (
  <span className={`cht-avatar ${className}`}>
    {user?.avatar ? <img src={user.avatar} alt={user.username} /> : <span>{monogram(user?.username || '?')}</span>}
  </span>
);

const UserPicker: React.FC<UserPickerProps> = ({ selected, onChange, excludeIds = [], suggestions = [], autoFocus }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupUser[]>([]);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);

  // Іздеу — 350мс кідіріспен; ескі жауаптар жаңасын баспауы үшін реттік нөмір
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++requestRef.current;
    const timer = setTimeout(async () => {
      try {
        const found = await apiService.searchUsers(q);
        if (id === requestRef.current) setResults(found.map((u) => ({ id: u.id, username: u.username, avatar: u.avatar })));
      } catch {
        if (id === requestRef.current) setResults([]);
      } finally {
        if (id === requestRef.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const selectedIds = new Set(selected.map((u) => u.id));
  const hidden = new Set(excludeIds);
  const toggle = (user: GroupUser) =>
    onChange(selectedIds.has(user.id) ? selected.filter((u) => u.id !== user.id) : [...selected, user]);

  const list = (query.trim() ? results : suggestions).filter((u) => !hidden.has(u.id));

  return (
    <div className="cht-picker">
      {selected.length > 0 && (
        <div className="cht-picker__chips">
          {selected.map((u) => (
            <button key={u.id} type="button" className="cht-picker__chip" onClick={() => toggle(u)}>
              <Avatar user={u} className="cht-avatar--xs" />
              <span>{u.username}</span>
              <CloseIcon size={12} />
            </button>
          ))}
        </div>
      )}

      <label className="cht-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('chat.group.searchPeople')}
          aria-label={t('chat.group.searchPeople')}
          autoFocus={autoFocus}
        />
      </label>

      {!query.trim() && suggestions.length > 0 && <h4 className="cht-section">{t('chat.friends')}</h4>}

      <div className="cht-picker__list">
        {searching ? (
          <p className="cht-empty">{t('chat.searching')}</p>
        ) : query.trim() && list.length === 0 ? (
          <p className="cht-empty">{t('chat.group.noResults')}</p>
        ) : (
          list.map((u) => {
            const isSelected = selectedIds.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                className={`cht-item cht-picker__row ${isSelected ? 'is-active' : ''}`}
                onClick={() => toggle(u)}
                aria-pressed={isSelected}
              >
                <Avatar user={u} />
                <span className="cht-item__name">{u.username}</span>
                <span className={`cht-picker__check ${isSelected ? 'is-on' : ''}`} aria-hidden="true">
                  {isSelected ? <CheckSmallIcon size={14} /> : <UserPlusIcon size={14} />}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default UserPicker;
