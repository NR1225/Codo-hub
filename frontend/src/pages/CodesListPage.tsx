import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCodesFeed, useLoadMoreSentinel } from '../hooks/useCodesFeed';
import {
  ArrowLeftIcon,
  DatabaseIcon,
  FileIcon,
  FolderIcon,
  GamepadIcon,
  GlobeIcon,
  InfinityIcon,
  LayersIcon,
  MonitorIcon,
  PhoneIcon,
  PlugIcon,
  RefreshIcon,
  SparkleIcon,
} from '../components/home/icons';
import CodeTile from '../components/codes/CodeTile';
import SortMenu from '../components/codes/SortMenu';
import ViewToggle from '../components/codes/ViewToggle';
import { SortOption, ViewMode, readViewMode, saveViewMode } from '../components/codes/codeUtils';
import { CategoryKey, CATEGORIES, categoryFromSlug } from '../utils/codeCategories';
import './CodesPage.css';

/* Кодтар тізімі — бұрынғы модал терезенің орнына бөлек бет.
   Кодтар беті сияқты: сол жақта бөлімдер, оң жақта таңдалған бөлімнің кодтары. */

const CATEGORY_ICONS: Record<CategoryKey, React.ReactNode> = {
  ai: <SparkleIcon />,
  mobile: <PhoneIcon />,
  web: <GlobeIcon />,
  desktop: <MonitorIcon />,
  game: <GamepadIcon />,
  api: <PlugIcon />,
  database: <DatabaseIcon />,
  devops: <InfinityIcon />,
  other: <FolderIcon />,
};

const CodesListPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [view, setView] = useState<ViewMode>(readViewMode);

  // Таңдалған бөлім URL-да — сілтемемен бөлісуге болады
  const active = categoryFromSlug(searchParams.get('section'));

  const selectCategory = (key: CategoryKey | null) => {
    setSearchParams(key ? { section: key } : {}, { replace: true });
  };

  // Бөлім мен сұрыптау серверде; бір сұрауда 30 жоба, қалғаны айналдырған сайын
  const { codes, hasMore, loading, loadingMore, error, reload, loadMore } = useCodesFeed(
    { category: active ?? undefined, sort: sortBy },
    t('home.error')
  );
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading, codes.length);

  useEffect(() => saveViewMode(view), [view]);

  const isInitialLoading = loading && codes.length === 0;
  const activeCategory = CATEGORIES.find((c) => c.key === active);
  const title = activeCategory ? t(activeCategory.labelKey) : t('codes.allSections');

  return (
    <div className="codes-page">
      <div className="cdx-layout">
        {/* ---------- Сол жақ: бөлімдер ---------- */}
        <aside className="cdx-side" aria-label={t('settings.codesList')}>
          <div className="cdx-side__head">
            <Link to="/codes" className="cdx-side__back" aria-label={t('common.back')} title={t('common.back')}>
              <ArrowLeftIcon />
            </Link>
            <h1 className="cdx-side__title">{t('settings.codesList')}</h1>
          </div>

          <div className="cdx-side__scroll">
            <nav className="cdx-cats" aria-label={t('settings.codesList')}>
              <button
                type="button"
                className={`cdx-row cdx-cat ${!active ? 'is-active' : ''}`}
                onClick={() => selectCategory(null)}
                aria-current={!active ? 'page' : undefined}
              >
                <span className="cdx-row__slot">
                  <span className="cdx-cat__icon">
                    <LayersIcon />
                  </span>
                </span>
                <span className="cdx-row__label">{t('codes.allSections')}</span>
              </button>

              {/* Барлық категория — жүктеу терезесіндегі ретпен, «Басқа» ең соңында */}
              {CATEGORIES.map((category, i) => {
                const isActive = active === category.key;
                return (
                  <button
                    key={category.key}
                    type="button"
                    className={`cdx-row cdx-cat ${isActive ? 'is-active' : ''}`}
                    style={{ '--d': i + 1 } as React.CSSProperties}
                    onClick={() => selectCategory(category.key)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="cdx-row__slot">
                      <span className="cdx-cat__icon">{CATEGORY_ICONS[category.key]}</span>
                    </span>
                    <span className="cdx-row__label">{t(category.labelKey)}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* ---------- Оң жақ: бөлімнің кодтары ---------- */}
        <main className="cdx-main">
          <header className="cdx-bar">
            <div className="cdx-bar__titles">
              <h2 className="cdx-bar__title">{title}</h2>
            </div>
            <div className="cdx-bar__tools">
              <SortMenu value={sortBy} onChange={setSortBy} />
              <ViewToggle value={view} onChange={setView} />
            </div>
          </header>

          <div className="cdx-scroll">
            {error && (
              <div className="cdx-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={reload}>
                  <RefreshIcon />
                  {t('home.retry')}
                </button>
              </div>
            )}

            {isInitialLoading ? (
              <div className={`cdx-grid cdx-grid--${view}`} aria-busy="true" aria-label={t('home.loading')}>
                {Array.from({ length: view === 'grid' ? 9 : 8 }).map((_, i) => (
                  <div key={i} className={`cdx-skel cdx-skel--${view}`} />
                ))}
              </div>
            ) : codes.length === 0 ? (
              !error && (
                <div className="cdx-empty">
                  <span className="cdx-empty__icon">
                    <FileIcon size={22} />
                  </span>
                  <p className="cdx-empty__title">{t('home.noCodes')}</p>
                  <p className="cdx-empty__text">{active ? t('settings.noCodesInCategory') : t('settings.noCodesYet')}</p>
                  {active && (
                    <button type="button" className="cdx-btn cdx-btn--ghost" onClick={() => selectCategory(null)}>
                      {t('codes.allSections')}
                    </button>
                  )}
                </div>
              )
            ) : (
              // key — бөлім ауысқанда карталар анимациясы қайта ойнауы үшін
              <>
                <div key={active ?? 'all'} className={`cdx-grid cdx-grid--${view} ${loading ? 'is-refreshing' : ''}`}>
                  {codes.map((code, i) => (
                    <CodeTile key={code.id} code={code} index={i} view={view} />
                  ))}
                </div>
                <div ref={sentinelRef} className="cdx-more">
                  {loadingMore && <span className="cdx-more__spinner" role="status" aria-label={t('home.loading')} />}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default CodesListPage;
