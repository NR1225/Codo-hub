import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  apiService,
  type CodoInfoDTO,
  type GitMutationDTO,
  type PullRequestDTO,
  type PullRequestDetailDTO,
} from '../../../utils/api';
import { ArrowLeftIcon, BranchIcon, CheckIcon, CircleAlertIcon, CloseIcon, RefreshIcon } from '../icons';
import { FileTypeIcon } from '../fileIcons';
import { openGitDiff } from './gitEvents';
import { relativeTime } from './gitGraph';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toUnix = (iso: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);

export const PrStatusIcon: React.FC<{ status: PullRequestDTO['status'] }> = ({ status }) => (
  <span className={`vx-pr-icon is-${status}`} aria-hidden>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      {status === 'merged' ? (
        <>
          <circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="8" r="1.6" />
          <path d="M4.5 5.1v5.8M4.5 5.5c0 2 2.5 2.5 5.4 2.5" />
        </>
      ) : (
        <>
          <circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="12.5" r="1.6" />
          <path d="M4.5 5.1v5.8M11.5 10.9V6.5c0-1.4-1-2.5-2.5-2.5H7.5" />
          {status === 'closed' && <path d="M10 2l3 3M13 2l-3 3" />}
        </>
      )}
    </svg>
  </span>
);

// ─── Тізім (Source Control ішіндегі бөлім) ────────────────────────

export const PrList: React.FC<{
  prs: PullRequestDTO[];
  projectId: string;
  onOpen: (id: string) => void;
}> = ({ prs, projectId, onOpen }) => {
  const { t, i18n } = useTranslation();
  if (!prs.length) {
    return <p className="vx-git__hint">{t('vibecoding.git.pr.none', 'Ашық pull request жоқ')}</p>;
  }
  return (
    <>
      {prs.map((pr) => {
        const incoming = pr.target.projectId === projectId;
        return (
          <div key={pr.id} className="vx-pr-row" role="button" tabIndex={0}
            onClick={() => onOpen(pr.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(pr.id); }}
            title={pr.title}>
            <PrStatusIcon status={pr.status} />
            <span className="vx-pr-row__main">
              <span className="vx-pr-row__title">{pr.title}</span>
              <span className="vx-pr-row__meta">
                #{pr.number} · {incoming
                  ? `${pr.author?.username ?? '?'} → ${pr.target.branch}`
                  : `${t('vibecoding.git.pr.outgoing', 'жіберілген')} → ${pr.target.name ?? ''}`}
                {' · '}{relativeTime(toUnix(pr.createdAt), i18n.language)}
              </span>
            </span>
          </div>
        );
      })}
    </>
  );
};

// ─── PR толық көрінісі ────────────────────────────────────────────

export const PrDetail: React.FC<{
  projectId: string;
  prId: string;
  onBack: () => void;
  onMutation: (res: GitMutationDTO) => void;
  onChanged: () => void;
}> = ({ projectId, prId, onBack, onMutation, onChanged }) => {
  const { t, i18n } = useTranslation();
  const [pr, setPr] = useState<PullRequestDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPr(await apiService.prDetail(projectId, prId));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, prId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const merge = (squash: boolean) => act(async () => {
    const res = await apiService.prMerge(projectId, prId, squash);
    onMutation(res);
    if (res.error) setError(res.error);
  });

  const statusLabel = pr?.status === 'merged'
    ? t('vibecoding.git.pr.merged', 'Біріктірілді')
    : pr?.status === 'closed' ? t('vibecoding.git.pr.closed', 'Жабылды') : t('vibecoding.git.pr.open', 'Ашық');

  return (
    <div className="vx-pr">
      <div className="vx-pr__bar">
        <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={onBack} title={t('common.back', 'Артқа')}>
          <ArrowLeftIcon size={14} />
        </button>
        <span className="vx-pr__bar-title">{t('vibecoding.git.pr.title', 'Pull request')} {pr ? `#${pr.number}` : ''}</span>
        <button type="button" className={`vx-icon-btn vx-icon-btn--xs ${loading ? 'vx-git-spin' : ''}`} onClick={load}
          title={t('vibecoding.git.refresh', 'Жаңарту')}>
          <RefreshIcon size={13} />
        </button>
      </div>

      {error && (
        <div className="vx-git__error">
          <span>{error}</span>
          <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={() => setError(null)}><CloseIcon size={11} /></button>
        </div>
      )}
      {!pr ? (
        !error && <p className="vx-git__hint">…</p>
      ) : (
        <>
          <div className="vx-pr__head">
            <h3 className="vx-pr__title">{pr.title}</h3>
            <div className="vx-pr__state">
              <span className={`vx-pr-badge is-${pr.status}`}><PrStatusIcon status={pr.status} />{statusLabel}</span>
              <span className="vx-pr__by">
                {pr.author?.username ?? '?'} · {relativeTime(toUnix(pr.createdAt), i18n.language)}
              </span>
            </div>
            <div className="vx-pr__branches">
              <span className="vx-git-ref is-branch" title={pr.source.name ?? ''}>
                {pr.sameProject ? pr.source.branch : `${pr.source.name ?? '?'}:${pr.source.branch}`}
              </span>
              <span className="vx-pr__arrow">→</span>
              <span className="vx-git-ref is-head">{pr.target.branch}</span>
            </div>
            {pr.body && <p className="vx-pr__body">{pr.body}</p>}
          </div>

          {pr.status === 'open' && (
            <div className="vx-pr__merge">
              {pr.upToDate ? (
                <p className="vx-git__hint">{t('vibecoding.git.pr.upToDate', 'Бұл өзгерістер мақсатты бұтақта бар')}</p>
              ) : pr.mergeable ? (
                <p className="vx-pr__ok"><CheckIcon size={12} /> {t('vibecoding.git.pr.mergeable', 'Конфликт жоқ — біріктіруге болады')}</p>
              ) : (
                <div className="vx-pr__conflict">
                  <p><CircleAlertIcon size={12} /> {t('vibecoding.git.pr.conflict', 'Конфликт бар. Автор өз бұтағына мақсатты бұтақты біріктіріп, қайта жіберуі керек.')}</p>
                  {pr.conflicts.map((f) => <code key={f}>{f}</code>)}
                </div>
              )}
              <div className="vx-pr__actions">
                {pr.canMerge && (
                  <>
                    <button type="button" className="vx-btn vx-btn--primary vx-git-commit__btn"
                      disabled={busy || !pr.mergeable || pr.upToDate} onClick={() => merge(false)}>
                      <CheckIcon size={12} /> {t('vibecoding.git.pr.merge', 'Біріктіру (Merge)')}
                    </button>
                    <button type="button" className="vx-btn vx-git-commit__btn"
                      disabled={busy || !pr.mergeable || pr.upToDate} onClick={() => merge(true)}
                      title={t('vibecoding.git.pr.squashHint', 'Барлық коммит біреуге жиналады')}>
                      {t('vibecoding.git.pr.squash', 'Squash')}
                    </button>
                  </>
                )}
                {(pr.canMerge || pr.isAuthor) && (
                  <button type="button" className="vx-btn vx-git-commit__btn" disabled={busy}
                    onClick={() => act(() => apiService.prSetState(projectId, prId, 'close'))}>
                    {t('vibecoding.git.pr.close', 'Жабу')}
                  </button>
                )}
              </div>
              {!pr.canMerge && (
                <p className="vx-git__hint">
                  {t('vibecoding.git.pr.waiting', 'Жоба иесі ({{owner}}) қарап, біріктіруін күтуде. Жаңа коммиттерді «Сайт Git-іне сақтасаңыз» — PR өзі жаңарады.', { owner: pr.target.owner?.username ?? '?' })}
                </p>
              )}
            </div>
          )}
          {pr.status === 'closed' && (pr.canMerge || pr.isAuthor) && (
            <div className="vx-pr__actions">
              <button type="button" className="vx-btn vx-git-commit__btn" disabled={busy}
                onClick={() => act(() => apiService.prSetState(projectId, prId, 'reopen'))}>
                {t('vibecoding.git.pr.reopen', 'Қайта ашу')}
              </button>
            </div>
          )}
          {pr.status === 'merged' && (
            <p className="vx-git__hint">
              {t('vibecoding.git.pr.mergedBy', '{{user}} біріктірді', { user: pr.mergedBy?.username ?? '?' })}
              {pr.mergedSha ? ` · ${pr.mergedSha.slice(0, 7)}` : ''}
            </p>
          )}

          <div className="vx-pr__sec">{t('vibecoding.git.pr.commits', 'Коммиттер')} <span>{pr.commits.length}</span></div>
          {pr.commits.map((c) => (
            <div key={c.sha} className="vx-pr-commit" title={c.sha}>
              <code>{c.sha.slice(0, 7)}</code>
              <span className="vx-pr-commit__subject">{c.subject}</span>
              <span className="vx-pr-commit__meta">{c.author} · {relativeTime(c.time, i18n.language)}</span>
            </div>
          ))}

          <div className="vx-pr__sec">{t('vibecoding.git.pr.files', 'Өзгерген файлдар')} <span>{pr.files.length}</span></div>
          {pr.files.map((f) => {
            const name = f.path.split('/').pop() || f.path;
            return (
              <div key={f.path} className="vx-git-item" role="button" tabIndex={0} title={f.path}
                onClick={() => openGitDiff({ projectId, path: f.path, prId, title: `${f.path} (PR #${pr.number})` })}>
                <FileTypeIcon name={name} size={15} />
                <span className={`vx-git-item__name ${f.status === 'D' ? 'is-struck' : ''}`}>{name}</span>
                {f.path.includes('/') && <span className="vx-git-item__dir">{f.path.slice(0, f.path.lastIndexOf('/'))}</span>}
                <span className={`vx-git-item__letter is-${f.status === 'A' ? 'added' : f.status === 'D' ? 'deleted' : 'modified'}`}>{f.status}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

// ─── Жаңа PR ──────────────────────────────────────────────────────

export const PrCreate: React.FC<{
  projectId: string;
  codo: CodoInfoDTO | null;
  currentBranch: string | null;
  localBranches: string[];
  onBack: () => void;
  onCreated: (pr: PullRequestDTO) => void;
}> = ({ projectId, codo, currentBranch, localBranches, onBack, onCreated }) => {
  const { t } = useTranslation();
  const hasParent = !!codo?.parent;
  const [target, setTarget] = useState<'parent' | 'self'>(hasParent ? 'parent' : 'self');
  const selfDefault = codo?.defaultBranch && codo.defaultBranch !== currentBranch
    ? codo.defaultBranch
    : localBranches.find((b) => b !== currentBranch) ?? 'main';
  const [source, setSource] = useState(currentBranch ?? localBranches[0] ?? '');
  const [targetBranch, setTargetBranch] = useState(hasParent ? (codo?.upstream?.branch ?? 'main') : selfDefault);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTargetBranch(target === 'parent' ? (codo?.upstream?.branch ?? 'main') : selfDefault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Тақырыпты соңғы коммиттен ұсыну
  useEffect(() => {
    let alive = true;
    apiService.gitLastMessage(projectId)
      .then((r) => { if (alive) setTitle((v) => v || r.message.split('\n')[0].slice(0, 200)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const targetBranches = target === 'self' ? localBranches.filter((b) => b !== source) : [];

  const submit = async () => {
    if (!title.trim() || !source || !targetBranch) return;
    setBusy(true);
    try {
      const pr = await apiService.prCreate(projectId, {
        title: title.trim(), body, source_branch: source, target, target_branch: targetBranch,
      });
      onCreated(pr);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vx-pr">
      <div className="vx-pr__bar">
        <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={onBack} title={t('common.back', 'Артқа')}>
          <ArrowLeftIcon size={14} />
        </button>
        <span className="vx-pr__bar-title">{t('vibecoding.git.pr.new', 'Жаңа pull request')}</span>
      </div>
      <div className="vx-pr-form">
        {hasParent && (
          <div className="vx-seg">
            <button type="button" className={target === 'parent' ? 'is-on' : ''} onClick={() => setTarget('parent')}>
              {t('vibecoding.git.pr.toParent', 'Түпнұсқаға')} ({codo?.parent?.owner?.username ?? '?'})
            </button>
            <button type="button" className={target === 'self' ? 'is-on' : ''} onClick={() => setTarget('self')}>
              {t('vibecoding.git.pr.toSelf', 'Өз жобама')}
            </button>
          </div>
        )}
        <label className="vx-pr-form__row">
          <span><BranchIcon size={12} /> {t('vibecoding.git.pr.from', 'Қайдан')}</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {localBranches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="vx-pr-form__row">
          <span><BranchIcon size={12} /> {t('vibecoding.git.pr.into', 'Қайда')}</span>
          {target === 'self' ? (
            <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}>
              {targetBranches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : (
            <input value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} />
          )}
        </label>
        {target === 'parent' && codo?.parent && (
          <p className="vx-git__hint">{codo.parent.name} · {codo.parent.owner?.username}</p>
        )}
        <input className="vx-git-commit__input vx-pr-form__title" value={title} maxLength={300}
          onChange={(e) => setTitle(e.target.value)} placeholder={t('vibecoding.git.pr.titlePh', 'Тақырып')} />
        <textarea className="vx-git-commit__input" value={body} rows={5} maxLength={20000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('vibecoding.git.pr.bodyPh', 'Не өзгерді және неге? (міндетті емес)')} />
        <p className="vx-git__hint">{t('vibecoding.git.pr.pushHint', 'Бұтақ алдымен сайт Git-іне автоматты сақталады.')}</p>
        {error && (
          <div className="vx-git__error">
            <span>{error}</span>
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={() => setError(null)}><CloseIcon size={11} /></button>
          </div>
        )}
        <button type="button" className="vx-btn vx-btn--primary vx-git-commit__btn"
          disabled={busy || !title.trim() || !source || !targetBranch} onClick={submit}>
          {busy ? '…' : t('vibecoding.git.pr.create', 'PR ашу')}
        </button>
      </div>
    </div>
  );
};
