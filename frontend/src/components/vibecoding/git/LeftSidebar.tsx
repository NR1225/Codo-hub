import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../../contexts/VibecodingContext';
import FileExplorerPanel from '../FileExplorerPanel';
import SourceControlPanel from './SourceControlPanel';
import { BranchIcon, ExplorerIcon } from '../icons';
import { GIT_BRANCH_EVENT } from './gitEvents';
import './SourceControl.css';

type View = 'files' | 'git';
const VIEW_KEY = 'vibe-left-view';
const VIEW_EVENT = 'vibecoding:left-view';

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'git' ? 'git' : 'files';
  } catch {
    return 'files';
  }
}

/** Сол панельді ашып, Source Control (немесе Explorer) қойындысына ауыстыру */
export function showLeftView(view: View): void {
  // Панель жабық болса — ашылғанда осы қойынды таңдалсын
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* жеке терезе */ }
  window.dispatchEvent(new CustomEvent<View>(VIEW_EVENT, { detail: view }));
}

/** Сол панель: Explorer және Source Control (өзгерістер + граф) қойындылары */
const LeftSidebar: React.FC<{ isOverlay?: boolean }> = ({ isOverlay }) => {
  const { t } = useTranslation();
  const { dispatch } = useVibecoding();
  const [view, setView] = useState<View>(loadView);
  // Source Control бір рет ашылса — күйі (өзгерістер саны) сақталып тұрады
  const [gitLoaded, setGitLoaded] = useState(view === 'git');
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    if (view === 'git') setGitLoaded(true);
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* жеке терезе */ }
  }, [view]);

  useEffect(() => {
    const onView = (e: Event) => setView((e as CustomEvent<View>).detail);
    const onBranch = (e: Event) => setChangeCount((e as CustomEvent<{ changes?: number }>).detail.changes ?? 0);
    // Ctrl+Shift+G — Source Control (VS Code сияқты)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: true });
        setView('git');
      }
    };
    window.addEventListener(VIEW_EVENT, onView);
    window.addEventListener(GIT_BRANCH_EVENT, onBranch);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(VIEW_EVENT, onView);
      window.removeEventListener(GIT_BRANCH_EVENT, onBranch);
      window.removeEventListener('keydown', onKey);
    };
  }, [dispatch]);

  return (
    <div className="vx-left">
      <div className="vx-left__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'files'}
          className={`vx-left__tab ${view === 'files' ? 'is-on' : ''}`}
          onClick={() => setView('files')}
        >
          <ExplorerIcon size={14} />
          {t('vibecoding.git.filesTab', 'Файлдар')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'git'}
          className={`vx-left__tab ${view === 'git' ? 'is-on' : ''}`}
          onClick={() => setView('git')}
          title="Ctrl+Shift+G"
        >
          <BranchIcon size={14} />
          {t('vibecoding.git.gitTab', 'Git')}
          {changeCount > 0 && <span className="vx-left__badge">{changeCount > 99 ? '99+' : changeCount}</span>}
        </button>
      </div>
      <div className="vx-left__body" hidden={view !== 'files'}>
        <FileExplorerPanel />
      </div>
      {gitLoaded && (
        <div className="vx-left__body" hidden={view !== 'git'}>
          <SourceControlPanel
            isOverlay={isOverlay}
            onClose={() => dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false })}
          />
        </div>
      )}
    </div>
  );
};

export default LeftSidebar;
