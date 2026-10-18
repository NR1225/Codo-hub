import React, { useRef, useCallback, useState, useEffect, lazy, Suspense } from 'react';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { EditorMetaProvider } from '../../contexts/EditorMetaContext';
import { useResizer } from '../../hooks/useResizer';
import ResizeHandle from './ResizeHandle';
import FileExplorerPanel from './FileExplorerPanel';
import EditorPanel from './EditorPanel';
import ChatPanel from './ChatPanel';
import StatusBar from './StatusBar';
import EditorSettings from './EditorSettings';

// TerminalPanel xterm-ді (~200KB) тартады — тек terminal ашылғанда жүктеу үшін lazy.
const TerminalPanel = lazy(() => import('./TerminalPanel'));

const TerminalFallback: React.FC = () => (
  <div className="flex items-center justify-center h-full text-sm opacity-60">…</div>
);

const IDELayout: React.FC = () => {
  const { state, dispatch, isMobile, isTablet, isDesktop } = useVibecoding();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

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

  const editorHeight = bottomHeight > 0 ? `${100 - bottomHeight}%` : '100%';

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
    window.addEventListener('vibecoding:open-settings', onOpen);
    window.addEventListener('vibecoding:toggle-settings', onToggle);
    return () => {
      window.removeEventListener('vibecoding:open-settings', onOpen);
      window.removeEventListener('vibecoding:toggle-settings', onToggle);
    };
  }, []);

  return (
    <EditorMetaProvider>
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
                className="vibe-panel-left overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  width: `${leftWidth}%`,
                  minWidth: state.leftPanelVisible ? '180px' : '0',
                  maxWidth: state.leftPanelVisible ? '400px' : '0',
                  opacity: state.leftPanelVisible ? 1 : 0,
                }}
              >
                {state.leftPanelVisible && <FileExplorerPanel />}
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
            {/* Editor */}
            <div style={{ height: editorHeight }} className="overflow-hidden">
              <EditorPanel />
            </div>

            {/* Terminal - inline on all breakpoints */}
            <div
              className="vibe-panel-bottom overflow-hidden transition-all duration-300 ease-in-out bg-[var(--ide-terminal-bg)]"
              style={{
                height: state.bottomPanelVisible ? `${bottomHeight}%` : '0',
              }}
            >
              {state.bottomPanelVisible && (
                <>
                  <ResizeHandle
                    type="horizontal"
                    onMouseDown={(e) => onDragStart(e, 'bottom', containerRef.current!)}
                    onDoubleClick={() => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' })}
                  />
                  <Suspense fallback={<TerminalFallback />}>
                    <TerminalPanel />
                  </Suspense>
                </>
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
                className="vibe-panel-right overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  width: `${rightWidth}%`,
                  minWidth: state.rightPanelVisible ? '250px' : '0',
                  maxWidth: state.rightPanelVisible ? '500px' : '0',
                  opacity: state.rightPanelVisible ? 1 : 0,
                }}
              >
                {state.rightPanelVisible && <ChatPanel />}
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
    </EditorMetaProvider>
  );
};

export default IDELayout;