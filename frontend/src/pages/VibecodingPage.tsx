import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVibecoding, VibecodingProvider, Project, detectLanguage } from '../contexts/VibecodingContext';
import { apiService } from '../utils/api';
import { ExplorerIcon, MenuIcon, TerminalIcon, SparkleIcon, SearchIcon, CommandIcon } from '../components/vibecoding/icons';
import IDELayout from '../components/vibecoding/IDELayout';
import CommandPalette from '../components/vibecoding/CommandPalette';
import './VibecodingPage.css';
import '../components/vibecoding/VibecodingPanels.css';

/* ─── Main component ─── */
const VibecodingPageInner: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, activeFile, activeProject, isMobile, syncReady } = useVibecoding();

  const [paletteMode, setPaletteMode] = useState<'files' | 'commands' | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Басты беттің «Жобалар» панелінен келу:
  //   ?project=<id>  — Vibecoding жобасы
  //   ?repo=<codeId> — жүктелген жоба (бірінші рет ашылғанда Vibecoding-ке көшіріледі)
  //   &file=<path>   — ашылатын файл
  const handledLinkRef = useRef<string | null>(null);
  useEffect(() => {
    const projectId = searchParams.get('project');
    const repoId = searchParams.get('repo');
    if ((!projectId && !repoId) || !syncReady) return;
    const linkKey = searchParams.toString();
    if (handledLinkRef.current === linkKey) return;
    handledLinkRef.current = linkKey;
    const path = searchParams.get('file') || undefined;

    const openTarget = async () => {
      if (projectId) {
        dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId, path } });
        return;
      }
      const targetId = `repo-${repoId}`;
      if (!state.projects.some((p) => p.id === targetId)) {
        const root = await apiService.getCodeFile(repoId!);
        const sources = root.isFolder
          ? (await apiService.getCodeFiles(repoId!, 1000, 0, true)).codes
          : [root];
        const project: Project = {
          id: targetId,
          name: root.title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          files: sources.map((f) => {
            const filePath = f.folderPath || f.title;
            const name = filePath.split('/').pop() || f.title;
            return { id: f.id, name, path: filePath, content: f.content ?? '', language: detectLanguage(name), isDirty: false };
          }),
        };
        dispatch({ type: 'UPSERT_PROJECT', payload: { project } });
      }
      dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId: targetId, path } });
    };

    openTarget()
      .catch((err) => console.error('Failed to open project in Vibecoding:', err))
      .finally(() => setSearchParams({}, { replace: true }));
  }, [searchParams, setSearchParams, syncReady, state.projects, dispatch]);

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

  // Бет басты беттің дизайн тілінде: сайт хедері үстінде, қара фон,
  // қалқымалы панельдер (Home.css, HomeSidebar.css)
  return (
    <div className="vibe-root select-none">
      {/* Фон: жоғарыдан түсетін жұмсақ жарық + нүктелі тор */}
      <div className="vibe-ambient" aria-hidden="true">
        <span className="vibe-ambient__glow vibe-ambient__glow--a" />
        <span className="vibe-ambient__glow vibe-ambient__glow--b" />
        <span className="vibe-ambient__grid" />
      </div>
      <div className="vibe-content-layer">
        {/* Құралдар панелі — IDE панельдерін басқару */}
        <div className="vibe-toolbar">
          <div className="vibe-toolbar__group">
            <button
              onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANEL' })}
              className={`vibe-header-tab ${state.leftPanelVisible ? 'active' : ''}`}
              title={t('vibecoding.layout.toggleExplorer')}
            >
              <span className="vibe-header-tab__icon">
                {isMobile ? <MenuIcon size={16} /> : <ExplorerIcon size={16} />}
              </span>
              <span className="vibe-header-tab__text">{t('vibecoding.fileExplorer.title', 'Эксплорер')}</span>
            </button>

            <button
              onClick={() => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' })}
              className={`vibe-header-tab ${state.bottomPanelVisible ? 'active' : ''}`}
              title={t('vibecoding.layout.toggleTerminal')}
            >
              <span className="vibe-header-tab__icon">
                <TerminalIcon size={16} />
              </span>
              <span className="vibe-header-tab__text">{t('vibecoding.terminal.title', 'Терминал')}</span>
            </button>
          </div>

          {/* Ортада — жоба мен ашық файл */}
          <div className="vibe-toolbar__title">
            <span className="vibe-toolbar__brand">
              <span className="vibe-toolbar__brand-dot" />
              Vibecoding
            </span>
            {activeProject && !isMobile && (
              <>
                <span className="vibe-toolbar__sep">/</span>
                <span className="vibe-toolbar__project">{activeProject.name}</span>
              </>
            )}
            {activeFile && (
              <>
                <span className="vibe-toolbar__sep">/</span>
                <span className="vibe-toolbar__file">{activeFile.name}</span>
                {activeFile.isDirty && <span className="vibe-toolbar__dirty" aria-label="unsaved" />}
              </>
            )}
          </div>

          <div className="vibe-toolbar__group">
            <button
              onClick={openFilePalette}
              className="vibe-toolbar__search"
              title={t('vibecoding.palette.searchFiles', 'Файл іздеу')}
            >
              <SearchIcon size={15} />
              <span className="vibe-toolbar__search-text">{t('vibecoding.palette.searchFiles', 'Файл іздеу')}</span>
              <kbd>Ctrl P</kbd>
            </button>

            <button
              onClick={openCommandPalette}
              className="vibe-header-tab vibe-header-tab--icon"
              title={t('vibecoding.status.commandPalette', 'Командалар палитрасы (Ctrl+Shift+P)')}
            >
              <span className="vibe-header-tab__icon">
                <CommandIcon size={16} />
              </span>
            </button>

            <button
              onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
              className={`vibe-header-tab ${state.rightPanelVisible ? 'active' : ''}`}
              title={t('vibecoding.layout.toggleChat')}
            >
              <span className="vibe-header-tab__icon">
                <SparkleIcon size={16} />
              </span>
              <span className="vibe-header-tab__text">ЖИ</span>
            </button>
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