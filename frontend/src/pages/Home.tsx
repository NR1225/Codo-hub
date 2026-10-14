import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers, faStar, faFileAlt, faList, faSearch, faChevronDown, faChevronRight, faCode, faHashtag } from '@fortawesome/free-solid-svg-icons';
import { CodeFile } from '../utils/api';
import { apiService } from '../utils/api';
import { subscribeToCodes, unsubscribe } from '../utils/realtimeService';
import { isFirestoreBlocked } from '../utils/firebase';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import CodeCard from '../components/CodeCard';
import CodesListModal from '../components/modals/CodesListModal';
import './Home.css';

type SortOption = 'newest' | 'oldest' | 'title' | 'author';
type ViewMode = 'grid' | 'list';

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

const Home: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { config } = useSiteConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [codes, setCodes] = useState<CodeFile[]>(homeCachedCodes ?? []);
  const [loading, setLoading] = useState(homeCachedCodes === null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [totalCodesCount, setTotalCodesCount] = useState(homeCachedTotal);
  const [filterLanguage, setFilterLanguage] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const viewMode: ViewMode = 'grid'; // Default view mode
  const [isCodesModalOpen, setIsCodesModalOpen] = useState(false);
  const [isLanguageSectionExpanded, setIsLanguageSectionExpanded] = useState(false);
  const [isSortSectionExpanded, setIsSortSectionExpanded] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<{ [key: string]: boolean }>({
    'Web': false,
    'Backend': false,
    'Markup': false,
    'Other': false
  });

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
      // Егер кодтар жүктелмеген болса немесе барлық кодтар жүктелмеген болса
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

  const stats = useMemo(() => {
    const totalCodes = codes.length;
    const languages = Array.from(new Set(codes.map((code) => code.language)));
    const authors = Array.from(new Set(codes.map((code) => code.author)));
    const recentCodes = codes.filter((code) => {
      const codeDate = new Date(code.createdAt);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return codeDate >= weekAgo;
    }).length;

    return {
      totalCodes,
      totalLanguages: languages.length,
      totalAuthors: authors.length,
      recentCodes,
    };
  }, [codes]);

  const filteredAndSortedCodes = useMemo(() => {
    let filtered = codes.filter((code) => {
      // Іздеу сұрауын тексеру (Header-дан келген)
      if (!searchQuery) {
        // Іздеу сұрауы жоқ болса, барлық кодтарды қайтару
        return true;
      }
      
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = 
        code.title?.toLowerCase().includes(searchLower) ||
        (code.content && code.content.toLowerCase().includes(searchLower)) ||
        code.description?.toLowerCase().includes(searchLower) ||
        code.author?.toLowerCase().includes(searchLower) ||
        code.language?.toLowerCase().includes(searchLower);
      
      // Тіл фильтрін тексеру
      let matchesLanguage = true;
      if (filterLanguage) {
        // Папкалар мен файлдар үшін тілді case-insensitive салыстыру
        const codeLang = (code.language || '').toLowerCase().trim();
        const filterLang = filterLanguage.toLowerCase().trim();
        matchesLanguage = codeLang === filterLang;
      }
      
      return matchesSearch && matchesLanguage;
    });

    // Папкалар мен файлдарды ажырату
    const folders = filtered.filter(code => code.isFolder === true);
    const files = filtered.filter(code => !code.isFolder);

    // Папкаларды сұрыптау
    folders.sort((a, b) => {
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
    });

    // Файлдарды сұрыптау
    files.sort((a, b) => {
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
    });

    // Алдымен папкаларды, содан кейін файлдарды қайтару
    return [...folders, ...files];
  }, [codes, searchQuery, filterLanguage, sortBy]);

  // Барлық кодтардың тілдерін алу (папкалар мен файлдар)
  const allLanguages = Array.from(
    new Set(
      codes
        .filter((code) => code.language && code.language.trim()) // language жоқ кодтарды елемеу
        .map((code) => code.language.trim()) // Бастапқы түрінде сақтау
    )
  ).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); // Алфавит бойынша сұрыптау (case-insensitive)

  // Тілдерді категорияларға бөлу
  const languageCategories = useMemo(() => {
    // Категорияларды бэкенд конфигурациясынан алу, жоқ болса fallback
    const defaultCategories: { [key: string]: string[] } = {
      'Web': ['html', 'css', 'javascript', 'typescript'],
      'Backend': ['python', 'java', 'cpp', 'c'],
      'Markup': ['json', 'markdown'],
      'Other': []
    };
    const categories: { [key: string]: string[] } = config?.languageCategories
      ? Object.fromEntries(
          Object.entries(config.languageCategories).map(([key, langs]) => [key, [...langs]])
        )
      : defaultCategories;

    // Барлық тілдерді категорияларға бөлу
    allLanguages.forEach(lang => {
      const langLower = lang.toLowerCase();
      let found = false;

      for (const [category, langs] of Object.entries(categories)) {
        if (category !== 'Other' && langs.includes(langLower)) {
          found = true;
          break;
        }
      }

      if (!found) {
        categories['Other'].push(lang);
      }
    });

    // Бос категорияларды алып тастау
    return Object.entries(categories)
      .filter(([_, langs]) => langs.length > 0)
      .map(([category, langs]) => ({
        category,
        languages: langs.map(l => allLanguages.find(al => al.toLowerCase() === l.toLowerCase()) || l)
      }));
  }, [allLanguages, config?.languageCategories]);

  const dailyMotivationalQuote = useMemo(() => {
    const raw = t('home.motivationalQuotes', { returnObjects: true }) as unknown;
    const quotes = Array.isArray(raw)
      ? raw.filter((q): q is string => typeof q === 'string' && q.length > 0)
      : [];
    if (quotes.length === 0) return '';
    const idx = Math.abs(dayIndexForDailyQuote()) % quotes.length;
    return quotes[idx] ?? quotes[0];
  }, [t, i18n.language]);

  if (loading) {
    return (
      <div className="w-full max-w-[1400px] m-0 px-3 py-4 sm:p-6 animate-fade-in mx-auto">
        <div className="loading-spinner" style={{ minHeight: '320px', padding: '4rem' }}>
          <div className="spinner"></div>
          <p className="text-text-secondary text-lg font-medium">{t('home.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] m-0 px-3 py-4 sm:p-6 animate-fade-in box-border mx-auto">
      <div className="flex gap-4 sm:gap-8 max-w-[1400px] mx-auto items-start lg:flex-row flex-col">
        {/* Сол жақ меню */}
        <aside className="w-[280px] flex-shrink-0 p-6 sticky top-5 max-h-[calc(100vh-40px)] overflow-y-auto overflow-x-hidden lg:w-[280px] w-full lg:relative lg:top-0 lg:max-h-none">
          <div className="mb-6 pb-4 border-b-[1.5px] border-border">
            <h2 className="text-xm m-0 text-primary font-black tracking-[0px]">
              {dailyMotivationalQuote}
            </h2>
          </div>
          <div className="flex flex-col gap-2">
            {/* Статистика */}
            <div className="flex flex-col gap-4 mt-8">
              {/* Жалпы кодтар */}
              <div className="stat-widget stat-widget--codes">
                <div className="stat-widget-body">
                  <div className="stat-widget-icon stat-widget-icon--codes">
                    <FontAwesomeIcon icon={faCode} />
                  </div>
                  <div className="stat-widget-info">
                    <div className="stat-widget-label">{t('home.totalCodes')}</div>
                    <div className="stat-widget-value">{stats.totalCodes}</div>
                  </div>
                </div>
                <div className="stat-widget-chart" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className="stat-chart-bar"
                      style={{ '--bar-height': `${35 + Math.random() * 65}%` } as React.CSSProperties }
                    />
                  ))}
                </div>
              </div>

              {/* Бағдарламалау тілдері */}
              <div className="stat-widget stat-widget--languages">
                <div className="stat-widget-body">
                  <div className="stat-widget-icon stat-widget-icon--languages">
                    <FontAwesomeIcon icon={faHashtag} />
                  </div>
                  <div className="stat-widget-info">
                    <div className="stat-widget-label">{t('home.programmingLanguages')}</div>
                    <div className="stat-widget-value">{stats.totalLanguages}</div>
                  </div>
                </div>
                <div className="stat-widget-chart" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className="stat-chart-bar"
                      style={{ '--bar-height': `${35 + Math.random() * 65}%` } as React.CSSProperties }
                    />
                  ))}
                </div>
              </div>

              {/* Авторлар */}
              <div className="stat-widget stat-widget--authors">
                <div className="stat-widget-body">
                  <div className="stat-widget-icon stat-widget-icon--authors">
                    <FontAwesomeIcon icon={faUsers} />
                  </div>
                  <div className="stat-widget-info">
                    <div className="stat-widget-label">{t('home.authors')}</div>
                    <div className="stat-widget-value">{stats.totalAuthors}</div>
                  </div>
                </div>
                <div className="stat-widget-chart" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className="stat-chart-bar"
                      style={{ '--bar-height': `${35 + Math.random() * 65}%` } as React.CSSProperties }
                    />
                  ))}
                </div>
              </div>

              {/* Соңғы аптада */}
              <div className="stat-widget stat-widget--recent">
                <div className="stat-widget-body">
                  <div className="stat-widget-icon stat-widget-icon--recent">
                    <FontAwesomeIcon icon={faStar} />
                  </div>
                  <div className="stat-widget-info">
                    <div className="stat-widget-label">{t('home.lastWeek')}</div>
                    <div className="stat-widget-value">{stats.recentCodes}</div>
                  </div>
                </div>
                <div className="stat-widget-chart stat-widget-chart--line" aria-hidden="true">
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="stat-chart-svg">
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={Array.from({ length: 8 })
                        .map((_, i) => `${i * 14 + 5},${30 - Math.random() * 22}`)
                        .join(' ')}
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Тіл фильтрі */}
            <div className="flex flex-col">
              <button
                onClick={() => setIsLanguageSectionExpanded(!isLanguageSectionExpanded)}
                className="flex items-center gap-2 text-base font-bold text-text-primary m-0 mb-4 uppercase tracking-wider hover:text-primary transition-colors cursor-pointer text-left"
              >
                <FontAwesomeIcon 
                  icon={isLanguageSectionExpanded ? faChevronDown : faChevronRight} 
                  className="text-sm transition-transform"
                />
                {t('home.language')}
                {filterLanguage && (
                  <span className="text-sm font-normal normal-case text-primary ml-1">
                    ({filterLanguage.charAt(0).toUpperCase() + filterLanguage.slice(1)})
                  </span>
                )}
              </button>
              {isLanguageSectionExpanded && (
              <div className="flex flex-col gap-4">
                {languageCategories.map(({ category, languages: categoryLanguages }) => {
                  const isExpanded = expandedCategories[category] ?? true;
                  return (
                    <div key={category} className="flex flex-col gap-2">
                      <button
                        onClick={() => setExpandedCategories(prev => ({
                          ...prev,
                          [category]: !isExpanded
                        }))}
                        className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 py-1 hover:text-text-primary transition-colors cursor-pointer"
                      >
                        <FontAwesomeIcon 
                          icon={isExpanded ? faChevronDown : faChevronRight} 
                          className="text-xs transition-transform"
                        />
                        {category}
                      </button>
                      {isExpanded && (
                        <div className="flex flex-col gap-2">
                          {categoryLanguages.map((lang) => (
                            <button
                              key={lang}
                              className={`px-4 py-3 bg-bg-primary border-[1.5px] border-border rounded-[10px] text-text-primary font-semibold text-sm cursor-pointer transition-all text-left hover:bg-bg-hover hover:border-primary hover:translate-x-1 ${
                                filterLanguage === lang 
                                  ? 'bg-primary-light border-primary text-primary shadow-glow' 
                                  : ''
                              }`}
                              onClick={() => setFilterLanguage(lang)}
                            >
                              {lang.charAt(0).toUpperCase() + lang.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>

            {/* Сұрыптау */}
            <div className="flex flex-col">
              <button
                onClick={() => setIsSortSectionExpanded(!isSortSectionExpanded)}
                className="flex items-center gap-2 text-base font-bold text-text-primary m-0 mb-4 uppercase tracking-wider hover:text-primary transition-colors cursor-pointer text-left"
              >
                <FontAwesomeIcon 
                  icon={isSortSectionExpanded ? faChevronDown : faChevronRight} 
                  className="text-sm transition-transform"
                />
                {t('home.sortBy')}
              </button>
              {isSortSectionExpanded && (
              <div className="flex flex-col gap-2">
                <button
                  className={`px-4 py-3 bg-bg-primary border-[1.5px] border-border rounded-[10px] text-text-primary font-semibold text-sm cursor-pointer transition-all text-left hover:bg-bg-hover hover:border-primary hover:translate-x-1 ${
                    sortBy === 'newest' 
                      ? 'bg-primary-light border-primary text-primary shadow-glow' 
                      : ''
                  }`}
                  onClick={() => setSortBy('newest')}
                >
                  {t('home.newest')}
                </button>
                <button
                  className={`px-4 py-3 bg-bg-primary border-[1.5px] border-border rounded-[10px] text-text-primary font-semibold text-sm cursor-pointer transition-all text-left hover:bg-bg-hover hover:border-primary hover:translate-x-1 ${
                    sortBy === 'oldest' 
                      ? 'bg-primary-light border-primary text-primary shadow-glow' 
                      : ''
                  }`}
                  onClick={() => setSortBy('oldest')}
                >
                  {t('home.oldest')}
                </button>
                <button
                  className={`px-4 py-3 bg-bg-primary border-[1.5px] border-border rounded-[10px] text-text-primary font-semibold text-sm cursor-pointer transition-all text-left hover:bg-bg-hover hover:border-primary hover:translate-x-1 ${
                    sortBy === 'title' 
                      ? 'bg-primary-light border-primary text-primary shadow-glow' 
                      : ''
                  }`}
                  onClick={() => setSortBy('title')}
                >
                  {t('home.byTitle')}
                </button>
                <button
                  className={`px-4 py-3 bg-bg-primary border-[1.5px] border-border rounded-[10px] text-text-primary font-semibold text-sm cursor-pointer transition-all text-left hover:bg-bg-hover hover:border-primary hover:translate-x-1 ${
                    sortBy === 'author' 
                      ? 'bg-primary-light border-primary text-primary shadow-glow' 
                      : ''
                  }`}
                  onClick={() => setSortBy('author')}
                >
                  {t('home.byAuthor')}
                </button>
              </div>
              )}
            </div>
          </div>
        </aside>

        {/* Оң жақ контент */}
        <main className="flex-1 min-w-0 flex flex-col gap-8 max-h-[calc(100vh-40px)] overflow-y-auto overflow-x-hidden lg:max-h-none">

          {/* Іздеу және басқару элементтері */}
          <div className="flex flex-col gap-6 mb-8 p-3 sm:p-6 md:p-8 pt-2 overflow-visible w-full max-w-none box-border">
            <div className="sticky top-[1px] z-10 bg-bg-secondary mx-auto px-3 sm:px-6 lg:px-8 pt-2 pb-4 mb-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 flex-shrink-0 w-full max-w-full sm:w-auto sm:max-w-fit relative rounded-2xl overflow-visible border border-border sm:justify-center">
              {/* Бірінші баған: Кодтар тізімі батырмасы */}
              <div className="flex items-center gap-4 flex-shrink-0 overflow-visible w-full sm:w-auto justify-center sm:justify-start">
                <button
                  onClick={() => setIsCodesModalOpen(true)}
                  className="px-4 sm:px-6 h-[44px] rounded-[10.2px] bg-bg-primary border-[1.3px] border-border text-text-primary font-semibold text-sm sm:text-base flex items-center gap-2 hover:bg-bg-secondary hover:border-primary hover:-translate-y-[1.3px] hover:shadow-md transition-all whitespace-nowrap w-full sm:w-auto min-w-0 sm:min-w-fit sm:pr-7 justify-center"
                >
                  <FontAwesomeIcon icon={faList} className="flex-shrink-0" />
                  <span className="whitespace-nowrap">{t('settings.codesList')}</span>
                </button>
              </div>
              {/* Екінші баған: Іздеу */}
              <form onSubmit={handleSearchSubmit} className="flex-1 min-w-0 w-full sm:min-w-[160px] relative sm:max-w-[400px] flex items-center">
                <div className="relative w-full">
                  <input
                    type="text"
                    placeholder={t('common.search')}
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="w-full px-4 h-[44px] pl-11 border border-border rounded-lg bg-bg-primary text-text-primary text-base transition-all font-medium focus:outline-none focus:border-primary"
                  />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl pointer-events-none z-10 text-text-secondary transition-all">
                    <FontAwesomeIcon icon={faSearch} />
                  </span>
                </div>
              </form>
            </div>

            {error && (
              <div className="bg-gradient-to-br from-[rgba(255,107,107,0.15)] to-[rgba(251,191,36,0.1)] text-error p-6 rounded-[10.2px] mb-8 flex justify-between items-center border-[1.3px] border-[rgba(255,107,107,0.3)] shadow-[0_2.6px_10.2px_rgba(255,107,107,0.15)] animate-shake">
                <span>{error}</span>
                <button 
                  onClick={() => window.location.reload()} 
                  className="bg-gradient-to-br from-error to-[#dc2626] text-white px-6 py-3 rounded-[7.7px] cursor-pointer font-semibold transition-all shadow-[0_2.6px_7.7px_rgba(255,107,107,0.3)] text-sm hover:bg-gradient-to-br hover:from-[#dc2626] hover:to-[#b91c1c] hover:-translate-y-[1.3px] hover:shadow-[0_3.8px_12.8px_rgba(255,107,107,0.4)] focus-visible:outline focus-visible:outline-[1.3px] focus-visible:outline-error focus-visible:outline-offset-[1.3px] focus-visible:bg-gradient-to-br focus-visible:from-[#dc2626] focus-visible:to-[#b91c1c] active:translate-y-0"
                >
                  {t('home.retry')}
                </button>
              </div>
            )}

            {loading ? (
              <div className="text-center">{t('common.loading')}</div>
            ) : filteredAndSortedCodes.length === 0 ? (
              <div className="text-center py-20 px-8 text-text-secondary empty-state-bg rounded-[15.4px] border-[1.3px] border-dashed border-primary my-8 animate-fade-in shadow-glow">
                <p className="text-5xl m-0 mb-6 inline-block animate-bounce drop-shadow-[0_2.6px_5.1px_rgba(0,0,0,0.1)]">
                  <FontAwesomeIcon icon={faFileAlt} />
                </p>
                <p className="text-2xl font-bold bg-accent-gradient bg-clip-text text-transparent m-0 mb-4 tracking-[-0.32px]">
                  {t('home.noCodes')}
                </p>
                <p className="text-lg m-0 opacity-80 leading-relaxed max-w-[320px] mx-auto">
                  {searchQuery || filterLanguage
                    ? t('home.searchParams')
                    : t('home.firstCode')}
                </p>
              </div>
            ) : (
              <div className="animate-fade-in flex flex-col gap-7 w-full max-w-full overflow-x-hidden overflow-y-auto box-border max-h-[680px] pr-3 pb-4">
                {filteredAndSortedCodes.map((code) => (
                  <CodeCard 
                    key={code.id} 
                    code={code} 
                    viewMode={viewMode}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
      <CodesListModal 
        isOpen={isCodesModalOpen} 
        onClose={() => setIsCodesModalOpen(false)} 
      />
    </div>
  );
};

export default Home;