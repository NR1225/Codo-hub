import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faShare, faCheck, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../../../utils/api';
import type { Chat } from '../../../utils/api';
import { REPLY_MAX, avatarSrc } from './storyUtils';

/* «Жіберу» панелі: чаттағы достар мен хат жазысқандар тізімі → бірнешеуін таңдап, стористі чатқа жіберу */

interface Props {
  storyId: string;
  currentUserId: string;
  onClose: () => void;
  /** Жіберіп болды — нәтиже мәтіні (тост) */
  onDone: (message: string) => void;
}

const StoryShareSheet: React.FC<Props> = ({ storyId, currentUserId, onClose, onDone }) => {
  const { t } = useTranslation();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiService.getChats(currentUserId).then(
      (list) => setChats(list.filter((c) => c.partnerId !== currentUserId)),
      () => setChats([]),
    );
  }, [currentUserId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (chats ?? []).filter((c) => !q || c.partner.username.toLowerCase().includes(q));
  }, [chats, query]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const send = async () => {
    if (!selected.length || sending) return;
    setSending(true);
    setError(null);
    try {
      const { results } = await apiService.shareStory(storyId, selected, text.trim());
      const ok = results.filter((r) => r.ok);
      if (!ok.length) {
        setError(results[0]?.error || t('home.story.shareFailed'));
        return;
      }
      const requests = ok.filter((r) => r.request).length;
      onDone([
        t('home.story.shareDone', { count: ok.length }),
        requests ? t('home.story.shareRequests', { count: requests }) : '',
      ].filter(Boolean).join(' · '));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('home.story.shareFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sv__sheet-backdrop" onClick={onClose}>
      <div className="sv__sheet sv__share" onClick={(e) => e.stopPropagation()}>
        <header className="sv__sheet-head">
          <span>
            <FontAwesomeIcon icon={faShare} />
            {t('home.story.shareTitle')}
            {selected.length > 0 && <em>{selected.length}</em>}
          </span>
          <button type="button" className="sv__tool" onClick={onClose} aria-label={t('home.storyClose')}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <label className="sv__share-search">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('home.story.shareSearch')} />
        </label>

        {chats === null ? (
          <span className="sv__sheet-spin" aria-hidden />
        ) : visible.length === 0 ? (
          <p className="sv__sheet-empty">{chats.length ? t('home.story.shareNotFound') : t('home.story.shareEmpty')}</p>
        ) : (
          <ul className="sv__sheet-list">
            {visible.map((c) => {
              const on = selected.includes(c.partnerId);
              const av = avatarSrc(c.partner.avatar);
              return (
                <li key={c.partnerId}>
                  <button type="button" className={`sv__viewer sv__share-row ${on ? 'is-on' : ''}`}
                    onClick={() => toggle(c.partnerId)} aria-pressed={on}>
                    <span className="sv__avatar">{av ? <img src={av} alt="" /> : c.partner.username.charAt(0).toUpperCase()}</span>
                    <span className="sv__name">{c.partner.username}</span>
                    <span className="sv__share-check" aria-hidden>{on && <FontAwesomeIcon icon={faCheck} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected.length > 0 && (
          <footer className="sv__share-foot">
            {error && <p className="sv__share-error" role="alert">{error}</p>}
            <input className="sv__share-text" value={text} onChange={(e) => setText(e.target.value)}
              maxLength={REPLY_MAX} placeholder={t('home.story.shareText')} />
            <button type="button" className="sv__btn sv__share-send" onClick={send} disabled={sending}>
              {t('home.story.shareSend')}
              <em>{selected.length}</em>
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};

export default StoryShareSheet;
