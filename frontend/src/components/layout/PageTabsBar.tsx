import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faHouse, faLayerGroup, faLaptopCode, faGear, faUser, faNoteSticky, faShieldHalved,
  faCode, faUpload, faStar, faChartLine, faTerminal, faPlus, faXmark, faFile,
} from '@fortawesome/free-solid-svg-icons';
import { faComments } from '@fortawesome/free-regular-svg-icons';
import { useAuth } from '../../contexts/AuthContext';
import './PageTabsBar.css';

/* Хедер астындағы бет табтары — браузердегідей: әр таб сайттың бір бетін (жолын) есте сақтайды.
   Таб ішінде басқа бетке өтсең — сол таб жаңа бетке ауысады; табқа басқанда сақталған бетіне ораласың.
   Табтар localStorage-та әр қолданушыға бөлек сақталады — бетті жаңартқанда да қалады. */

type PageTab = { id: string; path: string };
type TabsState = { tabs: PageTab[]; activeId: string };

const STORAGE_PREFIX = 'pageTabs.v1:';
const TABS_LIMIT = 30;

const newId = () => Math.random().toString(36).slice(2, 10);

const loadState = (key: string, current: string): TabsState => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    const tabs: PageTab[] = Array.isArray(raw?.tabs)
      ? raw.tabs.filter((x: PageTab) => x && typeof x.id === 'string' && typeof x.path === 'string')
      : [];
    if (tabs.length) {
      const activeId = tabs.some((x) => x.id === raw.activeId) ? raw.activeId : tabs[0].id;
      // Ашылған бет (адрес жолағы) белсенді табта көрінеді
      return { tabs: tabs.map((x) => (x.id === activeId ? { ...x, path: current } : x)), activeId };
    }
  } catch {
    /* бүлінген жазба — жаңадан бастаймыз */
  }
  const id = newId();
  return { tabs: [{ id, path: current }], activeId: id };
};

type TabInfo = { label: string; icon: IconDefinition };

const PageTabsBar: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const current = location.pathname + location.search + location.hash;
  const storageKey = STORAGE_PREFIX + (user?.id ?? 'guest');

  const [state, setState] = useState<TabsState>(() => loadState(storageKey, current));
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Аккаунт ауысса — сол қолданушының табтары
  const loadedKeyRef = useRef(storageKey);
  useEffect(() => {
    if (loadedKeyRef.current === storageKey) return;
    loadedKeyRef.current = storageKey;
    setState(loadState(storageKey, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    // Кіру тексерілгенше сақтамаймыз — әйтпесе қолданушының табтары «guest» кілтіне түседі
    if (isLoading || loadedKeyRef.current !== storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* сақталмаса да жұмыс істейді */ }
  }, [state, storageKey, isLoading]);

  // Бет ауысқанда — белсенді таб сол бетті есте сақтайды
  useEffect(() => {
    setState((s) => {
      const active = s.tabs.find((x) => x.id === s.activeId);
      if (!active || active.path === current) return s;
      return { ...s, tabs: s.tabs.map((x) => (x.id === s.activeId ? { ...x, path: current } : x)) };
    });
  }, [current]);

  const switchTo = useCallback((id: string) => {
    const tab = state.tabs.find((x) => x.id === id);
    if (!tab || id === state.activeId) return;
    setState((s) => ({ ...s, activeId: id }));
    navigate(tab.path);
  }, [state, navigate]);

  const openTab = useCallback((path = '/') => {
    if (state.tabs.length >= TABS_LIMIT) return;
    const id = newId();
    setState((s) => ({ tabs: [...s.tabs, { id, path }], activeId: id }));
    if (path !== current) navigate(path);
  }, [state.tabs.length, current, navigate]);

  const closeTab = useCallback((id: string) => {
    const { tabs, activeId } = state;
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const rest = tabs.filter((x) => x.id !== id);
    if (id !== activeId) {
      setState({ tabs: rest, activeId });
      return;
    }
    // Белсенді таб жабылса — оң жағындағы (жоқ болса сол жағындағы) табқа өтеміз
    const next = rest[Math.min(idx, rest.length - 1)];
    setState({ tabs: rest, activeId: next.id });
    navigate(next.path);
  }, [state, navigate]);

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setState((s) => {
      const from = s.tabs.findIndex((x) => x.id === dragId);
      const to = s.tabs.findIndex((x) => x.id === targetId);
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...s, tabs };
    });
    setDragId(null);
  };

  // Белсенді таб әрқашан көрінсін
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.page-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.activeId, state.tabs.length]);

  const describe = useCallback((path: string): TabInfo => {
    const pathname = path.split(/[?#]/)[0];
    const seg = pathname.split('/').filter(Boolean);
    if (seg.includes('view')) return { label: t('pageTabs.code', 'Код'), icon: faCode };
    switch (seg[0]) {
      case undefined: return { label: t('pageTabs.home', 'Басты бет'), icon: faHouse };
      case 'codes': return { label: t('header.codes', 'Кодтар'), icon: faLayerGroup };
      case 'chat': return { label: t('header.chat', 'Чат'), icon: faComments };
      case 'vibecoding': return { label: 'Vibecoding', icon: faLaptopCode };
      case 'settings': return { label: t('pageTabs.settings', 'Баптаулар'), icon: faGear };
      case 'profile': return { label: seg[1] ? decodeURIComponent(seg[1]) : t('pageTabs.profile', 'Профиль'), icon: faUser };
      case 'notes': return { label: t('pageTabs.notes', 'Жазбалар'), icon: faNoteSticky };
      case 'upload': return { label: t('pageTabs.upload', 'Жүктеу'), icon: faUpload };
      case 'features': return { label: t('pageTabs.features', 'Мүмкіндіктер'), icon: faStar };
      case 'moderation': return { label: t('pageTabs.moderation', 'Модерация'), icon: faShieldHalved };
      case 'admin': return seg[1] === 'monitoring'
        ? { label: t('pageTabs.monitoring', 'Мониторинг'), icon: faChartLine }
        : { label: t('pageTabs.admin', 'Әкімші'), icon: faShieldHalved };
      case 'cli': return { label: 'CLI', icon: faTerminal };
      default: return { label: decodeURIComponent(seg[seg.length - 1]), icon: faFile };
    }
  }, [t]);

  const infos = useMemo(() => new Map(state.tabs.map((x) => [x.id, describe(x.path)])), [state.tabs, describe]);

  return (
    <div className="page-tabs" role="tablist" aria-label={t('pageTabs.label', 'Ашық беттер')}>
      <div
        className="page-tabs__list"
        ref={listRef}
        onDoubleClick={(e) => { if (e.target === e.currentTarget) openTab(); }}
      >
        {state.tabs.map((tab) => {
          const active = tab.id === state.activeId;
          const info = infos.get(tab.id)!;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`page-tab ${active ? 'active' : ''} ${dragId === tab.id ? 'dragging' : ''}`}
              title={`${info.label} — ${tab.path}`}
              draggable
              onDragStart={() => setDragId(tab.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(tab.id)}
              onClick={() => switchTo(tab.id)}
              onMouseDown={(e) => {
                // Тышқанның ортаңғы батырмасы — табты жабу
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
            >
              <FontAwesomeIcon icon={info.icon} className="page-tab__icon" />
              <span className="page-tab__name">{info.label}</span>
              {state.tabs.length > 1 && (
                <button
                  type="button"
                  className="page-tab__close"
                  title={t('pageTabs.close', 'Табты жабу')}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="page-tabs__new"
        title={t('pageTabs.new', 'Жаңа таб')}
        disabled={state.tabs.length >= TABS_LIMIT}
        onClick={() => openTab()}
      >
        <FontAwesomeIcon icon={faPlus} />
      </button>
    </div>
  );
};

export default PageTabsBar;
