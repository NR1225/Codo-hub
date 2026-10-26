import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronLeft, faChevronRight, faDiagramProject, faPen, faEye, faTableColumns, faStar as faStarSolid,
  faEllipsisVertical, faCircleInfo, faCalendarDay, faFileCirclePlus, faMagnifyingGlass, faFileImport, faFileExport,
  faWandMagicSparkles, faFileLines, faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons';
import { faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';
import { PanelIcon } from '../components/home/icons';
import type { NoteMeta } from '../utils/api';
import { useToast, useConfirm } from '../contexts/ToastContext';
import { useNotesVault } from '../components/notes/useNotesVault';
import NotesSidebar, { type SidebarTab } from '../components/notes/NotesSidebar';
import NoteEditor, { type EditorMode } from '../components/notes/NoteEditor';
import NoteInfoPanel from '../components/notes/NoteInfoPanel';
import NotesGraph from '../components/notes/NotesGraph';
import NoteCanvas from '../components/notes/NoteCanvas';
import NotesPicker, { type PickerItem } from '../components/notes/NotesPicker';
import { DAILY_FOLDER, dailyTitle, notePath, resolveLink, type OutlineItem } from '../components/notes/noteLinks';
import './NotesPage.css';

const TEMPLATES_FOLDER = 'Templates';

type Picker =
  | { kind: 'switch' }
  | { kind: 'move'; note: NoteMeta }
  | { kind: 'template' }
  | { kind: 'canvas-note'; onPicked: (note: NoteMeta) => void };

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(`notes.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const writePref = (key: string, value: unknown) => {
  try {
    localStorage.setItem(`notes.${key}`, JSON.stringify(value));
  } catch {
    /* жеке режим — елемейміз */
  }
};

/** Үлгідегі {{date}}, {{time}}, {{title}} айнымалыларын ауыстыру */
const fillTemplate = (text: string, title: string) => {
  const now = new Date();
  return text
    .replace(/\{\{\s*date\s*\}\}/gi, dailyTitle(now))
    .replace(/\{\{\s*time\s*\}\}/gi, now.toTimeString().slice(0, 5))
    .replace(/\{\{\s*title\s*\}\}/gi, title);
};

const NotesPage: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const vault = useNotesVault();
  const { notes, folders, contents } = vault;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('note');
  const view = searchParams.get('view') === 'graph' ? 'graph' : 'note';

  const [mode, setMode] = useState<EditorMode>(() => readPref('mode', 'edit'));
  // Десктопта: ашық/жиналған (белгішелер жолағы). Телефонда: үстінен шығатын панель, әдепкіде жабық
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref('sidebar', true));
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [infoOpen, setInfoOpen] = useState(() => readPref('info', window.innerWidth > 1200));
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [heading, setHeading] = useState<{ slug: string; line?: number; nonce: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const history = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => writePref('mode', mode), [mode]);
  useEffect(() => writePref('sidebar', sidebarOpen), [sidebarOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (narrow) setMobileSidebar((v) => !v);
    else setSidebarOpen((v) => !v);
  }, [narrow]);
  const revealSidebar = () => (narrow ? setMobileSidebar(true) : setSidebarOpen(true));
  const showTag = (tag: string) => {
    setTagFilter(tag);
    setSidebarTab('tags');
    revealSidebar();
  };
  useEffect(() => writePref('info', infoOpen), [infoOpen]);

  const active = notes.find((n) => n.id === activeId) ?? null;
  const activeContent = activeId ? contents[activeId] : undefined;

  useEffect(() => setTitleDraft(active?.title ?? ''), [active?.id, active?.title]);

  useEffect(() => {
    if (activeId) vault.loadContent(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Жоқ жазбаға сілтеме (жойылған немесе басқа біреудікі) — тазалаймыз
  useEffect(() => {
    if (!vault.loading && activeId && !active) {
      setSearchParams((p) => {
        p.delete('note');
        return p;
      }, { replace: true });
    }
  }, [vault.loading, activeId, active, setSearchParams]);

  const open = useCallback((id: string, fromHistory = false) => {
    if (!fromHistory) {
      const h = history.current;
      if (h.stack[h.index] !== id) {
        h.stack = [...h.stack.slice(0, h.index + 1), id].slice(-100);
        h.index = h.stack.length - 1;
      }
    }
    setSearchParams((p) => {
      p.set('note', id);
      p.delete('view');
      return p;
    });
    setMobileSidebar(false);
  }, [setSearchParams]);

  const canGo = (delta: number) => {
    const h = history.current;
    for (let i = h.index + delta; i >= 0 && i < h.stack.length; i += delta) {
      if (notes.some((n) => n.id === h.stack[i])) return true;
    }
    return false;
  };

  const go = (delta: number) => {
    const h = history.current;
    let next = h.index + delta;
    while (next >= 0 && next < h.stack.length && !notes.some((n) => n.id === h.stack[next])) next += delta;
    if (next < 0 || next >= h.stack.length) return;
    h.index = next;
    open(h.stack[next], true);
  };

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

  const createNote = async (folder = '', title?: string, content = '') => {
    try {
      const note = await vault.createNote(title || t('notes.untitled'), folder, 'note', content);
      open(note.id);
      if (mode === 'preview') setMode('edit');
      return note;
    } catch (e) {
      fail(e);
    }
  };

  const createCanvas = async (folder = '') => {
    try {
      const note = await vault.createNote(t('notes.untitledCanvas'), folder, 'canvas');
      open(note.id);
    } catch (e) {
      fail(e);
    }
  };

  /** [[сілтеме]] басылғанда: бар болса — ашу, жоқ болса — жаңа жазба жасау */
  const openLink = async (target: string, headingSlug?: string) => {
    const note = resolveLink(target, notes);
    if (note) {
      open(note.id);
      if (headingSlug) setTimeout(() => setHeading({ slug: headingSlug, nonce: Date.now() }), 300);
      return;
    }
    const parts = target.split('/').map((s) => s.trim()).filter(Boolean);
    const title = parts.pop();
    if (!title) return;
    await createNote(parts.join('/'), title);
  };

  const dailyNote = async () => {
    const title = dailyTitle();
    const existing = notes.find((n) => n.folder === DAILY_FOLDER && n.title === title);
    if (existing) return open(existing.id);
    const template = notes.find((n) => n.folder === TEMPLATES_FOLDER && n.title.toLowerCase() === 'daily');
    const body = template ? fillTemplate((await vault.loadContent(template.id)) ?? '', title) : `# ${title}\n\n`;
    await createNote(DAILY_FOLDER, title, body);
  };

  const rename = async (note: NoteMeta, title: string) => {
    try {
      const saved = await vault.updateMeta(note.id, { title });
      if (saved.updatedNotes.length) toast.info(t('notes.linksUpdated', { count: saved.updatedNotes.length }));
    } catch (e) {
      fail(e);
      setTitleDraft(note.title);
    }
  };

  const move = async (note: NoteMeta, folder: string) => {
    try {
      await vault.updateMeta(note.id, { folder });
    } catch (e) {
      fail(e);
    }
  };

  const toggleStar = (note: NoteMeta) => vault.updateMeta(note.id, { starred: !note.starred }).catch(fail);

  const deleteNote = async (note: NoteMeta) => {
    if (!(await confirm({ title: t('notes.deleteConfirm', { name: note.title }), confirmText: t('notes.delete'), danger: true }))) return;
    try {
      await vault.deleteNote(note.id);
      if (note.id === activeId) setSearchParams((p) => { p.delete('note'); return p; });
    } catch (e) {
      fail(e);
    }
  };

  const deleteFolder = async (path: string) => {
    const count = notes.filter((n) => n.folder === path || n.folder.startsWith(`${path}/`)).length;
    if (!(await confirm({ title: t('notes.deleteFolderConfirm', { name: path }), message: count ? t('notes.deleteFolderNotes', { count }) : undefined, confirmText: t('notes.delete'), danger: true }))) return;
    vault.deleteFolder(path).catch(fail);
  };

  const insertTemplate = async (template: NoteMeta) => {
    if (!active || active.kind !== 'note') return;
    const text = fillTemplate((await vault.loadContent(template.id)) ?? '', active.title);
    const current = contents[active.id] ?? '';
    vault.setContent(active.id, current ? `${current.replace(/\n*$/, '')}\n\n${text}` : text);
  };

  const exportNote = () => {
    if (!active || activeContent === undefined) return;
    const blob = new Blob([activeContent], { type: active.kind === 'canvas' ? 'application/json' : 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${active.title}.${active.kind === 'canvas' ? 'canvas' : 'md'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Бүкіл vault-ты .zip ретінде жүктеп алу (Obsidian-ға ашуға болады) */
  const exportVault = async () => {
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const note of notes) {
        const text = (await vault.loadContent(note.id)) ?? '';
        zip.file(`${notePath(note)}.${note.kind === 'canvas' ? 'canvas' : 'md'}`, text);
      }
      folders.forEach((f) => zip.folder(f));
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kazakh-hub-notes-${dailyTitle()}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      fail(e);
    }
  };

  /** .md файлдарын импорттау — папка жолы файлдың салыстырмалы жолынан алынады */
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let ok = 0;
    for (const file of Array.from(files)) {
      if (!/\.(md|markdown|txt)$/i.test(file.name)) continue;
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = rel.split('/');
      const title = parts.pop()!.replace(/\.(md|markdown|txt)$/i, '').replace(/[[\]#|^\\/:*?"<>]/g, ' ').trim() || t('notes.untitled');
      try {
        await vault.createNote(title, parts.join('/'), 'note', await file.text());
        ok++;
      } catch (e) {
        fail(e);
        break;
      }
    }
    if (ok) toast.success(t('notes.imported', { count: ok }));
    if (importRef.current) importRef.current.value = '';
  };

  // Пернетақта тіркесімдері
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'o') { e.preventDefault(); setPicker({ kind: 'switch' }); }
      else if (mod && k === 'e' && active?.kind === 'note') { e.preventDefault(); setMode((m) => (m === 'preview' ? 'edit' : 'preview')); }
      else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); revealSidebar(); setSidebarTab('search'); }
      else if (mod && e.code === 'Backslash') { e.preventDefault(); toggleSidebar(); }
      else if (mod && k === 'g') { e.preventDefault(); setSearchParams((p) => { p.set('view', 'graph'); return p; }); }
      else if (e.altKey && k === 'n') { e.preventDefault(); createNote(active?.folder ?? ''); }
      else if (e.altKey && k === 'd') { e.preventDefault(); dailyNote(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (mod && k === 's') { e.preventDefault(); vault.flush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  const templates = useMemo(() => notes.filter((n) => n.folder === TEMPLATES_FOLDER && n.kind === 'note'), [notes]);

  const pickerProps = (): React.ComponentProps<typeof NotesPicker> | null => {
    if (!picker) return null;
    const close = () => setPicker(null);
    const noteItems: PickerItem[] = notes.map((n) => ({ id: n.id, label: n.title, hint: n.folder || undefined }));
    switch (picker.kind) {
      case 'switch':
        return {
          placeholder: t('notes.switcherPlaceholder'),
          items: noteItems,
          createLabel: (q) => t('notes.createNamed', { name: q }),
          onPick: (item) => open(item.id),
          onCreate: (q) => openLink(q),
          onClose: close,
        };
      case 'move':
        return {
          placeholder: t('notes.moveToPlaceholder'),
          items: [{ id: '', label: '/', hint: t('notes.rootFolder') }, ...folders.map((f) => ({ id: f, label: f }))],
          createLabel: (q) => t('notes.createFolderNamed', { name: q }),
          onPick: (item) => move(picker.note, item.id),
          onCreate: (q) => move(picker.note, q),
          onClose: close,
        };
      case 'template':
        return {
          placeholder: t('notes.templatePlaceholder'),
          items: templates.map((n) => ({ id: n.id, label: n.title })),
          onPick: (item) => {
            const tpl = notes.find((n) => n.id === item.id);
            if (tpl) insertTemplate(tpl);
          },
          onClose: close,
        };
      case 'canvas-note':
        return {
          placeholder: t('notes.switcherPlaceholder'),
          items: noteItems.filter((i) => i.id !== activeId),
          onPick: (item) => {
            const note = notes.find((n) => n.id === item.id);
            if (note) picker.onPicked(note);
          },
          onClose: close,
        };
    }
  };
  const activePicker = pickerProps();

  const saveLabel = {
    saved: t('notes.saved'),
    saving: t('notes.saving'),
    dirty: t('notes.unsaved'),
    error: t('notes.saveError'),
  }[vault.saveState];

  const recent = useMemo(() => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8), [notes]);

  const renderMain = () => {
    if (view === 'graph') {
      return <NotesGraph notes={notes} activeId={activeId} onOpen={open} onOpenLink={openLink} onTag={showTag} />;
    }
    if (!active) {
      return (
        <div className="nt-welcome">
          {/* Басты беттегі Бүркіт сияқты: жарқыраған белгіше, тақырып, дайын әрекеттер */}
          <div className="nt-welcome__hero">
            <div className="nt-welcome__orb">
              <FontAwesomeIcon icon={faFileLines} />
            </div>
            <h2 className="nt-welcome__title">{t('notes.welcomeTitle')}</h2>
            <p className="nt-welcome__text">{t('notes.welcomeText')}</p>
            <div className="nt-welcome__actions">
              {([
                [faFileCirclePlus, t('notes.newNote'), 'Alt+N', () => createNote(), true],
                [faCalendarDay, t('notes.dailyNote'), 'Alt+D', dailyNote, false],
                [faMagnifyingGlass, t('notes.quickSwitcher'), 'Ctrl+O', () => setPicker({ kind: 'switch' }), false],
                [faDiagramProject, t('notes.graphView'), 'Ctrl+G', () => setSearchParams((p) => { p.set('view', 'graph'); return p; }), false],
              ] as const).map(([icon, label, key, onClick, primary], i) => (
                <button
                  key={key}
                  type="button"
                  className={`nt-action${primary ? ' nt-action--primary' : ''}`}
                  style={{ '--d': i } as React.CSSProperties}
                  onClick={onClick}
                >
                  <span className="nt-action__icon"><FontAwesomeIcon icon={icon} /></span>
                  <span className="nt-action__label">{label}</span>
                  <kbd>{key}</kbd>
                </button>
              ))}
            </div>
          </div>

          {!!recent.length && (
            <section className="nt-welcome__section">
              <h4 className="nt-welcome__label">{t('notes.recent')}</h4>
              <div className="nt-welcome__recent">
                {recent.map((n, i) => (
                  <button key={n.id} type="button" className="nt-recent" style={{ '--d': i } as React.CSSProperties} onClick={() => open(n.id)}>
                    <span className="nt-recent__mono" aria-hidden="true">
                      <FontAwesomeIcon icon={n.kind === 'canvas' ? faTableCellsLarge : faFileLines} />
                    </span>
                    <span className="nt-recent__text">
                      <span className="nt-recent__title">{n.title}</span>
                      <small>{n.folder || '/'}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="nt-welcome__section">
            <h4 className="nt-welcome__label">{t('notes.shortcuts')}</h4>
            <dl className="nt-welcome__keys">
              {([
                ['[[ ]]', t('notes.help.links')],
                ['#тег', t('notes.help.tags')],
                ['Ctrl+E', t('notes.help.toggleMode')],
                ['Alt+N / Alt+D', t('notes.help.newDaily')],
                ['Ctrl+G', t('notes.graphView')],
                [`${TEMPLATES_FOLDER}/`, t('notes.help.templates', { date: '{{date}}', title: '{{title}}' })],
              ] as const).map(([key, text]) => (
                <div key={key} className="nt-welcome__key">
                  <dt><kbd>{key}</kbd></dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      );
    }
    if (activeContent === undefined) return <div className="nt-loading">{t('notes.loading')}</div>;
    if (active.kind === 'canvas') {
      return (
        <NoteCanvas
          key={active.id}
          content={activeContent}
          notes={notes}
          contents={contents}
          loadContent={vault.loadContent}
          onChange={(c) => vault.setContent(active.id, c)}
          onOpen={open}
          onOpenLink={openLink}
          onPickNote={(onPicked) => setPicker({ kind: 'canvas-note', onPicked })}
        />
      );
    }
    return (
      <NoteEditor
        key={active.id}
        note={active}
        content={activeContent}
        notes={notes}
        mode={mode}
        scrollToHeading={heading}
        onChange={(c) => vault.setContent(active.id, c)}
        onOpenLink={openLink}
        onTag={showTag}
      />
    );
  };

  if (vault.loading && !notes.length) {
    return (
      <div className="nt-root">
        <div className="nt-body">
          <section className="nt-workspace"><div className="nt-loading">{t('notes.loading')}</div></section>
        </div>
      </div>
    );
  }

  // Басты бет сияқты: қара фон үстінде қалқымалы панельдер — сол жақта жазбалар, ортада редактор, оң жақта ақпарат
  return (
    <div className={`nt-root${!narrow && !sidebarOpen ? ' is-collapsed' : ''}${infoOpen && active && view === 'note' ? ' has-info' : ''}`}>
      <div className="nt-body">
        {(!narrow || mobileSidebar) && (
          <>
            {narrow && <div className="nt-backdrop" onClick={() => setMobileSidebar(false)} />}
            <NotesSidebar
              collapsed={!narrow && !sidebarOpen}
              onToggle={toggleSidebar}
              notes={notes}
              folders={folders}
              activeId={activeId}
              tab={sidebarTab}
              onTab={setSidebarTab}
              tagFilter={tagFilter}
              onTagFilter={setTagFilter}
              onOpen={open}
              onCreateNote={(folder) => createNote(folder)}
              onCreateCanvas={createCanvas}
              onCreateFolder={(parent, name) => vault.createFolder(parent ? `${parent}/${name}` : name).catch(fail)}
              onDailyNote={dailyNote}
              onRenameNote={rename}
              onMoveNote={move}
              onPickFolder={(note) => setPicker({ kind: 'move', note })}
              onToggleStar={toggleStar}
              onDeleteNote={deleteNote}
              onRenameFolder={(path, newPath) => vault.renameFolder(path, newPath).catch(fail)}
              onDeleteFolder={deleteFolder}
            />
          </>
        )}

        <section className={`nt-workspace${!active && view === 'note' ? ' is-empty' : ''}`}>
          <header className="nt-topbar">
            <div className="nt-topbar__side">
              {narrow && (
                <button type="button" className="nt-icon-btn" onClick={toggleSidebar} title={t('notes.toggleSidebar')}>
                  <PanelIcon />
                </button>
              )}
              <button type="button" className="nt-icon-btn nt-topbar__nav" onClick={() => go(-1)} disabled={!canGo(-1)} title={`${t('notes.back')} (Alt+←)`}>
                <FontAwesomeIcon icon={faChevronLeft} />
              </button>
              <button type="button" className="nt-icon-btn nt-topbar__nav" onClick={() => go(1)} disabled={!canGo(1)} title={`${t('notes.forward')} (Alt+→)`}>
                <FontAwesomeIcon icon={faChevronRight} />
              </button>
            </div>

            <div className="nt-topbar__title">
              {view === 'graph' ? (
                <span className="nt-topbar__heading">{t('notes.graphView')}</span>
              ) : active ? (
                <>
                  {active.folder && <span className="nt-topbar__crumb">{active.folder.split('/').join(' / ')} /</span>}
                  <input
                    className="nt-topbar__input"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') { setTitleDraft(active.title); e.currentTarget.blur(); }
                    }}
                    onBlur={() => {
                      const value = titleDraft.trim();
                      if (value && value !== active.title) rename(active, value);
                      else setTitleDraft(active.title);
                    }}
                    aria-label={t('notes.rename')}
                  />
                  <span className={`nt-save nt-save--${vault.saveState}`} title={saveLabel}>{saveLabel}</span>
                </>
              ) : (
                <span className="nt-topbar__heading">{t('notes.title')}</span>
              )}
            </div>

            <div className="nt-topbar__side nt-topbar__side--end">
              {active && view === 'note' && active.kind === 'note' && (
                <div className="nt-segment" role="group">
                  {([['edit', faPen], ['split', faTableColumns], ['preview', faEye]] as const).map(([m, icon]) => (
                    <button key={m} type="button" className={`nt-icon-btn${mode === m ? ' is-active' : ''}`} onClick={() => setMode(m)} title={t(`notes.mode.${m}`)}>
                      <FontAwesomeIcon icon={icon} />
                    </button>
                  ))}
                </div>
              )}
              {active && view === 'note' && (
                <button type="button" className={`nt-icon-btn${active.starred ? ' is-starred' : ''}`} onClick={() => toggleStar(active)} title={active.starred ? t('notes.unstar') : t('notes.star')}>
                  <FontAwesomeIcon icon={active.starred ? faStarSolid : faStarRegular} />
                </button>
              )}
              <button
                type="button"
                className={`nt-icon-btn${view === 'graph' ? ' is-active' : ''}`}
                onClick={() => setSearchParams((p) => { if (view === 'graph') p.delete('view'); else p.set('view', 'graph'); return p; })}
                title={`${t('notes.graphView')} (Ctrl+G)`}
              >
                <FontAwesomeIcon icon={faDiagramProject} />
              </button>
              <div className="nt-more">
                <button type="button" className="nt-icon-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} title={t('notes.more')}>
                  <FontAwesomeIcon icon={faEllipsisVertical} />
                </button>
                {menuOpen && (
                  <div className="nt-menu nt-menu--right" onClick={() => setMenuOpen(false)}>
                    {active && active.kind === 'note' && (
                      <button type="button" className="nt-menu__item" onClick={() => (templates.length ? setPicker({ kind: 'template' }) : toast.info(t('notes.noTemplates')))}>
                        <FontAwesomeIcon icon={faWandMagicSparkles} /> {t('notes.insertTemplate')}
                      </button>
                    )}
                    {active && (
                      <>
                        <button type="button" className="nt-menu__item" onClick={() => setPicker({ kind: 'move', note: active })}>{t('notes.moveTo')}</button>
                        <button type="button" className="nt-menu__item" onClick={exportNote}>
                          <FontAwesomeIcon icon={faFileExport} /> {t('notes.exportNote')}
                        </button>
                        <button type="button" className="nt-menu__item is-danger" onClick={() => deleteNote(active)}>{t('notes.delete')}</button>
                        <div className="nt-menu__sep" />
                      </>
                    )}
                    <button type="button" className="nt-menu__item" onClick={() => importRef.current?.click()}>
                      <FontAwesomeIcon icon={faFileImport} /> {t('notes.importFiles')}
                    </button>
                    <button type="button" className="nt-menu__item" onClick={exportVault}>
                      <FontAwesomeIcon icon={faFileExport} /> {t('notes.exportVault')}
                    </button>
                  </div>
                )}
              </div>
              {active && view === 'note' && (
                <button type="button" className={`nt-icon-btn${infoOpen ? ' is-active' : ''}`} onClick={() => setInfoOpen((v) => !v)} title={t('notes.toggleInfo')}>
                  <FontAwesomeIcon icon={faCircleInfo} />
                </button>
              )}
            </div>
          </header>

          <main className="nt-main">{renderMain()}</main>
        </section>

        {infoOpen && active && view === 'note' && (
          <div className="nt-right">
            <NoteInfoPanel
              note={active}
              content={activeContent ?? ''}
              notes={notes}
              onOpen={open}
              onOpenLink={openLink}
              onHeading={(item: OutlineItem) => setHeading({ slug: item.slug, line: item.line, nonce: Date.now() })}
              onTag={showTag}
            />
            <div className="nt-right__graph">
              <NotesGraph notes={notes} activeId={active.id} local onOpen={open} onOpenLink={openLink} onTag={showTag} />
            </div>
          </div>
        )}
      </div>

      <input ref={importRef} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={(e) => importFiles(e.target.files)} />
      {activePicker && <NotesPicker {...activePicker} />}
      {vault.error && !notes.length && <div className="nt-error">{vault.error}</div>}
    </div>
  );
};

export default NotesPage;
