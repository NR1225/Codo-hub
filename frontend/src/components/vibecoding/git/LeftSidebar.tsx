import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../../contexts/VibecodingContext';
import FileExplorerPanel from '../FileExplorerPanel';
import SourceControlPanel from './SourceControlPanel';
import SearchPanel from '../SearchPanel';
import { BranchIcon, ExplorerIcon, SearchIcon, SettingsIcon } from '../icons';
import { GIT_BRANCH_EVENT } from './gitEvents';
import './SourceControl.css';

type View = 'files' | 'search' | 'git';
const VIEW_KEY = 'vibe-left-view';
const VIEW_EVENT = 'vibecoding:left-view';

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'git' || v === 'search' ? v : 'files';
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

/** Сол панель: Explorer немесе Source Control (өзгерістер + граф).
    Десктопта олар сол жақтағы белгішелер жолағы (LeftRail) арқылы бөлек ауысады,
    қойындылар тек мобильді/планшет оверлейінде көрсетіледі */
const LeftSidebar: React.FC<{ isOverlay?: boolean }> = ({ isOverlay }) => {
  const { t } = useTranslation();
  const { dispatch } = useVibecoding();
  const [view, setView] = useState<View>(loadView);
  // Source Control әрқашан жүктеулі — өзгерістер саны (бейдж) таб ашылмаса да автоматты жаңарады
  const [gitLoaded, setGitLoaded] = useState(true);
  // Іздеу де бір рет ашылса — сұрауы мен нәтижелері сақталады
  const [searchLoaded, setSearchLoaded] = useState(view === 'search');
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    if (view === 'git') setGitLoaded(true);
    if (view === 'search') setSearchLoaded(true);
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* жеке терезе */ }
  }, [view]);

  useEffect(() => {
    const onView = (e: Event) => setView((e as CustomEvent<View>).detail);
    const onBranch = (e: Event) => setChangeCount((e as CustomEvent<{ changes?: number }>).detail.changes ?? 0);
    // Ctrl+Shift+G — Source Control (VS Code сияқты)
    // Десктопта бұл пернені LeftRail өңдейді — екі рет іске қоспау үшін
    const onKey = (e: KeyboardEvent) => {
      if (!isOverlay) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyG' || e.code === 'KeyF')) {
        e.preventDefault();
        dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: true });
        showLeftView(e.code === 'KeyG' ? 'git' : 'search');
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
  }, [dispatch, isOverlay]);

  return (
    <div className="vx-left">
      {isOverlay && (
      <div className="vx-left__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'files'}
          className={`vx-left__tab ${view === 'files' ? 'is-on' : ''}`}
          onClick={() => showLeftView('files')}
        >
          <ExplorerIcon size={14} />
          {t('vibecoding.git.filesTab', 'Файлдар')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'search'}
          className={`vx-left__tab ${view === 'search' ? 'is-on' : ''}`}
          onClick={() => showLeftView('search')}
        >
          <SearchIcon size={14} />
          {t('vibecoding.search.title', 'Іздеу')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'git'}
          className={`vx-left__tab ${view === 'git' ? 'is-on' : ''}`}
          onClick={() => showLeftView('git')}
          title="Ctrl+Shift+G"
        >
          <BranchIcon size={14} />
          {t('vibecoding.git.gitTab', 'Git')}
          {changeCount > 0 && <span className="vx-left__badge">{changeCount > 99 ? '99+' : changeCount}</span>}
        </button>
      </div>
      )}
      <div className="vx-left__body" hidden={view !== 'files'}>
        <FileExplorerPanel />
      </div>
      {searchLoaded && (
        <div className="vx-left__body" hidden={view !== 'search'}>
          <SearchPanel isOverlay={isOverlay} active={view === 'search'} />
        </div>
      )}
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

type RailItem = {
  id: string;
  label: string;
  keys?: string;
  icon: React.ReactNode;
  on?: boolean;
  badge?: number;
  onClick: () => void;
};

type TipState = { label: string; keys?: string; top: number; left: number } | null;

/** Белгішенің оң жағында бірден шығатын тұспал (аты + пернелері).
    Панельдің overflow-ы кеспеуі үшін body-ге portal арқылы салынады */
const RailTip: React.FC<{ tip: TipState }> = ({ tip }) => {
  if (!tip) return null;
  return createPortal(
    <div className="vx-rail-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
      <span>{tip.label}</span>
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>,
    document.body,
  );
};

/** Сол жақтағы жіңішке белгішелер жолағы (rail) — панель ашық та, жабық та
    кезде көрініп тұрады (VS Code-тың activity bar-ы сияқты):
    Файлдар, Git (өзгерістер саны), файл іздеу және баптаулар.
    Ыңғайлылық: бірден шығатын тұспал, ашық бөлімнің белгісі,
    ↑/↓ пернелерімен жүру, Ctrl+Shift+E / Ctrl+Shift+F / Ctrl+Shift+G */
export const LeftRail: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch } = useVibecoding();
  const panelOpen = state.leftPanelVisible;
  const [changeCount, setChangeCount] = useState(0);
  const [view, setView] = useState<View>(loadView);
  const [tip, setTip] = useState<TipState>(null);
  const navRef = useRef<HTMLElement>(null);

  const setPanel = useCallback(
    (visible: boolean) => dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: visible }),
    [dispatch],
  );

  useEffect(() => {
    const onBranch = (e: Event) => setChangeCount((e as CustomEvent<{ changes?: number }>).detail.changes ?? 0);
    const onView = (e: Event) => setView((e as CustomEvent<View>).detail);
    // Ctrl+Shift+E — Файлдар, Ctrl+Shift+G — Git (VS Code сияқты); панель жабық болса да істейді
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const next: View | null =
        e.code === 'KeyE' ? 'files' : e.code === 'KeyF' ? 'search' : e.code === 'KeyG' ? 'git' : null;
      if (!next) return;
      e.preventDefault();
      showLeftView(next);
      setPanel(true);
    };
    window.addEventListener(GIT_BRANCH_EVENT, onBranch);
    window.addEventListener(VIEW_EVENT, onView);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(GIT_BRANCH_EVENT, onBranch);
      window.removeEventListener(VIEW_EVENT, onView);
      window.removeEventListener('keydown', onKey);
    };
  }, [setPanel]);

  // Панель ашылып-жабылғанда немесе бөлім ауысқанда тұспал жабылады
  useEffect(() => { setTip(null); }, [panelOpen, view]);

  // Ашық тұрған бөлімнің белгішесін қайта басса — панель жабылады
  const select = (next: View) => {
    if (panelOpen && view === next) {
      setPanel(false);
      return;
    }
    showLeftView(next);
    setPanel(true);
  };

  const showTip = (el: HTMLElement, item: RailItem) => {
    const r = el.getBoundingClientRect();
    setTip({ label: item.label, keys: item.keys, top: r.top + r.height / 2, left: r.right + 10 });
  };

  // ↑/↓ (және Home/End) — белгішелер арасында жүру
  const onNavKey = (e: React.KeyboardEvent) => {
    const btns = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('.vx-rail__btn') ?? []);
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    if (e.key === 'Escape') { setTip(null); return; }
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % btns.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = btns.length - 1;
    if (next < 0) return;
    e.preventDefault();
    btns[next].focus();
  };

  const top: RailItem[] = [
    {
      id: 'files',
      label: t('vibecoding.git.filesTab', 'Файлдар'),
      keys: 'Ctrl+Shift+E',
      icon: <ExplorerIcon size={17} />,
      on: panelOpen && view === 'files',
      onClick: () => select('files'),
    },
    {
      id: 'search',
      label: t('vibecoding.search.title', 'Іздеу'),
      keys: 'Ctrl+Shift+F',
      icon: <SearchIcon size={17} />,
      on: panelOpen && view === 'search',
      onClick: () => select('search'),
    },
    {
      id: 'git',
      label: t('vibecoding.git.gitTab', 'Git'),
      keys: 'Ctrl+Shift+G',
      icon: <BranchIcon size={17} />,
      on: panelOpen && view === 'git',
      badge: changeCount,
      onClick: () => select('git'),
    },
  ];
  const bottom: RailItem[] = [
    {
      id: 'settings',
      label: t('vibecoding.status.settings', 'Баптаулар'),
      keys: 'Ctrl+,',
      icon: <SettingsIcon size={17} />,
      onClick: () => window.dispatchEvent(new CustomEvent('vibecoding:open-settings')),
    },
  ];

  const renderBtn = (item: RailItem, d: number) => (
    <button
      key={item.id}
      type="button"
      className={`vx-rail__btn ${item.on ? 'is-on' : ''}`}
      style={{ '--d': d } as React.CSSProperties}
      onClick={item.onClick}
      onMouseEnter={(e) => showTip(e.currentTarget, item)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget, item); }}
      onBlur={() => setTip(null)}
      aria-label={item.keys ? `${item.label} (${item.keys})` : item.label}
      aria-pressed={item.on !== undefined ? item.on : undefined}
    >
      {item.icon}
      {!!item.badge && (
        <span className="vx-rail__badge" aria-hidden>{item.badge > 99 ? '99+' : item.badge}</span>
      )}
    </button>
  );

  return (
    <nav
      ref={navRef}
      className="vx-rail"
      aria-label={t('vibecoding.layout.toggleExplorer', 'Эксплорер')}
      aria-orientation="vertical"
      onKeyDown={onNavKey}
    >
      {top.map((item, i) => renderBtn(item, i + 1))}
      <span className="vx-rail__spacer" />
      {bottom.map((item, i) => renderBtn(item, top.length + i + 1))}
      <RailTip tip={tip} />
    </nav>
  );
};

export default LeftSidebar;
