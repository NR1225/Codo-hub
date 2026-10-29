import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faShieldHalved, faCheck, faXmark, faTrashCan, faArrowRight, faCode, faFolder, faRobot, faGavel,
} from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../utils/api';
import type { ModerationCase, ModerationAction } from '../utils/api';
import { avatarSrc, backgroundOf, mediaSrc, shortAgo } from '../components/home/stories/storyUtils';
import './ModerationPage.css';

/* Шағымдарды қолмен тексеру (тек модераторларға): шағым, дәлел, Бүркіттің пікірі →
   модератор себебін жазып шешім шығарады; себебі авторға (алып тастағанда — белгіленгенге де) чатпен барады */

type Tab = 'pending' | 'approved' | 'closed';
const TABS: Tab[] = ['pending', 'approved', 'closed'];
const NOTE_MIN = 10;

const Person: React.FC<{ p: ModerationCase['author'] }> = ({ p }) => {
  if (!p) return <span className="mod__person">—</span>;
  const src = avatarSrc(p.avatar);
  return (
    <Link to={`/profile/${p.username}`} className="mod__person">
      <span className="mod__avatar">{src ? <img src={src} alt="" /> : p.username.charAt(0).toUpperCase()}</span>
      @{p.username}
    </Link>
  );
};

const CaseCard: React.FC<{ item: ModerationCase; onDone: (id: string) => void }> = ({ item, onDone }) => {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ModerationAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const story = item.story;

  const decide = async (action: ModerationAction) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await apiService.decideComplaint(item.id, action, note.trim());
      onDone(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const noteOk = note.trim().length >= NOTE_MIN;
  const actions: ModerationAction[] = item.status === 'pending' ? ['approve', 'reject'] : item.status === 'approved' ? ['remove'] : [];

  return (
    <article className={`mod__case is-${item.status}`}>
      {/* Стористің кішкентай көрінісі */}
      <div className="mod__thumb">
        {!story ? (
          <span className="mod__thumb-gone">⌛</span>
        ) : story.mediaType === 'text' ? (
          <span className="mod__thumb-bg" style={{ background: backgroundOf(story.mediaUrl) }}>{story.caption}</span>
        ) : story.mediaType === 'image' ? (
          <img src={mediaSrc(story.mediaUrl)} alt="" loading="lazy" />
        ) : (
          <video src={mediaSrc(story.mediaUrl)} muted preload="metadata" playsInline controls />
        )}
      </div>

      <div className="mod__body">
        <header className="mod__head">
          <Person p={item.author} />
          <FontAwesomeIcon icon={faArrowRight} className="mod__arrow" />
          <Person p={item.target} />
          <span className="mod__ago">{shortAgo(item.createdAt, t)}</span>
          <span className={`mod__status is-${item.status}`}>{t(`moderation.status.${item.status}`)}</span>
        </header>

        <section className="mod__block">
          <h4>{t('moderation.complaint')}</h4>
          <p>{item.text}</p>
        </section>

        <section className="mod__block">
          <h4>{t('moderation.evidence')}</h4>
          <p>{item.evidence || '—'}</p>
          {item.evidenceProject && (
            <Link to={`/view/${item.evidenceProject.id}`} target="_blank" rel="noopener noreferrer" className="mod__project">
              <FontAwesomeIcon icon={item.evidenceProject.isFolder ? faFolder : faCode} />
              {item.evidenceProject.title}
              {item.evidenceProject.language && <em>{item.evidenceProject.language}</em>}
            </Link>
          )}
        </section>

        <section className={`mod__block mod__burkit ${item.verdict ? 'is-ok' : ''}`}>
          <h4><FontAwesomeIcon icon={faRobot} /> {t('moderation.burkit')}</h4>
          <p>{item.verdict || t('moderation.burkitNone')}</p>
        </section>

        {item.note && (
          <section className="mod__block mod__decision">
            <h4><FontAwesomeIcon icon={faGavel} /> {t('moderation.decision')}{item.moderator && <> · @{item.moderator.username}</>}</h4>
            <p>{item.note}</p>
          </section>
        )}

        {actions.length > 0 && (
          <div className="mod__act">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
              placeholder={t('moderation.notePlaceholder')} aria-label={t('moderation.note')} disabled={!!busy} />
            <div className="mod__btns">
              {actions.map((a) => (
                <button key={a} type="button" className={`mod__btn is-${a}`} onClick={() => decide(a)} disabled={!noteOk || !!busy}
                  title={noteOk ? undefined : t('moderation.noteRequired', { min: NOTE_MIN })}>
                  {busy === a ? <span className="mod__spin" aria-hidden /> : (
                    <FontAwesomeIcon icon={a === 'approve' ? faCheck : a === 'reject' ? faXmark : faTrashCan} />
                  )}
                  {t(`moderation.action.${a}`)}
                </button>
              ))}
            </div>
            {!noteOk && <small className="mod__hint">{t('moderation.noteRequired', { min: NOTE_MIN })}</small>}
            {error && <small className="mod__error" role="alert">{error}</small>}
          </div>
        )}
      </div>
    </article>
  );
};

const ModerationPage: React.FC = () => {
  const { t } = useTranslation();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<ModerationCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiService.getModerationMe().then((r) => setAllowed(r.isModerator)).catch(() => setAllowed(false));
  }, []);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      setItems(await apiService.getComplaintCases(tab));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, [tab]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (allowed === false) {
    return (
      <div className="mod mod--center">
        <FontAwesomeIcon icon={faShieldHalved} className="mod__big-icon" />
        <p>{t('moderation.forbidden')}</p>
      </div>
    );
  }

  return (
    <div className="mod">
      <header className="mod__top">
        <h1><FontAwesomeIcon icon={faShieldHalved} /> {t('moderation.title')}</h1>
        <p>{t('moderation.subtitle')}</p>
        <div className="mod__tabs" role="tablist">
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              className={`mod__tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>
              {t(`moderation.tab.${k}`)}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mod__error" role="alert">{error}</p>}
      {items === null || allowed === null ? (
        <span className="mod__loading" aria-hidden />
      ) : items.length === 0 ? (
        <p className="mod__empty">{t(`moderation.empty.${tab}`)}</p>
      ) : (
        <div className="mod__list">
          {items.map((it) => (
            <CaseCard key={it.id} item={it} onDone={(id) => setItems((prev) => (prev ?? []).filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ModerationPage;
