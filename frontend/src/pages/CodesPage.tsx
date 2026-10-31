import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCodesFeed, useLoadMoreSentinel } from '../hooks/useCodesFeed';
import { useAuth } from '../contexts/AuthContext';
import {
  PlusIcon,
  SearchIcon,
  ListIcon,
  FileIcon,
  XIcon,
  RefreshIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronIcon,
  CodeBracketsIcon,
} from '../components/home/icons';
import { monogram } from '../components/home/monogram';
import UploadModal from '../components/modals/UploadModal';
import CodeTile from '../components/codes/CodeTile';
import SortMenu from '../components/codes/SortMenu';
import ViewToggle from '../components/codes/ViewToggle';
import {
  SortOption,
  ViewMode,
  capitalize,
  readViewMode,
  saveViewMode,
} from '../components/codes/codeUtils';
import './CodesPage.css';

/* Кодтар беті — басты беттің дизайн тілінде: қара фон, монохром палитра,
   сол жақта сүзгілер панелі, оң жақта кодтар панелі. Бет өзі айналмайды —
   тек ішкі тізімдер айналады. */

// Іздеу өрісінде әр әріпке сұрау жібермеу үшін
const SEARCH_DEBOUNCE_MS = 300;

/* ---------- Тіл таңдау картасы ---------- */

interface LanguageOption {
  label: string;
  count: number;
}

const LanguagePicker: React.FC<{
  options: LanguageOption[];
  value: string;
  total: number;
  loading: boolean;
  onChange: (value: string) => void;
}> = ({ options, value, total, loading, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.label.toLowerCase() === value.toLowerCase());

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  // Сыртын басқанда жабылады
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Ашылғанда — таңдалған тілге (болмаса бірінші нұсқаға) фокус
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const target =
      root?.querySelector<HTMLButtonElement>('.cdx-lang__option.is-active') ??
      root?.querySelector<HTMLButtonElement>('.cdx-lang__option');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const choose = (label: string) => {
    onChange(label);
    close(true);
  };

  // ↑/↓ — нұсқалар арасында жүру, Esc — жабу
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.cdx-lang__option') ?? []);
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : idx <= 0 ? items.length - 1 : idx - 1;
    items[next].focus();
  };

  const renderOption = (label: string, display: string, count: number, mono: string) => {
    const active = label ? selected?.label === label : !selected;
    return (
      <button
        key={label || '__all'}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={open ? 0 : -1}
        className={`cdx-lang__option ${active ? 'is-active' : ''}`}
        onClick={() => choose(label)}
      >
        <span className="cdx-mono" aria-hidden="true">
          {mono}
        </span>
        <span className="cdx-lang__name">{display}</span>
        <span className="cdx-lang__count">{count}</span>
        <CheckIcon />
      </button>
    );
  };

  return (
    <div ref={rootRef} className={`cdx-lang ${open ? 'is-open' : ''} ${selected ? 'has-value' : ''}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="cdx-lang__trigger"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="cdx-lang-list"
        aria-label={t('home.filterByLanguage')}
        disabled={loading}
      >
        <span className="cdx-lang__badge" aria-hidden="true">
          {selected ? monogram(selected.label) : <CodeBracketsIcon />}
        </span>
        <span className="cdx-lang__text">
          <span className="cdx-lang__caption">{t('codes.languages')}</span>
          <span className="cdx-lang__value">{selected ? capitalize(selected.label) : t('home.allLanguages')}</span>
        </span>
        <span className="cdx-lang__meta">{selected ? selected.count : options.length}</span>
        <span className="cdx-lang__chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {selected && !open && (
        <button type="button" className="cdx-lang__reset" onClick={() => onChange('')} aria-label={t('home.clearFilters')}>
          <XIcon />
        </button>
      )}

      <div className="cdx-lang__panel" aria-hidden={!open}>
        <div className="cdx-lang__inner">
          <div id="cdx-lang-list" className="cdx-lang__list" role="listbox" aria-label={t('codes.languages')}>
            {renderOption('', t('home.allLanguages'), total, '∗')}
            {options.map((o) => renderOption(o.label, capitalize(o.label), o.count, monogram(o.label)))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------- Бет ---------- */

const CodesPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [view, setView] = useState<ViewMode>(readViewMode);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Іздеу мен тіл сүзгісі URL-да — сілтемемен бөлісуге болады
  const searchQuery = searchParams.get('search') || '';
  const filterLanguage = searchParams.get('lang') || '';
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const updateParam = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  };

  // Сүзгі мен сұрыптау серверде; бір сұрауда 30 жоба, қалғаны айналдырған сайын
  const { codes, hasMore, languages, languagesTotal, loading, loadingMore, error, reload, loadMore } = useCodesFeed(
    { search: debouncedSearch, lang: filterLanguage, sort: sortBy },
    t('home.error')
  );
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading, codes.length);

  useEffect(() => saveViewMode(view), [view]);

  // «/» — іздеуге өту, Esc — іздеуден шығу (GitHub сияқты)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  const hasActiveFilters = Boolean(searchQuery || filterLanguage);
  const isInitialLoading = loading && codes.length === 0;

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  const openUpload = () => (user ? setIsUploadOpen(true) : navigate('/login'));

  return (
    <div className="codes-page">
      <div className="cdx-layout">
        {/* ---------- Сол жақ: сүзгілер панелі ---------- */}
        <aside className="cdx-side" aria-label={t('codes.filters')}>
          <div className="cdx-side__head">
            <span className="cdx-side__badge" aria-hidden="true">
              {'</>'}
            </span>
            <h1 className="cdx-side__title">{t('header.codes')}</h1>
          </div>

          <button type="button" className="cdx-row cdx-row--primary" onClick={openUpload}>
            <span className="cdx-row__slot">
              <PlusIcon />
            </span>
            <span className="cdx-row__label">{t('home.uploadCode')}</span>
          </button>

          <label className="cdx-row cdx-search">
            <span className="cdx-row__slot">
              <SearchIcon />
            </span>
            <input
              ref={searchRef}
              type="search"
              className="cdx-search__input"
              value={searchQuery}
              onChange={(e) => updateParam('search', e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
              placeholder={t('codes.searchPlaceholder')}
              aria-label={t('common.search')}
            />
          </label>

          <div className="cdx-side__scroll">
            <LanguagePicker
              options={languages}
              value={filterLanguage}
              total={languagesTotal}
              loading={isInitialLoading}
              onChange={(lang) => updateParam('lang', lang)}
            />
          </div>

          <Link to="/codes/list" className="cdx-row cdx-row--ghost">
            <span className="cdx-row__slot">
              <ListIcon />
            </span>
            <span className="cdx-row__label">{t('settings.codesList')}</span>
            <span className="cdx-row__arrow" aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </Link>
        </aside>

        {/* ---------- Оң жақ: кодтар панелі ---------- */}
        <main className="cdx-main">
          <header className="cdx-bar">
            <div className="cdx-bar__titles">
              <h2 className="cdx-bar__title">{t('home.explore')}</h2>
            </div>

            <div className="cdx-bar__tools">
              <SortMenu value={sortBy} onChange={setSortBy} />

              <ViewToggle value={view} onChange={setView} />
            </div>
          </header>

          {/* Белсенді сүзгілер — бір басумен алып тастауға болады */}
          {hasActiveFilters && (
            <div className="cdx-pills">
              {searchQuery && (
                <button type="button" className="cdx-pill" onClick={() => updateParam('search', '')}>
                  «{searchQuery}»
                  <XIcon />
                </button>
              )}
              {filterLanguage && (
                <button type="button" className="cdx-pill" onClick={() => updateParam('lang', '')}>
                  {capitalize(filterLanguage)}
                  <XIcon />
                </button>
              )}
              <button type="button" className="cdx-pill cdx-pill--clear" onClick={clearFilters}>
                {t('home.clearFilters')}
              </button>
            </div>
          )}

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
                    {hasActiveFilters ? <SearchIcon /> : <FileIcon size={22} />}
                  </span>
                  <p className="cdx-empty__title">{t('home.noCodes')}</p>
                  <p className="cdx-empty__text">{hasActiveFilters ? t('home.searchParams') : t('home.firstCode')}</p>
                  {hasActiveFilters ? (
                    <button type="button" className="cdx-btn cdx-btn--ghost" onClick={clearFilters}>
                      {t('home.clearFilters')}
                    </button>
                  ) : (
                    <button type="button" className="cdx-btn cdx-btn--primary" onClick={openUpload}>
                      <PlusIcon />
                      {t('home.uploadCode')}
                    </button>
                  )}
                </div>
              )
            ) : (
              <>
                <div className={`cdx-grid cdx-grid--${view} ${loading ? 'is-refreshing' : ''}`}>
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

      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  );
};

export default CodesPage;
