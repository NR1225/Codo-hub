import React, { useRef, useCallback, useState, useEffect, lazy, Suspense } from 'react';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { EditorMetaProvider } from '../../contexts/EditorMetaContext';
import { BurkitEditsProvider } from '../../contexts/BurkitEditsContext';
import { useResizer } from '../../hooks/useResizer';
import ResizeHandle from './ResizeHandle';
import FileExplorerPanel from './FileExplorerPanel';
import EditorPanel from './EditorPanel';
import ChatPanel from './ChatPanel';
import StatusBar from './StatusBar';
import EditorSettings from './EditorSettings';

// TerminalPanel xterm-ді (~200KB) тартады — тек terminal ашылғанда жүктеу үшін lazy.
const TerminalPanel = lazy(() => import('./TerminalPanel'));
const PreviewPanel = lazy(() => import('./PreviewPanel'));

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

const IDELayout: React.FC = () => {
  const { state, dispatch, isMobile, isTablet, isDesktop } = useVibecoding();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Жобаны іске қосу — редактордың оң жағындағы алдын ала көрініс
  const [previewOpen, setPreviewOpen] = useState(false);
  const [runId, setRunId] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(45); // % — редактор+көрініс жолағынан
  const [splitDragging, setSplitDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const onSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const row = splitRef.current;
    if (!row) return;
    setSplitDragging(true);
    const onMove = (ev: MouseEvent) => {
      const rect = row.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      setPreviewWidth(Math.min(80, Math.max(20, pct)));
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
    minCenter: 25,
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
  const rightWidth = isDesktop && state.rightPanelVisible ? sizes.right : 0;
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

  // Listen for settings open/toggle requests from shortcuts & command palette
  useEffect(() => {
    const onOpen = () => setShowSettings(true);
    const onToggle = () => setShowSettings(v => !v);
    const onRun = () => {
      setPreviewOpen(true);
      setRunId(id => id + 1);
    };
    const onClosePreview = () => setPreviewOpen(false);
    window.addEventListener('vibecoding:open-settings', onOpen);
    window.addEventListener('vibecoding:toggle-settings', onToggle);
    window.addEventListener('vibecoding:run', onRun);
    window.addEventListener('vibecoding:close-preview', onClosePreview);
    return () => {
      window.removeEventListener('vibecoding:open-settings', onOpen);
      window.removeEventListener('vibecoding:toggle-settings', onToggle);
      window.removeEventListener('vibecoding:run', onRun);
      window.removeEventListener('vibecoding:close-preview', onClosePreview);
    };
  }, []);

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
                  maxWidth: state.leftPanelVisible ? '400px' : '0',
                  opacity: state.leftPanelVisible ? 1 : 0,
                }}
              >
                {leftPresence.mounted && <FileExplorerPanel />}
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
                <FileExplorerPanel />
              </div>
            </>
          )}

          {/* Center - Editor + Terminal */}
          <div className="vibe-panel-center flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0 }}>
            {/* Editor (+ іске қосылған жобаның көрінісі) — қалған биіктікті алады */}
            <div
              ref={splitRef}
              style={{ flex: '1 1 0', minHeight: 0 }}
              className={`vx-split flex overflow-hidden relative ${splitDragging ? 'is-dragging' : ''}`}
            >
              <div style={{ flex: '1 1 0', minWidth: 0 }} className="overflow-hidden">
                <EditorPanel />
              </div>
              {previewOpen && (
                <>
                  {isDesktop && <ResizeHandle type="vertical" onMouseDown={onSplitDragStart} />}
                  <div
                    className={isDesktop ? 'overflow-hidden' : 'vx-preview-overlay'}
                    style={isDesktop ? { width: `${previewWidth}%`, flexShrink: 0, minWidth: 0 } : undefined}
                  >
                    <Suspense fallback={<TerminalFallback />}>
                      <PreviewPanel runId={runId} onClose={() => setPreviewOpen(false)} />
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
                  maxWidth: state.rightPanelVisible ? '500px' : '0',
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