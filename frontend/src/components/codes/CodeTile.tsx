import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CodeFile } from '../../utils/api';
import { formatDate } from '../../utils/dateFormatter';
import { FileIcon, FolderIcon, HeartIcon, CommentIcon, EyeIcon, LockIcon } from '../home/icons';
import { monogram } from '../home/monogram';
import { ViewMode, codeSnippet, folderEntries, isLivePreviewable } from './codeUtils';
import CodeLivePreview from './CodeLivePreview';

/* ---------- Код картасы ---------- */

interface CodeTileProps {
  code: CodeFile;
  index: number;
  view: ViewMode;
  /** Иесінің мәзірі (⋮) — сілтеменің ішінде емес, картаның үстінде тұрады */
  menu?: React.ReactNode;
}

const CodeTile: React.FC<CodeTileProps> = ({ code, index, view, menu }) => {
  const { t } = useTranslation();
  const snippet = codeSnippet(code);
  const folder = folderEntries(code);
  const likes = code.likes?.length ?? 0;
  const comments = code.comments?.length ?? 0;
  const views = code.views ?? code.viewedBy?.length ?? 0;

  const card = (
    <Link
      to={`/view/${code.id}`}
      className={`cdx-card cdx-card--${view} ${code.isFolder ? 'is-folder' : ''} ${menu ? 'has-menu' : ''}`}
      // Кезекпен пайда болу анимациясы
      style={{ '--d': Math.min(index, 12) } as React.CSSProperties}
    >
      <div className="cdx-card__head">
        <span className="cdx-card__mono" aria-hidden="true">
          {code.isFolder ? <FolderIcon size={16} /> : monogram(code.title)}
        </span>
        <div className="cdx-card__titles">
          <h3 className="cdx-card__title">{code.title}</h3>
          <span className="cdx-card__meta">
            {code.isPrivate && (
              <span className="cdx-card__private" title={t('projectVisibility.privateHint')}>
                <LockIcon size={12} />
                {t('projectVisibility.privateBadge')}
              </span>
            )}
            <span className="cdx-card__author">{code.author}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={code.createdAt}>{formatDate(code.createdAt)}</time>
          </span>
        </div>
        {code.language && <span className="cdx-card__lang">{code.language}</span>}
      </div>

      {view === 'grid' && (
        <div className="cdx-card__preview">
          {code.isFolder ? (
            <ul className="cdx-card__tree">
              {folder.names.map((entry) => (
                <li key={`${entry.type}-${entry.name}`}>
                  {entry.type === 'folder' ? <FolderIcon size={13} /> : <FileIcon size={13} />}
                  <span>{entry.name}</span>
                </li>
              ))}
              {folder.names.length === 0 && <li className="cdx-card__tree-empty">{code.description || code.title}</li>}
            </ul>
          ) : snippet ? (
            <pre className="cdx-card__code">
              <code>{snippet}</code>
            </pre>
          ) : (
            <p className="cdx-card__desc">{code.description}</p>
          )}
          {/* Веб-код болса — үзіндінің үстінен іске қосылған беті шығады */}
          {isLivePreviewable(code) && <CodeLivePreview codeId={code.id} title={code.title} isPrivate={code.isPrivate} />}
        </div>
      )}

      {view === 'grid' && code.description && snippet && <p className="cdx-card__caption">{code.description}</p>}

      <div className="cdx-card__foot">
        {code.isFolder && (
          <span className="cdx-card__stat" title={t('codes.filesInFolder', { count: folder.files })}>
            <FileIcon size={14} />
            {folder.files}
          </span>
        )}
        <span className="cdx-card__stat" aria-label={`${t('common.like')}: ${likes}`}>
          <HeartIcon />
          {likes}
        </span>
        <span className="cdx-card__stat" aria-label={`${t('codes.comments')}: ${comments}`}>
          <CommentIcon />
          {comments}
        </span>
        <span className="cdx-card__stat" aria-label={`${t('codes.views')}: ${views}`}>
          <EyeIcon />
          {views}
        </span>
        <span className="cdx-card__open" aria-hidden="true">
          {t('codes.open')} →
        </span>
      </div>
    </Link>
  );

  if (!menu) return card;
  return (
    <div className="cdx-card-wrap">
      {card}
      <div className="cdx-card__menu">{menu}</div>
    </div>
  );
};

export default CodeTile;
