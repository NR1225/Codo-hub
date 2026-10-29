import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeart, faFaceSmile } from '@fortawesome/free-regular-svg-icons';
import {
  faXmark, faChevronLeft, faChevronRight, faPause, faPlay, faVolumeHigh, faVolumeXmark,
  faTrashCan, faEye, faArrowRight, faFolder, faCode, faChevronUp, faShare,
  faPaperPlane, faLock,
} from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../../../utils/api';
import type { StoryGroup, StoryItem, StoryViewer as StoryViewerEntry } from '../../../utils/api';
import StoryShareSheet from './StoryShareSheet';
import StickerGlyph from './StickerGlyph';
import StoryViewersSheet from './StoryViewersSheet';
import {
  IMAGE_DURATION_MS, MAX_VIDEO_SECONDS, REACTIONS, WOLF_STICKERS, REPLY_MAX, LIKE_STICKER,
  avatarSrc, mediaSrc, shortAgo, readStickerUsage, bumpStickerUsage, quickStickers,
  backgroundOf,
} from './storyUtils';

/* Стористі толық экранда көру: прогресс, кідірту (басып ұстау / Space), видео дыбысы,
   «Жобаға өту» карточкасы, стикерлер (бір батырмада), чат арқылы жауап, сілтемемен бөлісу;
   авторға — статистика (көрулер, өтулер, реакциялар), «Кім көрді» және өшіру */

interface Props {
  groups: StoryGroup[];
  groupIndex: number;
  itemIndex: number;
  currentUserId?: string;
  onChange: (groupIndex: number, itemIndex: number) => void;
  onShown: (storyId: string) => void;
  onDelete: (storyId: string) => void;
  onPatch: (storyId: string, patch: Partial<StoryItem>) => void;
  onClose: () => void;
}

const StoryViewer: React.FC<Props> = ({
  groups, groupIndex, itemIndex, currentUserId, onChange, onShown, onDelete, onPatch, onClose,
}) => {
  const { t } = useTranslation();
  const group = groups[groupIndex];
  const item = group?.items[itemIndex];
  const isOwn = !!currentUserId && group?.authorId === currentUserId;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [muted, setMuted] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // «Кім көрді» панелі: null — жабық
  const [viewers, setViewers] = useState<StoryViewerEntry[] | 'loading' | null>(null);
  // Реакция қойғанда ортада ұшатын эмодзи; «Сілтеме көшірілді» белгісі
  const [burst, setBurst] = useState<{ emoji: string; key: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  // Стикерлер панелі және жауап жазу — ашық тұрғанда сторис тоқтап тұрады
  const [stickersOpen, setStickersOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyFocus, setReplyFocus] = useState(false);
  const [sending, setSending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Стикерлер панелінің бөлімі: эмодзи не Codo қасқыры
  const [stickerTab, setStickerTab] = useState<'emoji' | 'codo'>('emoji');
  // Жылдам стикерлер қатары — қолдану жиілігі бойынша (осы браузерде)
  const [stickerUsage, setStickerUsage] = useState(readStickerUsage);
  const holdTimer = useRef<number | null>(null);
  const viewersOpen = useRef(false);
  viewersOpen.current = viewers !== null;
  const shareOpenRef = useRef(false);
  shareOpenRef.current = shareOpen;
  const suppressTap = useRef(false);

  const stopped = paused || held || !loaded || confirmDelete || viewers !== null
    || stickersOpen || replyFocus || replyText.trim() !== '' || shareOpen;

  const goNext = useCallback(() => {
    if (itemIndex < group.items.length - 1) onChange(groupIndex, itemIndex + 1);
    else if (groupIndex < groups.length - 1) onChange(groupIndex + 1, 0);
    else onClose();
  }, [itemIndex, group, groupIndex, groups.length, onChange, onClose]);

  const goPrev = useCallback(() => {
    if (itemIndex > 0) onChange(groupIndex, itemIndex - 1);
    else if (groupIndex > 0) onChange(groupIndex - 1, groups[groupIndex - 1].items.length - 1);
  }, [itemIndex, groupIndex, groups, onChange]);

  // Жаңа сторис — күйді басынан бастау
  useEffect(() => {
    // Мәтіндік стористе жүктелетін файл жоқ
    setLoaded(item?.mediaType === 'text');
    setVideoProgress(0);
    setConfirmDelete(false);
    setViewers(null);
    setStickersOpen(false);
    setReplyText('');
    setShareOpen(false);
    if (item) onShown(item.id);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Видео кідірту/ойнату
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !loaded) return;
    if (stopped) video.pause();
    else video.play().catch(() => setPaused(true));
  }, [stopped, loaded, item?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Жауап жазып отырғанда — бос орын мен көрсеткілер мәтінге тиесілі
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === 'Escape') {
        if (shareOpenRef.current) setShareOpen(false);
        else if (viewersOpen.current) setViewers(null);
        else onClose();
      }
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goNext, goPrev]);

  if (!group || !item) return null;

  const react = (emoji: string) => {
    const next = item.myReaction === emoji ? null : emoji;
    const prev = item.myReaction ?? null;
    onPatch(item.id, { myReaction: next });
    if (next) {
      setBurst({ emoji: next, key: Date.now() });
      setStickerUsage(bumpStickerUsage(next));
    }
    setStickersOpen(false);
    apiService.reactStory(item.id, next).catch(() => onPatch(item.id, { myReaction: prev }));
  };

  const flash = (text: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  // Жауап авторға чат арқылы барады; профилі жабық болса — «Сұраулар»-ға
  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await apiService.replyStory(item.id, text);
      setReplyText('');
      (document.activeElement as HTMLElement | null)?.blur?.();
      flash(res.request ? t('home.story.replyRequestSent') : t('home.story.replySent'));
    } catch (err) {
      flash(err instanceof Error && err.message ? err.message : t('home.story.replyFailed'));
    } finally {
      setSending(false);
    }
  };

  // Жіберу — чаттағы достарға (сыртқа «Бөлісу» кейін қосылады)
  const share = () => setShareOpen(true);

  const reactionSummary = Object.entries(item.reactions ?? {}).sort((a, b) => b[1] - a[1]);

  const openViewers = async () => {
    setViewers('loading');
    try {
      setViewers(await apiService.getStoryViewers(item.id));
    } catch {
      setViewers([]);
    }
  };

  // Басып ұстау — кідірту; қысқа басу — сол жақ үштен бірі артқа, қалғаны алға
  const onPointerDown = () => {
    holdTimer.current = window.setTimeout(() => {
      suppressTap.current = true;
      setHeld(true);
    }, 220);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    setHeld(false);
    if (suppressTap.current) {
      suppressTap.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 3) goPrev();
    else goNext();
  };
  const onPointerLeave = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    setHeld(false);
  };

  const onVideoTime = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const limit = Math.min(video.duration, MAX_VIDEO_SECONDS);
    setVideoProgress(Math.min(1, video.currentTime / limit));
    if (video.currentTime >= MAX_VIDEO_SECONDS) goNext();
  };

  const avatar = avatarSrc(group.avatar);
  const src = mediaSrc(item.mediaUrl);
  const isText = item.mediaType === 'text';

  // body-ға шығарамыз — хедер (z-index 9999) үстінен толық экран болуы үшін
  return createPortal(
    <div className="sv" role="dialog" aria-modal="true" aria-label={group.author} onClick={onClose}>
      <button type="button" className="sv__nav sv__nav--prev" onClick={(e) => { e.stopPropagation(); goPrev(); }}
        aria-label={t('home.storyPrev')} disabled={groupIndex === 0 && itemIndex === 0}>
        <FontAwesomeIcon icon={faChevronLeft} />
      </button>

      <div className={`sv__card ${held ? 'is-held' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Фон — сол медианың бұлдыр көшірмесі, сурет кесілмеуі үшін */}
        {item.mediaType === 'image' && <div className="sv__backdrop" style={{ backgroundImage: `url("${src}")` }} />}

        <div className="sv__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave}>
          {isText ? (
            <div key={item.id} className="sv__textstory" style={{ background: backgroundOf(item.mediaUrl) }}>
              <p className={item.caption.length > 140 ? 'is-long' : ''}>{item.caption}</p>
            </div>
          ) : item.mediaType === 'image' ? (
            <img key={item.id} className="sv__media" src={src} alt={item.caption || group.author}
              onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} draggable={false} />
          ) : (
            <video key={item.id} ref={videoRef} className="sv__media" src={src} playsInline muted={muted}
              onLoadedData={() => setLoaded(true)} onError={() => setLoaded(true)}
              onTimeUpdate={onVideoTime} onEnded={goNext} />
          )}
          {!loaded && <span className="sv__spinner" aria-hidden />}
        </div>

        <div className="sv__top">
          <div className="sv__progress">
            {group.items.map((it, i) => (
              <span key={it.id} className="sv__bar">
                {i < itemIndex && <span className="sv__fill is-done" />}
                {i === itemIndex && (it.mediaType !== 'video' ? (
                  <span key={it.id} className="sv__fill is-timed" onAnimationEnd={goNext}
                    style={{ animationDuration: `${IMAGE_DURATION_MS}ms`, animationPlayState: stopped ? 'paused' : 'running' }} />
                ) : (
                  <span className="sv__fill" style={{ width: `${videoProgress * 100}%` }} />
                ))}
              </span>
            ))}
          </div>

          <header className="sv__head">
            <Link to={`/profile/${group.author}`} className="sv__author">
              <span className="sv__avatar">
                {avatar ? <img src={avatar} alt="" /> : group.author.charAt(0).toUpperCase()}
              </span>
              <span className="sv__name">{group.author}</span>
            </Link>
            <span className="sv__ago">{shortAgo(item.createdAt, t)}</span>
            <div className="sv__tools">
              {item.mediaType === 'video' && (
                <button type="button" className="sv__tool" onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? t('home.story.unmute') : t('home.story.mute')}>
                  <FontAwesomeIcon icon={muted ? faVolumeXmark : faVolumeHigh} />
                </button>
              )}
              <button type="button" className="sv__tool" onClick={share} aria-label={t('home.story.share')} title={t('home.story.share')}>
                <FontAwesomeIcon icon={faShare} />
              </button>
              <button type="button" className="sv__tool" onClick={() => setPaused((p) => !p)}
                aria-label={paused ? t('home.story.play') : t('home.story.pause')}>
                <FontAwesomeIcon icon={paused ? faPlay : faPause} />
              </button>
              {isOwn && (
                <button type="button" className="sv__tool" onClick={() => setConfirmDelete(true)} aria-label={t('home.story.delete')}>
                  <FontAwesomeIcon icon={faTrashCan} />
                </button>
              )}
              <button type="button" className="sv__tool" onClick={onClose} aria-label={t('home.storyClose')}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          </header>
        </div>

        <div className="sv__bottom">
          {item.status === 'pending' && <p className="sv__pending">⏳ {t('home.story.pendingReview')}</p>}
          {/* Белгіленген адам: мақтау не шағым — басқалар да білуі үшін */}
          {item.mention && (
            <Link to={`/profile/${item.mention.username}`} className={`sv__mention is-${item.mention.kind}`}>
              <span className="sv__mention-icon">{item.mention.kind === 'praise' ? '👍' : '⚠️'}</span>
              <span className="sv__mention-avatar">
                {avatarSrc(item.mention.avatar)
                  ? <img src={avatarSrc(item.mention.avatar) as string} alt="" />
                  : item.mention.username.charAt(0).toUpperCase()}
              </span>
              <span className="sv__mention-text">
                {item.mention.kind === 'praise'
                  ? t('home.story.mentionPraise', { name: item.mention.username })
                  : t('home.story.mentionComplaint', { name: item.mention.username })}
              </span>
            </Link>
          )}
          {item.mention?.text && <p className={`sv__opinion is-${item.mention.kind}`}>{item.mention.text}</p>}
          {/* Мәтіндік стористе жазу ортада тұр — қайталамаймыз */}
          {item.caption && !isText && <p className="sv__caption">{item.caption}</p>}

          {item.project && (
            <Link to={`/view/${item.project.id}`} className="sv__cta"
              onClick={() => !isOwn && apiService.storyClick(item.id).catch(() => {})}>
              <span className="sv__cta-icon">
                <FontAwesomeIcon icon={item.project.isFolder ? faFolder : faCode} />
              </span>
              <span className="sv__cta-text">
                <span className="sv__cta-title">{item.project.title}</span>
                <span className="sv__cta-sub">
                  {item.project.language && <span className="sv__cta-lang">{item.project.language}</span>}
                  {item.project.description || t('home.story.projectOnHub')}
                </span>
              </span>
              <span className="sv__cta-go">
                {t('home.story.goToProject')}
                <FontAwesomeIcon icon={faArrowRight} />
              </span>
            </Link>
          )}

          {/* Авторға — статистика; басқаларға — реакциялар */}
          {isOwn ? (
            <div className="sv__reply">
              {/* Авторға: бір шыны карта — кім көрді (аватарлар), реакциялар; басқанда «Кім көрді» панелі */}
              <button type="button" className="sv__seen" onClick={openViewers}>
                {item.recentViewers && item.recentViewers.length > 0 ? (
                  <span className="sv__seen-faces" aria-hidden>
                    {item.recentViewers.map((v) => {
                      const av = avatarSrc(v.avatar);
                      return (
                        <span key={v.id} className="sv__seen-face">
                          {av ? <img src={av} alt="" /> : v.username.charAt(0).toUpperCase()}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span className="sv__seen-eye" aria-hidden><FontAwesomeIcon icon={faEye} /></span>
                )}
                <span className="sv__seen-text">
                  <strong>{item.views ? t('home.story.viewedBy', { count: item.views }) : t('home.story.noViewers')}</strong>
                  <small>{t('home.story.seenOpen')}</small>
                </span>
                {reactionSummary.length > 0 && (
                  <span className="sv__seen-reacts" aria-label={t('home.story.reactionsTitle')}>
                    {reactionSummary.slice(0, 3).map(([emoji, count]) => (
                      <span key={emoji} className="sv__seen-react"><StickerGlyph value={emoji} /><em>{count}</em></span>
                    ))}
                  </span>
                )}
                <FontAwesomeIcon icon={faChevronUp} className="sv__seen-caret" />
              </button>
            </div>
          ) : currentUserId ? (
            <div className="sv__reply-wrap">
              {/* Жиі қолданылатын стикерлер — бір басумен */}
              <div className="sv__quick" role="group" aria-label={t('home.story.stickers')}>
                {quickStickers(stickerUsage).map((emoji) => (
                  <button key={emoji} type="button" aria-pressed={item.myReaction === emoji}
                    className={`sv__react ${item.myReaction === emoji ? 'is-on' : ''}`} onClick={() => react(emoji)}>
                    <StickerGlyph value={emoji} />
                  </button>
                ))}
              </div>
              {stickersOpen && (
                <div className="sv__stickers-panel">
                  <div className="sv__sticker-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={stickerTab === 'emoji'}
                      className={`sv__sticker-tab ${stickerTab === 'emoji' ? 'is-on' : ''}`} onClick={() => setStickerTab('emoji')}>
                      😊 {t('home.story.stickerEmoji')}
                    </button>
                    <button type="button" role="tab" aria-selected={stickerTab === 'codo'}
                      className={`sv__sticker-tab ${stickerTab === 'codo' ? 'is-on' : ''}`} onClick={() => setStickerTab('codo')}>
                      <StickerGlyph value="wolf:smile" /> Codo
                    </button>
                  </div>
                  <div className={`sv__stickers ${stickerTab === 'codo' ? 'is-codo' : ''}`} role="group" aria-label={t('home.story.stickers')}>
                    {(stickerTab === 'codo' ? WOLF_STICKERS : REACTIONS).map((emoji) => (
                      <button key={emoji} type="button" aria-pressed={item.myReaction === emoji}
                        className={`sv__react ${item.myReaction === emoji ? 'is-on' : ''}`} onClick={() => react(emoji)}>
                        <StickerGlyph value={emoji} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="sv__reply">
                <form className={`sv__reply-form ${item.replyMode === 'blocked' ? 'is-blocked' : ''}`} onSubmit={sendReply}>
                  {/* Барлық стикерлер — жазу картының басында */}
                  <button type="button" className={`sv__reply-icon ${stickersOpen ? 'is-open' : ''}`}
                    onClick={() => setStickersOpen((o) => !o)} aria-expanded={stickersOpen}
                    aria-label={t('home.story.stickers')} title={t('home.story.stickers')}>
                    <FontAwesomeIcon icon={faFaceSmile} />
                  </button>
                  {item.replyMode === 'blocked' && <FontAwesomeIcon icon={faLock} className="sv__reply-lock" />}
                  <input
                    className="sv__reply-input"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onFocus={() => { setReplyFocus(true); setStickersOpen(false); }}
                    onBlur={() => setReplyFocus(false)}
                    maxLength={REPLY_MAX}
                    disabled={item.replyMode === 'blocked' || sending}
                    placeholder={item.replyMode === 'blocked'
                      ? t('home.story.replyBlocked')
                      : t('home.story.replyPlaceholder', { name: group.author })}
                    aria-label={t('home.story.replyPlaceholder', { name: group.author })}
                  />
                  {replyText.trim() && (
                    <button type="submit" className="sv__reply-send" disabled={sending} aria-label={t('home.story.send')}>
                      <FontAwesomeIcon icon={faPaperPlane} />
                    </button>
                  )}
                </form>
                {/* Лайк / қойылған реакция: қойылған болса — басқанда қайтарып алынады */}
                <button type="button" className={`sv__like ${item.myReaction ? 'is-on' : ''}`}
                  onClick={() => react(item.myReaction ?? LIKE_STICKER)} aria-pressed={!!item.myReaction}
                  aria-label={item.myReaction ? t('home.story.unreact') : t('home.story.like')}
                  title={item.myReaction ? t('home.story.unreact') : t('home.story.like')}>
                  {item.myReaction
                    ? <span className="sv__like-emoji"><StickerGlyph value={item.myReaction} /></span>
                    : <FontAwesomeIcon icon={faHeart} />}
                </button>
              </div>
              {item.replyMode === 'request' && (
                <p className="sv__reply-hint">
                  <FontAwesomeIcon icon={faLock} /> {t('home.story.replyRequestHint')}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {burst && (
          <span key={burst.key} className="sv__burst" aria-hidden onAnimationEnd={() => setBurst(null)}><StickerGlyph value={burst.emoji} /></span>
        )}
        {toast && <span className="sv__toast" role="status">{toast}</span>}

        {shareOpen && currentUserId && (
          <StoryShareSheet
            storyId={item.id}
            currentUserId={currentUserId}
            onClose={() => setShareOpen(false)}
            onDone={(msg) => { setShareOpen(false); flash(msg); }}
          />
        )}

        {viewers !== null && (
          <StoryViewersSheet viewers={viewers} reactions={reactionSummary} onClose={() => setViewers(null)} />
        )}

        {confirmDelete && (
          <div className="sv__confirm">
            <p>{t('home.story.deleteConfirm')}</p>
            <div className="sv__confirm-actions">
              <button type="button" className="sv__btn" onClick={() => setConfirmDelete(false)}>{t('home.story.cancel')}</button>
              <button type="button" className="sv__btn sv__btn--danger" onClick={() => onDelete(item.id)}>{t('home.story.delete')}</button>
            </div>
          </div>
        )}
      </div>

      <button type="button" className="sv__nav sv__nav--next" onClick={(e) => { e.stopPropagation(); goNext(); }}
        aria-label={t('home.storyNext')}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
    </div>,
    document.body
  );
};

export default StoryViewer;
