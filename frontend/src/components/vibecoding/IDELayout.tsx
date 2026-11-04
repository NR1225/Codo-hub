import React, { useRef, useCallback, useState, useEffect, lazy, Suspense } from 'react';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { EditorMetaProvider } from '../../contexts/EditorMetaContext';
import { BurkitEditsProvider } from '../../contexts/BurkitEditsContext';
import { useResizer } from '../../hooks/useResizer';
import ResizeHandle from './ResizeHandle';
import LeftSidebar, { LeftRail } from './git/LeftSidebar';
import { GIT_DIFF_EVENT, type GitDiffTarget } from './git/gitEvents';
import EditorPanel from './EditorPanel';
import ChatPanel from './ChatPanel';
import StatusBar from './StatusBar';
import EditorSettings from './EditorSettings';
import { DEV_SERVER_EVENT, DEV_SERVER_STOP_EVENT, devCommand, type DevServerInfo } from '../../utils/devServer';
import { runInTerminal, stopTerminalRun } from '../../utils/vibeBridge';
import { apiService, type VibecodingRunPlan } from '../../utils/api';
import { subscribeTerminalOutput } from '../../utils/vibeActivity';
import {
  VIBE_EVENTS, getRunState, setRunState, resetRunState, setPreviewOpenState, useRunState,
} from '../../utils/vibeControl';

// TerminalPanel xterm-ді (~200KB) тартады — тек terminal ашылғанда жүктеу үшін lazy.
const TerminalPanel = lazy(() => import('./TerminalPanel'));
const PreviewPanel = lazy(() => import('./PreviewPanel'));
const GitDiffView = lazy(() => import('./git/GitDiffView'));

const TerminalFallback: React.FC = () => (
  <div className="flex items-center justify-center h-full text-sm opacity-60">…</div>
);

// Панель мазмұны жабылу анимациясы біткенше көрініп тұрады (басты беттің sidebar-ы сияқты
// бірге сөнеді), ал ашылғанда біраз уақыт «entering» күйінде болады — толқын анимациясы үшін.
const ENTER_MS = 900;
const EXIT_MS = 450;
type PanelPhase = 'entering' | 'open' | 'closing' | 'closed';

function usePanelPresence(visible: boolean) {
  const [phase, setPhase] = useState<PanelPhase>(visible ? 'entering' : 'closed');
  useEffect(() => {
    setPhase(visible ? 'entering' : (p) => (p === 'closed' ? p : 'closing'));
    const timer = window.setTimeout(
      () => setPhase(visible ? 'open' : 'closed'),
      visible ? ENTER_MS : EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [visible]);
  return { phase, mounted: visible || phase !== 'closed' };
}

const PREVIEW_LAYOUT_KEY = 'vibe-preview-layout';
// Жабық сол панельдің белгішелер жолағы (басты беттің sidebar-ы сияқты)
const LEFT_RAIL_PX = 56;
// Сервер адресі осы уақытта шықпаса — іске қосу сәтсіз деп саналады (npm install ұзаққа созылуы мүмкін)
const SERVER_WAIT_MS = 180_000;
// Терминалда қате шыққан соң адрес күтудің шегі
const ERROR_GRACE_MS = 2500;
// Іске қосу кезіндегі «өлімші» қателер (сервер тоқтап қалды)
const FATAL_RE = /npm ERR!|npm error|Traceback \(most recent call last\)|EADDRINUSE|address already in use|command not found|is not recognized as|Cannot find module|ModuleNotFoundError|No module named|ERR_MODULE_NOT_FOUND|SyntaxError:|Error: listen|failed to start|Missing script/i;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
// Скрипт аяқталды: shell шақыруы қайта шықты
const PROMPT_RE = /(?:^|\n)[^\n]*[$#%>]\s*$/;
// AI сайдбары беттің ортасына дейін ғана созылады (% — IDE енінен)
const AI_PANEL_MAX = 50;

function loadPreviewLayout(): { open: boolean; width: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREVIEW_LAYOUT_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const width = Number(raw.width);
      return { open: raw.open === true, width: width >= 15 && width <= 90 ? width : 45 };
    }
  } catch { /* бұзылған жазба */ }
  return { open: false, width: 45 };
}

interface IDELayoutProps {
  /** Ортаңғы бағанның үстіндегі құралдар қатары (іздеу, палитра, панельдер) —
      сайдбарлар оның қасынан жоба табтарына дейін көтеріледі */
  centerToolbar?: React.ReactNode;
}

const IDELayout: React.FC<IDELayoutProps> = ({ centerToolbar }) => {
  const { state, dispatch, isMobile, isTablet, isDesktop, activeProject, flushProjects } = useVibecoding();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Жобаны іске қосу — редактордың оң жағындағы алдын ала көрініс
  const [previewOpen, setPreviewOpen] = useState(() => loadPreviewLayout().open);
  const [runId, setRunId] = useState(0);
  // Терминалда іске қосылған dev-сервер (npm run dev) — көрініс соны көрсетеді
  const [devServer, setDevServer] = useState<DevServerInfo | null>(null);
  // Жоба бойынша соңғы сервер: × басылса да процесс терминалда жүріп тұр, қайта іске қоспаймыз
  const lastServers = useRef(new Map<string, DevServerInfo>());
  const [previewWidth, setPreviewWidth] = useState(() => loadPreviewLayout().width); // % — редактор+көрініс жолағынан
  // Тулбардағы «Көрініс» белгішесі де білсін
  useEffect(() => { setPreviewOpenState(previewOpen); }, [previewOpen]);
  useEffect(() => () => setPreviewOpenState(false), []);

  // Бет жаңартылғанда көрініс ашық/жабық күйі мен ені сақталады
  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_LAYOUT_KEY, JSON.stringify({ open: previewOpen, width: previewWidth }));
    } catch { /* жеке терезе — тек осы сессияда */ }
  }, [previewOpen, previewWidth]);
  const [splitDragging, setSplitDragging] = useState(false);
  // Көріністі редактордың орнына толық жаю
  const [previewMax, setPreviewMax] = useState(false);
  const togglePreviewMax = useCallback(() => setPreviewMax(v => !v), []);
  useEffect(() => {
    if (!previewOpen) setPreviewMax(false);
  }, [previewOpen]);
  const maxed = previewMax && isDesktop;
  // Source Control-дан ашылған diff — редактордың үстінде көрсетіледі
  const [gitDiff, setGitDiff] = useState<GitDiffTarget | null>(null);
  const closeGitDiff = useCallback(() => setGitDiff(null), []);
  const splitRef = useRef<HTMLDivElement>(null);

  const onSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const row = splitRef.current;
    if (!row) return;
    setSplitDragging(true);
    const onMove = (ev: MouseEvent) => {
      const rect = row.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      setPreviewWidth(Math.min(90, Math.max(15, pct)));
    };
    const onUp = () => {
      setSplitDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const { sizes, onDragStart } = useResizer({
    initialSizes: state.panelSizes,
    minLeft: 10,
    minRight: 10,
    minBottom: 10,
    // Сайдбарларды қалағанша созуға болады — ортаға тек редактор сыйятын орын қалады
    minCenter: 8,
    minCenterPx: 260,
    maxRight: AI_PANEL_MAX,
    leftVisible: state.leftPanelVisible,
    rightVisible: state.rightPanelVisible,
    onSizesChange: (newSizes) => {
      dispatch({ type: 'SET_PANEL_SIZES', payload: newSizes });
    },
    disabled: isMobile, // No resize on mobile (overlay mode)
  });

  // On mobile/tablet, panels are overlays
  const showLeftAsOverlay = isMobile || isTablet;
  const showRightAsOverlay = isMobile || isTablet;

  // Desktop: normal layout sizing
  const leftWidth = isDesktop && state.leftPanelVisible ? sizes.left : 0;
  const rightWidth = isDesktop && state.rightPanelVisible ? Math.min(sizes.right, AI_PANEL_MAX) : 0;
  const bottomHeight = state.bottomPanelVisible ? sizes.bottom : 0;

  const leftPresence = usePanelPresence(state.leftPanelVisible);
  const rightPresence = usePanelPresence(state.rightPanelVisible);
  const bottomPresence = usePanelPresence(state.bottomPanelVisible);
  const previewPresence = usePanelPresence(previewOpen);
  // Кіші экрандағы қалқымалы панельдер де жабылғанда сырғып кетеді
  const leftOverlay = usePanelPresence((isMobile || isTablet) && state.leftPanelVisible);
  const rightOverlay = usePanelPresence((isMobile || isTablet) && state.rightPanelVisible);
  // Терминал бір рет ашылса — панель жабылғанда да сессиялар (табтар) тірі қалады
  const [terminalLoaded, setTerminalLoaded] = useState(state.bottomPanelVisible);
  useEffect(() => {
    if (state.bottomPanelVisible) setTerminalLoaded(true);
  }, [state.bottomPanelVisible]);

  const closeLeftOverlay = useCallback(() => {
    dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false });
  }, [dispatch]);

  const closeRightOverlay = useCallback(() => {
    dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: false });
  }, [dispatch]);

  // «Іске қосу»: жоба қалай іске қосылатынын сервер анықтайды (run-plan):
  //  • server  — команда терминалдың бөлек «Іске қосу» табында орындалады (npm run dev, Django, Flask,
  //              FastAPI, Streamlit …), ол басқан адрес осы көрініс панелінде ашылады;
  //  • console — жай скрипт (python main.py): нәтижесі терминалда;
  //  • web     — статикалық HTML: көрініс браузерде файлдардан құрастырылады.
  // Күйі (planning → starting → running / error) vibeControl-да — батырма, көрініс және Codo бірдей көреді.
  const run = useRunState();
  const runRef = useRef<() => void>(() => {});
  runRef.current = () => {
    const projectId = activeProject?.id ?? null;
    const runStatic = () => {
      setPreviewOpen(true);
      setDevServer(null);
      setRunState({
        phase: 'running', kind: 'web', projectId, command: null, framework: null, url: null, error: null, startedAt: Date.now(),
      });
      setRunId(id => id + 1);
    };
    if (!activeProject || !projectId) {
      runStatic();
      return;
    }
    // Сервер бұрыннан жүріп тұр — соңғы өзгерістерді жіберіп, көріністі қайта жүктейміз
    const running = lastServers.current.get(projectId);
    if (running) {
      setPreviewOpen(true);
      setDevServer(running);
      setRunState({ phase: 'running', kind: 'server', projectId, url: running.url, error: null });
      flushProjects()
        .catch(() => {})
        .then(() => setRunId(id => id + 1));
      return;
    }
    const current = getRunState();
    if ((current.phase === 'planning' || current.phase === 'starting') && current.projectId === projectId) {
      if (current.kind === 'server') setPreviewOpen(true);
      return;
    }
    setRunState({
      phase: 'planning', kind: null, projectId, command: null, framework: null, url: null, error: null, startedAt: Date.now(),
    });
    // Сервер қолжетімсіз болса — браузердегі файлдардан package.json-ды өзіміз қараймыз
    const fallback = devCommand(activeProject.files);
    const stillPlanning = () => {
      const s = getRunState();
      return s.phase === 'planning' && s.projectId === projectId;
    };
    // Терминал папкасы серверде — соңғы өзгерістер алдымен сонда жетсін
    flushProjects()
      .catch(() => {})
      .then(() => apiService.getVibecodingRunPlan(projectId))
      .catch((): VibecodingRunPlan => (fallback ? { kind: 'server', command: fallback } : { kind: 'web', command: null }))
      .then(async plan => {
        if (!stillPlanning()) return; // тоқтатылды немесе жоба ауысты
        if (!plan.command || (plan.kind !== 'server' && plan.kind !== 'console')) {
          runStatic();
          return;
        }
        const command = plan.command;
        const framework = typeof plan.framework === 'string' ? plan.framework : null;
        dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: true });
        if (plan.kind === 'server') {
          setPreviewOpen(true);
          setDevServer(null);
          setRunState({ phase: 'starting', kind: 'server', command, framework, startedAt: Date.now() });
        } else {
          setRunState({ phase: 'running', kind: 'console', command, framework, startedAt: Date.now() });
        }
        try {
          await runInTerminal(projectId, command, { role: 'run', timeoutMs: 45_000 });
        } catch (e) {
          if (getRunState().projectId !== projectId) return;
          setRunState({ phase: 'error', error: e instanceof Error ? e.message : 'Терминал қатесі' });
        }
      });
  };

  // Тоқтату: «Іске қосу» табындағы процесс Ctrl+C алады. keepPreview — көрініс жабылмайды (файлдарға ауысу)
  const stopRef = useRef<(keepPreview?: boolean) => void>(() => {});
  stopRef.current = (keepPreview = false) => {
    const projectId = activeProject?.id ?? null;
    const s = getRunState();
    const hadServer = !!devServer || s.kind === 'server';
    if (projectId) {
      lastServers.current.delete(projectId);
      if (s.kind === 'server' || s.kind === 'console' || devServer) stopTerminalRun(projectId);
    }
    setDevServer(null);
    resetRunState();
    if (!keepPreview && (hadServer || s.kind === 'web')) setPreviewOpen(false);
  };

  // Сервер адресін күту: терминалда өлімші қате шықса немесе уақыт бітсе — қате күйі
  useEffect(() => {
    if (run.phase !== 'starting' || run.kind !== 'server') return;
    const projectId = run.projectId;
    let tail = '';
    let errorTimer = 0;
    const fail = (message: string) => {
      const s = getRunState();
      if (s.phase === 'starting' && s.projectId === projectId) setRunState({ phase: 'error', error: message });
    };
    const unsubscribe = subscribeTerminalOutput(text => {
      tail = (tail + text.replace(ANSI_RE, '')).slice(-3000);
      if (errorTimer || !FATAL_RE.test(tail)) return;
      const line = tail.split('\n').map(l => l.trim()).filter(l => FATAL_RE.test(l)).pop() ?? '';
      errorTimer = window.setTimeout(() => fail(line.slice(0, 300) || 'Терминалда қате шықты'), ERROR_GRACE_MS);
    });
    const waitTimer = window.setTimeout(
      () => fail(`Сервер адресі ${Math.round(SERVER_WAIT_MS / 1000)} секунд ішінде шықпады. Терминалдағы шығысты тексеріңіз.`),
      SERVER_WAIT_MS,
    );
    return () => {
      unsubscribe();
      window.clearTimeout(errorTimer);
      window.clearTimeout(waitTimer);
    };
  }, [run.phase, run.kind, run.projectId]);

  // Консольдік скрипт: shell шақыруы қайта шыққанда — аяқталды
  useEffect(() => {
    if (run.phase !== 'running' || run.kind !== 'console') return;
    const projectId = run.projectId;
    let out = '';
    let idleTimer = 0;
    const started = Date.now();
    const unsubscribe = subscribeTerminalOutput(text => {
      out = (out + text.replace(ANSI_RE, '')).slice(-2000);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        const s = getRunState();
        if (Date.now() - started > 1200 && PROMPT_RE.test(out) && s.kind === 'console' && s.projectId === projectId) resetRunState();
      }, 900);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(idleTimer);
    };
  }, [run.phase, run.kind, run.projectId]);

  // Listen for settings open/toggle requests from shortcuts & command palette
  useEffect(() => {
    const onOpen = () => setShowSettings(true);
    const onToggle = () => setShowSettings(v => !v);
    const onRun = () => runRef.current();
    const onStop = (e: Event) => stopRef.current((e as CustomEvent<{ keepPreview?: boolean } | undefined>).detail?.keepPreview);
    const onOpenPreview = () => setPreviewOpen(true);
    const onClosePreview = () => setPreviewOpen(false);
    const onTogglePreview = () => setPreviewOpen(v => !v);
    const onMaximizePreview = (e: Event) => {
      const want = (e as CustomEvent<boolean | undefined>).detail;
      setPreviewOpen(true);
      setPreviewMax(v => (typeof want === 'boolean' ? want : !v));
    };
    const onDevServer = (e: Event) => {
      const info = (e as CustomEvent<DevServerInfo>).detail;
      if (info.projectId) lastServers.current.set(info.projectId, info);
      // Басқа жобаның терминалындағы сервер — тек есте сақтаймыз, көріністі ауыстырмаймыз
      if (info.projectId && info.projectId !== activeIdRef.current) return;
      setDevServer(info);
      setPreviewOpen(true);
      setRunState(prev => ({
        phase: 'running', kind: 'server', projectId: info.projectId, url: info.url, error: null,
        command: prev.projectId === info.projectId ? prev.command : null,
        framework: prev.projectId === info.projectId ? prev.framework : null,
        startedAt: prev.projectId === info.projectId ? prev.startedAt : Date.now(),
      }));
    };
    const onDevServerStop = (e: Event) => {
      const { port, projectId } = (e as CustomEvent<{ port: number; projectId: string | null }>).detail;
      if (projectId && lastServers.current.get(projectId)?.port === port) lastServers.current.delete(projectId);
      setDevServer(prev => (prev && prev.port === port && prev.projectId === projectId ? null : prev));
      const s = getRunState();
      if (s.kind === 'server' && s.projectId === projectId && s.phase === 'running') resetRunState();
    };
    const onGitDiff = (e: Event) => setGitDiff((e as CustomEvent<GitDiffTarget>).detail);
    window.addEventListener(GIT_DIFF_EVENT, onGitDiff);
    window.addEventListener(DEV_SERVER_EVENT, onDevServer);
    window.addEventListener(DEV_SERVER_STOP_EVENT, onDevServerStop);
    window.addEventListener('vibecoding:open-settings', onOpen);
    window.addEventListener('vibecoding:toggle-settings', onToggle);
    window.addEventListener(VIBE_EVENTS.run, onRun);
    window.addEventListener(VIBE_EVENTS.stop, onStop);
    window.addEventListener(VIBE_EVENTS.openPreview, onOpenPreview);
    window.addEventListener(VIBE_EVENTS.closePreview, onClosePreview);
    window.addEventListener(VIBE_EVENTS.togglePreview, onTogglePreview);
    window.addEventListener(VIBE_EVENTS.maximizePreview, onMaximizePreview);
    return () => {
      window.removeEventListener('vibecoding:open-settings', onOpen);
      window.removeEventListener('vibecoding:toggle-settings', onToggle);
      window.removeEventListener(VIBE_EVENTS.run, onRun);
      window.removeEventListener(VIBE_EVENTS.stop, onStop);
      window.removeEventListener(VIBE_EVENTS.openPreview, onOpenPreview);
      window.removeEventListener(VIBE_EVENTS.closePreview, onClosePreview);
      window.removeEventListener(VIBE_EVENTS.togglePreview, onTogglePreview);
      window.removeEventListener(VIBE_EVENTS.maximizePreview, onMaximizePreview);
      window.removeEventListener(GIT_DIFF_EVENT, onGitDiff);
      window.removeEventListener(DEV_SERVER_EVENT, onDevServer);
      window.removeEventListener(DEV_SERVER_STOP_EVENT, onDevServerStop);
    };
  }, []);

  // Басқа жобаға ауысқанда алдыңғы жобаның серверін көрсетпейміз (ол терминалда жүре береді —
  // қайта оралғанда «Іске қосу» соны бірден ашады)
  const activeIdRef = useRef(activeProject?.id ?? null);
  activeIdRef.current = activeProject?.id ?? null;
  useEffect(() => {
    const id = activeProject?.id ?? null;
    setDevServer(prev => (prev && prev.projectId && prev.projectId !== id ? null : prev));
    const s = getRunState();
    if (s.projectId && s.projectId !== id) resetRunState();
    const server = id ? lastServers.current.get(id) : undefined;
    if (server) setRunState({ phase: 'running', kind: 'server', projectId: id, url: server.url, error: null });
    setGitDiff(prev => (prev && prev.projectId !== id ? null : prev));
  }, [activeProject?.id]);

  const previewPanel = (
    <Suspense fallback={<TerminalFallback />}>
      <PreviewPanel
        runId={runId}
        serverUrl={devServer?.url ?? null}
        serverPort={devServer?.port ?? null}
        onServerClose={() => {
          setDevServer(null);
          setRunState({ phase: 'running', kind: 'web', url: null, error: null });
          setRunId(id => id + 1);
        }}
        onClose={() => setPreviewOpen(false)}
        maximized={maxed}
        onToggleMaximize={isDesktop ? togglePreviewMax : undefined}
      />
    </Suspense>
  );

  return (
    <EditorMetaProvider>
    <BurkitEditsProvider>
      <div
        ref={containerRef}
        className="vibe-ide flex-1 flex flex-col overflow-hidden relative"
      >
        {/* Editor + Terminal Area */}
        <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
          {/* Left Panel - Desktop inline */}
          {isDesktop && (
            <>
              <div
                data-open={state.leftPanelVisible}
                data-phase={leftPresence.phase}
                className="vibe-panel-left has-rail overflow-hidden"
                style={{
                  // Жабық кезде толық жоғалмайды — басты беттегідей белгішелер жолағы қалады
                  width: state.leftPanelVisible ? `${leftWidth}%` : `${LEFT_RAIL_PX}px`,
                  minWidth: state.leftPanelVisible ? `${180 + LEFT_RAIL_PX}px` : `${LEFT_RAIL_PX}px`,
                  maxWidth: state.leftPanelVisible ? '100%' : `${LEFT_RAIL_PX}px`,
                }}
              >
                {/* Белгішелер жолағы панель ашық та, жабық та кезде тұрады */}
                <LeftRail />
                {leftPresence.mounted && <LeftSidebar />}
              </div>

              {state.leftPanelVisible && (
                <ResizeHandle
                  type="vertical"
                  onMouseDown={(e) => onDragStart(e, 'left', containerRef.current!)}
                  onDoubleClick={() => dispatch({ type: 'TOGGLE_LEFT_PANEL' })}
                />
              )}
            </>
          )}

          {/* Left Panel - Mobile/Tablet Overlay */}
          {showLeftAsOverlay && leftOverlay.mounted && (
            <>
              <div
                className="vibe-overlay-backdrop vx-overlay-fade"
                data-open={state.leftPanelVisible}
                onClick={closeLeftOverlay}
              />
              <div className="vibe-overlay vibe-overlay--left vx-overlay-slide" data-open={state.leftPanelVisible}>
                <LeftSidebar isOverlay />
              </div>
            </>
          )}

          {/* Center - Editor + Terminal */}
          <div className="vibe-panel-center flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0 }}>
            {centerToolbar}
            {/* Editor (+ іске қосылған жобаның көрінісі) — қалған биіктікті алады */}
            <div
              ref={splitRef}
              style={{ flex: '1 1 0', minHeight: 0 }}
              className={`vx-split flex overflow-hidden relative ${splitDragging ? 'is-dragging' : ''}`}
            >
              <div
                style={maxed ? { display: 'none' } : { flex: '1 1 0', minWidth: 0 }}
                className="overflow-hidden relative"
              >
                <EditorPanel />
                {gitDiff && (
                  <Suspense fallback={null}>
                    <GitDiffView target={gitDiff} onClose={closeGitDiff} />
                  </Suspense>
                )}
              </div>
              {isDesktop ? (
                <>
                  {previewOpen && !maxed && (
                    <ResizeHandle type="vertical" onMouseDown={onSplitDragStart} onDoubleClick={togglePreviewMax} />
                  )}
                  {/* Көрініс — сайдбарлар сияқты ашылып-жабылады (бірдей анимация, VibecodingPanels.css) */}
                  <div
                    data-open={previewOpen}
                    data-phase={previewPresence.phase}
                    className="vibe-panel-preview overflow-hidden"
                    style={maxed
                      ? { flex: '1 1 0', minWidth: 0 }
                      : {
                          width: previewOpen ? `${previewWidth}%` : '0%',
                          minWidth: previewOpen ? '260px' : '0',
                          flexShrink: 0,
                          opacity: previewOpen ? 1 : 0,
                        }}
                  >
                    {previewPresence.mounted && previewPanel}
                  </div>
                </>
              ) : previewPresence.mounted && (
                <div className="vx-preview-overlay vx-overlay-slide vx-overlay-slide--up" data-open={previewOpen}>
                  {previewPanel}
                </div>
              )}
            </div>

            {/* Terminal - inline on all breakpoints */}
            <div
              data-open={state.bottomPanelVisible}
              data-phase={bottomPresence.phase}
              className="vibe-panel-bottom overflow-hidden"
              style={{
                height: state.bottomPanelVisible ? `${bottomHeight}%` : '0',
                flexShrink: 0,
              }}
            >
              {bottomPresence.mounted && (
                <ResizeHandle
                  type="horizontal"
                  onMouseDown={(e) => onDragStart(e, 'bottom', containerRef.current!)}
                  onDoubleClick={() => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' })}
                />
              )}
              {terminalLoaded && (
                <div className="vx-term-host" hidden={!bottomPresence.mounted}>
                  <Suspense fallback={<TerminalFallback />}>
                    <TerminalPanel />
                  </Suspense>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Desktop inline */}
          {isDesktop && (
            <>
              {state.rightPanelVisible && (
                <ResizeHandle
                  type="vertical"
                  onMouseDown={(e) => onDragStart(e, 'right', containerRef.current!)}
                  onDoubleClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
                />
              )}
              <div
                data-open={state.rightPanelVisible}
                data-phase={rightPresence.phase}
                className="vibe-panel-right overflow-hidden"
                style={{
                  width: `${rightWidth}%`,
                  minWidth: state.rightPanelVisible ? '250px' : '0',
                  maxWidth: state.rightPanelVisible ? '100%' : '0',
                  opacity: state.rightPanelVisible ? 1 : 0,
                }}
              >
                {rightPresence.mounted && <ChatPanel />}
              </div>
            </>
          )}

          {/* Right Panel - Mobile/Tablet Overlay */}
          {showRightAsOverlay && rightOverlay.mounted && (
            <>
              <div
                className="vibe-overlay-backdrop vx-overlay-fade"
                data-open={state.rightPanelVisible}
                onClick={closeRightOverlay}
              />
              <div className="vibe-overlay vibe-overlay--right vx-overlay-slide" data-open={state.rightPanelVisible}>
                <ChatPanel />
              </div>
            </>
          )}
        </div>

        {/* Global status bar (full width, below everything) */}
        <StatusBar
          onOpenSettings={() => setShowSettings(v => !v)}
          onTogglePalette={() => {
            // Delegate to the page-level palette via a custom event
            window.dispatchEvent(new CustomEvent('vibecoding:open-palette-commands'));
          }}
        />

        {/* Editor settings popover, anchored to bottom-right above the status bar */}
        {showSettings && <EditorSettings onClose={() => setShowSettings(false)} />}
      </div>
    </BurkitEditsProvider>
    </EditorMetaProvider>
  );
};

export default IDELayout;