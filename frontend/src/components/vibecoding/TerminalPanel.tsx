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

// Бастапқы карточкадағы пернелер тізімі
const KEYS: { keys: string[]; labelKey: string; fallback: string }[] = [
  { keys: ['Ctrl', 'J'], labelKey: 'vibecoding.terminal.keyToggle', fallback: 'Ашу / жабу' },
  { keys: ['Ctrl', 'Shift', '`'], labelKey: 'vibecoding.terminal.keyNewTab', fallback: 'Жаңа терминал' },
  { keys: ['Ctrl', 'C'], labelKey: 'vibecoding.terminal.keyStop', fallback: 'Тоқтату' },
  { keys: ['Esc'], labelKey: 'vibecoding.terminal.keyRestore', fallback: 'Кішірейту' },
];

let tabSeq = 0;
const newTabId = () => `term-${Date.now().toString(36)}-${++tabSeq}`;

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
  const [connecting, setConnecting] = useState(true);

  // Терминалда жасалған/өзгерген/өшірілген файлдар — редакторға
  const onFsChanges = useCallback((projectId: string, changes: WorkspaceChanges) => {
    dispatch({ type: 'APPLY_WORKSPACE_CHANGES', payload: { projectId, changes } });
  }, [dispatch]);

  const { terminalRef, isConnected, error, connect, clear, focus, fit, requestSync } = useTerminal({
    projectId: tab.projectId,
    onFsChanges,
  });

  useImperativeHandle(ref, () => ({ clear, sync: requestSync, focus }), [clear, requestSync, focus]);

  const start = useCallback(async () => {
    setConnecting(true);
    try {
      const token = await getAccessToken();
      if (token) connect(token);
    } catch (err) {
      console.error('Failed to connect terminal:', err);
    } finally {
      setConnecting(false);
    }
  }, [getAccessToken, connect]);

  // Таб ашылғанда бірден қосыламыз
  useEffect(() => {
    void start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onStatus(tab.id, isConnected ? 'on' : connecting ? 'wait' : 'off', error);
  }, [tab.id, isConnected, connecting, error, onStatus]);

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
      {!isConnected && !connecting && (
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
  const { state, activeProject, flushProjects } = useVibecoding();
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
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
  }, [tabs, activeId]);

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

  const status = activeStatus?.status ?? (opening ? 'wait' : 'off');
  const statusText = status === 'on'
    ? t('vibecoding.terminal.connected', 'Қосылды')
    : status === 'wait'
      ? t('vibecoding.terminal.connecting', 'Қосылу...')
      : t('vibecoding.terminal.disconnected', 'Ажыратылған');
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

          {tabs.length > 0 && (
            <span className={`vx-term__status is-${status}`}>
              <span className="vx-term__dot" />
              <span className="vx-term__status-text">{statusText}</span>
            </span>
          )}
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

          {/* Бастапқы карточка — әлі бірде-бір терминал жоқ кезде */}
          {tabs.length === 0 && (
            <div className="vx-term__intro">
              <div className="vx-term__card">
                <span className="vx-term__card-icon" style={{ '--d': 0 } as React.CSSProperties}>
                  <TerminalIcon size={22} />
                </span>
                <h3 className="vx-term__card-title" style={{ '--d': 1 } as React.CSSProperties}>
                  {t('vibecoding.terminal.introTitle', 'Терминал дайын')}
                </h3>
                <p className="vx-term__card-text" style={{ '--d': 2 } as React.CSSProperties}>
                  {activeProject
                    ? t('vibecoding.terminal.introProject', 'Терминал «{{name}}» жобасының папкасында ашылады — мұнда жасалған файлдар редакторда да пайда болады.', { name: activeProject.name })
                    : t('vibecoding.terminal.introText', 'Командаларды тікелей браузерде орындаңыз. Бастау үшін сессияға қосылыңыз.')}
                </p>

                {/* Шағын «промпт» — терминалдың алдын ала көрінісі */}
                <div className="vx-term__preview" style={{ '--d': 3 } as React.CSSProperties} aria-hidden="true">
                  <span className="vx-term__preview-user">kazakh-hub</span>
                  <span className="vx-term__preview-path">~/{activeProject?.name ?? 'project'}</span>
                  <span className="vx-term__preview-sign">&gt;</span>
                  <span className="vx-term__preview-cursor" />
                </div>

                <button
                  type="button"
                  onClick={() => void addTab()}
                  disabled={opening}
                  className="vx-term__card-btn"
                  style={{ '--d': 4 } as React.CSSProperties}
                >
                  <PlugIcon size={15} />
                  {t('vibecoding.terminal.open', 'Терминал ашу')}
                </button>

                <div className="vx-term__keys">
                  {KEYS.map((k, i) => (
                    <div key={k.labelKey} className="vx-term__key" style={{ '--d': 5 + i } as React.CSSProperties}>
                      <span>{t(k.labelKey, k.fallback)}</span>
                      <span className="vx-term__kbd">
                        {k.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TerminalPanel;
