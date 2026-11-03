import React, { useRef, useCallback, useState, useEffect, lazy, Suspense } from 'react';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { EditorMetaProvider } from '../../contexts/EditorMetaContext';
import { BurkitEditsProvider } from '../../contexts/BurkitEditsContext';
import { useResizer } from '../../hooks/useResizer';
import ResizeHandle from './ResizeHandle';
import LeftSidebar from './git/LeftSidebar';
import { GIT_DIFF_EVENT, type GitDiffTarget } from './git/gitEvents';
import EditorPanel from './EditorPanel';
import ChatPanel from './ChatPanel';
import StatusBar from './StatusBar';
import EditorSettings from './EditorSettings';
import { DEV_SERVER_EVENT, DEV_SERVER_STOP_EVENT, devCommand, type DevServerInfo } from '../../utils/devServer';
import { runInTerminal } from '../../utils/vibeBridge';
import { apiService, type VibecodingRunPlan } from '../../utils/api';

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
  const [devStarting, setDevStarting] = useState(false);
  // Жоба бойынша соңғы сервер: × басылса да процесс терминалда жүріп тұр, қайта іске қоспаймыз
  const lastServers = useRef(new Map<string, DevServerInfo>());
  const [previewWidth, setPreviewWidth] = useState(() => loadPreviewLayout().width); // % — редактор+көрініс жолағынан

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
  //  • server  — команда терминалда орындалады (npm run dev, Django, Flask, FastAPI, Streamlit …),
  //              ол басқан адрес осы көрініс панелінде ашылады;
  //  • console — жай скрипт (python main.py): нәтижесі терминалда;
  //  • web     — статикалық HTML: көрініс браузерде файлдардан құрастырылады.
  const planningRef = useRef(false);
  const runRef = useRef<() => void>(() => {});
  runRef.current = () => {
    const runStatic = () => {
      setPreviewOpen(true);
      setDevServer(null);
      setDevStarting(false);
      setRunId(id => id + 1);
    };
    if (!activeProject) {
      runStatic();
      return;
    }
    const projectId = activeProject.id;
    const running = lastServers.current.get(projectId);
    if (running) {
      setPreviewOpen(true);
      setDevServer(running);
      // Алдымен соңғы өзгерістер сервер папкасына жетсін, содан кейін көріністі қайта жүктейміз
      flushProjects()
        .catch(() => {})
        .then(() => setRunId(id => id + 1));
      return;
    }
    if (devStarting || planningRef.current) return;
    planningRef.current = true;
    // Сервер қолжетімсіз болса — браузердегі файлдардан package.json-ды өзіміз қараймыз
    const fallback = devCommand(activeProject.files);
    // Терминал папкасы серверде — соңғы өзгерістер алдымен сонда жетсін
    flushProjects()
      .catch(() => {})
      .then(() => apiService.getVibecodingRunPlan(projectId))
      .catch((): VibecodingRunPlan => (fallback ? { kind: 'server', command: fallback } : { kind: 'web', command: null }))
      .then(plan => {
        if (!plan.command || (plan.kind !== 'server' && plan.kind !== 'console')) {
          runStatic();
          return;
        }
        dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: true });
        if (plan.kind === 'server') {
          setPreviewOpen(true);
          setDevServer(null);
          setDevStarting(true);
        }
        return runInTerminal(projectId, plan.command);
      })
      .catch(() => setDevStarting(false))
      .finally(() => { planningRef.current = false; });
  };

  // Listen for settings open/toggle requests from shortcuts & command palette
  useEffect(() => {
    const onOpen = () => setShowSettings(true);
    const onToggle = () => setShowSettings(v => !v);
    const onRun = () => runRef.current();
    const onClosePreview = () => setPreviewOpen(false);
    const onDevServer = (e: Event) => {
      const info = (e as CustomEvent<DevServerInfo>).detail;
      if (info.projectId) lastServers.current.set(info.projectId, info);
      setDevServer(info);
      setDevStarting(false);
      setPreviewOpen(true);
    };
    const onDevServerStop = (e: Event) => {
      const { port, projectId } = (e as CustomEvent<{ port: number; projectId: string | null }>).detail;
      if (projectId && lastServers.current.get(projectId)?.port === port) lastServers.current.delete(projectId);
      setDevServer(prev => (prev && prev.port === port && prev.projectId === projectId ? null : prev));
    };
    const onGitDiff = (e: Event) => setGitDiff((e as CustomEvent<GitDiffTarget>).detail);
    window.addEventListener(GIT_DIFF_EVENT, onGitDiff);
    window.addEventListener(DEV_SERVER_EVENT, onDevServer);
    window.addEventListener(DEV_SERVER_STOP_EVENT, onDevServerStop);
    window.addEventListener('vibecoding:open-settings', onOpen);
    window.addEventListener('vibecoding:toggle-settings', onToggle);
    window.addEventListener('vibecoding:run', onRun);
    window.addEventListener('vibecoding:close-preview', onClosePreview);
    return () => {
      window.removeEventListener('vibecoding:open-settings', onOpen);
      window.removeEventListener('vibecoding:toggle-settings', onToggle);
      window.removeEventListener('vibecoding:run', onRun);
      window.removeEventListener('vibecoding:close-preview', onClosePreview);
      window.removeEventListener(GIT_DIFF_EVENT, onGitDiff);
      window.removeEventListener(DEV_SERVER_EVENT, onDevServer);
      window.removeEventListener(DEV_SERVER_STOP_EVENT, onDevServerStop);
    };
  }, []);

  // Басқа жобаға ауысқанда алдыңғы жобаның серверін көрсетпейміз
  useEffect(() => {
    setDevServer(prev => (prev && prev.projectId && prev.projectId !== activeProject?.id ? null : prev));
    setDevStarting(false);
    setGitDiff(prev => (prev && prev.projectId !== activeProject?.id ? null : prev));
  }, [activeProject?.id]);

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
                className="vibe-panel-left overflow-hidden"
                style={{
                  width: `${leftWidth}%`,
                  minWidth: state.leftPanelVisible ? '180px' : '0',
                  maxWidth: state.leftPanelVisible ? '100%' : '0',
                  opacity: state.leftPanelVisible ? 1 : 0,
                }}
              >
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
          {showLeftAsOverlay && state.leftPanelVisible && (
            <>
              {/* Backdrop */}
              <div
                className="vibe-overlay-backdrop animate-fadeIn"
                onClick={closeLeftOverlay}
              />
              {/* Sidebar overlay */}
              <div
                className="vibe-overlay vibe-overlay--left animate-slideInLeft"
              >
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
              {previewOpen && (
                <>
                  {isDesktop && !maxed && (
                    <ResizeHandle type="vertical" onMouseDown={onSplitDragStart} onDoubleClick={togglePreviewMax} />
                  )}
                  <div
                    className={isDesktop ? 'overflow-hidden' : 'vx-preview-overlay'}
                    style={isDesktop
                      ? maxed
                        ? { flex: '1 1 0', minWidth: 0 }
                        : { width: `${previewWidth}%`, flexShrink: 0, minWidth: 0 }
                      : undefined}
                  >
                    <Suspense fallback={<TerminalFallback />}>
                      <PreviewPanel
                        runId={runId}
                        serverUrl={devServer?.url ?? null}
                        serverPort={devServer?.port ?? null}
                        serverStarting={devStarting}
                        onServerClose={() => setDevServer(null)}
                        onClose={() => setPreviewOpen(false)}
                        maximized={maxed}
                        onToggleMaximize={isDesktop ? togglePreviewMax : undefined}
                      />
                    </Suspense>
                  </div>
                </>
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
          {showRightAsOverlay && state.rightPanelVisible && (
            <>
              {/* Backdrop */}
              <div
                className="vibe-overlay-backdrop animate-fadeIn"
                onClick={closeRightOverlay}
              />
              {/* Chat overlay */}
              <div
                className="vibe-overlay vibe-overlay--right animate-slideInRight"
              >
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