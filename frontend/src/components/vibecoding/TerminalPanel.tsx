import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTerminal } from '../../hooks/useTerminal';
import { useAuth } from '../../contexts/AuthContext';
import { useVibecoding, WorkspaceChanges } from '../../contexts/VibecodingContext';
import {
  PlugIcon, CloseIcon, TrashIcon, TerminalIcon, ExpandIcon, CollapseIcon,
  PlusIcon, RefreshIcon, FolderIcon, HomeIcon,
} from './icons';

// Сервердегі TERMINAL_MAX_SESSIONS_PER_USER-мен бірдей
const MAX_TABS = 5;

type TabStatus = 'on' | 'wait' | 'off';

interface TermTab {
  id: string;
  /** Терминал ашылған жоба (null — үй папкасы) */
  projectId: string | null;
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
        .map((x: TermTab) => ({ id: x.id, projectId: typeof x.projectId === 'string' ? x.projectId : null }));
      const activeId = tabs.some(x => x.id === raw.activeId) ? raw.activeId : tabs[0]?.id ?? null;
      return { tabs, activeId };
    }
  } catch { /* бұзылған жазба */ }
  return { tabs: [], activeId: null };
}

// ─── Бір терминал (бір таб = бір shell сессиясы) ──────────────────────

interface TerminalViewHandle {
  clear: () => void;
  sync: () => void;
  focus: () => void;
}

interface TerminalViewProps {
  tab: TermTab;
  active: boolean;
  onStatus: (id: string, status: TabStatus, error: string | null) => void;
}

const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(({ tab, active, onStatus }, ref) => {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { dispatch } = useVibecoding();
  // Терминалда жасалған/өзгерген/өшірілген файлдар — редакторға
  const onFsChanges = useCallback((projectId: string, changes: WorkspaceChanges) => {
    dispatch({ type: 'APPLY_WORKSPACE_CHANGES', payload: { projectId, changes } });
  }, [dispatch]);

  const { terminalRef, status, error, connect, clear, focus, fit, requestSync } = useTerminal({
    projectId: tab.projectId,
    onFsChanges,
  });

  useImperativeHandle(ref, () => ({ clear, sync: requestSync, focus }), [clear, requestSync, focus]);

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
    onStatus(tab.id, status === 'open' ? 'on' : status === 'connecting' ? 'wait' : 'off', error);
  }, [tab.id, status, error, onStatus]);

  // Белсенді болғанда — өлшемді түзетіп, курсорды терминалға қою
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      fit();
      focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, fit, focus]);

  return (
    <div className={`vx-term__pane ${active ? 'is-active' : ''}`} aria-hidden={!active}>
      <div
        ref={(el) => { (terminalRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
        className="vx-term__screen"
      />
      {/* Батырма тек байланыс шынымен тоқтағанда — қосылу/қайта қосылу кезінде емес */}
      {status === 'closed' && (
        <div className="vx-term__offline">
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
  const [statuses, setStatuses] = useState<Record<string, { status: TabStatus; error: string | null }>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [opening, setOpening] = useState(false);
  const views = useRef(new Map<string, TerminalViewHandle>());

  const activeTab = tabs.find(tab => tab.id === activeId) ?? null;
  const activeStatus = activeId ? statuses[activeId] : undefined;

  const onStatus = useCallback((id: string, status: TabStatus, error: string | null) => {
    setStatuses(prev => (
      prev[id]?.status === status && prev[id]?.error === error ? prev : { ...prev, [id]: { status, error } }
    ));
  }, []);

  const addTab = useCallback(async () => {
    if (tabs.length >= MAX_TABS || opening) return;
    setOpening(true);
    // Жобаның соңғы нұсқасы серверде болсын — терминал папкасы содан жасалады
    try {
      await flushProjects();
    } catch { /* сақталмаса да терминал ашылады */ }
    const tab: TermTab = { id: newTabId(), projectId: activeProject?.id ?? null };
    setTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
    setOpening(false);
  }, [tabs.length, opening, flushProjects, activeProject?.id]);

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex(tab => tab.id === id);
    const next = tabs.filter(tab => tab.id !== id);
    setTabs(next);
    // Жабылған таб белсенді болса — көршісіне ауысамыз
    if (activeId === id) setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? null);
    setStatuses(prev => {
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
    views.current.delete(id);
    // Соңғы терминал жабылса — панель де жабылады (VS Code сияқты)
    if (next.length === 0) dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: false });
  }, [tabs, activeId, dispatch]);

  // Панель ашылғанда терминал жоқ болса — бірден жаңасын ашамыз (VS Code: Ctrl+`)
  useEffect(() => {
    if (state.bottomPanelVisible && tabs.length === 0 && !opening) void addTab();
  }, [state.bottomPanelVisible, tabs.length, opening, addTab]);

  // Ctrl+Shift+` — жаңа терминал (VS Code сияқты); Esc — жайылғанды кішірейту
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Backquote' || e.key === '~')) {
        e.preventDefault();
        void addTab();
      } else if (e.key === 'Escape' && isMaximized) {
        setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addTab, isMaximized]);

  const tabLabel = (tab: TermTab) => {
    if (!tab.projectId) return t('vibecoding.terminal.home', 'Үй папкасы');
    const name = state.projects.find(p => p.id === tab.projectId)?.name ?? t('vibecoding.terminal.project', 'Жоба');
    // Бір жобада бірнеше терминал болса — нөмірлейміз
    const same = tabs.filter(x => x.projectId === tab.projectId);
    return same.length > 1 ? `${name} ${same.indexOf(tab) + 1}` : name;
  };

  const error = activeStatus?.error;
  const canAdd = tabs.length < MAX_TABS && !opening;

  return (
    <div className="vx-term-wrap">
      <div className={`vx-term ${isMaximized ? 'is-max' : ''}`}>
        <div className="vx-term__bar select-none">
          <span className="vx-term__icon">
            <TerminalIcon size={15} />
          </span>

          {tabs.length === 0 ? (
            <span className="vx-term__title">{t('vibecoding.terminal.title', 'Терминал')}</span>
          ) : (
            <div className="vx-term__tabs" role="tablist">
              {tabs.map(tab => {
                const st = statuses[tab.id]?.status ?? 'wait';
                return (
                  <div
                    key={tab.id}
                    role="tab"
                    tabIndex={0}
                    aria-selected={tab.id === activeId}
                    className={`vx-term__tab ${tab.id === activeId ? 'is-active' : ''}`}
                    onClick={() => setActiveId(tab.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveId(tab.id); }}
                    onAuxClick={(e) => { if (e.button === 1) closeTab(tab.id); }}
                    title={tabLabel(tab)}
                  >
                    <span className={`vx-term__tab-dot is-${st}`} />
                    <span className="vx-term__tab-icon">
                      {tab.projectId ? <FolderIcon size={12} /> : <HomeIcon size={12} />}
                    </span>
                    <span className="vx-term__tab-name">{tabLabel(tab)}</span>
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
            {activeTab?.projectId && (
              <button
                type="button"
                onClick={() => views.current.get(activeTab.id)?.sync()}
                className="vx-term__action"
                title={t('vibecoding.terminal.sync', 'Файлдарды редактормен синхрондау')}
              >
                <RefreshIcon size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => activeId && views.current.get(activeId)?.clear()}
              disabled={!activeTab}
              className="vx-term__action"
              title={t('vibecoding.terminal.clear', 'Тазалау')}
            >
              <TrashIcon size={14} />
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

        <div className="vx-term__body">
          {tabs.map(tab => (
            <TerminalView
              key={tab.id}
              ref={(h) => { if (h) views.current.set(tab.id, h); }}
              tab={tab}
              active={tab.id === activeId}
              onStatus={onStatus}
            />
          ))}

        </div>
      </div>
    </div>
  );
};

export default TerminalPanel;
