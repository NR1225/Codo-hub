import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService, CodeFile, CodesQuery } from '../utils/api';
import { isNetworkError } from '../components/codes/codeUtils';

/* Кодтар беттерінің тізімі: бірінші 30 жоба, кейін айналдырған сайын келесі 30-ы (loadMore).
   Сүзгі өзгерсе — басынан жүктеледі. Соңғы нәтиже модуль кэшінде: бетке қайта оралғанда
   жүктелу флешы болмайды. */

type FeedQuery = Omit<CodesQuery, 'offset'>;

interface FeedState {
  codes: CodeFile[];
  total: number;
  hasMore: boolean;
  languages: { label: string; count: number }[];
  languagesTotal: number;
}

const feedCache = new Map<string, FeedState>();
const EMPTY: FeedState = { codes: [], total: 0, hasMore: false, languages: [], languagesTotal: 0 };
const MAX_RETRIES = 2;

export function useCodesFeed(query: FeedQuery, errorText: string) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<FeedState>(() => feedCache.get(key) ?? EMPTY);
  const [loading, setLoading] = useState(!feedCache.has(key));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ескі сүзгінің кешіккен жауабы жаңасын баспауы үшін
  const requestId = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Қатарынан екі шақыру бір бетті екі рет сұрамауы үшін (state әлі жаңармаған болуы мүмкін)
  const moreInFlight = useRef(false);

  const fetchPage = useCallback(async (offset: number, retry = 0): Promise<FeedState | null> => {
    try {
      const page = await apiService.getCodesPage({ ...JSON.parse(key), offset });
      return {
        codes: page.codes,
        total: page.total,
        hasMore: page.hasMore,
        languages: page.languages ?? [],
        languagesTotal: page.languagesTotal ?? page.total,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (isNetworkError(message) && retry < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
        return fetchPage(offset, retry + 1);
      }
      setError(message || errorText);
      return null;
    }
  }, [key, errorText]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const page = await fetchPage(0);
    if (id !== requestId.current) return;
    if (page) {
      setState(page);
      feedCache.set(key, page);
      setError(null);
    }
    setLoading(false);
  }, [fetchPage, key]);

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (moreInFlight.current || loading || !current.hasMore) return;
    moreInFlight.current = true;
    const id = requestId.current;
    setLoadingMore(true);
    const page = await fetchPage(current.codes.length);
    if (id === requestId.current && page) {
      // Арада жаңа жоба қосылса, жылжыған жазба қайталанбауы үшін
      const seen = new Set(current.codes.map((c) => c.id));
      const next = { ...page, codes: [...current.codes, ...page.codes.filter((c) => !seen.has(c.id))] };
      setState(next);
      feedCache.set(key, next);
    }
    moreInFlight.current = false;
    setLoadingMore(false);
  }, [fetchPage, key, loading]);

  // Сүзгі өзгергенде — кэштегісі бірден, сосын серверден жаңасы
  useEffect(() => {
    setState(feedCache.get(key) ?? EMPTY);
    reload();
  }, [key, reload]);

  useEffect(() => {
    const onUpdated = () => {
      apiService.invalidateCodesCache();
      feedCache.clear();
      reload();
    };
    window.addEventListener('codesUpdated', onUpdated);
    return () => window.removeEventListener('codesUpdated', onUpdated);
  }, [reload]);

  return { ...state, loading, loadingMore, error, reload, loadMore };
}

/** Тізімнің соңына жеткенде (айналдыру контейнері ішінде) onVisible шақырылады.
    loaded өзгерген сайын бақылау қайта басталады — белгі әлі көрініп тұрса, келесі бет те жүктеледі */
export function useLoadMoreSentinel(onVisible: () => void, enabled: boolean, loaded: number) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const root = el.closest('.cdx-scroll');
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && callback.current(),
      { root, rootMargin: '0px 0px 600px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, loaded]);

  return ref;
}
