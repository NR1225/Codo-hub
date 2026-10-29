import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faTrashCan, faCirclePlay } from '@fortawesome/free-solid-svg-icons';
import { apiService, OpinionItem, StoryMentionKind } from '../../utils/api';
import { formatDateTime } from '../../utils/dateFormatter';
import { avatarSrc } from '../home/stories/storyUtils';
import './ProfileOpinions.css';

/* Профильдегі «Пікірлер»: басқалар стористе осы адамды белгілеп қалдырған мақтау мен шағымдар */

const PAGE = 20;

interface Props {
  username: string;
  currentUserId?: string;
  /** Жою сияқты өзгерістен кейін — профиль панеліндегі сандарды жаңарту үшін */
  onCountsChange?: (counts: { praise: number; complaint: number }) => void;
}

type Filter = 'all' | StoryMentionKind;

const ProfileOpinions: React.FC<Props> = ({ username, currentUserId, onCountsChange }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<OpinionItem[]>([]);
  const [counts, setCounts] = useState({ praise: 0, complaint: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(false);
    try {
      const data = await apiService.getOpinions(username, {
        kind: filter === 'all' ? undefined : filter,
        limit: PAGE,
        offset,
      });
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
      setCounts({ praise: data.praise, complaint: data.complaint });
      setTotal(data.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [username, filter]);

  useEffect(() => {
    load(0);
  }, [load]);

  const remove = async (id: string) => {
    try {
      await apiService.deleteOpinion(id);
    } catch {
      return;
    }
    const removed = items.find((it) => it.id === id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    setTotal((n) => n - 1);
    if (removed) {
      const next = { ...counts, [removed.kind]: counts[removed.kind] - 1 };
      setCounts(next);
      onCountsChange?.(next);
    }
    setConfirmId(null);
  };

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('profile.opinions.all'), count: counts.praise + counts.complaint },
    { key: 'praise', label: `👍 ${t('profile.opinions.praise')}`, count: counts.praise },
    { key: 'complaint', label: `⚠️ ${t('profile.opinions.complaint')}`, count: counts.complaint },
  ];

  return (
    <div className="pop">
      <div className="pop__filters" role="tablist">
        {filters.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
            className={`pop__filter ${filter === f.key ? 'is-on' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
            <span className="pop__filter-count">{f.count}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="pop__empty">
          <p>{t('profile.opinions.error')}</p>
          <button type="button" className="prf-btn prf-btn--ghost" onClick={() => load(0)}>{t('home.retry')}</button>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="pop__empty">
          <span className="pop__empty-icon"><FontAwesomeIcon icon={faComments} /></span>
          <p className="pop__empty-title">{t('profile.opinions.empty')}</p>
          <p className="pop__empty-text">{t('profile.opinions.emptyHint')}</p>
        </div>
      ) : (
        <ul className="pop__list">
          {items.map((op, i) => {
            const av = op.author ? avatarSrc(op.author.avatar) : null;
            return (
              <li key={op.id} className={`pop__item is-${op.kind}`} style={{ '--d': Math.min(i, 8) } as React.CSSProperties}>
                <header className="pop__head">
                  {op.author ? (
                    <Link to={`/profile/${op.author.username}`} className="pop__author">
                      <span className="pop__avatar">{av ? <img src={av} alt="" /> : op.author.username.charAt(0).toUpperCase()}</span>
                      <span className="pop__name">{op.author.username}</span>
                    </Link>
                  ) : (
                    <span className="pop__author pop__author--gone">{t('profile.opinions.deletedUser')}</span>
                  )}
                  <span className={`pop__badge is-${op.kind}`}>
                    {op.kind === 'praise' ? `👍 ${t('profile.opinions.praise')}` : `⚠️ ${t('profile.opinions.complaint')}`}
                  </span>
                </header>

                <p className="pop__text">{op.text}</p>
                {op.verdict && (
                  <p className="pop__verdict">🛡️ <b>{t('home.story.verdictLabel')}:</b> {op.verdict}</p>
                )}
                {op.moderatorNote && (
                  <p className="pop__verdict">⚖️ <b>{t('home.story.moderatorLabel')}:</b> {op.moderatorNote}</p>
                )}

                <footer className="pop__foot">
                  <time dateTime={op.createdAt}>{formatDateTime(op.createdAt)}</time>
                  {op.storyId && (
                    <Link to={`/?story=${encodeURIComponent(op.storyId)}`} className="pop__story">
                      <FontAwesomeIcon icon={faCirclePlay} />
                      {t('profile.opinions.openStory')}
                    </Link>
                  )}
                  {op.author?.id === currentUserId && (
                    confirmId === op.id ? (
                      <span className="pop__confirm">
                        <button type="button" className="pop__link is-danger" onClick={() => remove(op.id)}>{t('home.story.delete')}</button>
                        <button type="button" className="pop__link" onClick={() => setConfirmId(null)}>{t('home.story.cancel')}</button>
                      </span>
                    ) : (
                      <button type="button" className="pop__link" onClick={() => setConfirmId(op.id)} title={t('profile.opinions.deleteMine')}>
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    )
                  )}
                </footer>
              </li>
            );
          })}
          {loading && [0, 1].map((k) => <li key={`sk-${k}`} className="pop__item pop__item--skeleton" aria-hidden />)}
        </ul>
      )}

      {!loading && items.length < total && (
        <button type="button" className="prf-btn prf-btn--ghost pop__more" onClick={() => load(items.length)}>
          {t('profile.opinions.more')}
        </button>
      )}
    </div>
  );
};

export default ProfileOpinions;
