import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpIcon, FolderIcon, PlusIcon, SearchIcon, StarIcon } from './icons';
import { SideToggleIcon } from '../chat/SideIcons';
import { monogram } from './monogram';

/** Бүгінгі күннің реттік нөмірі (жергілікті уақыт) — сөз күн сайын ауысады */
function dayIndex(): number {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}
import './HomeSidebar.css';

/* Басты беттегі жобалар sidebar-ы — қалқымалы панель.
   Әр жол бірдей құрылымда: сол жақта 40px белгіше ұяшығы, оң жақта мәтін.
   Жабылғанда тек ен кішірейеді — белгішелер орнынан қозғалмай, бірдей шаршыларға айналады. */

export interface SidebarItem {
  key: string;
  title: string;
  /** Папка-жоба — әріптің орнына папка белгішесі */
  isFolder?: boolean;
  /** Басқаның жобасы — мүше болып қосылғанмын */
  joined?: boolean;
  /** Жұлдыз қойылған — тізімнің басында тұрады */
  starred?: boolean;
  /** Жоқ болса — жұлдыз батырмасы көрсетілмейді */
  onToggleStar?: () => void;
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
  const listRef = useRef<HTMLElement>(null);
  const [showTop, setShowTop] = useState(false);

  // Тақырып орнындағы қысқа сөз — күн сайын басқасы
  const tips = t('home.dailyTips', { returnObjects: true }) as unknown;
  const dailyTip =
    Array.isArray(tips) && tips.length > 0 ? String(tips[dayIndex() % tips.length]) : t('home.projects');

  // Ашылып-жабылғанда ескі кеңес қалып қоймасын
  useEffect(() => setTip(null), [collapsed]);

  const handleListScroll = () => {
    setTip(null);
    setShowTop((listRef.current?.scrollTop ?? 0) > 120);
  };

  const scrollListToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
            <SideToggleIcon />
          </span>
        </button>
        <p className="hsb__tagline hsb__label" title={dailyTip}>
          {dailyTip}
        </p>
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

          {/* «Жобалар» тақырыбы — іздеудің астында, тізімнің үстінде (ашық күйде) */}
          <h2 className="hsb__title hsb__label" style={{ '--d': 3 } as React.CSSProperties}>
            {t('home.projects')}
            <span className="hsb__count">{items.length}</span>
          </h2>

          {error && (
            <div className="hsb__error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={onRetry}>
                {t('home.retry')}
              </button>
            </div>
          )}

          <div className="hsb__list-wrap">
          <nav className="hsb__list" ref={listRef} onScroll={handleListScroll}>
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
              items.map((item, i) => {
                const tipText = item.joined ? `${item.title} · ${t('home.joinedProject')}` : item.title;
                const starLabel = item.starred ? t('home.unstarProject') : t('home.starProject');
                return (
                  <div
                    key={item.key}
                    className={`hsb__entry ${item.starred ? 'is-starred' : ''}`}
                    // Кезекпен анимация үшін реттік нөмір
                    style={{ '--d': 4 + Math.min(i, 10) } as React.CSSProperties}
                  >
                    <button type="button" className="hsb__row hsb__item" onClick={item.onOpen} data-tip={tipText}>
                      <span className="hsb__slot">
                        <span className="hsb__mono" aria-hidden="true">
                          {item.isFolder ? <FolderIcon size={15} /> : monogram(item.title)}
                        </span>
                        {item.starred && (
                          <span className="hsb__star-badge" aria-hidden="true">
                            <StarIcon filled size={9} />
                          </span>
                        )}
                      </span>
                      <span className="hsb__label">
                        {item.title}
                        {item.joined && <span className="hsb__tag">{t('home.joinedProject')}</span>}
                      </span>
                    </button>
                    {item.onToggleStar && (
                      <button
                        type="button"
                        className="hsb__star"
                        onClick={item.onToggleStar}
                        aria-pressed={!!item.starred}
                        aria-label={`${starLabel}: ${item.title}`}
                        title={starLabel}
                      >
                        <StarIcon filled={item.starred} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </nav>

          {/* Төмен түскенде — «Жобалар» басына қайтаратын жебе */}
          <button
            type="button"
            className={`hsb__to-top ${showTop && !collapsed ? 'is-visible' : ''}`}
            onClick={scrollListToTop}
            aria-label={t('home.projects')}
            title={t('home.projects')}
            tabIndex={showTop && !collapsed ? 0 : -1}
          >
            <ArrowUpIcon />
          </button>
          </div>
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
