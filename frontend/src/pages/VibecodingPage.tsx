import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVibecoding, VibecodingProvider } from '../contexts/VibecodingContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCode,
  faTerminal,
  faRobot,
  faFolderTree,
  faUpload,
  faComments,
  faHome,
  faSun,
  faMoon,
  faBars,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons';
import IDELayout from '../components/vibecoding/IDELayout';
import CommandPalette from '../components/vibecoding/CommandPalette';
import { useTheme } from '../contexts/ThemeContext';
import './VibecodingPage.css';

/* ─── Main component ─── */
const VibecodingPageInner: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, activeFile, isMobile, isDesktop } = useVibecoding();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [paletteMode, setPaletteMode] = useState<'files' | 'commands' | null>(null);

  const openFilePalette = useCallback(() => setPaletteMode('files'), []);
  const openCommandPalette = useCallback(() => setPaletteMode('commands'), []);
  const closePalette = useCallback(() => setPaletteMode(null), []);

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+P  → file palette
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteMode('files');
        return;
      }
      // Ctrl+Shift+P → command palette
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteMode('commands');
        return;
      }
      // Ctrl+B → toggle explorer
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_LEFT_PANEL' });
        return;
      }
      // Ctrl+J → toggle terminal
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_BOTTOM_PANEL' });
        return;
      }
      // Ctrl+I → toggle AI panel
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_RIGHT_PANEL' });
        return;
      }
      // Ctrl+, → open settings
      if (mod && e.key === ',') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('vibecoding:open-settings'));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  // Bridge: status bar / command palette can request the command palette
  useEffect(() => {
    const onOpenCmd = () => setPaletteMode('commands');
    const onOpenFiles = () => setPaletteMode('files');
    window.addEventListener('vibecoding:open-palette-commands', onOpenCmd);
    window.addEventListener('vibecoding:open-palette-files', onOpenFiles);
    return () => {
      window.removeEventListener('vibecoding:open-palette-commands', onOpenCmd);
      window.removeEventListener('vibecoding:open-palette-files', onOpenFiles);
    };
  }, []);

  const isDark = theme === 'dark';

  return (
    <div
      className={`vibe-root fixed inset-0 flex flex-col overflow-hidden select-none ${isDark ? '' : 'light-theme'}`}
      style={{ color: 'var(--ide-text)', zIndex: 100 }}
    >
      {/* ═══════════════════════════════════════════════════
          CONTENT LAYER
          (the ambient gradient lives on .vibe-root::before)
          ═══════════════════════════════════════════════════ */}
      <div className="vibe-content-layer">
        {/* IDE Header / Title bar */}
        <div className={`vibe-glass flex items-center flex-shrink-0 ${isMobile ? 'h-9' : 'h-10'}`}>
          {/* Activity bar — only on desktop */}
          {isDesktop && (
            <div
              className="flex flex-col items-center w-11 h-full py-1 gap-0.5"
              style={{
                backgroundColor: 'var(--ide-sidebar-bg)',
                borderRight: '1px solid var(--ide-border)',
              }}
            >
              <button
                onClick={() => navigate('/')}
                className="w-8 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--ide-hover)] transition-colors"
                title={t('common.home', 'Басты бет')}
              >
                <FontAwesomeIcon icon={faCode} className="text-[var(--ide-accent)] text-sm" />
              </button>
              <button
                onClick={openFilePalette}
                className="w-8 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--ide-hover)] transition-colors"
                title={t('vibecoding.palette.searchFiles', 'Файл іздеу')}
              >
                <FontAwesomeIcon icon={faMagnifyingGlass} className="text-[var(--ide-text-muted)] text-xs" />
              </button>
            </div>
          )}

          {/* Title bar */}
          <div className={`flex-1 flex items-center ${isMobile ? 'px-2 gap-1' : 'px-3 gap-2'} h-full`}>
            {/* Left actions - Panel toggles */}
            <div className="flex items-center gap-1">
              {isMobile && (
                <button
                  onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANEL' })}
                  className={`vibe-header-tab !p-1.5 ${state.leftPanelVisible ? 'active' : ''}`}
                  title={t('vibecoding.layout.toggleExplorer')}
                >
                  <FontAwesomeIcon icon={faBars} className="text-[11px]" />
                </button>
              )}

              {!isMobile && (
                <button
                  onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANEL' })}
                  className={`vibe-header-tab ${state.leftPanelVisible ? 'active' : ''}`}
                  title={t('vibecoding.layout.toggleExplorer')}
                >
                  <FontAwesomeIcon icon={faFolderTree} className="text-[10px]" />
                  <span className="hidden sm:inline">{t('vibecoding.fileExplorer.title', 'Эксплорер')}</span>
                </button>
              )}

              <button
                onClick={() => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' })}
                className={`vibe-header-tab ${state.bottomPanelVisible ? 'active' : ''}`}
                title={t('vibecoding.layout.toggleTerminal')}
              >
                <FontAwesomeIcon icon={faTerminal} className="text-[10px]" />
                <span className="hidden sm:inline">{t('vibecoding.terminal.title', 'Терминал')}</span>
              </button>
            </div>

            {/* Center - title */}
            <div className="flex-1 text-center min-w-0">
              <span
                className="text-xs font-semibold tracking-wide truncate block"
                style={{ color: 'var(--ide-text)' }}
              >
                {activeFile ? (
                  <>
                    <span className="text-[var(--ide-text)]">{activeFile.name}</span>
                    {activeFile.isDirty && <span className="ml-1 text-[var(--ide-dirty)]">●</span>}
                    {!isMobile && <>{' · '}<span style={{ color: 'var(--ide-text-muted)' }}>Vibecoding</span></>}
                  </>
                ) : (
                  <span className="bg-gradient-to-r from-[var(--ide-accent)] to-[#9d7bff] bg-clip-text text-transparent">
                    Vibecoding
                  </span>
                )}
              </span>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={openCommandPalette}
                className="vibe-header-tab"
                title={t('vibecoding.status.commandPalette', 'Командалар палитрасы (Ctrl+Shift+P)')}
              >
                <FontAwesomeIcon icon={faMagnifyingGlass} className="text-[10px]" />
                <span className="hidden md:inline">{t('vibecoding.palette.commands', 'Командалар')}</span>
              </button>

              <button
                onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
                className={`vibe-header-tab ${state.rightPanelVisible ? 'active' : ''}`}
                title={t('vibecoding.layout.toggleChat')}
              >
                <FontAwesomeIcon icon={faRobot} className="text-[10px]" />
                <span className="hidden sm:inline">ЖИ</span>
              </button>

              {!isMobile && (
                <button
                  onClick={toggleTheme}
                  className="vibe-header-tab"
                  title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                >
                  <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} className="text-[10px]" />
                </button>
              )}

              <button
                onClick={() => navigate('/upload')}
                className="vibe-header-tab"
                title={t('vibecoding.layout.upload')}
              >
                <FontAwesomeIcon icon={faUpload} className="text-[10px]" />
              </button>

              <button
                onClick={() => navigate('/chat')}
                className="vibe-header-tab"
                title={t('header.chat')}
              >
                <FontAwesomeIcon icon={faComments} className="text-[10px]" />
              </button>

              <button
                onClick={() => navigate('/')}
                className="vibe-header-tab"
                title={t('common.home')}
              >
                <FontAwesomeIcon icon={faHome} className="text-[10px]" />
              </button>
            </div>
          </div>
        </div>

        {/* IDE Layout (editor + panels + terminal + status bar) */}
        <IDELayout />
      </div>

      {/* Command palette overlay */}
      {paletteMode && (
        <CommandPalette mode={paletteMode} onClose={closePalette} />
      )}
    </div>
  );
};

const VibecodingPage: React.FC = () => (
  <VibecodingProvider>
    <VibecodingPageInner />
  </VibecodingProvider>
);

export default VibecodingPage;