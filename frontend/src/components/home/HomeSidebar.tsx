import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PanelIcon, PlusIcon, SearchIcon } from './icons';
import { monogram } from './monogram';
import './HomeSidebar.css';

/* Басты беттегі жобалар sidebar-ы — қалқымалы панель.
   Әр жол бірдей құрылымда: сол жақта 40px белгіше ұяшығы, оң жақта мәтін.
   Жабылғанда тек ен кішірейеді — белгішелер орнынан қозғалмай, бірдей шаршыларға айналады. */

export interface SidebarItem {
  key: string;
  title: string;
  onOpen: () => void;
}

interface HomeSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Жабық күйде іздеуді басқанда — sidebar ашылады */
  onExpand: () => void;
  items: SidebarItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: () => void;
  emptyText: string;
}

interface Tip {
  text: string;
  top: number;
  left: number;
}

const HomeSidebar: React.FC<HomeSidebarProps> = ({
  collapsed,
  onToggle,
  onExpand,
  items,
  loading,
  error,
  onRetry,
  query,
  onQueryChange,
  onAdd,
  emptyText,
}) => {
  const { t } = useTranslation();
  const [tip, setTip] = useState<Tip | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Ашылып-жабылғанда ескі кеңес қалып қоймасын
  useEffect(() => setTip(null), [collapsed]);

  // Жабық күйде мәтін жоқ — атауды оң жақта қалқымалы кеңеспен көрсетеміз
  const showTip = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
    if (!collapsed || !el || !window.matchMedia('(min-width: 901px)').matches) {
      setTip(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const asideRight = asideRef.current?.getBoundingClientRect().right ?? rect.right;
    setTip({ text: el.dataset.tip ?? '', top: rect.top + rect.height / 2, left: asideRight + 10 });
  };

  const toggleLabel = collapsed ? t('home.sidebarOpen') : t('home.sidebarClose');

  return (
    <aside
      ref={asideRef}
      id="home-sidebar"
      className={`hsb ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={t('home.projects')}
      onMouseOver={(e) => showTip(e.target)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => showTip(e.target)}
      onBlur={() => setTip(null)}
    >
      <div className="hsb__head">
        <button
          type="button"
          className="hsb__row hsb__toggle"
          style={{ '--d': 0 } as React.CSSProperties}
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="home-sidebar-body"
          aria-label={toggleLabel}
          aria-keyshortcuts="Control+B"
          data-tip={`${toggleLabel} · Ctrl+B`}
        >
          <span className="hsb__slot">
            <PanelIcon />
          </span>
        </button>
        <h2 className="hsb__title hsb__label">
          {t('home.projects')}
          <span className="hsb__count">{items.length}</span>
        </h2>
      </div>

      <div id="home-sidebar-body" className="hsb__body">
        <div className="hsb__inner">
          <button
            type="button"
            className="hsb__row hsb__row--primary"
            onClick={onAdd}
            data-tip={t('home.addProject')}
            style={{ '--d': 1 } as React.CSSProperties}
          >
            <span className="hsb__slot">
              <PlusIcon />
            </span>
            <span className="hsb__label">{t('home.addProject')}</span>
          </button>

          <label
            className="hsb__row hsb__search"
            data-tip={t('home.searchProjects')}
            style={{ '--d': 2 } as React.CSSProperties}
          >
            <span className="hsb__slot">
              <SearchIcon />
            </span>
            <input
              type="search"
              className="hsb__input hsb__label"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={onExpand}
              placeholder={t('home.searchProjects')}
              aria-label={t('home.searchProjects')}
            />
          </label>

          <div className="hsb__divider" role="separator" style={{ '--d': 3 } as React.CSSProperties} />

          {error && (
            <div className="hsb__error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={onRetry}>
                {t('home.retry')}
              </button>
            </div>
          )}

          <nav className="hsb__list" onScroll={() => setTip(null)}>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="hsb__skeleton">
                  <span />
                  <span />
                </div>
              ))
            ) : items.length === 0 ? (
              <p className="hsb__empty">{emptyText}</p>
            ) : (
              items.map((item, i) => (
                <button
                  key={item.key}
                  type="button"
                  className="hsb__row hsb__item"
                  onClick={item.onOpen}
                  data-tip={item.title}
                  // Кезекпен анимация үшін реттік нөмір
                  style={{ '--d': 4 + Math.min(i, 10) } as React.CSSProperties}
                >
                  <span className="hsb__slot">
                    <span className="hsb__mono" aria-hidden="true">
                      {monogram(item.title)}
                    </span>
                  </span>
                  <span className="hsb__label">{item.title}</span>
                </button>
              ))
            )}
          </nav>
        </div>
      </div>

      {tip &&
        createPortal(
          <div className="hsb-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
            {tip.text}
          </div>,
          document.body
        )}
    </aside>
  );
};

export default HomeSidebar;
