import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVibecoding, VibecodingProvider, Project, detectLanguage } from '../contexts/VibecodingContext';
import { apiService } from '../utils/api';
import {
  SearchIcon, CommandIcon, PanelLeftIcon, PanelBottomIcon, PanelRightIcon, PlayIcon, StopIcon,
} from '../components/vibecoding/icons';
import { emitVibe, useRunState } from '../utils/vibeControl';
import IDELayout from '../components/vibecoding/IDELayout';
import CommandPalette from '../components/vibecoding/CommandPalette';
import ProjectTabsBar from '../components/vibecoding/ProjectTabsBar';
import { showLeftView } from '../components/vibecoding/git/LeftSidebar';
import './VibecodingPage.css';
import '../components/vibecoding/VibecodingPanels.css';

/* ─── Main component ─── */
const VibecodingPageInner: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, syncReady, activeProject } = useVibecoding();
  const run = useRunState();
  const runMine = !run.projectId || run.projectId === activeProject?.id;
  const runBusy = runMine && (run.phase === 'planning' || run.phase === 'starting');
  // Тоқтатуға болатын процесс: сервер немесе әлі аяқталмаған скрипт
  const canStop = runMine && (runBusy || (run.phase === 'running' && (run.kind === 'server' || run.kind === 'console')));
  const runLabel = runBusy
    ? (run.phase === 'planning' ? t('vibecoding.preview.runPlanning', 'Тексерілуде…') : t('vibecoding.preview.runStarting', 'Іске қосылуда…'))
    : runMine && run.phase === 'running' && run.kind === 'server'
      ? t('vibecoding.preview.runReload', 'Жаңарту')
      : t('vibecoding.preview.run', 'Іске қосу');

  const [paletteMode, setPaletteMode] = useState<'files' | 'commands' | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Басты беттің «Жобалар» панелінен келу:
  //   ?project=<id>  — Vibecoding жобасы
  //   ?repo=<codeId> — жүктелген жоба (бірінші рет ашылғанда Vibecoding-ке көшіріледі)
  //   &file=<path>   — ашылатын файл
  //   &run=1         — ашылған соң бірден іске қосу (Кодты көру бетіндегі батырма)
  const handledLinkRef = useRef<string | null>(null);
  useEffect(() => {
    const projectId = searchParams.get('project');
    const repoId = searchParams.get('repo');
    if ((!projectId && !repoId) || !syncReady) return;
    const linkKey = searchParams.toString();
    if (handledLinkRef.current === linkKey) return;
    handledLinkRef.current = linkKey;
    const path = searchParams.get('file') || undefined;
    const shouldRun = searchParams.get('run') === '1';

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
      .then(() => {
        // Жоба күйге түскен соң (келесі рендерден кейін) алдын ала көріністі іске қосамыз
        if (shouldRun) setTimeout(() => emitVibe('run'), 150);
      })
      .catch((err) => console.error('Failed to open project in Vibecoding:', err))
      .finally(() => setSearchParams({}, { replace: true }));
  }, [searchParams, setSearchParams, syncReady, state.projects, dispatch]);

  // Іздеу — модалка емес, сол сайтбардағы «Іздеу» бөлімі
  const openSearchSidebar = useCallback(() => {
    showLeftView('search');
    dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: true });
  }, [dispatch]);
  const openCommandPalette = useCallback(() => setPaletteMode('commands'), []);
  const closePalette = useCallback(() => setPaletteMode(null), []);

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+Enter → жобаны іске қосу (F5 браузердің өз жаңартуы болып қалады)
      if (mod && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        emitVibe('run');
        return;
      }

      // Ctrl+P  → file palette
      if (mod && !e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        setPaletteMode('files');
        return;
      }
      // Ctrl+Shift+P → command palette
      if (mod && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        setPaletteMode('commands');
        return;
      }
      // Ctrl+B → toggle explorer
      if (mod && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_LEFT_PANEL' });
        return;
      }
      // Ctrl+J → toggle terminal
      if (mod && !e.shiftKey && e.code === 'KeyJ') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_BOTTOM_PANEL' });
        return;
      }
      // Ctrl+I → toggle AI panel
      if (mod && !e.shiftKey && e.code === 'KeyI') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_RIGHT_PANEL' });
        return;
      }
      // Ctrl+, → open settings
      if (mod && e.code === 'Comma') {
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

  // Құралдар қатары — тек ортаңғы баған (редактор) енінде, сайдбарлар
  // оның қасынан жоба табтарына дейін көтеріледі
  const toolbar = (
    <div className="vibe-toolbar">
      <div className="vibe-toolbar__side" />

      {/* Ортада — файл іздеу (VS Code-тағы command center сияқты) */}
      <button
        onClick={openSearchSidebar}
        className="vibe-toolbar__search"
        title={`${t('vibecoding.search.title', 'Іздеу')} (Ctrl+Shift+F)`}
      >
        <SearchIcon size={13} />
        <span className="vibe-toolbar__search-text">{t('vibecoding.palette.searchFiles', 'Файл іздеу')}</span>
      </button>

      {/* Оң жақта — панельдерді ашып-жабатын белгішелер бір топта */}
      <div className="vibe-toolbar__side vibe-toolbar__side--end">
        <div className={`vibe-run-group ${canStop ? 'has-stop' : ''}`}>
          <button
            onClick={() => emitVibe('run')}
            className={`vibe-run-btn ${runBusy ? 'is-busy' : ''} ${runMine && run.phase === 'error' ? 'is-error' : ''} ${runMine && run.phase === 'running' && run.kind === 'server' ? 'is-live' : ''}`}
            title={runMine && run.phase === 'error' && run.error
              ? `${run.error}
${t('vibecoding.preview.retry', 'Қайта іске қосу')} (Ctrl+Enter)`
              : `${runLabel} (Ctrl+Enter)`}
            aria-busy={runBusy}
          >
            {runBusy ? <span className="vibe-run-btn__spin" aria-hidden="true" /> : <PlayIcon size={13} />}
            <span className="vibe-run-btn__text">{runLabel}</span>
          </button>
          {canStop && (
            <button
              onClick={() => emitVibe('stop')}
              className="vibe-run-btn vibe-run-btn--stop"
              title={t('vibecoding.preview.stop', 'Тоқтату')}
            >
              <StopIcon size={13} />
            </button>
          )}
        </div>
        <span className="vibe-toolbar__divider" />
        <button
          onClick={openCommandPalette}
          className="vibe-header-tab vibe-header-tab--icon"
          title={t('vibecoding.status.commandPalette', 'Командалар палитрасы (Ctrl+Shift+P)')}
        >
          <CommandIcon size={15} />
        </button>
        <span className="vibe-toolbar__divider" />
        <button
          onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANEL' })}
          className={`vibe-header-tab vibe-header-tab--icon ${state.leftPanelVisible ? 'active' : ''}`}
          title={`${t('vibecoding.layout.toggleExplorer')} (Ctrl+B)`}
        >
          <PanelLeftIcon size={16} active={state.leftPanelVisible} />
        </button>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' })}
          className={`vibe-header-tab vibe-header-tab--icon ${state.bottomPanelVisible ? 'active' : ''}`}
          title={`${t('vibecoding.layout.toggleTerminal')} (Ctrl+J)`}
        >
          <PanelBottomIcon size={16} active={state.bottomPanelVisible} />
        </button>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
          className={`vibe-header-tab vibe-header-tab--icon ${state.rightPanelVisible ? 'active' : ''}`}
          title={`${t('vibecoding.layout.toggleChat')} (Ctrl+I)`}
        >
          <PanelRightIcon size={16} active={state.rightPanelVisible} />
        </button>
      </div>
    </div>
  );

  // IDE стилі: әсерлер аз — басты назар кодта
  return (
    <div className="vibe-root select-none">
      <div className="vibe-content-layer">
        {/* Жоба табтары (жоба қосу, іздеу) — беттің ең жоғарғы қатары */}
        <ProjectTabsBar />

        {/* IDE Layout (editor + panels + terminal + status bar) */}
        <IDELayout centerToolbar={toolbar} />
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