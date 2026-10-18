import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '../utils/api';
import { apiService } from '../utils/api';
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
import { SortOption, ViewMode, compareCodes, isNetworkError, readViewMode, saveViewMode } from '../components/codes/codeUtils';
import { CategoryKey, CATEGORIES, categoryFromSlug, getCategory } from '../utils/codeCategories';
import './CodesPage.css';

/* Кодтар тізімі — бұрынғы модал терезенің орнына бөлек бет.
   Кодтар беті сияқты: сол жақта бөлімдер, оң жақта таңдалған бөлімнің кодтары. */

const ALL_LIMIT = 1000;

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

// Бетке қайта оралғанда жүктелу флешы болмауы үшін
let listCachedCodes: CodeFile[] | null = null;

const CodesListPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [codes, setCodes] = useState<CodeFile[]>(listCachedCodes ?? []);
  const [loading, setLoading] = useState(listCachedCodes === null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [view, setView] = useState<ViewMode>(readViewMode);

  // Таңдалған бөлім URL-да — сілтемемен бөлісуге болады
  const active = categoryFromSlug(searchParams.get('section'));

  const selectCategory = (key: CategoryKey | null) => {
    setSearchParams(key ? { section: key } : {}, { replace: true });
  };

  const loadCodes = useCallback(async (retryCount: number = 0): Promise<void> => {
    const MAX_RETRIES = 2;
    try {
      const response = await apiService.getCodeFiles(undefined, ALL_LIMIT, 0, false);
      setCodes(response.codes);
      listCachedCodes = response.codes;
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (isNetworkError(message) && retryCount < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return loadCodes(retryCount + 1);
      }
      setError(message || t('home.error'));
    } finally {
      setLoading(false);
    }
  // t тек қате мәтіні үшін — тәуелділікке қоспаймыз
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCodes();
    const handleCodesUpdated = () => {
      apiService.invalidateCodesCache();
      loadCodes();
    };
    window.addEventListener('codesUpdated', handleCodesUpdated);
    return () => window.removeEventListener('codesUpdated', handleCodesUpdated);
  }, [loadCodes]);

  useEffect(() => saveViewMode(view), [view]);

  // Жүктеу кезінде таңдалған категория бойынша
  const results = useMemo(() => {
    const list = active ? codes.filter((code) => getCategory(code) === active) : codes;
    return [...list].sort(compareCodes(sortBy));
  }, [active, codes, sortBy]);

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
                <button type="button" onClick={() => loadCodes()}>
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
            ) : results.length === 0 ? (
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
              <div key={active ?? 'all'} className={`cdx-grid cdx-grid--${view}`}>
                {results.map((code, i) => (
                  <CodeTile key={code.id} code={code} index={i} view={view} />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default CodesListPage;
