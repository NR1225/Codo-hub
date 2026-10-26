import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faAngleRight, faCalendarDay, faEllipsis, faFolderPlus, faFolder, faFolderOpen,
  faFileLines, faMagnifyingGlass, faHashtag, faStar, faCompress, faTableCellsLarge, faPlus, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, type NoteMeta, type NoteSearchResult } from '../../utils/api';
import { PanelIcon } from '../home/icons';

export type SidebarTab = 'files' | 'search' | 'tags' | 'starred';

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  notes: NoteMeta[];
  folders: string[];
  activeId: string | null;
  /** Десктопта жиналған күй — басты беттегідей тек белгішелер жолағы */
  collapsed: boolean;
  onToggle: () => void;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  tagFilter: string | null;
  onTagFilter: (tag: string | null) => void;
  onOpen: (id: string) => void;
  onCreateNote: (folder: string, title?: string) => void;
  onCreateCanvas: (folder: string) => void;
  onCreateFolder: (parent: string, name: string) => void;
  onDailyNote: () => void;
  onRenameNote: (note: NoteMeta, title: string) => void;
  onMoveNote: (note: NoteMeta, folder: string) => void;
  onPickFolder: (note: NoteMeta) => void;
  onToggleStar: (note: NoteMeta) => void;
  onDeleteNote: (note: NoteMeta) => void;
  onRenameFolder: (path: string, newPath: string) => void;
  onDeleteFolder: (path: string) => void;
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseOf = (path: string) => path.split('/').pop() || path;
const byTitle = (a: NoteMeta, b: NoteMeta) => a.title.localeCompare(b.title, undefined, { numeric: true });

/** Атауды орнында өзгерту/жаңа атау енгізу өрісі */
const InlineInput: React.FC<{ initial: string; depth: number; icon: typeof faFolder; onDone: (value: string | null) => void }> = ({
  initial, depth, icon, onDone,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value?.trim() ? value.trim() : null);
  };
  return (
    <div className="nt-tree__row nt-tree__row--editing" style={{ paddingLeft: 10 + depth * 14 }}>
      <FontAwesomeIcon icon={icon} className="nt-tree__icon" />
      <input
        ref={ref}
        className="nt-tree__input"
        defaultValue={initial}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value);
          if (e.key === 'Escape') finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </div>
  );
};

const NotesSidebar: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { notes, folders, activeId, collapsed, tab, onTab } = props;
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ kind: 'new-folder' | 'rename-folder' | 'rename-note'; path: string; id?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Ашық жазбаның папкаларын автоматты түрде ашу
  const active = notes.find((n) => n.id === activeId);
  useEffect(() => {
    if (!active?.folder) return;
    setExpanded((prev) => {
      const parts = active.folder.split('/');
      const next = new Set(prev);
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/')));
      return next.size === prev.size ? prev : next;
    });
  }, [active?.folder]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // Серверде толық мәтін бойынша іздеу (кешіктірілген)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        setResults(await apiService.searchNotes(query.trim()));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Ctrl+Shift+F — іздеу өрісіне фокус (бөлек қойынды жоқ, өріс әрқашан көрінеді)
  useEffect(() => {
    if (tab !== 'search') return;
    searchRef.current?.focus();
    onTab('files');
  }, [tab, onTab]);

  const childFolders = useMemo(() => {
    const map = new Map<string, string[]>();
    folders.forEach((f) => {
      const p = parentOf(f);
      map.set(p, [...(map.get(p) ?? []), f]);
    });
    map.forEach((list) => list.sort((a, b) => baseOf(a).localeCompare(baseOf(b))));
    return map;
  }, [folders]);

  const notesIn = useMemo(() => {
    const map = new Map<string, NoteMeta[]>();
    notes.forEach((n) => map.set(n.folder, [...(map.get(n.folder) ?? []), n]));
    map.forEach((list) => list.sort(byTitle));
    return map;
  }, [notes]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((n) => n.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: e.type === 'contextmenu' ? e.clientX : rect.right - 4, y: e.type === 'contextmenu' ? e.clientY : rect.bottom, items });
  };

  const toggleFolder = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const folderMenu = (path: string): MenuItem[] => [
    { label: t('notes.newNote'), onClick: () => props.onCreateNote(path) },
    { label: t('notes.newCanvas'), onClick: () => props.onCreateCanvas(path) },
    { label: t('notes.newFolder'), onClick: () => { setExpanded((p) => new Set(p).add(path)); setEditing({ kind: 'new-folder', path }); } },
    { label: t('notes.rename'), onClick: () => setEditing({ kind: 'rename-folder', path }) },
    { label: t('notes.delete'), onClick: () => props.onDeleteFolder(path), danger: true },
  ];

  const noteMenu = (note: NoteMeta): MenuItem[] => [
    { label: note.starred ? t('notes.unstar') : t('notes.star'), onClick: () => props.onToggleStar(note) },
    { label: t('notes.rename'), onClick: () => setEditing({ kind: 'rename-note', path: note.folder, id: note.id }) },
    { label: t('notes.moveTo'), onClick: () => props.onPickFolder(note) },
    { label: t('notes.delete'), onClick: () => props.onDeleteNote(note), danger: true },
  ];

  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-note-id')) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === folder ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const id = e.dataTransfer.getData('application/x-note-id');
      const note = notes.find((n) => n.id === id);
      if (note && note.folder !== folder) props.onMoveNote(note, folder);
    },
  });

  const renderNote = (note: NoteMeta, depth: number) => {
    if (editing?.kind === 'rename-note' && editing.id === note.id) {
      return (
        <InlineInput
          key={note.id}
          initial={note.title}
          depth={depth}
          icon={faFileLines}
          onDone={(value) => {
            setEditing(null);
            if (value && value !== note.title) props.onRenameNote(note, value);
          }}
        />
      );
    }
    return (
      <div
        key={note.id}
        className={`nt-tree__row nt-tree__row--note${note.id === activeId ? ' is-active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-note-id', note.id);
          e.dataTransfer.setData('text/plain', `[[${note.title}]]`);
        }}
        onClick={() => props.onOpen(note.id)}
        onDoubleClick={() => setEditing({ kind: 'rename-note', path: note.folder, id: note.id })}
        onContextMenu={(e) => openMenu(e, noteMenu(note))}
        title={note.folder ? `${note.folder}/${note.title}` : note.title}
      >
        <FontAwesomeIcon icon={note.kind === 'canvas' ? faTableCellsLarge : faFileLines} className="nt-tree__icon" />
        <span className="nt-tree__label">{note.title}</span>
        {note.starred && <FontAwesomeIcon icon={faStar} className="nt-tree__star" />}
        <button type="button" className="nt-tree__more" onClick={(e) => openMenu(e, noteMenu(note))} aria-label={t('notes.more')}>
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
      </div>
    );
  };

  const renderFolder = (path: string, depth: number): React.ReactNode => {
    const open = expanded.has(path);
    const row =
      editing?.kind === 'rename-folder' && editing.path === path ? (
        <InlineInput
          initial={baseOf(path)}
          depth={depth}
          icon={faFolder}
          onDone={(value) => {
            setEditing(null);
            if (value && value !== baseOf(path)) {
              const parent = parentOf(path);
              props.onRenameFolder(path, parent ? `${parent}/${value}` : value);
            }
          }}
        />
      ) : (
        <div
          className={`nt-tree__row nt-tree__row--folder${dropTarget === path ? ' is-drop' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => toggleFolder(path)}
          onContextMenu={(e) => openMenu(e, folderMenu(path))}
          {...dropProps(path)}
        >
          <FontAwesomeIcon icon={faAngleRight} className={`nt-tree__chevron${open ? ' is-open' : ''}`} />
          <FontAwesomeIcon icon={open ? faFolderOpen : faFolder} className="nt-tree__icon nt-tree__icon--folder" />
          <span className="nt-tree__label">{baseOf(path)}</span>
          <button type="button" className="nt-tree__more" onClick={(e) => openMenu(e, folderMenu(path))} aria-label={t('notes.more')}>
            <FontAwesomeIcon icon={faEllipsis} />
          </button>
        </div>
      );
    return (
      <React.Fragment key={path}>
        {row}
        {open && renderChildren(path, depth + 1)}
      </React.Fragment>
    );
  };

  const renderChildren = (folder: string, depth: number): React.ReactNode => (
    <>
      {editing?.kind === 'new-folder' && editing.path === folder && (
        <InlineInput
          initial=""
          depth={depth}
          icon={faFolder}
          onDone={(value) => {
            setEditing(null);
            if (value) props.onCreateFolder(folder, value);
          }}
        />
      )}
      {(childFolders.get(folder) ?? []).map((f) => renderFolder(f, depth))}
      {(notesIn.get(folder) ?? []).map((n) => renderNote(n, depth))}
    </>
  );

  const flatList = (list: NoteMeta[]) =>
    list.length ? list.sort(byTitle).map((n) => renderNote(n, 0)) : <p className="nt-sidebar__empty">{t('notes.nothingHere')}</p>;

  const isSearching = query.trim().length > 0;
  const tabs = [
    ['files', faFolder, t('notes.tabs.files')],
    ['tags', faHashtag, t('notes.tabs.tags')],
    ['starred', faStar, t('notes.tabs.starred')],
  ] as const;

  // Жабық күйде белгіше басылса — панель ашылып, сол бөлім көрсетіледі
  const expandTo = (key: SidebarTab) => {
    onTab(key);
    if (collapsed) props.onToggle();
  };

  return (
    <aside className={`nt-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label={t('notes.title')}>
      <div className="nt-sidebar__head">
        <button
          type="button"
          className="nt-sidebar__row nt-sidebar__toggle"
          onClick={props.onToggle}
          aria-expanded={!collapsed}
          title={`${t('notes.toggleSidebar')} (Ctrl+\\)`}
        >
          <span className="nt-sidebar__slot"><PanelIcon /></span>
        </button>
        <h2 className="nt-sidebar__title nt-sidebar__label">
          {t('notes.title')}
          <span className="nt-sidebar__count">{notes.length}</span>
        </h2>
      </div>

      <button
        type="button"
        className="nt-sidebar__row nt-sidebar__new"
        onClick={() => props.onCreateNote(active?.folder ?? '')}
        title={`${t('notes.newNote')} (Alt+N)`}
      >
        <span className="nt-sidebar__slot"><FontAwesomeIcon icon={faPlus} /></span>
        <span className="nt-sidebar__label">{t('notes.newNote')}</span>
        <kbd className="nt-sidebar__label">Alt+N</kbd>
      </button>

      <label className="nt-sidebar__row nt-sidebar__search" title={`${t('notes.tabs.search')} (Ctrl+Shift+F)`}>
        <span className="nt-sidebar__slot"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
        <input
          ref={searchRef}
          type="search"
          className="nt-sidebar__input nt-sidebar__label"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => collapsed && props.onToggle()}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder={t('notes.searchPlaceholder')}
          aria-label={t('notes.tabs.search')}
        />
      </label>

      {collapsed ? (
        <nav className="nt-sidebar__rail">
          <div className="nt-sidebar__divider" />
          {tabs.map(([key, icon, label]) => (
            <button key={key} type="button" className={`nt-sidebar__row${tab === key ? ' is-active' : ''}`} onClick={() => expandTo(key)} title={label}>
              <span className="nt-sidebar__slot"><FontAwesomeIcon icon={icon} /></span>
            </button>
          ))}
          <div className="nt-sidebar__divider" />
          <button type="button" className="nt-sidebar__row" onClick={props.onDailyNote} title={`${t('notes.dailyNote')} (Alt+D)`}>
            <span className="nt-sidebar__slot"><FontAwesomeIcon icon={faCalendarDay} /></span>
          </button>
          <button type="button" className="nt-sidebar__row" onClick={() => props.onCreateCanvas(active?.folder ?? '')} title={t('notes.newCanvas')}>
            <span className="nt-sidebar__slot"><FontAwesomeIcon icon={faTableCellsLarge} /></span>
          </button>
        </nav>
      ) : isSearching ? (
        <div className="nt-sidebar__panel">
          <div className="nt-sidebar__section">
            <span>{t('notes.tabs.search')}</span>
            <button type="button" className="nt-icon-btn nt-icon-btn--sm" onClick={() => setQuery('')} title="Esc">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <div className="nt-search">
            {searching && <p className="nt-sidebar__empty">{t('notes.searching')}</p>}
            {!searching && !results.length && <p className="nt-sidebar__empty">{t('notes.noResults')}</p>}
            {results.map((r) => (
              <button key={r.id} type="button" className={`nt-search__item${r.id === activeId ? ' is-active' : ''}`} onClick={() => props.onOpen(r.id)}>
                <span className="nt-search__title">{r.title}</span>
                {r.folder && <span className="nt-search__folder">{r.folder}</span>}
                {r.snippet && <span className="nt-search__snippet">{r.snippet}</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="nt-sidebar__tabs" role="tablist">
            {tabs.map(([key, icon, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`nt-sidebar__tab${tab === key ? ' is-active' : ''}`}
                onClick={() => onTab(key)}
                title={label}
                aria-label={label}
              >
                <FontAwesomeIcon icon={icon} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {tab === 'files' && (
            <>
              <div className="nt-sidebar__section">
                <span>{t('notes.tabs.files')}</span>
                <div className="nt-sidebar__tools">
                  <button type="button" className="nt-icon-btn nt-icon-btn--sm" onClick={() => props.onCreateCanvas(active?.folder ?? '')} title={t('notes.newCanvas')}>
                    <FontAwesomeIcon icon={faTableCellsLarge} />
                  </button>
                  <button type="button" className="nt-icon-btn nt-icon-btn--sm" onClick={() => setEditing({ kind: 'new-folder', path: '' })} title={t('notes.newFolder')}>
                    <FontAwesomeIcon icon={faFolderPlus} />
                  </button>
                  <button type="button" className="nt-icon-btn nt-icon-btn--sm" onClick={props.onDailyNote} title={`${t('notes.dailyNote')} (Alt+D)`}>
                    <FontAwesomeIcon icon={faCalendarDay} />
                  </button>
                  <button type="button" className="nt-icon-btn nt-icon-btn--sm" onClick={() => setExpanded(new Set())} title={t('notes.collapseAll')}>
                    <FontAwesomeIcon icon={faCompress} />
                  </button>
                </div>
              </div>
              <div
                className={`nt-tree${dropTarget === '' ? ' is-drop' : ''}`}
                onContextMenu={(e) => openMenu(e, folderMenu('').filter((_, i) => i < 3))}
                {...dropProps('')}
              >
                {renderChildren('', 0)}
                {!notes.length && !folders.length && (
                  <div className="nt-sidebar__blank">
                    <FontAwesomeIcon icon={faFileLines} />
                    <p>{t('notes.emptyVault')}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'tags' && (
            <div className="nt-sidebar__panel">
              {props.tagFilter ? (
                <>
                  <button type="button" className="nt-chip is-active" onClick={() => props.onTagFilter(null)}>
                    #{props.tagFilter} <FontAwesomeIcon icon={faXmark} />
                  </button>
                  <div className="nt-tree">{flatList(notes.filter((n) => n.tags.some((tg) => tg === props.tagFilter || tg.startsWith(`${props.tagFilter}/`))))}</div>
                </>
              ) : (
                <div className="nt-tags">
                  {tagCounts.length ? (
                    tagCounts.map(([tag, count]) => (
                      <button key={tag} type="button" className="nt-chip" onClick={() => props.onTagFilter(tag)}>
                        #{tag} <span className="nt-chip__count">{count}</span>
                      </button>
                    ))
                  ) : (
                    <p className="nt-sidebar__empty">{t('notes.noTags')}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'starred' && <div className="nt-tree nt-tree--flat">{flatList(notes.filter((n) => n.starred))}</div>}
        </>
      )}

      {menu && (
        <div className="nt-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }} onClick={(e) => e.stopPropagation()}>
          {menu.items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`nt-menu__item${item.danger ? ' is-danger' : ''}`}
              onClick={() => {
                setMenu(null);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
};

export default NotesSidebar;
