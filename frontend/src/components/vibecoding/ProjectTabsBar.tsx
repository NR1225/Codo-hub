import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, projectTabIds, nextProjectName } from '../../contexts/VibecodingContext';
import { PlusIcon, CloseIcon, ChevronDownIcon, FolderIcon, SearchIcon } from './icons';

/* Жабылған табтар тізімі (браузердегідей Alt+Shift+T — соңғысын қайта ашу).
   Бетті жаңартқанда да сақталады. */
const CLOSED_TABS_KEY = 'vibecoding.closedProjectTabs';
const CLOSED_TABS_LIMIT = 20;
type ClosedTab = { id: string; index: number };
const loadClosedTabs = (): ClosedTab[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_TABS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
};
const saveClosedTabs = (list: ClosedTab[]) => {
  try { localStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(list)); } catch { /* сақталмаса да жұмыс істейді */ }
};

/* Хедер астындағы жоба табтары: бірнеше жобада қатар жұмыс істеу.
   Жылдам ауысу: Alt+1…9, Alt+PageUp/PageDown, Alt+Shift+N — жаңа жоба, Alt+W — табты жабу,
   Alt+Shift+T — жабылған табты қайта ашу. */
const ProjectTabsBar: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch } = useVibecoding();

  const tabIds = projectTabIds(state);
  const byId = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const tabs = tabIds.map((id) => byId.get(id)!).filter(Boolean);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const stateRef = useRef({ tabIds, active: state.activeProjectId });
  stateRef.current = { tabIds, active: state.activeProjectId };

  /* ── Жабылған табтар: табтар тізімінен жоғалған (бірақ жойылмаған) жобаны жазып аламыз ── */
  const closedRef = useRef<ClosedTab[]>(loadClosedTabs());
  const [closedCount, setClosedCount] = useState(closedRef.current.length);
  const prevTabsRef = useRef<string[] | null>(null);
  const tabsKey = tabIds.join('|');
  useEffect(() => {
    const prev = prevTabsRef.current;
    prevTabsRef.current = tabIds;
    if (!prev) return;
    const projectIds = new Set(state.projects.map((p) => p.id));
    let list = closedRef.current.filter((c) => projectIds.has(c.id) && !tabIds.includes(c.id));
    prev.forEach((id, index) => {
      if (!tabIds.includes(id) && projectIds.has(id)) {
        list = [...list.filter((c) => c.id !== id), { id, index }];
      }
    });
    list = list.slice(-CLOSED_TABS_LIMIT);
    closedRef.current = list;
    setClosedCount(list.length);
    saveClosedTabs(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey, state.projects]);

  const reopenClosed = useCallback(() => {
    const { tabIds: ids } = stateRef.current;
    const projectIds = new Set(state.projects.map((p) => p.id));
    const list = [...closedRef.current];
    let target: ClosedTab | undefined;
    while (list.length) {
      const c = list.pop()!;
      if (projectIds.has(c.id) && !ids.includes(c.id)) { target = c; break; }
    }
    closedRef.current = list;
    setClosedCount(list.length);
    saveClosedTabs(list);
    if (!target) return;
    // Жоба табқа соңынан қосылады — кейін бұрынғы орнына қоямыз
    dispatch({ type: 'SWITCH_PROJECT', payload: { projectId: target.id } });
    const order = ids.filter((id) => id !== target!.id);
    order.splice(Math.min(target.index, order.length), 0, target.id);
    dispatch({ type: 'REORDER_PROJECT_TABS', payload: { projectIds: order } });
    setMenuOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, state.projects]);

  const switchTo = useCallback((projectId: string) => {
    dispatch({ type: 'SWITCH_PROJECT', payload: { projectId } });
  }, [dispatch]);

  const closeTab = useCallback((projectId: string) => {
    dispatch({ type: 'CLOSE_PROJECT_TAB', payload: { projectId } });
  }, [dispatch]);

  const createProject = useCallback(() => {
    dispatch({ type: 'CREATE_PROJECT', payload: { name: nextProjectName(state.projects) } });
    setMenuOpen(false);
  }, [dispatch, state.projects]);

  const startRename = (projectId: string, name: string) => {
    setRenamingId(projectId);
    setRenameValue(name);
  };

  const commitRename = () => {
    const name = renameValue.trim();
    const project = renamingId ? byId.get(renamingId) : undefined;
    if (project && name && name !== project.name) {
      dispatch({ type: 'RENAME_PROJECT', payload: { projectId: project.id, name } });
    }
    setRenamingId(null);
  };

  /* ── Пернелер ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const { tabIds: ids, active } = stateRef.current;
      const idx = active ? ids.indexOf(active) : -1;

      // Alt+1…8 — сол табқа, Alt+9 — соңғы таб (браузер табтарындағыдай)
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && !e.shiftKey) {
        const n = Number(digit[1]);
        const target = n === 9 ? ids[ids.length - 1] : ids[n - 1];
        if (target) {
          e.preventDefault();
          switchTo(target);
        }
        return;
      }
      if (!e.shiftKey && (e.code === 'PageDown' || e.code === 'PageUp') && ids.length > 1) {
        e.preventDefault();
        const step = e.code === 'PageDown' ? 1 : -1;
        switchTo(ids[(idx + step + ids.length) % ids.length]);
        return;
      }
      if (e.shiftKey && e.code === 'KeyT') {
        e.preventDefault();
        reopenClosed();
        return;
      }
      if (e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        createProject();
        return;
      }
      if (!e.shiftKey && e.code === 'KeyW' && active) {
        e.preventDefault();
        closeTab(active);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchTo, closeTab, createProject, reopenClosed]);

  // Белсенді таб әрқашан көрінсін
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.vibe-ptab.active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.activeProjectId, tabIds.length]);

  // Тізімнен тыс басқанда мәзір жабылады
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) setQuery('');
  }, [menuOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.projects.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [state.projects, query]);

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = tabIds.filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId) + (tabIds.indexOf(dragId) < tabIds.indexOf(targetId) ? 1 : 0), 0, dragId);
    dispatch({ type: 'REORDER_PROJECT_TABS', payload: { projectIds: ids } });
    setDragId(null);
  };

  return (
    <div className="vibe-ptabs" role="tablist" aria-label={t('vibecoding.projectTabs.label', 'Ашық жобалар')}>
      <div className="vibe-ptabs__list" ref={listRef}>
        {tabs.map((project, i) => {
          const active = project.id === state.activeProjectId;
          const dirty = project.files.some((f) => f.isDirty);
          const hint = i < 8 ? `Alt+${i + 1}` : i === tabs.length - 1 ? 'Alt+9' : '';
          return (
            <div
              key={project.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`vibe-ptab ${active ? 'active' : ''} ${dragId === project.id ? 'dragging' : ''}`}
              title={hint ? `${project.name} (${hint})` : project.name}
              draggable={renamingId !== project.id}
              onDragStart={() => setDragId(project.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(project.id)}
              onClick={() => switchTo(project.id)}
              onDoubleClick={() => startRename(project.id, project.name)}
              onMouseDown={(e) => {
                // Тышқанның ортаңғы батырмасы — табты жабу
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(project.id);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'F2') startRename(project.id, project.name);
              }}
            >
              <FolderIcon size={12} open={active} />
              {renamingId === project.id ? (
                <input
                  className="vibe-ptab__input"
                  value={renameValue}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span className="vibe-ptab__name">{project.name}</span>
              )}
              {i < 9 && <span className="vibe-ptab__key">{i + 1}</span>}
              {tabs.length > 1 ? (
                <button
                  type="button"
                  className={`vibe-ptab__close ${dirty ? 'dirty' : ''}`}
                  title={`${t('vibecoding.projectTabs.close', 'Табты жабу')} (Alt+W)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(project.id);
                  }}
                >
                  <CloseIcon size={10} />
                </button>
              ) : dirty ? (
                <span className="vibe-ptab__dot" />
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="vibe-ptabs__btn"
        onClick={createProject}
        title={`${t('vibecoding.projectTabs.new', 'Жаңа жоба')} (Alt+Shift+N)`}
      >
        <PlusIcon size={13} />
      </button>

      {/* Барлық жобалар — табта жоғын ашу немесе бар табқа өту */}
      <div className="vibe-ptabs__menu-wrap" ref={menuRef}>
        <button
          type="button"
          className={`vibe-ptabs__btn ${menuOpen ? 'active' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          title={t('vibecoding.projectTabs.all', 'Барлық жобалар')}
          aria-expanded={menuOpen}
        >
          <ChevronDownIcon size={13} />
        </button>
        {menuOpen && (
          <div className="vibe-ptabs__menu">
            <label className="vibe-ptabs__search">
              <SearchIcon size={12} />
              <input
                autoFocus
                value={query}
                placeholder={t('vibecoding.projectTabs.search', 'Жоба іздеу…')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setMenuOpen(false);
                  if (e.key === 'Enter' && filtered[0]) {
                    switchTo(filtered[0].id);
                    setMenuOpen(false);
                  }
                }}
              />
            </label>
            <div className="vibe-ptabs__menu-list">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`vibe-ptabs__menu-item ${p.id === state.activeProjectId ? 'active' : ''}`}
                  onClick={() => {
                    switchTo(p.id);
                    setMenuOpen(false);
                  }}
                >
                  <FolderIcon size={13} />
                  <span className="vibe-ptabs__menu-name">{p.name}</span>
                  {tabIds.includes(p.id) && <span className="vibe-ptabs__menu-open">●</span>}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="vibe-ptabs__empty">{t('vibecoding.projectTabs.notFound', 'Жоба табылмады')}</div>
              )}
            </div>
            {closedCount > 0 && (
              <button type="button" className="vibe-ptabs__menu-item vibe-ptabs__menu-new" onClick={reopenClosed}>
                <FolderIcon size={13} />
                <span className="vibe-ptabs__menu-name">{t('vibecoding.projectTabs.reopen', 'Жабылған жобаны қайта ашу')}</span>
                <span className="vibe-ptabs__menu-hint">Alt+Shift+T</span>
              </button>
            )}
            <button type="button" className="vibe-ptabs__menu-item vibe-ptabs__menu-new" onClick={createProject}>
              <PlusIcon size={13} />
              <span className="vibe-ptabs__menu-name">{t('vibecoding.projectTabs.new', 'Жаңа жоба')}</span>
              <span className="vibe-ptabs__menu-hint">Alt+Shift+N</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectTabsBar;
