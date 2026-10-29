import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useTerminal, TerminalShortcut, TerminalSearchResult } from '../../hooks/useTerminal';
import { useAuth } from '../../contexts/AuthContext';
import { useVibecoding, WorkspaceChanges } from '../../contexts/VibecodingContext';
import { askBurkit, requestReveal, TERMINAL_RUN_EVENT, peekTerminalRuns, takeTerminalRun } from '../../utils/vibeBridge';
import { detectRunCommands, loadHistory, pushHistory, resolveProjectFile } from './terminalCommands';
import {
  PlugIcon, CloseIcon, TerminalIcon, ExpandIcon, CollapseIcon,
  PlusIcon, FolderIcon, HomeIcon, SplitIcon, PlayIcon, SparkleIcon,
  SearchIcon, ArrowUpIcon, CopyIcon, ChevronDownIcon, HistoryIcon, TrashIcon,
} from './icons';

// Сервердегі TERMINAL_MAX_SESSIONS_PER_USER-мен бірдей
const MAX_TABS = 5;
// Бір топта (бөлінген экранда) қатар тұратын терминалдар
const MAX_SPLIT = 3;

const FONT_KEY = 'vibe-terminal-font';
const FONT_DEFAULT = 13;
const FONT_MIN = 9;
const FONT_MAX = 24;

type TabStatus = 'on' | 'wait' | 'off';

interface TermTab {
  id: string;
  /** Терминал ашылған жоба (null — үй папкасы) */
  projectId: string | null;
  /** Бөлінген экран: бір топтағы табтар қатар көрсетіледі */
  group: string;
  /** Қолданушы берген ат (жоқ болса — жобаның аты) */
  title?: string;
}

let tabSeq = 0;
const newTabId = () => `term-${Date.now().toString(36)}-${++tabSeq}`;

// Ашық табтар бет жаңартылғанда (немесе панель жабылып-ашылғанда) қалпына келеді —
// әр таб қайта қосылып, жаңа shell сессиясын ашады
const TABS_KEY = 'vibe-terminal-tabs';

function loadTabs(): { tabs: TermTab[]; activeId: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
    if (raw && Array.isArray(raw.tabs)) {
      const tabs: TermTab[] = raw.tabs
        .filter((x: unknown): x is TermTab => !!x && typeof (x as TermTab).id === 'string')
        .slice(0, MAX_TABS)
        .map((x: TermTab) => ({
          id: x.id,
          projectId: typeof x.projectId === 'string' ? x.projectId : null,
          group: typeof x.group === 'string' ? x.group : x.id,
          title: typeof x.title === 'string' && x.title.trim() ? x.title.slice(0, 40) : undefined,
        }));
      const activeId = tabs.some(x => x.id === raw.activeId) ? raw.activeId : tabs[0]?.id ?? null;
      return { tabs, activeId };
    }
  } catch { /* бұзылған жазба */ }
  return { tabs: [], activeId: null };
}

function loadFontSize(): number {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    if (n >= FONT_MIN && n <= FONT_MAX) return n;
  } catch { /* жеке терезе */ }
  return FONT_DEFAULT;
}

// ─── Бір терминал (бір таб = бір shell сессиясы) ──────────────────────

interface TerminalViewHandle {
  clear: () => void;
  focus: () => void;
  sendText: (text: string) => void;
  copySelection: () => boolean;
  paste: () => void;
  selectAll: () => void;
  getSelection: () => string;
  getRecentText: (lines: number) => string;
  findNext: (query: string, incremental?: boolean) => boolean;
  findPrevious: (query: string) => boolean;
  clearSearch: () => void;
}

interface TerminalViewProps {
  tab: TermTab;
  /** Белсенді топта — экранда көрінеді */
  visible: boolean;
  /** Курсор осы терминалда */
  focused: boolean;
  /** Табтар ретімен тұруы үшін (DOM-да ретін ауыстырмаймыз — xterm қайта салынбасын) */
  order: number;
  fontSize: number;
  onStatus: (id: string, status: TabStatus, error: string | null) => void;
  onFocusPane: (id: string) => void;
  onShortcut: (id: string, action: TerminalShortcut) => void;
  onSubmit: (id: string, command: string | null) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onAskBurkit: (id: string, isError: boolean) => void;
  onSearchResult: (id: string, result: TerminalSearchResult | null) => void;
  resolveFile: (projectId: string, raw: string) => string | null;
  onOpenFile: (projectId: string, path: string, line: number, column: number) => void;
}

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(({
  tab, visible, focused, order, fontSize, onStatus, onFocusPane, onShortcut, onSubmit,
  onContextMenu, onAskBurkit, onSearchResult, resolveFile, onOpenFile,
}, ref) => {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { dispatch } = useVibecoding();
  // Шығыста қате көрінсе — «Бүркітпен түсіндіру» батырмасы шығады (келесі командаға дейін)
  const [hasError, setHasError] = useState(false);

  // Терминалда жасалған/өзгерген/өшірілген файлдар — редакторға
  const onFsChanges = useCallback((projectId: string, changes: WorkspaceChanges) => {
    dispatch({ type: 'APPLY_WORKSPACE_CHANGES', payload: { projectId, changes } });
  }, [dispatch]);

  const projectId = tab.projectId;
  const term = useTerminal({
    projectId,
    onFsChanges,
    fontSize,
    resolveFile: projectId ? (raw) => resolveFile(projectId, raw) : undefined,
    onOpenFile: projectId ? (path, line, column) => onOpenFile(projectId, path, line, column) : undefined,
    onShortcut: (action) => onShortcut(tab.id, action),
    onErrorOutput: () => setHasError(true),
    onSubmit: (command) => {
      setHasError(false);
      onSubmit(tab.id, command);
    },
  });
  const { terminalRef, status, connect, focus, fit, searchResult } = term;

  useImperativeHandle(ref, () => ({
    clear: term.clear,
    focus: term.focus,
    sendText: term.sendText,
    copySelection: term.copySelection,
    paste: term.paste,
    selectAll: term.selectAll,
    getSelection: term.getSelection,
    getRecentText: term.getRecentText,
    findNext: term.findNext,
    findPrevious: term.findPrevious,
    clearSearch: term.clearSearch,
  }), [term.clear, term.focus, term.sendText, term.copySelection, term.paste, term.selectAll,
    term.getSelection, term.getRecentText, term.findNext, term.findPrevious, term.clearSearch]);

  // Токен 5 минут сайын жаңарады — қайта қосылу әрқашан ең соңғысын алсын
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  const start = useCallback(() => {
    connect(async () => getTokenRef.current());
  }, [connect]);

  // Таб ашылғанда бірден қосыламыз
  useEffect(() => {
    void start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onStatus(tab.id, status === 'open' ? 'on' : status === 'connecting' ? 'wait' : 'off', term.error);
  }, [tab.id, status, term.error, onStatus]);

  useEffect(() => {
    onSearchResult(tab.id, searchResult);
  }, [tab.id, searchResult, onSearchResult]);

  // Көрінгенде — өлшемді түзетеміз; белсенді болса — курсорды терминалға қоямыз
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => {
      fit();
      if (focused) focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, focused, fit, focus]);

  return (
    <div
      className={`vx-term__pane ${visible ? 'is-visible' : ''} ${focused ? 'is-focused' : ''}`}
      style={{ order }}
      aria-hidden={!visible}
      onMouseDown={() => onFocusPane(tab.id)}
      onFocusCapture={() => onFocusPane(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onFocusPane(tab.id);
        onContextMenu(tab.id, e.clientX, e.clientY);
      }}
    >
      <div
        ref={(el) => { (terminalRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
        className="vx-term__screen"
      />
      {hasError && status === 'open' && (
        <div className="vx-term__float">
          <button
            type="button"
            className="vx-term__ask"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setHasError(false);
              onAskBurkit(tab.id, true);
            }}
          >
            <SparkleIcon size={13} />
            <span>{t('vibecoding.terminal.explainError', 'Қатені Бүркітпен түсіндіру')}</span>
          </button>
          <button
            type="button"
            className="vx-term__ask-close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setHasError(false)}
            aria-label={t('common.close', 'Жабу')}
          >
            <CloseIcon size={11} />
          </button>
        </div>
      )}
      {/* Батырма тек байланыс шынымен тоқтағанда — қосылу/қайта қосылу кезінде емес */}
      {status === 'closed' && (
        <div className="vx-term__float">
          <button type="button" onClick={start} className="vx-term__connect">
            <PlugIcon size={13} />
            <span>{t('vibecoding.terminal.reconnect', 'Қосылу')}</span>
          </button>
        </div>
      )}
    </div>
  );
});
TerminalView.displayName = 'TerminalView';

// ─── Панель: табтар + әрекеттер ────────────────────────────────────────

type Menu =
  | { kind: 'run'; right: number; top: number }
  | { kind: 'context'; tabId: string; x: number; y: number };

const TerminalPanel: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, activeProject, flushProjects } = useVibecoding();
  const [initialTabs] = useState(loadTabs);
  const [tabs, setTabs] = useState<TermTab[]>(initialTabs.tabs);
  const [activeId, setActiveId] = useState<string | null>(initialTabs.activeId);

  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeId }));
    } catch { /* жеке терезе — тек осы сессияда */ }
  }, [tabs, activeId]);

  const [fontSize, setFontSize] = useState(loadFontSize);
  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch { /* жеке терезе */ }
  }, [fontSize]);

  const [statuses, setStatuses] = useState<Record<string, { status: TabStatus; error: string | null }>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [opening, setOpening] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Record<string, TerminalSearchResult | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const dragIdRef = useRef<string | null>(null);
  // Esc басылғанда blur-дағы сақтау іске аспасын
  const renameCancelRef = useRef(false);
  const views = useRef(new Map<string, TerminalViewHandle>());
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find(tab => tab.id === activeId) ?? null;
  const activeGroup = activeTab?.group ?? null;
  const activeStatus = activeId ? statuses[activeId] : undefined;
  const activeView = () => (activeId ? views.current.get(activeId) : undefined);
  const groupSize = (group: string) => tabs.filter(tab => tab.group === group).length;

  const onStatus = useCallback((id: string, status: TabStatus, error: string | null) => {
    setStatuses(prev => (
      prev[id]?.status === status && prev[id]?.error === error ? prev : { ...prev, [id]: { status, error } }
    ));
  }, []);

  const onSearchResult = useCallback((id: string, result: TerminalSearchResult | null) => {
    setSearchResults(prev => (prev[id] === result ? prev : { ...prev, [id]: result }));
  }, []);

  /** split — белсенді терминалдың жанына (сол жобада) ашады */
  const addTab = useCallback(async (split = false) => {
    if (tabs.length >= MAX_TABS || opening) return;
    const base = split ? activeTab : null;
    if (split && (!base || tabs.filter(x => x.group === base.group).length >= MAX_SPLIT)) return;
    setOpening(true);
    // Жобаның соңғы нұсқасы серверде болсын — терминал папкасы содан жасалады
    try {
      await flushProjects();
    } catch { /* сақталмаса да терминал ашылады */ }
    const id = newTabId();
    const tab: TermTab = base
      ? { id, projectId: base.projectId, group: base.group }
      : { id, projectId: activeProject?.id ?? null, group: id };
    setTabs(prev => {
      if (!base) return [...prev, tab];
      // Топтың соңғы табынан кейін қоямыз — табтар қатарында бірге тұрсын
      let at = -1;
      prev.forEach((x, i) => { if (x.group === base.group) at = i; });
      const next = [...prev];
      next.splice(at + 1, 0, tab);
      return next;
    });
    setActiveId(id);
    setOpening(false);
  }, [tabs, opening, activeTab, flushProjects, activeProject?.id]);

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex(tab => tab.id === id);
    const closing = tabs[idx];
    const next = tabs.filter(tab => tab.id !== id);
    setTabs(next);
    // Жабылған таб белсенді болса — алдымен сол топтағы көршісіне, болмаса қатардағы көршісіне
    if (activeId === id) {
      const sibling = next.find(tab => tab.group === closing?.group);
      setActiveId(sibling?.id ?? next[Math.min(idx, next.length - 1)]?.id ?? null);
    }
    setStatuses(prev => {
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
    if (editingId === id) setEditingId(null);
    views.current.delete(id);
    // Соңғы терминал жабылса — панель де жабылады (VS Code сияқты)
    if (next.length === 0) dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: false });
  }, [tabs, activeId, editingId, dispatch]);

  // Панель ашылғанда терминал жоқ болса — бірден жаңасын ашамыз (VS Code: Ctrl+`)
  useEffect(() => {
    if (state.bottomPanelVisible && tabs.length === 0 && !opening) void addTab();
  }, [state.bottomPanelVisible, tabs.length, opening, addTab]);

  // ─── Іздеу (Ctrl+F) ───

  const openSearch = useCallback(() => {
    const sel = activeId ? views.current.get(activeId)?.getSelection() ?? '' : '';
    if (sel && !sel.includes('\n')) setQuery(sel);
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, [activeId]);

  const closeSearch = () => {
    setSearchOpen(false);
    activeView()?.clearSearch();
    activeView()?.focus();
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (value) activeView()?.findNext(value, true);
    else activeView()?.clearSearch();
  };

  // ─── Пернелер ───

  const zoom = useCallback((action: 'zoom-in' | 'zoom-out' | 'zoom-reset') => {
    setFontSize(f => {
      if (action === 'zoom-reset') return FONT_DEFAULT;
      return Math.min(FONT_MAX, Math.max(FONT_MIN, f + (action === 'zoom-in' ? 1 : -1)));
    });
  }, []);

  // Табтар қатарындағы ретпен ауысу (соңынан басына айналады)
  const switchTab = useCallback((id: string, action: 'next-tab' | 'prev-tab' | { tab: number }) => {
    if (tabs.length === 0) return;
    let target: TermTab | undefined;
    if (typeof action === 'object') {
      target = tabs[action.tab - 1];
    } else {
      const idx = tabs.findIndex(tab => tab.id === id);
      const step = action === 'next-tab' ? 1 : -1;
      target = tabs[(idx + step + tabs.length) % tabs.length];
    }
    if (target && target.id !== id) setActiveId(target.id);
  }, [tabs]);

  const onShortcut = useCallback((id: string, action: TerminalShortcut) => {
    if (action === 'find') openSearch();
    else if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') zoom(action);
    else switchTab(id, action);
  }, [openSearch, zoom, switchTab]);

  // Ctrl+Shift+` — жаңа терминал, Ctrl+Shift+5 — бөлу (VS Code сияқты); Esc — мәзір/жайылғанды жабу
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.code === 'Backquote' || e.key === '~')) {
        e.preventDefault();
        void addTab();
      } else if (mod && e.shiftKey && e.code === 'Digit5' && wrapRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        void addTab(true);
      } else if (e.key === 'Escape') {
        if (menu) setMenu(null);
        else if (isMaximized) setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addTab, isMaximized, menu]);

  // Мәзірден тыс басылса — жабамыз
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current?.contains(target) || target.closest('[data-term-menu-toggle]')) return;
      setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // ─── Команда тарихы ───

  const onSubmit = useCallback((id: string, command: string | null) => {
    if (!command) return;
    const tab = tabs.find(x => x.id === id);
    pushHistory(tab?.projectId ?? null, command);
  }, [tabs]);

  const runCommand = (cmd: string) => {
    setMenu(null);
    activeView()?.sendText(cmd);
  };

  // ─── Бүркіт пен редактор ───

  const askAboutTerminal = useCallback((id: string, isError: boolean) => {
    const view = views.current.get(id);
    if (!view) return;
    const sel = view.getSelection().trim();
    // Бүркітке тым ұзын мәтін жібермейміз — соңғы бөлігі жеткілікті
    const text = (sel || view.getRecentText(60)).slice(-6000);
    if (!text) return;
    const intro = isError && !sel
      ? t('vibecoding.terminal.promptError', 'Терминалда қате шықты. Себебін түсіндіріп, қалай түзетуге болатынын айт:')
      : t('vibecoding.terminal.promptOutput', 'Терминалдағы мына шығысты түсіндір:');
    askBurkit(`${intro}\n\n\`\`\`\n${text}\n\`\`\``);
    setIsMaximized(false);
    dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: true });
  }, [t, dispatch]);

  const resolveFile = useCallback((projectId: string, raw: string) => (
    resolveProjectFile(state.projects.find(p => p.id === projectId), raw)
  ), [state.projects]);

  const onOpenFile = useCallback((projectId: string, path: string, line: number, column: number) => {
    requestReveal({ path, line, column });
    dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId, path } });
    setIsMaximized(false);
  }, [dispatch]);

  // ─── Бүркіттің командалары ───
  // Сұраныс келгенде: жобаның қосулы терминалында орындаймыз; ондай терминал жоқ болса — ашамыз
  const [runTick, setRunTick] = useState(0);
  useEffect(() => {
    const onRun = () => setRunTick(n => n + 1);
    window.addEventListener(TERMINAL_RUN_EVENT, onRun);
    return () => window.removeEventListener(TERMINAL_RUN_EVENT, onRun);
  }, []);

  useEffect(() => {
    const queue = peekTerminalRuns();
    if (queue.length === 0) return;
    const req = queue[0];
    const own = tabs.filter(tab => tab.projectId === req.projectId);
    const ready = own.find(tab => tab.id === activeId && statuses[tab.id]?.status === 'on')
      ?? own.find(tab => statuses[tab.id]?.status === 'on');
    const view = ready && views.current.get(ready.id);
    if (ready && view) {
      takeTerminalRun(req);
      setActiveId(ready.id);
      setIsMaximized(false);
      view.sendText(req.command);
      req.resolve();
      setRunTick(n => n + 1); // кезектегі келесісі
      return;
    }
    // Терминал жоқ (немесе бәрі ажыраған) — жаңасы ашылады; қосылып жатса — күтеміз
    const connecting = own.some(tab => statuses[tab.id]?.status !== 'off');
    // Панель бос ашылса, бірінші табты жоғарыдағы эффект өзі ашады
    const autoOpening = state.bottomPanelVisible && tabs.length === 0;
    if (autoOpening) return;
    if (!connecting && !opening && activeProject?.id === req.projectId && tabs.length < MAX_TABS) void addTab();
    else if (!connecting && !opening && (activeProject?.id !== req.projectId || tabs.length >= MAX_TABS)) {
      takeTerminalRun(req);
      req.reject(new Error(tabs.length >= MAX_TABS ? 'Терминал табтарының шегі толды' : 'Жоба ауысып кетті'));
    }
  }, [runTick, tabs, statuses, activeId, opening, activeProject?.id, addTab, state.bottomPanelVisible]);

  // ─── Табтар: ат беру, сүйреп ауыстыру ───

  const tabLabel = (tab: TermTab) => {
    if (tab.title) return tab.title;
    if (!tab.projectId) return t('vibecoding.terminal.home', 'Үй папкасы');
    const name = state.projects.find(p => p.id === tab.projectId)?.name ?? t('vibecoding.terminal.project', 'Жоба');
    // Бір жобада бірнеше терминал болса — нөмірлейміз
    const same = tabs.filter(x => x.projectId === tab.projectId && !x.title);
    return same.length > 1 ? `${name} ${same.indexOf(tab) + 1}` : name;
  };

  const startRename = (tab: TermTab) => {
    setMenu(null);
    renameCancelRef.current = false;
    setEditingId(tab.id);
    setEditValue(tabLabel(tab));
  };

  const commitRename = () => {
    if (!editingId || renameCancelRef.current) return;
    const title = editValue.trim().slice(0, 40) || undefined;
    setTabs(prev => prev.map(tab => (tab.id === editingId ? { ...tab, title } : tab)));
    setEditingId(null);
  };

  const moveTab = (from: string, to: string, after: boolean) => {
    if (from === to) return;
    setTabs(prev => {
      const moving = prev.find(tab => tab.id === from);
      if (!moving) return prev;
      const rest = prev.filter(tab => tab.id !== from);
      const at = rest.findIndex(tab => tab.id === to);
      if (at < 0) return prev;
      rest.splice(after ? at + 1 : at, 0, moving);
      return rest;
    });
  };

  const error = activeStatus?.error;
  const canAdd = tabs.length < MAX_TABS && !opening;
  const canSplit = canAdd && !!activeTab && groupSize(activeTab.group) < MAX_SPLIT;
  const searchResult = activeId ? searchResults[activeId] : null;
  // DOM-дағы тұрақты рет (жасалу уақыты бойынша); көрінетін рет — CSS order
  const paneOrder = [...tabs].sort((a, b) => a.id.localeCompare(b.id));

  const runProject = activeTab?.projectId ? state.projects.find(p => p.id === activeTab.projectId) : null;
  const runCommands = menu?.kind === 'run' ? detectRunCommands(runProject) : [];
  const recent = menu?.kind === 'run' ? loadHistory(activeTab?.projectId ?? null) : [];

  const contextTab = menu?.kind === 'context' ? tabs.find(tab => tab.id === menu.tabId) ?? null : null;
  const contextView = contextTab ? views.current.get(contextTab.id) : undefined;
  const contextHasSelection = !!contextView?.getSelection();

  return (
    <div className="vx-term-wrap" ref={wrapRef}>
      <div className={`vx-term ${isMaximized ? 'is-max' : ''}`}>
        <div className="vx-term__bar select-none">
          <span className="vx-term__icon">
            <TerminalIcon size={15} />
          </span>

          {tabs.length === 0 ? (
            <span className="vx-term__title">{t('vibecoding.terminal.title', 'Терминал')}</span>
          ) : (
            <div className="vx-term__tabs" role="tablist">
              {tabs.map((tab, index) => {
                const st = statuses[tab.id]?.status ?? 'wait';
                const grouped = groupSize(tab.group) > 1;
                const editing = editingId === tab.id;
                const cls = [
                  'vx-term__tab',
                  tab.id === activeId ? 'is-active' : tab.group === activeGroup ? 'is-visible' : '',
                  grouped ? 'is-grouped' : '',
                  drop?.id === tab.id ? (drop.after ? 'is-drop-after' : 'is-drop-before') : '',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={tab.id}
                    role="tab"
                    tabIndex={0}
                    aria-selected={tab.id === activeId}
                    className={cls}
                    draggable={!editing}
                    onClick={() => setActiveId(tab.id)}
                    onDoubleClick={() => startRename(tab)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setActiveId(tab.id);
                      else if (e.key === 'F2') startRename(tab);
                    }}
                    onAuxClick={(e) => { if (e.button === 1) closeTab(tab.id); }}
                    onDragStart={(e) => {
                      dragIdRef.current = tab.id;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', tab.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragIdRef.current || dragIdRef.current === tab.id) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const after = e.clientX > rect.left + rect.width / 2;
                      if (drop?.id !== tab.id || drop.after !== after) setDrop({ id: tab.id, after });
                    }}
                    onDragLeave={() => { if (drop?.id === tab.id) setDrop(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdRef.current && drop) moveTab(dragIdRef.current, tab.id, drop.after);
                      dragIdRef.current = null;
                      setDrop(null);
                    }}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                      setDrop(null);
                    }}
                    title={`${tabLabel(tab)} — Alt+${index + 1} · ${t('vibecoding.terminal.rename', 'Атын өзгерту')}: F2`}
                  >
                    <span className={`vx-term__tab-dot is-${st}`} />
                    <span className="vx-term__tab-icon">
                      {grouped ? <SplitIcon size={12} /> : tab.projectId ? <FolderIcon size={12} /> : <HomeIcon size={12} />}
                    </span>
                    {editing ? (
                      <input
                        className="vx-term__tab-input"
                        value={editValue}
                        autoFocus
                        maxLength={40}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setEditValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitRename();
                          else if (e.key === 'Escape') {
                            renameCancelRef.current = true;
                            setEditingId(null);
                          }
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span className="vx-term__tab-name">{tabLabel(tab)}</span>
                    )}
                    <button
                      type="button"
                      className="vx-term__tab-close"
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                      title={t('vibecoding.terminal.closeTab', 'Терминалды жабу')}
                    >
                      <CloseIcon size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => void addTab()}
            disabled={!canAdd}
            className="vx-term__action vx-term__add"
            title={canAdd
              ? `${t('vibecoding.terminal.newTab', 'Жаңа терминал')} (Ctrl+Shift+\`)`
              : t('vibecoding.terminal.maxTabs', 'Ең көбі 5 терминал')}
          >
            <PlusIcon size={14} />
          </button>

          {error && <span className="vx-term__error" title={error}>{error}</span>}

          <div className="vx-term__actions">
            <button
              type="button"
              data-term-menu-toggle
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu(m => (m?.kind === 'run' ? null : { kind: 'run', right: window.innerWidth - rect.right, top: rect.bottom + 6 }));
              }}
              disabled={!activeTab}
              className={`vx-term__action vx-term__run ${menu?.kind === 'run' ? 'is-open' : ''}`}
              title={t('vibecoding.terminal.run', 'Іске қосу')}
              aria-haspopup="menu"
              aria-expanded={menu?.kind === 'run'}
            >
              <PlayIcon size={13} />
              <ChevronDownIcon size={11} />
            </button>
            <button
              type="button"
              onClick={() => activeId && askAboutTerminal(activeId, false)}
              disabled={!activeTab}
              className="vx-term__action"
              title={t('vibecoding.terminal.askBurkit', 'Бүркіттен сұрау')}
            >
              <SparkleIcon size={14} />
            </button>
            <button
              type="button"
              onClick={openSearch}
              disabled={!activeTab}
              className="vx-term__action"
              title={`${t('vibecoding.terminal.find', 'Іздеу')} (Ctrl+F)`}
            >
              <SearchIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => void addTab(true)}
              disabled={!canSplit}
              className="vx-term__action"
              title={`${t('vibecoding.terminal.split', 'Терминалды бөлу')} (Ctrl+Shift+5)`}
            >
              <SplitIcon size={14} />
            </button>
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              className="vx-term__action"
              title={isMaximized
                ? `${t('vibecoding.terminal.minimize', 'Кішірейту')} (Esc)`
                : t('vibecoding.terminal.maximize', 'Жаю')}
            >
              {isMaximized ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
            </button>
            {activeTab && (
              <>
                <span className="vx-term__sep" />
                <button
                  type="button"
                  onClick={() => closeTab(activeTab.id)}
                  className="vx-term__action vx-term__action--danger"
                  title={t('vibecoding.terminal.closeTab', 'Терминалды жабу')}
                >
                  <CloseIcon size={14} />
                </button>
              </>
            )}
          </div>

        </div>

        <div className={`vx-term__body ${activeGroup && groupSize(activeGroup) > 1 ? 'is-split' : ''}`}>
          {searchOpen && activeTab && (
            <div className="vx-term__search" role="search">
              <SearchIcon size={13} />
              <input
                ref={searchRef}
                value={query}
                placeholder={t('vibecoding.terminal.findPlaceholder', 'Терминалдан іздеу')}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query) {
                    e.preventDefault();
                    if (e.shiftKey) activeView()?.findPrevious(query);
                    else activeView()?.findNext(query);
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    closeSearch();
                  }
                }}
              />
              <span className="vx-term__search-count">
                {query && (searchResult && searchResult.count > 0
                  ? `${searchResult.index >= 0 ? searchResult.index + 1 : '?'}/${searchResult.count}`
                  : t('vibecoding.terminal.noResults', 'Нәтиже жоқ'))}
              </span>
              <button
                type="button"
                className="vx-term__search-btn"
                disabled={!query}
                onClick={() => activeView()?.findPrevious(query)}
                title={`${t('vibecoding.terminal.prevMatch', 'Алдыңғы')} (Shift+Enter)`}
              >
                <ArrowUpIcon size={13} />
              </button>
              <button
                type="button"
                className="vx-term__search-btn is-flip"
                disabled={!query}
                onClick={() => activeView()?.findNext(query)}
                title={`${t('vibecoding.terminal.nextMatch', 'Келесі')} (Enter)`}
              >
                <ArrowUpIcon size={13} />
              </button>
              <button
                type="button"
                className="vx-term__search-btn"
                onClick={closeSearch}
                title={`${t('common.close', 'Жабу')} (Esc)`}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}

          {paneOrder.map(tab => (
            <TerminalView
              key={tab.id}
              ref={(h) => { if (h) views.current.set(tab.id, h); }}
              tab={tab}
              visible={tab.group === activeGroup}
              focused={tab.id === activeId}
              order={tabs.indexOf(tab)}
              fontSize={fontSize}
              onStatus={onStatus}
              onFocusPane={setActiveId}
              onShortcut={onShortcut}
              onSubmit={onSubmit}
              onContextMenu={(id, x, y) => setMenu({ kind: 'context', tabId: id, x, y })}
              onAskBurkit={askAboutTerminal}
              onSearchResult={onSearchResult}
              resolveFile={resolveFile}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </div>

      {/* Мәзірлер body-ге шығады — терминалдың overflow: hidden-і кесіп тастамасын */}
      {menu?.kind === 'run' && createPortal(
        <div
          ref={menuRef}
          className="vx-term__menu"
          role="menu"
          style={{ right: menu.right, top: menu.top, maxHeight: `calc(100vh - ${menu.top + 12}px)` }}
        >
          <div className="vx-term__menu-title">{t('vibecoding.terminal.runProject', 'Жоба командалары')}</div>
          {runCommands.length === 0 && (
            <div className="vx-term__menu-empty">{t('vibecoding.terminal.noCommands', 'Команда табылмады')}</div>
          )}
          {runCommands.map(c => (
            <button key={c.cmd} type="button" role="menuitem" className="vx-term__menu-item" onClick={() => runCommand(c.cmd)}>
              <PlayIcon size={12} />
              <code>{c.label}</code>
            </button>
          ))}
          {recent.length > 0 && (
            <>
              <div className="vx-term__menu-sep" />
              <div className="vx-term__menu-title">{t('vibecoding.terminal.recent', 'Соңғы командалар')}</div>
              {recent.map(cmd => (
                <button key={cmd} type="button" role="menuitem" className="vx-term__menu-item" onClick={() => runCommand(cmd)}>
                  <HistoryIcon size={12} />
                  <code>{cmd}</code>
                </button>
              ))}
            </>
          )}
        </div>,
        document.body,
      )}

      {menu?.kind === 'context' && contextTab && createPortal(
        <div
          ref={menuRef}
          className="vx-term__menu"
          role="menu"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 248)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 420)),
            maxHeight: 'calc(100vh - 16px)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            disabled={!contextHasSelection}
            onClick={() => { contextView?.copySelection(); setMenu(null); }}
          >
            <CopyIcon size={13} />
            <span>{t('vibecoding.terminal.copy', 'Көшіру')}</span>
            <kbd>Ctrl+Shift+C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            onClick={() => { contextView?.paste(); setMenu(null); }}
          >
            <span className="vx-term__menu-ico" />
            <span>{t('vibecoding.terminal.paste', 'Қою')}</span>
            <kbd>Ctrl+Shift+V</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            onClick={() => { contextView?.selectAll(); setMenu(null); }}
          >
            <span className="vx-term__menu-ico" />
            <span>{t('vibecoding.terminal.selectAll', 'Барлығын белгілеу')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            onClick={() => { setMenu(null); openSearch(); }}
          >
            <SearchIcon size={13} />
            <span>{t('vibecoding.terminal.find', 'Іздеу')}</span>
            <kbd>Ctrl+F</kbd>
          </button>
          <div className="vx-term__menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            onClick={() => { setMenu(null); askAboutTerminal(contextTab.id, false); }}
          >
            <SparkleIcon size={13} />
            <span>{t('vibecoding.terminal.askBurkit', 'Бүркіттен сұрау')}</span>
          </button>
          <div className="vx-term__menu-sep" />
          <div className="vx-term__menu-zoom">
            <span>{fontSize}px</span>
            <button type="button" onClick={() => zoom('zoom-out')} title={`${t('vibecoding.terminal.zoomOut', 'Шрифтті кішірейту')} (Ctrl −)`}>−</button>
            <button type="button" onClick={() => zoom('zoom-reset')} title={`${t('vibecoding.terminal.zoomReset', 'Шрифт өлшемін қалпына келтіру')} (Ctrl+0)`}>A</button>
            <button type="button" onClick={() => zoom('zoom-in')} title={`${t('vibecoding.terminal.zoomIn', 'Шрифтті үлкейту')} (Ctrl +)`}>+</button>
          </div>
          <div className="vx-term__menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            onClick={() => startRename(contextTab)}
          >
            <span className="vx-term__menu-ico" />
            <span>{t('vibecoding.terminal.rename', 'Атын өзгерту')}</span>
            <kbd>F2</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            disabled={!canSplit}
            onClick={() => { setMenu(null); void addTab(true); }}
          >
            <SplitIcon size={13} />
            <span>{t('vibecoding.terminal.split', 'Терминалды бөлу')}</span>
            <kbd>Ctrl+Shift+5</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item"
            onClick={() => { contextView?.clear(); setMenu(null); }}
          >
            <TrashIcon size={13} />
            <span>{t('vibecoding.terminal.clear', 'Тазалау')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="vx-term__menu-item is-danger"
            onClick={() => { setMenu(null); closeTab(contextTab.id); }}
          >
            <CloseIcon size={13} />
            <span>{t('vibecoding.terminal.closeTab', 'Терминалды жабу')}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default TerminalPanel;
