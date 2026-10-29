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
  | { kind: 'repo'; id: string; date: string; code: CodeFile }
  | { kind: 'vibe'; id: string; date: string; project: VibecodingProjectSummary };

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
  const [loading, setLoading] = useState(homeCachedCodes === null);
  const [error, setError] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [vibeProjects, setVibeProjects] = useState<VibecodingProjectSummary[]>(() => readVibecodingProjects(user?.id));

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
      const response = await apiService.getCodeFiles(undefined, 50, 0, false);
      setCodes(response.codes);
      homeCachedCodes = response.codes;
      setError(null);
      setLoading(false);
      return response.codes;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // Желі қатесі болса, қайталау
      if ((message.includes('timeout') || message.includes('Failed to fetch') || message.includes('қосылу')) && retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return loadCodes(retryCount + 1);
      }
      setError(message || t('home.error'));
      setLoading(false);
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

  // Sidebar — тек қолданушының өз репозиторийлері: өзі қосқан жобалар
  // және Vibecoding бетінде жасағандары. Ең жаңасы жоғарыда.
  const projects = useMemo<SidebarProject[]>(() => {
    if (!user) return [];
    const q = projectQuery.toLowerCase().trim();
    const repos: SidebarProject[] = codes
      .filter(
        (code) =>
          !code.folderId &&
          code.author === user.username &&
          (!q || code.title?.toLowerCase().includes(q) || code.language?.toLowerCase().includes(q))
      )
      .map((code) => ({ kind: 'repo', id: code.id, date: code.createdAt, code }));
    const repoIds = new Set(repos.map((r) => `repo-${r.id}`));
    const vibes: SidebarProject[] = vibeProjects
      // Жүктелген жобаның Vibecoding-тегі көшірмесі — қайталамау үшін жасырамыз
      .filter((p) => !repoIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || 'vibecoding'.includes(q))
      .map((p) => ({ kind: 'vibe', id: p.id, date: p.updatedAt, project: p }));
    return [...repos, ...vibes].sort(
      (a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0)
    );
  }, [codes, vibeProjects, projectQuery, user]);

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
            onOpen: () => openProject(item),
          }))}
          loading={loading && codes.length === 0}
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
