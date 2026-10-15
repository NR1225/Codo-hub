import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUsers,
  faStar,
  faFileAlt,
  faList,
  faSearch,
  faCode,
  faHashtag,
  faPlus,
  faQuoteLeft,
  faXmark,
  faArrowDownWideShort,
} from '@fortawesome/free-solid-svg-icons';
import { CodeFile } from '../utils/api';
import { apiService } from '../utils/api';
import { subscribeToCodes, unsubscribe } from '../utils/realtimeService';
import { isFirestoreBlocked } from '../utils/firebase';
import CodeCard from '../components/CodeCard';
import CodesListModal from '../components/modals/CodesListModal';
import './Home.css';

type SortOption = 'newest' | 'oldest' | 'title' | 'author';

/** Local calendar day → stable index for rotating daily quotes */
function dayIndexForDailyQuote(): number {
  const d = new Date();
  const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).valueOf();
  return Math.floor(localMidnight / 86400000);
}

// Модуль деңгейіндегі кэш: Home-қа қайта оралғанда loading spinner флешы
// көрінбеуі үшін — бұрын жүктелген кодтарды бірден көрсетіп, фонда жаңартамыз.
let homeCachedCodes: CodeFile[] | null = null;
let homeCachedTotal = 0;

const SORT_OPTIONS: { value: SortOption; labelKey: string }[] = [
  { value: 'newest', labelKey: 'home.newest' },
  { value: 'oldest', labelKey: 'home.oldest' },
  { value: 'title', labelKey: 'home.byTitle' },
  { value: 'author', labelKey: 'home.byAuthor' },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const Home: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [codes, setCodes] = useState<CodeFile[]>(homeCachedCodes ?? []);
  const [loading, setLoading] = useState(homeCachedCodes === null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [totalCodesCount, setTotalCodesCount] = useState(homeCachedTotal);
  const [filterLanguage, setFilterLanguage] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isCodesModalOpen, setIsCodesModalOpen] = useState(false);

  // Жаңа жүктеу стратегиясы: жеңілдетілген және тиімді
  const loadCodes = useCallback(async (limit: number = 50, offset: number = 0, retryCount: number = 0): Promise<{ codes: CodeFile[]; total: number } | null> => {
    const MAX_RETRIES = 2;

    try {
      const response = await apiService.getCodeFiles(undefined, limit, offset, false);

      setCodes(response.codes);
      setTotalCodesCount(response.total);
      // Модуль кэшін жаңарту — келесі рет Home-қа кіргенде бірден көрсетуге.
      homeCachedCodes = response.codes;
      homeCachedTotal = response.total;
      setError(null);
      setLoading(false);

      return response;
    } catch (err: any) {
      // Егер желі қатесі болса, қайталау
      if ((err?.message?.includes('timeout') || err?.message?.includes('Failed to fetch') || err?.message?.includes('қосылу')) && retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return loadCodes(limit, offset, retryCount + 1);
      }

      setError(err instanceof Error ? err.message : t('home.error'));
      setLoading(false);
      setCodes([]);
      return null;
    }
  // t is only used for error messages and rarely changes — suppress dep warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeListener: (() => void) | null = null;
    let apiCodesLoaded = false;

    // Негізгі жүктеу функциясы
    const initializeCodes = async () => {
      // Тек бірінші рет жүктегенде spinner көрсету; кэш бар болса — фонда
      // жаңартып, loading флешын жасамау.
      if (homeCachedCodes === null) {
        setLoading(true);
      }

      // API-дан кодтарды жүктеу
      const response = await loadCodes(50, 0);

      if (!isMounted) return;

      if (response && response.codes.length > 0) {
        apiCodesLoaded = true;
      }

      // Real-time listener қосу (тек Firestore блокталмаған болса)
      if (!isFirestoreBlocked()) {
        try {
          unsubscribeListener = subscribeToCodes(
            null,
            (updatedCodes) => {
              if (!isMounted) return;

              if (!apiCodesLoaded && updatedCodes.length > 0) {
                setCodes(updatedCodes);
              }
            },
            (_error: any) => {
              if (!isMounted) return;
            }
          );
        } catch (err) {
          // Real-time listener қатесін елемеу - API деректері пайдаланылады
        }
      }
    };

    initializeCodes();

    return () => {
      isMounted = false;
      if (unsubscribeListener) {
        unsubscribeListener();
        unsubscribe('codes-all');
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Папка жүктелгеннен кейін тізімді жаңарту
    const handleCodesUpdated = () => {
      // Кэшті жою және қайта жүктеу
      apiService.invalidateCodesCache();
      loadCodes(50, 0);
    };

    window.addEventListener('codesUpdated', handleCodesUpdated);

    return () => {
      window.removeEventListener('codesUpdated', handleCodesUpdated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Sync search query with URL params
    const urlSearch = searchParams.get('search') || '';
    setSearchQuery(urlSearch);

    // Егер URL-да іздеу сұрауы болса, барлық кодтарды жүктеу
    if (urlSearch && totalCodesCount === 0 && !loading) {
      setLoading(true);
      loadCodes(1000, 0);
    }
  }, [searchParams, loadCodes]);

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    // Update URL params
    if (value) {
      setSearchParams({ search: value });
      // Іздеу сұрауы болғанда, барлық кодтарды жүктеу (іздеу дұрыс жұмыс істеуі үшін)
      if (totalCodesCount === 0 || codes.length < totalCodesCount) {
        setLoading(true);
        // Барлық кодтарды жүктеу үшін үлкен лимит пайдалану
        await loadCodes(1000, 0);
      }
    } else {
      setSearchParams({});
      // Іздеу сұрауы жойылғанда, тек 50 кодты қалдыру (егер кодтар көп болса)
      if (codes.length > 50) {
        setLoading(true);
        await loadCodes(50, 0);
      }
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Search is already handled by handleSearchChange
  };

  const clearFilters = () => {
    setFilterLanguage('');
    if (searchQuery) {
      setSearchQuery('');
      setSearchParams({});
    }
  };

  const stats = useMemo(() => {
    const languages = new Set(codes.map((code) => code.language));
    const authors = new Set(codes.map((code) => code.author));
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentCodes = codes.filter((code) => new Date(code.createdAt) >= weekAgo).length;

    return {
      totalCodes: Math.max(codes.length, totalCodesCount),
      totalLanguages: languages.size,
      totalAuthors: authors.size,
      recentCodes,
    };
  }, [codes, totalCodesCount]);

  // Тілдер — қолданылу жиілігі бойынша (ең көп қолданылатыны бірінші)
  const languageCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    codes.forEach((code) => {
      const label = code.language?.trim();
      if (!label) return;
      const key = label.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label, count: 1 });
    });
    return Array.from(counts.values()).sort(
      (a, b) => b.count - a.count || a.label.toLowerCase().localeCompare(b.label.toLowerCase())
    );
  }, [codes]);

  const filteredAndSortedCodes = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    const filterLang = filterLanguage.toLowerCase().trim();

    const filtered = codes.filter((code) => {
      const matchesSearch =
        !searchLower ||
        code.title?.toLowerCase().includes(searchLower) ||
        (code.content && code.content.toLowerCase().includes(searchLower)) ||
        code.description?.toLowerCase().includes(searchLower) ||
        code.author?.toLowerCase().includes(searchLower) ||
        code.language?.toLowerCase().includes(searchLower);

      // Папкалар мен файлдар үшін тілді case-insensitive салыстыру
      const matchesLanguage = !filterLang || (code.language || '').toLowerCase().trim() === filterLang;

      return matchesSearch && matchesLanguage;
    });

    const compare = (a: CodeFile, b: CodeFile) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        case 'author':
          return a.author.localeCompare(b.author);
        default:
          return 0;
      }
    };

    // Алдымен папкаларды, содан кейін файлдарды қайтару
    const folders = filtered.filter(code => code.isFolder === true).sort(compare);
    const files = filtered.filter(code => !code.isFolder).sort(compare);
    return [...folders, ...files];
  }, [codes, searchQuery, filterLanguage, sortBy]);

  const dailyMotivationalQuote = useMemo(() => {
    const raw = t('home.motivationalQuotes', { returnObjects: true }) as unknown;
    const quotes = Array.isArray(raw)
      ? raw.filter((q): q is string => typeof q === 'string' && q.length > 0)
      : [];
    if (quotes.length === 0) return '';
    const idx = Math.abs(dayIndexForDailyQuote()) % quotes.length;
    return quotes[idx] ?? quotes[0];
  }, [t, i18n.language]);

  const statTiles = [
    { key: 'codes', icon: faCode, label: t('home.totalCodes'), value: stats.totalCodes },
    { key: 'languages', icon: faHashtag, label: t('home.programmingLanguages'), value: stats.totalLanguages },
    { key: 'authors', icon: faUsers, label: t('home.authors'), value: stats.totalAuthors },
    { key: 'recent', icon: faStar, label: t('home.lastWeek'), value: stats.recentCodes },
  ];

  const hasActiveFilters = Boolean(searchQuery || filterLanguage);
  const isInitialLoading = loading && codes.length === 0;

  return (
    <div className="home-page animate-fade-in">
      {/* Hero */}
      <section className="home-hero">
        <div className="home-hero__content">
          {dailyMotivationalQuote && (
            <p className="home-hero__eyebrow">
              <FontAwesomeIcon icon={faQuoteLeft} />
              {t('home.dailyQuote')}
            </p>
          )}
          <h1 className="home-hero__title">{dailyMotivationalQuote || t('home.title')}</h1>
          <p className="home-hero__subtitle">{t('home.subtitle')}</p>

          <form onSubmit={handleSearchSubmit} className="home-search" role="search">
            <FontAwesomeIcon icon={faSearch} className="home-search__icon" />
            <input
              type="search"
              placeholder={t('common.search')}
              value={searchQuery}
              onChange={handleSearchChange}
              className="home-search__input"
              aria-label={t('common.search')}
            />
          </form>

          <div className="home-hero__actions">
            <Link to="/upload" className="home-btn home-btn--primary">
              <FontAwesomeIcon icon={faPlus} />
              {t('home.uploadCode')}
            </Link>
            <button type="button" onClick={() => setIsCodesModalOpen(true)} className="home-btn home-btn--ghost">
              <FontAwesomeIcon icon={faList} />
              {t('settings.codesList')}
            </button>
          </div>
        </div>

        <ul className="home-stats" aria-label={t('home.globalStats')}>
          {statTiles.map((tile) => (
            <li key={tile.key} className={`home-stat home-stat--${tile.key}`}>
              <span className="home-stat__icon">
                <FontAwesomeIcon icon={tile.icon} />
              </span>
              <span className="home-stat__value">{tile.value}</span>
              <span className="home-stat__label">{tile.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Сүзгілер */}
      <section className="home-toolbar">
        <div className="home-chips" role="group" aria-label={t('home.filterByLanguage')}>
          <button
            type="button"
            className={`home-chip ${!filterLanguage ? 'is-active' : ''}`}
            onClick={() => setFilterLanguage('')}
            aria-pressed={!filterLanguage}
          >
            {t('home.allLanguages')}
          </button>
          {languageCounts.map(({ label, count }) => {
            const active = filterLanguage.toLowerCase() === label.toLowerCase();
            return (
              <button
                key={label}
                type="button"
                className={`home-chip ${active ? 'is-active' : ''}`}
                onClick={() => setFilterLanguage(active ? '' : label)}
                aria-pressed={active}
              >
                {capitalize(label)}
                <span className="home-chip__count">{count}</span>
              </button>
            );
          })}
        </div>

        <label className="home-sort">
          <FontAwesomeIcon icon={faArrowDownWideShort} className="home-sort__icon" />
          <span className="sr-only">{t('home.sortBy')}</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Нәтижелер */}
      <section className="home-results">
        <div className="home-results__head">
          <h2 className="home-results__title">{t('home.explore')}</h2>
          {!isInitialLoading && (
            <span className="home-results__count">
              {t('home.resultsCount', { count: filteredAndSortedCodes.length })}
            </span>
          )}
          {hasActiveFilters && (
            <button type="button" className="home-results__clear" onClick={clearFilters}>
              <FontAwesomeIcon icon={faXmark} />
              {t('home.clearFilters')}
            </button>
          )}
        </div>

        {error && (
          <div className="home-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => window.location.reload()} className="home-btn home-btn--danger">
              {t('home.retry')}
            </button>
          </div>
        )}

        {isInitialLoading ? (
          <div className="home-grid" aria-busy="true" aria-label={t('home.loading')}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="home-skeleton" />
            ))}
          </div>
        ) : filteredAndSortedCodes.length === 0 ? (
          <div className="home-empty">
            <span className="home-empty__icon">
              <FontAwesomeIcon icon={faFileAlt} />
            </span>
            <p className="home-empty__title">{t('home.noCodes')}</p>
            <p className="home-empty__text">
              {hasActiveFilters ? t('home.searchParams') : t('home.firstCode')}
            </p>
            {hasActiveFilters ? (
              <button type="button" className="home-btn home-btn--ghost" onClick={clearFilters}>
                {t('home.clearFilters')}
              </button>
            ) : (
              <Link to="/upload" className="home-btn home-btn--primary">
                <FontAwesomeIcon icon={faPlus} />
                {t('home.uploadCode')}
              </Link>
            )}
          </div>
        ) : (
          <div className={`home-grid ${loading ? 'is-refreshing' : ''}`}>
            {filteredAndSortedCodes.map((code) => (
              <CodeCard key={code.id} code={code} viewMode="grid" />
            ))}
          </div>
        )}
      </section>

      <CodesListModal
        isOpen={isCodesModalOpen}
        onClose={() => setIsCodesModalOpen(false)}
      />
    </div>
  );
};

export default Home;
