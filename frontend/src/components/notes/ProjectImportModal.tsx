import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCode, faGlobe, faRotate, faPlus, faArrowUpRightFromSquare, faWandMagicSparkles, faXmark, faLock, faCheck,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, type NoteMeta, type NoteProjectSource, type NoteProjectSourcesDTO } from '../../utils/api';
import { fuzzyScore } from './noteLinks';

type Tab = 'vibe' | 'site';

interface Props {
  onClose: () => void;
  /** Жазба жасалды/жаңартылды — vault-ты қайта жүктеу керек */
  onImported: (note: NoteMeta, opts: { open: boolean }) => void;
  onOpenNote: (id: string) => void;
}

const readAi = () => {
  try {
    return localStorage.getItem('notes.projectAi') === '1';
  } catch {
    return false;
  }
};

/** «Жобаны қосу»: Vibecoding және сайттағы жобаларды Notes-қа бір басумен қосу/жаңарту */
const ProjectImportModal: React.FC<Props> = ({ onClose, onImported, onOpenNote }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<NoteProjectSourcesDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('vibe');
  const [query, setQuery] = useState('');
  const [ai, setAi] = useState(readAi);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiService.getNoteProjectSources();
      setData(res);
      setError(null);
      // Vibecoding жобасы жоқ, бірақ сайтта бар болса — бірден сол бетті ашамыз
      if (!res.vibe.length && res.site.length) setTab('site');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try { localStorage.setItem('notes.projectAi', ai ? '1' : '0'); } catch { /* жеке режим */ }
  }, [ai]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !bulk) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, bulk]);

  const items = useMemo(() => {
    const list = data?.[tab] ?? [];
    if (!query.trim()) return list;
    return list
      .map((p) => ({ p, s: Math.max(fuzzyScore(query, p.name), fuzzyScore(query, p.description ?? '') - 50) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  }, [data, tab, query]);

  const keyOf = (p: NoteProjectSource) => `${p.kind}:${p.id}`;

  const importOne = async (p: NoteProjectSource, open: boolean) => {
    const key = keyOf(p);
    setBusy((prev) => new Set(prev).add(key));
    try {
      const note = await apiService.importNoteProject({ kind: p.kind, id: p.id, lang: i18n.language?.slice(0, 2), ai });
      setData((prev) => prev && {
        ...prev,
        [p.kind]: prev[p.kind].map((x) => (x.id === p.id ? { ...x, noteId: note.id } : x)),
      });
      onImported(note, { open });
      setError(null);
      return true;
    } catch (e) {
      setError(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  /** Ағымдағы беттегі әлі қосылмаған барлық жобаны рет-ретімен қосу */
  const importAll = async () => {
    const todo = items.filter((p) => !p.noteId);
    if (!todo.length) return;
    setBulk({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      const ok = await importOne(todo[i], false);
      setBulk({ done: i + 1, total: todo.length });
      if (!ok) break;
    }
    setBulk(null);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const pendingCount = items.filter((p) => !p.noteId).length;

  return (
    <div className="nt-modal" onMouseDown={() => !bulk && onClose()}>
      <div className="nt-picker nt-projects" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('notes.projects.title')}>
        <header className="nt-projects__head">
          <div>
            <h3>{t('notes.projects.title')}</h3>
            <p>{t('notes.projects.subtitle')}</p>
          </div>
          <button type="button" className="nt-icon-btn" onClick={onClose} disabled={!!bulk} title={t('notes.projects.close')}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="nt-projects__tabs" role="tablist">
          {([['vibe', faCode], ['site', faGlobe]] as const).map(([key, icon]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={`nt-projects__tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>
              <FontAwesomeIcon icon={icon} /> {t(`notes.projects.tab.${key}`)}
              {data && <span className="nt-projects__count">{data[key].length}</span>}
            </button>
          ))}
        </div>

        <div className="nt-projects__tools">
          <input
            className="nt-projects__search"
            autoFocus
            value={query}
            placeholder={t('notes.projects.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="nt-projects__ai" title={t('notes.projects.aiHint')}>
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
            <FontAwesomeIcon icon={faWandMagicSparkles} /> {t('notes.projects.ai')}
          </label>
        </div>

        <div className="nt-projects__list">
          {!data && !error && <div className="nt-projects__empty">{t('notes.loading')}</div>}
          {data && !items.length && (
            <div className="nt-projects__empty">{query ? t('notes.projects.noMatch') : t(`notes.projects.empty.${tab}`)}</div>
          )}
          {items.map((p) => {
            const working = busy.has(keyOf(p));
            return (
              <div key={keyOf(p)} className={`nt-projects__row${p.noteId ? ' is-linked' : ''}`}>
                <span className="nt-projects__icon" aria-hidden="true">
                  <FontAwesomeIcon icon={p.kind === 'vibe' ? faCode : faGlobe} />
                </span>
                <span className="nt-projects__info">
                  <span className="nt-projects__name">
                    {p.name}
                    {p.isPrivate && <FontAwesomeIcon icon={faLock} className="nt-projects__lock" title={t('notes.projects.private')} />}
                  </span>
                  <small>
                    {t('notes.projects.files', { count: p.fileCount })}
                    {p.updatedAt && ` · ${formatDate(p.updatedAt)}`}
                    {p.role === 'member' && ` · ${t('notes.projects.member')}`}
                    {p.noteId && <span className="nt-projects__badge"><FontAwesomeIcon icon={faCheck} /> {t('notes.projects.linked')}</span>}
                  </small>
                </span>
                <span className="nt-projects__actions">
                  {p.noteId && (
                    <button type="button" className="nt-icon-btn" onClick={() => { onOpenNote(p.noteId!); onClose(); }} title={t('notes.projects.open')}>
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`nt-projects__btn${p.noteId ? '' : ' is-primary'}`}
                    disabled={working || !!bulk}
                    onClick={async () => { if (await importOne(p, true)) onClose(); }}
                  >
                    <FontAwesomeIcon icon={p.noteId ? faRotate : faPlus} spin={working} />
                    {working ? t('notes.projects.working') : p.noteId ? t('notes.projects.refresh') : t('notes.projects.add')}
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        <footer className="nt-projects__foot">
          {error ? <span className="nt-projects__error">{error}</span> : <span>{bulk ? t('notes.projects.progress', bulk) : t('notes.projects.hint')}</span>}
          {pendingCount > 1 && (
            <button type="button" className="nt-projects__btn" disabled={!!bulk || busy.size > 0} onClick={importAll}>
              <FontAwesomeIcon icon={faPlus} /> {t('notes.projects.addAll', { count: pendingCount })}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default ProjectImportModal;
