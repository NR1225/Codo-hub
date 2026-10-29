import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faEye, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import type { StoryViewer as StoryViewerEntry } from '../../../utils/api';
import { avatarSrc, shortAgo } from './storyUtils';
import StickerGlyph from './StickerGlyph';

/* «Кім көрді» (тек авторға): реакциялар қорытындысы, «Барлығы / Реакция» сүзгісі,
   әр адам — аватары (бұрышында стикері), қашан көргені және чатқа жазу батырмасы */

interface Props {
  viewers: StoryViewerEntry[] | 'loading';
  reactions: [string, number][];
  onClose: () => void;
}

const StoryViewersSheet: React.FC<Props> = ({ viewers, reactions, onClose }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'reacted'>('all');
  const list = Array.isArray(viewers) ? viewers : [];
  const reacted = list.filter((v) => v.reaction);
  const shown = filter === 'reacted' ? reacted : list;

  return (
    <div className="sv__sheet-backdrop" onClick={onClose}>
      <div className="sv__sheet svw" onClick={(e) => e.stopPropagation()}>
        <span className="svw__grip" aria-hidden />
        <header className="svw__head">
          <span className="svw__title">
            <FontAwesomeIcon icon={faEye} />
            {t('home.story.whoViewed')}
            {Array.isArray(viewers) && <em>{viewers.length}</em>}
          </span>
          <button type="button" className="sv__tool" onClick={onClose} aria-label={t('home.storyClose')}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        {reactions.length > 0 && (
          <div className="svw__reactions" aria-label={t('home.story.reactionsTitle')}>
            {reactions.map(([emoji, count]) => (
              <span key={emoji} className="svw__chip"><StickerGlyph value={emoji} /><em>{count}</em></span>
            ))}
          </div>
        )}

        {reacted.length > 0 && (
          <div className="svw__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={filter === 'all'}
              className={`svw__tab ${filter === 'all' ? 'is-on' : ''}`} onClick={() => setFilter('all')}>
              {t('home.story.viewersAll')} <em>{list.length}</em>
            </button>
            <button type="button" role="tab" aria-selected={filter === 'reacted'}
              className={`svw__tab ${filter === 'reacted' ? 'is-on' : ''}`} onClick={() => setFilter('reacted')}>
              {t('home.story.viewersReacted')} <em>{reacted.length}</em>
            </button>
          </div>
        )}

        {viewers === 'loading' ? (
          <span className="sv__sheet-spin" aria-hidden />
        ) : shown.length === 0 ? (
          <div className="svw__empty">
            <span className="svw__empty-icon"><FontAwesomeIcon icon={faEye} /></span>
            <p>{t('home.story.noViewers')}</p>
          </div>
        ) : (
          <ul className="svw__list">
            {shown.map((v, i) => {
              const av = avatarSrc(v.avatar);
              return (
                <li key={v.id} className="svw__row" style={{ '--d': Math.min(i, 10) } as React.CSSProperties}>
                  <Link to={`/profile/${v.username}`} className="svw__person">
                    <span className="svw__avatar">
                      {av ? <img src={av} alt="" /> : v.username.charAt(0).toUpperCase()}
                      {v.reaction && <span className="svw__badge"><StickerGlyph value={v.reaction} /></span>}
                    </span>
                    <span className="svw__text">
                      <span className="svw__name">{v.username}</span>
                      {v.viewedAt && <span className="svw__ago">{shortAgo(v.viewedAt, t)}</span>}
                    </span>
                  </Link>
                  <Link to={`/chat/user/${encodeURIComponent(v.id)}`} className="svw__msg"
                    aria-label={t('home.story.viewerMessage', { name: v.username })} title={t('home.story.viewerMessage', { name: v.username })}>
                    <FontAwesomeIcon icon={faPaperPlane} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default StoryViewersSheet;
