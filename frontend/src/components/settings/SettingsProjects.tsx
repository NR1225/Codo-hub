import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder, faLock, faTrash, faCheck, faSpinner, faShieldHalved,
  faMagnifyingGlass, faGlobe, faXmark, faArrowDownWideShort, faArrowDownAZ,
  faFileLines, faUsers, faClock, faTriangleExclamation, faEllipsisVertical, faPen, faShareNodes,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, CodeFile } from '../../utils/api';
import { useConfirm } from '../../contexts/ToastContext';
import { formatDate } from '../../utils/dateFormatter';
import { langColor } from '../vibecoding/langColors';
import './SettingsProjects.css';

/* Баптаулар → «Жобалар»: шолу (статистика), көріну баптаулары
   (жаңа жобалар әдепкіде жабық, бәрін бірден жабу/ашу) және жобалар тізімі */

type Filter = 'all' | 'private' | 'public';
type Sort = 'recent' | 'name';
type Status = 'idle' | 'saving' | 'saved' | 'copied' | 'error';

const SettingsProjects: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [projects, setProjects] = useState<CodeFile[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [defaultPrivate, setDefaultPrivate] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ id: string; up: boolean } | null>(null);
  const [editing, setEditing] = useState<CodeFile | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // ⋯ мәзірі: сыртын басқанда / Escape басқанда жабылады
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.prj-menu-wrap')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Өңдеу терезесі Escape-пен жабылады
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editSaving && setEditing(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, editSaving]);

  const openMenu = (id: string, btn: HTMLElement) => {
    if (menu?.id === id) { setMenu(null); return; }
    const rect = btn.getBoundingClientRect();
    setMenu({ id, up: window.innerHeight - rect.bottom < 190 });
  };

  const openEdit = (project: CodeFile) => {
    setMenu(null);
    setEditTitle(project.title);
    setEditDesc(project.description || '');
    setEditError('');
    setEditing(project);
  };

  const saveEdit = async () => {
    if (!editing || !editTitle.trim() || editSaving) return;
    setEditSaving(true);
    setEditError('');
    try {
      const updated = await apiService.updateCodeFile(editing.id, {
        title: editTitle.trim(),
        description: editDesc.trim() || undefined,
      });
      setProjects((list) => list && list.map((p) => (p.id === editing.id
        ? { ...p, title: updated?.title ?? editTitle.trim(), description: updated?.description ?? editDesc.trim() }
        : p)));
      setEditing(null);
      setStatus('saved');
    } catch (err: any) {
      setEditError(err?.message || t('settings.projects.editError'));
    } finally {
      setEditSaving(false);
    }
  };

  const share = async (project: CodeFile) => {
    setMenu(null);
    const url = `${window.location.origin}/view/${project.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: project.title, text: project.description || project.title, url });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  };

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const mine = await apiService.getMyProjects();
      setProjects(mine.filter((p) => p.role !== 'member'));
    } catch (err: any) {
      setLoadError(err?.message || t('common.error'));
      setProjects([]);
    }
  }, [t]);

  useEffect(() => {
    load();
    apiService.getProjectSettings().then(
      (s) => setDefaultPrivate(s.defaultPrivate),
      () => setDefaultPrivate(false),
    );
  }, [load]);

  // «Сақталды» белгісі біраздан соң жоғалады
  useEffect(() => {
    if (status !== 'saved' && status !== 'copied') return;
    const id = window.setTimeout(() => setStatus('idle'), 2200);
    return () => window.clearTimeout(id);
  }, [status]);

  const toggleDefault = async (next: boolean) => {
    const prev = defaultPrivate;
    setDefaultPrivate(next);
    setStatus('saving');
    try {
      await apiService.updateProjectSettings(next);
      setStatus('saved');
    } catch {
      setDefaultPrivate(prev);
      setStatus('error');
    }
  };

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const setProjectPrivate = async (project: CodeFile, next: boolean) => {
    if (!!project.isPrivate === next) return;
    setBusy(project.id, true);
    setProjects((list) => list && list.map((p) => (p.id === project.id ? { ...p, isPrivate: next } : p)));
    setStatus('saving');
    try {
      await apiService.updateCodeFile(project.id, { isPrivate: next });
      setStatus('saved');
    } catch {
      setProjects((list) => list && list.map((p) => (p.id === project.id ? { ...p, isPrivate: !next } : p)));
      setStatus('error');
    } finally {
      setBusy(project.id, false);
    }
  };

  const counts = useMemo(() => {
    const list = projects ?? [];
    const priv = list.filter((p) => p.isPrivate).length;
    return { total: list.length, private: priv, public: list.length - priv };
  }, [projects]);

  const remove = async (project: CodeFile) => {
    setMenu(null);
    const ok = await confirm({
      title: t('common.delete'),
      message: `${t('viewCode.folderDeleteConfirm')} "${project.title}"?`,
      confirmText: t('common.delete'),
      danger: true,
      icon: faTrash,
    });
    if (!ok) return;
    setBusy(project.id, true);
    try {
      await apiService.deleteCodeFile(project.id);
      setProjects((list) => list && list.filter((p) => p.id !== project.id));
    } catch (err: any) {
      setLoadError(err?.message || t('viewCode.errorDeleteCode'));
    } finally {
      setBusy(project.id, false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => (filter === 'all' ? true : filter === 'private' ? p.isPrivate : !p.isPrivate))
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'name'
          ? a.title.localeCompare(b.title, i18n.language)
          : (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
      );
  }, [projects, filter, query, sort, i18n.language]);

  const publicPct = counts.total ? Math.round((counts.public / counts.total) * 100) : 0;
  const loading = projects === null;

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('settings.projects.filterAll'), count: counts.total },
    { key: 'public', label: t('settings.projects.filterPublic'), count: counts.public },
    { key: 'private', label: t('settings.projects.filterPrivate'), count: counts.private },
  ];

  return (
    <div className="prj">
      {/* ── Шолу ── */}
      <section className="prj-hero">
        <div className="prj-hero__top">
          <p className="prj-hero__desc">
            <FontAwesomeIcon icon={faShieldHalved} /> {t('settings.projects.desc')}
          </p>
          <span className={`prj-status is-${status}`} role="status" aria-live="polite">
            {status === 'saving' && <><FontAwesomeIcon icon={faSpinner} spin /> {t('settings.projects.saving')}</>}
            {status === 'saved' && <><FontAwesomeIcon icon={faCheck} /> {t('settings.projects.saved')}</>}
            {status === 'copied' && <><FontAwesomeIcon icon={faCheck} /> {t('settings.projects.linkCopied')}</>}
            {status === 'error' && <><FontAwesomeIcon icon={faTriangleExclamation} /> {t('settings.projects.error')}</>}
          </span>
        </div>

        <div className="prj-ratio" aria-hidden={loading}>
          <div className="prj-ratio__bar">
            <span className="prj-ratio__public" style={{ width: `${publicPct}%` }} />
            <span className="prj-ratio__private" style={{ width: `${counts.total ? 100 - publicPct : 0}%` }} />
          </div>
          <div className="prj-ratio__legend">
            <span><i className="prj-dot is-public" /> {publicPct}%</span>
            <span><i className="prj-dot is-private" /> {counts.total ? 100 - publicPct : 0}%</span>
          </div>
        </div>
      </section>

      {/* ── Көріну баптаулары ── */}
      <section className="prj-controls">
        <label className={`prj-option ${defaultPrivate ? 'is-on' : ''}`}>
          <span className="prj-option__icon"><FontAwesomeIcon icon={faLock} /></span>
          <span className="prj-option__text">
            <span className="prj-option__title">{t('settings.projects.defaultPrivate')}</span>
            <span className="prj-option__hint">{t('settings.projects.defaultPrivateHint')}</span>
          </span>
          <input
            type="checkbox"
            className="stg-switch"
            checked={!!defaultPrivate}
            disabled={defaultPrivate === null}
            onChange={(e) => toggleDefault(e.target.checked)}
          />
        </label>

      </section>

      {/* ── Жобалар тізімі ── */}
      <section className="prj-list">
        <div className="prj-toolbar">
          <div className="prj-tabs" role="radiogroup" aria-label={t('settings.projects.title')}>
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                className={`prj-tabs__btn ${filter === f.key ? 'is-active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="prj-tabs__count">{f.count}</span>
              </button>
            ))}
          </div>

          <div className="prj-toolbar__right">
            <label className="prj-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
              <input
                type="search"
                placeholder={t('settings.projects.search')}
                aria-label={t('settings.projects.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" className="prj-search__clear" onClick={() => setQuery('')} aria-label={t('settings.projects.clearSearch')}>
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </label>
            <button
              type="button"
              className="prj-sort"
              onClick={() => setSort((s) => (s === 'recent' ? 'name' : 'recent'))}
              title={t(sort === 'recent' ? 'settings.projects.sortRecent' : 'settings.projects.sortName')}
              aria-label={t(sort === 'recent' ? 'settings.projects.sortRecent' : 'settings.projects.sortName')}
            >
              <FontAwesomeIcon icon={sort === 'recent' ? faArrowDownWideShort : faArrowDownAZ} />
              <span>{t(sort === 'recent' ? 'settings.projects.sortRecent' : 'settings.projects.sortName')}</span>
            </button>
          </div>
        </div>

        {loadError && <p className="stg-msg stg-msg--error prj-error">{loadError}</p>}

        {loading ? (
          <div className="prj-rows">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="prj-row prj-row--skeleton" />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="prj-empty">
            <span className="prj-empty__icon"><FontAwesomeIcon icon={faFolder} /></span>
            <p className="prj-empty__title">{t('settings.projects.empty')}</p>
            <p className="prj-empty__hint">{t('settings.projects.emptyHint')}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="prj-empty prj-empty--sm">
            <span className="prj-empty__icon"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
            <p className="prj-empty__title">{t('settings.projects.noMatch')}</p>
          </div>
        ) : (
          <ul className="prj-rows">
            {visible.map((project, i) => {
              const busy = busyIds.has(project.id);
              const memberCount = project.members?.length ?? 0;
              const fileCount = project.folderStats?.files ?? 0;
              const priv = !!project.isPrivate;
              return (
                <li
                  key={project.id}
                  className={`prj-row ${priv ? 'is-private' : 'is-public'} ${busy ? 'is-busy' : ''}`}
                  style={{ '--d': Math.min(i, 12) } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="prj-row__main"
                    onClick={() => navigate(`/view/${project.id}`)}
                    title={t('viewCode.title')}
                  >
                    <span className="prj-row__icon">
                      <FontAwesomeIcon icon={faFolder} />
                      {project.language && (
                        <i className="prj-row__lang" style={{ background: langColor(project.language) }} />
                      )}
                    </span>
                    <span className="prj-row__body">
                      <span className="prj-row__title">{project.title}</span>
                      {project.description && <span className="prj-row__desc">{project.description}</span>}
                      <span className="prj-row__meta">
                        <span><FontAwesomeIcon icon={faClock} /> {formatDate(project.updatedAt || project.createdAt, i18n.language)}</span>
                        {fileCount > 0 && (
                          <span><FontAwesomeIcon icon={faFileLines} /> {t('settings.projects.files', { count: fileCount })}</span>
                        )}
                        {memberCount > 0 && (
                          <span><FontAwesomeIcon icon={faUsers} /> {t('settings.projects.members', { count: memberCount })}</span>
                        )}
                      </span>
                    </span>
                  </button>

                  <div className="prj-row__side">
                    <div
                      className="prj-vis"
                      role="radiogroup"
                      aria-label={project.title}
                      data-private={priv}
                    >
                      <span className="prj-vis__thumb" aria-hidden="true" />
                      <button
                        type="button"
                        role="radio"
                        aria-checked={!priv}
                        className={`prj-vis__btn ${!priv ? 'is-active' : ''}`}
                        onClick={() => setProjectPrivate(project, false)}
                        disabled={busy}
                        title={t('settings.projects.makePublic')}
                      >
                        <FontAwesomeIcon icon={busy && priv ? faSpinner : faGlobe} spin={busy && priv} />
                        <span>{t('settings.projects.public')}</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={priv}
                        className={`prj-vis__btn ${priv ? 'is-active' : ''}`}
                        onClick={() => setProjectPrivate(project, true)}
                        disabled={busy}
                        title={t('settings.projects.makePrivate')}
                      >
                        <FontAwesomeIcon icon={busy && !priv ? faSpinner : faLock} spin={busy && !priv} />
                        <span>{t('settings.projects.private')}</span>
                      </button>
                    </div>

                    <div className="prj-menu-wrap">
                      <button
                        type="button"
                        className={`prj-more ${menu?.id === project.id ? 'is-open' : ''}`}
                        onClick={(e) => openMenu(project.id, e.currentTarget)}
                        disabled={busy}
                        title={t('settings.projects.more')}
                        aria-label={t('settings.projects.more')}
                        aria-haspopup="menu"
                        aria-expanded={menu?.id === project.id}
                      >
                        <FontAwesomeIcon icon={faEllipsisVertical} />
                      </button>
                      {menu?.id === project.id && (
                        <div className={`prj-menu ${menu.up ? 'is-up' : ''}`} role="menu">
                          <button type="button" role="menuitem" className="prj-menu__item" onClick={() => openEdit(project)}>
                            <FontAwesomeIcon icon={faPen} /> {t('common.edit')}
                          </button>
                          <button type="button" role="menuitem" className="prj-menu__item" onClick={() => share(project)}>
                            <FontAwesomeIcon icon={faShareNodes} /> {t('settings.projects.share')}
                          </button>
                          <span className="prj-menu__sep" role="separator" />
                          <button
                            type="button"
                            role="menuitem"
                            className="prj-menu__item prj-menu__item--danger"
                            onClick={() => remove(project)}
                          >
                            <FontAwesomeIcon icon={faTrash} /> {t('common.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Өңдеу терезесі ── */}
      {editing && (
        <div className="prj-modal" onMouseDown={() => !editSaving && setEditing(null)}>
          <form
            className="prj-modal__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prj-edit-title"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveEdit(); }}
          >
            <div className="prj-modal__head">
              <h3 id="prj-edit-title"><FontAwesomeIcon icon={faPen} /> {t('settings.projects.editTitle')}</h3>
              <button
                type="button"
                className="prj-icon-btn"
                onClick={() => setEditing(null)}
                disabled={editSaving}
                aria-label={t('common.close')}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <label className="prj-field">
              <span>{t('settings.projects.titleLabel')}</span>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </label>
            <label className="prj-field">
              <span>{t('settings.projects.descLabel')}</span>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder={t('settings.projects.descPlaceholder')}
                rows={4}
                maxLength={1000}
              />
            </label>
            {editError && <p className="stg-msg stg-msg--error">{editError}</p>}
            <div className="prj-modal__foot">
              <button type="button" className="stg-btn stg-btn--ghost" onClick={() => setEditing(null)} disabled={editSaving}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="stg-btn stg-btn--primary" disabled={editSaving || !editTitle.trim()}>
                {editSaving ? <FontAwesomeIcon icon={faSpinner} spin /> : <FontAwesomeIcon icon={faCheck} />}
                {t('common.save')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SettingsProjects;
