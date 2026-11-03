import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../../contexts/VibecodingContext';
import {
  apiService,
  type GitCommitDTO,
  type GitCommitDetailDTO,
  type GitFileStatusDTO,
  type GitStatusDTO,
} from '../../../utils/api';
import { BranchIcon, CheckIcon, ChevronIcon, CloseIcon, PlusIcon, RefreshIcon, ArrowLeftIcon, FileIcon } from '../icons';
import { FileTypeIcon } from '../fileIcons';
import { buildGraph, graphColor, relativeTime, type GraphRow } from './gitGraph';
import { GIT_BRANCH_EVENT, openGitDiff, type GitDiffTarget } from './gitEvents';
import './SourceControl.css';

const ROW_H = 26;
const LANE_W = 14;

type Kind = 'staged' | 'changes';

interface ChangeItem {
  file: GitFileStatusDTO;
  kind: Kind;
  /** Көрсетілетін әріп: M, A, D, R, U (untracked), ! (қақтығыс) */
  letter: string;
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function splitChanges(files: GitFileStatusDTO[]): { staged: ChangeItem[]; changes: ChangeItem[] } {
  const staged: ChangeItem[] = [];
  const changes: ChangeItem[] = [];
  for (const file of files) {
    const xy = file.index + file.worktree;
    if (CONFLICT.has(xy)) {
      changes.push({ file, kind: 'changes', letter: '!' });
      continue;
    }
    if (file.index === '?') {
      changes.push({ file, kind: 'changes', letter: 'U' });
      continue;
    }
    if (file.index !== ' ') staged.push({ file, kind: 'staged', letter: file.index });
    if (file.worktree !== ' ') changes.push({ file, kind: 'changes', letter: file.worktree });
  }
  const byPath = (a: ChangeItem, b: ChangeItem) => a.file.path.localeCompare(b.file.path);
  return { staged: staged.sort(byPath), changes: changes.sort(byPath) };
}

const letterClass = (letter: string) => {
  switch (letter) {
    case 'A': case 'U': return 'is-added';
    case 'D': return 'is-deleted';
    case 'R': case 'C': return 'is-renamed';
    case '!': return 'is-conflict';
    default: return 'is-modified';
  }
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── Граф жолы (SVG) ──────────────────────────────────────────────

const GraphCell: React.FC<{ row: GraphRow; width: number }> = ({ row, width }) => {
  const mid = ROW_H / 2;
  const x = (c: number) => c * LANE_W + LANE_W / 2;
  return (
    <svg className="vx-git-graph__svg" width={width * LANE_W} height={ROW_H} aria-hidden>
      {row.edges.map((e, i) => {
        const y1 = e.half === 'top' ? 0 : mid;
        const y2 = e.half === 'top' ? mid : ROW_H;
        const x1 = x(e.from);
        const x2 = x(e.to);
        const d = x1 === x2
          ? `M${x1} ${y1}V${y2}`
          : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
        return <path key={i} d={d} stroke={graphColor(e.color)} strokeWidth={2} fill="none" strokeLinecap="round" />;
      })}
      {row.isMerge ? (
        <circle cx={x(row.col)} cy={mid} r={3.5} fill="var(--ide-editor-bg, #111)" stroke={graphColor(row.color)} strokeWidth={2} />
      ) : (
        <circle cx={x(row.col)} cy={mid} r={4} fill={graphColor(row.color)} stroke="var(--ide-editor-bg, #111)" strokeWidth={1.5} />
      )}
    </svg>
  );
};

const RefChip: React.FC<{ name: string }> = ({ name }) => {
  const head = name.startsWith('HEAD -> ');
  const label = head ? name.slice(8) : name.replace(/^tag: /, '');
  const kind = head ? 'is-head' : name.startsWith('tag: ') ? 'is-tag' : name.includes('/') ? 'is-remote' : 'is-branch';
  return <span className={`vx-git-ref ${kind}`} title={name}>{label}</span>;
};

// ─── Негізгі панель ───────────────────────────────────────────────

const SourceControlPanel: React.FC<{ isOverlay?: boolean; onClose?: () => void }> = ({ isOverlay, onClose }) => {
  const { t, i18n } = useTranslation();
  const { activeProject, dispatch, flushProjects } = useVibecoding();
  const projectId = activeProject?.id ?? null;

  const [status, setStatus] = useState<GitStatusDTO | null>(null);
  const [commits, setCommits] = useState<GitCommitDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [openSections, setOpenSections] = useState({ staged: true, changes: true, graph: true });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<GitCommitDetailDTO | null>(null);
  const reqId = useRef(0);

  const refresh = useCallback(async (opts: { flush?: boolean; quiet?: boolean } = {}) => {
    if (!projectId) return;
    const id = ++reqId.current;
    if (!opts.quiet) setLoading(true);
    try {
      if (opts.flush !== false) await flushProjects().catch(() => {});
      const st = await apiService.gitStatus(projectId);
      if (id !== reqId.current) return;
      setStatus(st);
      setCommits(st.repo ? await apiService.gitLog(projectId) : []);
      setError(null);
    } catch (e) {
      if (id === reqId.current) setError(errorText(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [projectId, flushProjects]);

  // Жоба ауысқанда — бәрін қайта жүктеу
  useEffect(() => {
    setStatus(null);
    setCommits([]);
    setExpanded(null);
    setDetail(null);
    setError(null);
    refresh();
  }, [projectId, refresh]);

  // Файлдар өзгергенде (редактор/терминал) — сәл күтіп, күйді жаңарту
  const filesRef = activeProject?.files;
  useEffect(() => {
    if (!filesRef) return;
    const timer = window.setTimeout(() => refresh({ quiet: true }), 1500);
    return () => window.clearTimeout(timer);
  }, [filesRef, refresh]);

  // Терезеге оралғанда (терминалда git командасы орындалған болуы мүмкін)
  useEffect(() => {
    const onFocus = () => refresh({ quiet: true, flush: false });
    window.addEventListener('focus', onFocus);
    window.addEventListener('vibecoding:git-refresh', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('vibecoding:git-refresh', onFocus);
    };
  }, [refresh]);

  // Статус жолағына ағымдағы бұтақ
  useEffect(() => {
    const branch = status?.repo ? (status.detached ? (status.head?.slice(0, 7) ?? 'HEAD') : status.branch ?? null) : null;
    const changes = status?.repo ? (status.files?.length ?? 0) : 0;
    window.dispatchEvent(new CustomEvent(GIT_BRANCH_EVENT, { detail: { projectId, branch, changes } }));
  }, [status, projectId]);

  const run = useCallback(async (fn: () => Promise<GitStatusDTO | void>, withLog = false) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await flushProjects().catch(() => {});
      const st = await fn();
      if (st) setStatus(st);
      if (withLog) setCommits(await apiService.gitLog(projectId));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, flushProjects]);

  const { staged, changes } = useMemo(() => splitChanges(status?.files ?? []), [status]);
  const graph = useMemo(() => buildGraph(commits), [commits]);

  const stage = (paths: string[]) => run(() => apiService.gitStage(projectId!, paths));
  const unstage = (paths: string[]) => run(() => apiService.gitUnstage(projectId!, paths));
  const discard = (items: ChangeItem[]) => {
    if (!items.length) return;
    const names = items.length === 1 ? items[0].file.path : `${items.length} ${t('vibecoding.git.files', 'файл')}`;
    const ok = window.confirm(t('vibecoding.git.discardConfirm', '{{name}} өзгерістерін қайтарасыз ба? Бұл әрекетті болдырмау мүмкін емес.', { name: names }));
    if (!ok) return;
    run(async () => {
      const res = await apiService.gitDiscard(projectId!, items.map((i) => i.file.path));
      if (res.changes) dispatch({ type: 'APPLY_WORKSPACE_CHANGES', payload: { projectId: projectId!, changes: res.changes } });
      return res.status;
    });
  };
  const commit = () => {
    const text = message.trim();
    if (!text || busy) return;
    const all = staged.length === 0;
    run(async () => {
      const res = await apiService.gitCommit(projectId!, text, all);
      setMessage('');
      return res.status;
    }, true);
  };

  const showDiff = (item: ChangeItem) => {
    const target: GitDiffTarget = {
      projectId: projectId!,
      path: item.file.path,
      staged: item.kind === 'staged',
      title: `${item.file.path} (${item.kind === 'staged' ? t('vibecoding.git.indexLabel', 'Индекс') : t('vibecoding.git.workingTree', 'Жұмыс папкасы')})`,
    };
    openGitDiff(target);
  };

  const openFile = (path: string) => {
    if (!projectId) return;
    dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId, path } });
  };

  const toggleCommit = async (sha: string) => {
    if (expanded === sha) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(sha);
    setDetail(null);
    try {
      const d = await apiService.gitCommitDetail(projectId!, sha);
      setDetail(d);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const header = (
    <div className="vx-explorer__head">
      {isOverlay && onClose && (
        <button type="button" onClick={onClose} className="vx-icon-btn vx-icon-btn--sm" title={t('common.close', 'Жабу')}>
          <ArrowLeftIcon size={17} />
        </button>
      )}
      <span className="vx-explorer__title">{t('vibecoding.git.title', 'Source Control')}</span>
      <div className="vx-explorer__actions" style={{ opacity: 1 }}>
        <button
          type="button"
          onClick={() => refresh()}
          className={`vx-icon-btn vx-icon-btn--sm ${loading ? 'vx-git-spin' : ''}`}
          title={t('vibecoding.git.refresh', 'Жаңарту')}
        >
          <RefreshIcon size={16} />
        </button>
      </div>
    </div>
  );

  if (!activeProject) {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <p className="vx-git__hint">{t('vibecoding.git.noProject', 'Алдымен жоба ашыңыз')}</p>
      </div>
    );
  }

  if (status && !status.repo) {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <div className="vx-git__empty">
          <span className="vx-git__orb"><BranchIcon size={26} /></span>
          <p>{t('vibecoding.git.noRepo', 'Бұл жобада әлі git репозиторийі жоқ. Өзгерістерді бақылау және коммиттер графын көру үшін репозиторий жасаңыз.')}</p>
          <button
            type="button"
            className="vx-btn vx-btn--primary vx-btn--xs"
            disabled={busy}
            onClick={() => run(() => apiService.gitInit(projectId!), true)}
          >
            <BranchIcon size={14} />
            {t('vibecoding.git.init', 'Репозиторий жасау')}
          </button>
          {error && <p className="vx-git__error">{error}</p>}
        </div>
      </div>
    );
  }

  const renderItem = (item: ChangeItem) => {
    const name = item.file.path.split('/').pop() || item.file.path;
    const dir = item.file.path.includes('/') ? item.file.path.slice(0, item.file.path.lastIndexOf('/')) : '';
    const deleted = item.letter === 'D';
    return (
      <div
        key={`${item.kind}:${item.file.path}`}
        className="vx-git-item"
        role="button"
        tabIndex={0}
        onClick={() => showDiff(item)}
        onKeyDown={(e) => { if (e.key === 'Enter') showDiff(item); }}
        title={item.file.orig ? `${item.file.orig} → ${item.file.path}` : item.file.path}
      >
        <FileTypeIcon name={name} size={16} />
        <span className={`vx-git-item__name ${deleted ? 'is-struck' : ''}`}>{name}</span>
        {dir && <span className="vx-git-item__dir">{dir}</span>}
        <span className="vx-git-item__actions" onClick={(e) => e.stopPropagation()}>
          {!deleted && (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.openFile', 'Файлды ашу')} onClick={() => openFile(item.file.path)}>
              <FileIcon size={13} />
            </button>
          )}
          {item.kind === 'changes' && (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.discard', 'Өзгерісті қайтару')} onClick={() => discard([item])} disabled={busy}>
              <span className="vx-git-undo" aria-hidden>↺</span>
            </button>
          )}
          {item.kind === 'changes' ? (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.stage', 'Индекске қосу')} onClick={() => stage([item.file.path])} disabled={busy}>
              <PlusIcon size={13} />
            </button>
          ) : (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.unstage', 'Индекстен алу')} onClick={() => unstage([item.file.path])} disabled={busy}>
              <span className="vx-git-minus" aria-hidden>−</span>
            </button>
          )}
        </span>
        <span className={`vx-git-item__letter ${letterClass(item.letter)}`}>{item.letter}</span>
      </div>
    );
  };

  const section = (
    key: 'staged' | 'changes',
    title: string,
    items: ChangeItem[],
    actions: React.ReactNode,
  ) => (
    <div className="vx-git-sec">
      <div className="vx-git-sec__head" onClick={() => setOpenSections((s) => ({ ...s, [key]: !s[key] }))}>
        <span className={`vx-git-sec__chev ${openSections[key] ? 'is-open' : ''}`}><ChevronIcon size={13} /></span>
        <span className="vx-git-sec__title">{title}</span>
        <span className="vx-git-sec__actions" onClick={(e) => e.stopPropagation()}>{actions}</span>
        <span className="vx-git-sec__count">{items.length}</span>
      </div>
      {openSections[key] && <div className="vx-git-sec__body">{items.map(renderItem)}</div>}
    </div>
  );

  const canCommit = !!message.trim() && !busy && (staged.length > 0 || changes.length > 0);
  const branchLabel = status?.detached ? `HEAD ${status.head?.slice(0, 7) ?? ''}` : status?.branch ?? '…';

  return (
    <div className="vx-explorer vx-git">
      {header}

      <div className="vx-git__scroll">
        {/* Коммит жолы */}
        <div className="vx-git-commit">
          <div className="vx-git-branch" title={status?.upstream ? `${branchLabel} → ${status.upstream}` : branchLabel}>
            <BranchIcon size={13} />
            <span>{branchLabel}</span>
            {!!status?.ahead && <span className="vx-git-branch__sync">↑{status.ahead}</span>}
            {!!status?.behind && <span className="vx-git-branch__sync">↓{status.behind}</span>}
          </div>
          <textarea
            className="vx-git-commit__input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit();
              }
            }}
            placeholder={t('vibecoding.git.messagePlaceholder', 'Хабарлама (Ctrl+Enter — коммит)')}
            rows={message.includes('\n') ? 4 : 2}
          />
          <button type="button" className="vx-btn vx-btn--primary vx-git-commit__btn" disabled={!canCommit} onClick={commit}>
            <CheckIcon size={14} />
            {staged.length === 0 && changes.length > 0
              ? t('vibecoding.git.commitAll', 'Барлығын коммиттеу')
              : t('vibecoding.git.commit', 'Коммит')}
          </button>
          {error && (
            <div className="vx-git__error">
              <span>{error}</span>
              <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={() => setError(null)}><CloseIcon size={11} /></button>
            </div>
          )}
        </div>

        {/* Өзгерістер */}
        {staged.length > 0 && section(
          'staged',
          t('vibecoding.git.stagedChanges', 'Индекстегі өзгерістер'),
          staged,
          <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.unstageAll', 'Барлығын индекстен алу')} onClick={() => unstage([])} disabled={busy}>
            <span className="vx-git-minus" aria-hidden>−</span>
          </button>,
        )}
        {section(
          'changes',
          t('vibecoding.git.changes', 'Өзгерістер'),
          changes,
          <>
            {changes.length > 0 && (
              <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.discardAll', 'Барлық өзгерісті қайтару')} onClick={() => discard(changes)} disabled={busy}>
                <span className="vx-git-undo" aria-hidden>↺</span>
              </button>
            )}
            {changes.length > 0 && (
              <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.stageAll', 'Барлығын индекске қосу')} onClick={() => stage([])} disabled={busy}>
                <PlusIcon size={13} />
              </button>
            )}
          </>,
        )}
        {status && staged.length === 0 && changes.length === 0 && (
          <p className="vx-git__hint">{t('vibecoding.git.clean', 'Өзгеріс жоқ — бәрі коммиттелген')}</p>
        )}
        {status?.truncated && <p className="vx-git__hint">{t('vibecoding.git.truncated', 'Тізім тым ұзын — бір бөлігі ғана көрсетілді')}</p>}

        {/* Граф */}
        <div className="vx-git-sec vx-git-sec--graph">
          <div className="vx-git-sec__head" onClick={() => setOpenSections((s) => ({ ...s, graph: !s.graph }))}>
            <span className={`vx-git-sec__chev ${openSections.graph ? 'is-open' : ''}`}><ChevronIcon size={13} /></span>
            <span className="vx-git-sec__title">{t('vibecoding.git.graph', 'Граф')}</span>
            <span className="vx-git-sec__count">{commits.length}</span>
          </div>
          {openSections.graph && (
            <div className="vx-git-graph">
              {commits.length === 0 && (
                <p className="vx-git__hint">{t('vibecoding.git.noCommits', 'Әзірге коммит жоқ')}</p>
              )}
              {graph.rows.map((row) => {
                const c = row.commit;
                const open = expanded === c.sha;
                return (
                  <React.Fragment key={c.sha}>
                    <div
                      className={`vx-git-graph__row ${open ? 'is-open' : ''}`}
                      onClick={() => toggleCommit(c.sha)}
                      title={`${c.sha.slice(0, 8)} · ${c.author} · ${new Date(c.time * 1000).toLocaleString(i18n.language)}\n${c.subject}`}
                    >
                      <GraphCell row={row} width={graph.maxWidth} />
                      <span className="vx-git-graph__text">
                        {c.refs.map((r) => <RefChip key={r} name={r} />)}
                        <span className="vx-git-graph__subject">{c.subject}</span>
                      </span>
                      <span className="vx-git-graph__meta">{c.author} · {relativeTime(c.time, i18n.language)}</span>
                    </div>
                    {open && (
                      <div className="vx-git-detail" style={{ marginLeft: graph.maxWidth * LANE_W }}>
                        {!detail ? (
                          <span className="vx-git__hint">…</span>
                        ) : (
                          <>
                            <div className="vx-git-detail__meta">
                              <code>{detail.sha.slice(0, 10)}</code> · {detail.author} &lt;{detail.email}&gt;
                            </div>
                            {detail.message !== c.subject && <pre className="vx-git-detail__msg">{detail.message}</pre>}
                            {detail.files.map((f) => {
                              const name = f.path.split('/').pop() || f.path;
                              return (
                                <div
                                  key={f.path}
                                  className="vx-git-item"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openGitDiff({ projectId: projectId!, path: f.path, sha: detail.sha, title: `${f.path} (${detail.sha.slice(0, 7)})` })}
                                  title={f.path}
                                >
                                  <FileTypeIcon name={name} size={15} />
                                  <span className={`vx-git-item__name ${f.status === 'D' ? 'is-struck' : ''}`}>{name}</span>
                                  {f.path.includes('/') && <span className="vx-git-item__dir">{f.path.slice(0, f.path.lastIndexOf('/'))}</span>}
                                  <span className={`vx-git-item__letter ${letterClass(f.status)}`}>{f.status}</span>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourceControlPanel;
