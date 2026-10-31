import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '../utils/api';
import { apiService } from '../utils/api';
import { subscribeToCodes, unsubscribe } from '../utils/realtimeService';
import { isFirestoreBlocked } from '../utils/firebase';
import { useAuth } from '../contexts/AuthContext';
import HomeStories from '../components/home/HomeStories';
import SiteAI from '../components/home/SiteAI';
import { VIBE_PROJECTS_EVENT } from '../utils/burkitProjectTools';
import HomeSidebar from '../components/home/HomeSidebar';
import UploadModal from '../components/modals/UploadModal';
import './Home.css';

// Модуль деңгейіндегі кэш: Home-қа қайта оралғанда loading флешы
// көрінбеуі үшін — бұрын жүктелген кодтарды бірден көрсетіп, фонда жаңартамыз.
let homeCachedCodes: CodeFile[] | null = null;

const SIDEBAR_STORAGE_KEY = 'kh-home-sidebar-collapsed';

// Vibecoding жобалары серверде тек иесінде — оларға қойылған жұлдыз браузерде сақталады
const VIBE_STARS_KEY = 'kh-home-vibe-stars';

function readVibeStars(userId?: string): string[] {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(`${VIBE_STARS_KEY}:${userId}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// Vibecoding беті жобаларды осы кілтпен localStorage-қа сақтайды
const VIBECODING_STORAGE_KEY = 'vibecoding_state';

interface VibecodingProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

// Браузердегі көшірме басқа қолданушынікі болса — көрсетпейміз
function readVibecodingProjects(userId?: string): VibecodingProjectSummary[] {
  try {
    const raw = localStorage.getItem(VIBECODING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { ownerId?: string; projects?: { id: string; name: string; updatedAt?: string; createdAt?: string }[] };
    if (parsed.ownerId && parsed.ownerId !== userId) return [];
    return (parsed.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt || p.createdAt || '',
    }));
  } catch {
    return [];
  }
}

type SidebarProject =
  | { kind: 'repo'; id: string; date: string; starred: boolean; code: CodeFile }
  | { kind: 'vibe'; id: string; date: string; starred: boolean; project: VibecodingProjectSummary };

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const Home: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [codes, setCodes] = useState<CodeFile[]>(homeCachedCodes ?? []);
  const [error, setError] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [vibeProjects, setVibeProjects] = useState<VibecodingProjectSummary[]>(() => readVibecodingProjects(user?.id));
  // Sidebar: өз жобаларым + қосылған жобалар (жалпы лентадағы 50 кодқа тәуелсіз)
  const [myProjects, setMyProjects] = useState<CodeFile[]>([]);
  const [myProjectsLoading, setMyProjectsLoading] = useState(!!user);
  const [vibeStars, setVibeStars] = useState<string[]>(() => readVibeStars(user?.id));

  const loadMyProjects = useCallback(() => {
    if (!user) {
      setMyProjects([]);
      setMyProjectsLoading(false);
      return;
    }
    apiService
      .getMyProjects()
      .then(setMyProjects)
      .catch(() => {
        // Ескі сервер: жалпы тізімнен тек өз жобаларым
        setMyProjects(homeCachedCodes?.filter((c) => !c.folderId && c.author === user.username) ?? []);
      })
      .finally(() => setMyProjectsLoading(false));
  }, [user]);

  useEffect(() => {
    loadMyProjects();
    window.addEventListener('codesUpdated', loadMyProjects);
    return () => window.removeEventListener('codesUpdated', loadMyProjects);
  }, [loadMyProjects]);

  useEffect(() => setVibeStars(readVibeStars(user?.id)), [user?.id]);

  // Vibecoding жобалары серверден (тек өзімдікі); сервер қолжетімсіз болса — браузердегі көшірме.
  // Бүркіт жоба жасаса/өшірсе (VIBE_PROJECTS_EVENT) — тізім қайта жүктеледі
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = () => {
      apiService
        .getVibecodingProjects()
        .then((list) => {
          if (cancelled) return;
          setVibeProjects(
            list.map((p) => ({
              id: p.id,
              name: p.name,
              updatedAt: p.updatedAt || p.createdAt,
            }))
          );
        })
        .catch(() => {
          // localStorage-тағы тізім қалады
        });
    };
    load();
    window.addEventListener(VIBE_PROJECTS_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(VIBE_PROJECTS_EVENT, load);
    };
  }, [user]);

  // Басқа қойындыда Vibecoding өзгерсе — тізімді жаңарту
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === VIBECODING_STORAGE_KEY) setVibeProjects(readVibecodingProjects(user?.id));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id]);

  // Күйді сақтау — келесі кіргенде sidebar сол күйінде ашылады
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // localStorage қолжетімсіз болса — елемеу
    }
  }, [sidebarCollapsed]);

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  // Ctrl+B (Mac-та ⌘B) — VS Code сияқты sidebar-ды ашу/жабу
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // e.code — перненің орны: қазақ/орыс тілінде тұрса да (e.key === 'и') жұмыс істейді
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !e.repeat && e.code === 'KeyB') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadCodes = useCallback(async (retryCount: number = 0): Promise<CodeFile[] | null> => {
    const MAX_RETRIES = 2;

    try {
      const response = await apiService.getCodesPage();
      setCodes(response.codes);
      homeCachedCodes = response.codes;
      setError(null);
      return response.codes;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // Желі қатесі болса, қайталау
      if ((message.includes('timeout') || message.includes('Failed to fetch') || message.includes('қосылу')) && retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return loadCodes(retryCount + 1);
      }
      setError(message || t('home.error'));
      return null;
    }
  // t is only used for error messages and rarely changes — suppress dep warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeListener: (() => void) | null = null;

    const initializeCodes = async () => {
      const loaded = await loadCodes();
      if (!isMounted) return;

      // Real-time listener (тек Firestore блокталмаған болса)
      if (!isFirestoreBlocked()) {
        try {
          unsubscribeListener = subscribeToCodes(
            null,
            (updatedCodes) => {
              if (isMounted && !loaded?.length && updatedCodes.length > 0) {
                setCodes(updatedCodes);
              }
            },
            () => {}
          );
        } catch {
          // API деректері пайдаланылады
        }
      }
    };

    initializeCodes();

    const handleCodesUpdated = () => {
      apiService.invalidateCodesCache();
      loadCodes();
    };
    window.addEventListener('codesUpdated', handleCodesUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('codesUpdated', handleCodesUpdated);
      if (unsubscribeListener) {
        unsubscribeListener();
        unsubscribe('codes-all');
      }
    };
  }, [loadCodes]);

  // Sidebar — тек қолданушының өз жобалары, мүше болып қосылған жобалары
  // және Vibecoding бетінде жасағандары. Жұлдыз қойылғандар — ең жоғарыда, қалғаны — ең жаңасы жоғарыда.
  const projects = useMemo<SidebarProject[]>(() => {
    if (!user) return [];
    const q = projectQuery.toLowerCase().trim();
    const repos: SidebarProject[] = myProjects
      .filter((code) => !q || code.title?.toLowerCase().includes(q) || code.language?.toLowerCase().includes(q))
      .map((code) => ({ kind: 'repo', id: code.id, date: code.createdAt, starred: !!code.starred, code }));
    const repoIds = new Set(myProjects.map((c) => `repo-${c.id}`));
    const vibes: SidebarProject[] = vibeProjects
      // Жүктелген жобаның Vibecoding-тегі көшірмесі — қайталамау үшін жасырамыз
      .filter((p) => !repoIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || 'vibecoding'.includes(q))
      .map((p) => ({ kind: 'vibe', id: p.id, date: p.updatedAt, starred: vibeStars.includes(p.id), project: p }));
    return [...repos, ...vibes].sort(
      (a, b) =>
        Number(b.starred) - Number(a.starred) ||
        (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0)
    );
  }, [myProjects, vibeProjects, vibeStars, projectQuery, user]);

  const toggleStar = (item: SidebarProject) => {
    const next = !item.starred;
    if (item.kind === 'vibe') {
      setVibeStars((prev) => {
        const updated = next ? [...prev, item.id] : prev.filter((id) => id !== item.id);
        try {
          localStorage.setItem(`${VIBE_STARS_KEY}:${user?.id}`, JSON.stringify(updated));
        } catch {
          // localStorage қолжетімсіз — тек осы сеансқа
        }
        return updated;
      });
      return;
    }
    // Бірден көрсетеміз; сервер қабылдамаса — кері қайтарамыз
    const setStar = (value: boolean) =>
      setMyProjects((prev) => prev.map((c) => (c.id === item.id ? { ...c, starred: value } : c)));
    setStar(next);
    apiService.setProjectStar(item.id, next).catch(() => setStar(!next));
  };

  // Жоба басылғанда — бірден Vibecoding бетінде ашылады
  const openProject = (item: SidebarProject) => {
    const params = new URLSearchParams(item.kind === 'repo' ? { repo: item.id } : { project: item.id });
    navigate(`/vibecoding?${params.toString()}`);
  };

  // Бүкіл бетті мөлдірден шығармаймыз (animate-fade-in жоқ) — әйтпесе артындағы түсті body фоны
  // тұман болып көрінеді; ішкі бөліктердің (sidebar, Бүркіт) өз анимациялары қара фон үстінде ойнайды
  return (
    <div className="home-page">
      <div className={`home-layout ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        {/* Сол жақта — жобалар sidebar-ы (ашылып-жабылады) */}
        <HomeSidebar
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onExpand={() => setSidebarCollapsed(false)}
          items={projects.map((item) => ({
            key: `${item.kind}-${item.id}`,
            title: item.kind === 'repo' ? item.code.title : item.project.name,
            isFolder: item.kind === 'vibe' || !!item.code.isFolder,
            joined: item.kind === 'repo' && item.code.role === 'member',
            starred: item.starred,
            onToggleStar: () => toggleStar(item),
            onOpen: () => openProject(item),
          }))}
          loading={myProjectsLoading && myProjects.length === 0}
          error={error}
          onRetry={() => loadCodes()}
          query={projectQuery}
          onQueryChange={setProjectQuery}
          // Жоба осы беттің өзінде жүктеледі — басқа бетке өтпейді
          onAdd={() => (user ? setIsUploadOpen(true) : navigate('/login'))}
          emptyText={!user ? t('home.loginForProjects') : projectQuery ? t('home.noCodes') : t('home.noOwnProjects')}
        />

        <main className="home-center">
          {/* Жоғарыда — тарихтар */}
          <HomeStories codes={codes} />

          {/* Ортада — Сайт ЖИ */}
          <SiteAI codes={codes} />
        </main>
      </div>

      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  );
};

export default Home;
