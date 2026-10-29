import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faAt, faXmark, faThumbsUp, faTriangleExclamation, faLock, faShieldHalved, faCircleCheck, faCircleXmark, faUserShield,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, MentionInfo, User } from '../../../utils/api';
import {
  avatarSrc, EVIDENCE_MAX, EVIDENCE_MIN, inRange, MentionValue, OPINION_MAX, OPINION_MIN,
} from './storyUtils';

export type { MentionValue } from './storyUtils';

/* Сторисқа адам белгілеу (міндетті емес): бір қолданушыны іздеп таңдау + пікір түрі + өз сөзімен пікір.
   Мақтау — оның жобасында кемінде 50 лайк болса ғана; шағым — дәлелімен Бүркіт қабылдаса ғана
   (ережелер серверде: backend/services/opinion_service.py) */

interface Props {
  value: MentionValue | null;
  onChange: (value: MentionValue | null) => void;
  currentUserId?: string;
  disabled?: boolean;
}

const SEARCH_DELAY_MS = 350;

const StoryMentionPicker: React.FC<Props> = ({ value, onChange, currentUserId, disabled }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<MentionInfo | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // Бүркіт бір рет жауап берген соң мәтін өзгерсе — «қайта тексерту керек»
  const [reviewedOnce, setReviewedOnce] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Іздеу — терген сайын емес, кідірістен кейін (сервер шегі 20/мин)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const found = await apiService.searchUsers(q);
      setResults(found.filter((u) => u.id !== currentUserId).slice(0, 8));
      setSearching(false);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, currentUserId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Таңдалған адам: мақтауға бола ма және оның жобалары
  const userId = value?.user.id;
  useEffect(() => {
    setInfo(null);
    if (!userId) return;
    let alive = true;
    apiService.getMentionInfo(userId).then((data) => alive && setInfo(data)).catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  const pick = (user: User) => {
    onChange({
      user: { id: user.id, username: user.username, avatar: user.avatar },
      kind: null, text: '', evidence: '', projectId: null, review: null, manual: false,
    });
    setQuery('');
    setResults([]);
    setOpen(false);
    setReviewedOnce(false);
    setReviewError(null);
  };

  // Мәтін/дәлел/жоба өзгерсе — Бүркіттің бұрынғы шешімі жарамсыз
  const patch = (fields: Partial<MentionValue>) => {
    if (!value) return;
    onChange({ ...value, ...fields, review: null });
    setReviewError(null);
  };

  const review = async () => {
    if (!value || reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await apiService.reviewOpinion({
        mentionId: value.user.id, text: value.text.trim(), evidence: value.evidence.trim(), projectId: value.projectId,
      });
      onChange({ ...value, review: res });
      setReviewedOnce(true);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  };

  const renderAvatar = (avatar: string | null | undefined, name: string) => {
    const src = avatarSrc(avatar);
    return <span className="sc__mention-avatar">{src ? <img src={src} alt="" /> : name.charAt(0).toUpperCase()}</span>;
  };

  const praiseLocked = !!info && !info.canPraise;
  const canReview = !!value && inRange(value.text, OPINION_MIN, OPINION_MAX) && inRange(value.evidence, EVIDENCE_MIN, EVIDENCE_MAX);

  return (
    <div className="sc__field">
      <small className="sc__hint">{t('home.story.mentionHint')}</small>

      {value ? (
        <>
          <div className="sc__mention-chip">
            {renderAvatar(value.user.avatar, value.user.username)}
            <span className="sc__mention-name">@{value.user.username}</span>
            <button type="button" className="sc__icon" onClick={() => onChange(null)} disabled={disabled}
              aria-label={t('home.story.mentionRemove')}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <div className="sc__kinds" role="radiogroup" aria-label={t('home.story.mentionKind')}>
            <button type="button" role="radio" aria-checked={value.kind === 'praise'} disabled={disabled || praiseLocked}
              className={`sc__kind sc__kind--praise ${value.kind === 'praise' ? 'is-on' : ''}`}
              onClick={() => patch({ kind: 'praise' })}>
              <FontAwesomeIcon icon={praiseLocked ? faLock : faThumbsUp} />
              {t('home.story.kindPraise')}
            </button>
            <button type="button" role="radio" aria-checked={value.kind === 'complaint'} disabled={disabled}
              className={`sc__kind sc__kind--complaint ${value.kind === 'complaint' ? 'is-on' : ''}`}
              onClick={() => patch({ kind: 'complaint' })}>
              <FontAwesomeIcon icon={faTriangleExclamation} />
              {t('home.story.kindComplaint')}
            </button>
          </div>
          {praiseLocked && info && (
            <small className="sc__hint">
              {t('home.story.praiseLocked', { name: value.user.username, min: info.praiseMinLikes, likes: info.bestLikes })}
            </small>
          )}
          {!value.kind && <small className="sc__hint sc__hint--warn">{t('home.story.chooseKind')}</small>}

          {value.kind && (
            <label className="sc__opinion">
              <textarea value={value.text} maxLength={OPINION_MAX} rows={3} disabled={disabled}
                aria-label={t('home.story.stepOpinion')}
                placeholder={t(value.kind === 'praise' ? 'home.story.opinionPraisePh' : 'home.story.opinionComplaintPh')}
                onChange={(e) => patch({ text: e.target.value })} />
              <em className={value.text.trim().length < OPINION_MIN ? 'is-short' : ''}>
                {t('home.story.opinionCount', { count: value.text.trim().length, max: OPINION_MAX })}
              </em>
            </label>
          )}

          {/* Шағым — дәлел + Бүркіттің тексеруі */}
          {value.kind === 'complaint' && (
            <div className="sc__evidence">
              <span className="sc__evidence-title">
                <FontAwesomeIcon icon={faShieldHalved} />
                {t('home.story.evidence')}
              </span>
              {info && info.projects.length > 0 && (
                <select className="sc__evidence-project" value={value.projectId ?? ''} disabled={disabled}
                  aria-label={t('home.story.evidenceProject')}
                  onChange={(e) => patch({ projectId: e.target.value || null })}>
                  <option value="">{t('home.story.evidenceProject')}</option>
                  {info.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              )}
              <label className="sc__opinion">
                <textarea value={value.evidence} maxLength={EVIDENCE_MAX} rows={3} disabled={disabled}
                  aria-label={t('home.story.evidence')} placeholder={t('home.story.evidencePh')}
                  onChange={(e) => patch({ evidence: e.target.value })} />
                <em className={value.evidence.trim().length < EVIDENCE_MIN ? 'is-short' : ''}>
                  {t('home.story.opinionCount', { count: value.evidence.trim().length, max: EVIDENCE_MAX })}
                </em>
              </label>

              {value.review ? (
                <div className={`sc__review ${value.review.accepted ? 'is-ok' : 'is-bad'}`} role="status">
                  <FontAwesomeIcon icon={value.review.accepted ? faCircleCheck : faCircleXmark} />
                  <span>
                    <b>{t(value.review.accepted ? 'home.story.reviewAccepted' : 'home.story.reviewRejected')}</b>
                    {value.review.reason}
                  </span>
                </div>
              ) : (
                <>
                  {reviewedOnce && <small className="sc__hint sc__hint--warn">{t('home.story.reviewAgain')}</small>}
                  {reviewError && <small className="sc__hint sc__hint--warn" role="alert">{reviewError}</small>}
                </>
              )}
              {!value.review?.accepted && !value.manual && (
                <div className="sc__review-actions">
                  <button type="button" className="sc__btn sc__review-btn" onClick={review} disabled={disabled || reviewing || !canReview}>
                    {reviewing ? <span className="sc__review-spin" aria-hidden /> : <FontAwesomeIcon icon={faShieldHalved} />}
                    {reviewing ? t('home.story.reviewing') : t('home.story.reviewBtn')}
                  </button>
                  {/* Бүркіт қабылдамаса не қолжетімсіз болса — адам қолмен тексереді */}
                  {(value.review || reviewError) && (
                    <button type="button" className="sc__btn sc__review-btn" disabled={disabled || !canReview}
                      onClick={() => onChange({ ...value, manual: true })}>
                      <FontAwesomeIcon icon={faUserShield} />
                      {t('home.story.toModerator')}
                    </button>
                  )}
                </div>
              )}
              {value.manual && !value.review?.accepted && (
                <div className="sc__review is-manual" role="status">
                  <FontAwesomeIcon icon={faUserShield} />
                  <span>
                    <b>{t('home.story.manualTitle')}</b>
                    {t('home.story.manualText')}
                  </span>
                  <button type="button" className="sc__icon" onClick={() => onChange({ ...value, manual: false })}
                    aria-label={t('home.story.manualCancel')} title={t('home.story.manualCancel')} disabled={disabled}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="sc__dd" ref={boxRef}>
          <label className="sc__search">
            <FontAwesomeIcon icon={faAt} />
            <input value={query} disabled={disabled} placeholder={t('home.story.mentionSearch')}
              onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
          </label>
          {open && query.trim().length >= 2 && (
            <div className="sc__dd-menu sc__dd-menu--up">
              <ul className="sc__projects" role="listbox">
                {results.map((u) => (
                  <li key={u.id}>
                    <button type="button" role="option" aria-selected={false} className="sc__project" onClick={() => pick(u)}>
                      {renderAvatar(u.avatar, u.username)}
                      <span className="sc__project-title">{u.username}</span>
                    </button>
                  </li>
                ))}
                {!searching && results.length === 0 && <li className="sc__dd-none">{t('home.story.mentionNone')}</li>}
                {searching && results.length === 0 && <li className="sc__dd-none">…</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StoryMentionPicker;
