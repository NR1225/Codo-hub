import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../../contexts/VibecodingContext';
import { apiService, type GitDiffDTO } from '../../../utils/api';
import { CloseIcon, FileIcon } from '../icons';
import { FileTypeIcon } from '../fileIcons';
import type { GitDiffTarget } from './gitEvents';
import './SourceControl.css';

interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Unified diff → жолдар (ескі/жаңа нөмірлерімен) */
function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of diff.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      inHunk = true;
      out.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith('Binary files')) out.push({ kind: 'meta', text: raw });
      continue; // diff --git / index / --- / +++ тақырыптары
    }
    if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ });
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ });
    else if (raw.startsWith('\\')) out.push({ kind: 'meta', text: raw });
    else if (raw.startsWith(' ')) out.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    else if (raw.startsWith('diff --git')) inHunk = false;
  }
  return out;
}

const GitDiffView: React.FC<{ target: GitDiffTarget; onClose: () => void }> = ({ target, onClose }) => {
  const { t } = useTranslation();
  const { dispatch, editorSettings } = useVibecoding();
  const [data, setData] = useState<GitDiffDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    const req = target.sha
      ? apiService.gitCommitDiff(target.projectId, target.sha, target.path)
      : apiService.gitDiff(target.projectId, target.path, !!target.staged);
    req.then((d) => alive && setData(d)).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lines = useMemo(() => (data ? parseDiff(data.diff) : []), [data]);
  const stats = useMemo(() => ({
    add: lines.filter((l) => l.kind === 'add').length,
    del: lines.filter((l) => l.kind === 'del').length,
  }), [lines]);
  const name = target.path.split('/').pop() || target.path;

  return (
    <div className="vx-git-diff" role="dialog" aria-label={target.title}>
      <div className="vx-git-diff__head">
        <FileTypeIcon name={name} size={16} />
        <span className="vx-git-diff__title">{target.title}</span>
        {data && !data.binary && (
          <span className="vx-git-diff__stats">
            <span className="is-add">+{stats.add}</span>
            <span className="is-del">−{stats.del}</span>
          </span>
        )}
        <button
          type="button"
          className="vx-icon-btn vx-icon-btn--sm"
          title={t('vibecoding.git.openFile', 'Файлды ашу')}
          onClick={() => {
            dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId: target.projectId, path: target.path } });
            onClose();
          }}
        >
          <FileIcon size={15} />
        </button>
        <button type="button" className="vx-icon-btn vx-icon-btn--sm" title={t('common.close', 'Жабу')} onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="vx-git-diff__body" style={{ fontSize: Math.max(11, editorSettings.fontSize - 1) }}>
        {error && <p className="vx-git__error">{error}</p>}
        {!data && !error && <p className="vx-git__hint">…</p>}
        {data?.binary && <p className="vx-git__hint">{t('vibecoding.git.binary', 'Бинарлы файл — diff көрсетілмейді')}</p>}
        {data && !data.binary && lines.length === 0 && (
          <p className="vx-git__hint">{t('vibecoding.git.noDiff', 'Мазмұнда өзгеріс жоқ (тек режим немесе атау өзгерген)')}</p>
        )}
        {lines.length > 0 && (
          <table className="vx-git-diff__table">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className={`is-${l.kind}`}>
                  <td className="vx-git-diff__no">{l.oldNo ?? ''}</td>
                  <td className="vx-git-diff__no">{l.newNo ?? ''}</td>
                  <td className="vx-git-diff__sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</td>
                  <td className="vx-git-diff__code">{l.text || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data?.truncated && <p className="vx-git__hint">{t('vibecoding.git.diffTruncated', 'Diff тым үлкен — бір бөлігі ғана көрсетілді')}</p>}
      </div>
    </div>
  );
};

export default GitDiffView;
