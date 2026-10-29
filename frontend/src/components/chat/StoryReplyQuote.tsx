import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { StoryReplyRef, StoryShareRef } from '../../utils/api';
import { backgroundOf, mediaSrc } from '../home/stories/storyUtils';
import './StoryReply.css';

/* Сторисқа жауаптың үстіндегі үзінді («Сторисқа жауап») немесе жіберілген сторис картасы («X сторисі»).
   Сторис әлі тірі болса — басқанда сол сторис ашылады */

interface Props {
  reply: StoryReplyRef | StoryShareRef;
  isOwn: boolean;
  /** share — досы жіберген сторис (үлкенірек карта) */
  kind?: 'reply' | 'share';
}

const StoryReplyQuote: React.FC<Props> = ({ reply, isOwn, kind = 'reply' }) => {
  const { t } = useTranslation();
  const alive = new Date(reply.expiresAt).getTime() > Date.now();
  const src = mediaSrc(reply.mediaUrl);

  const body = (
    <>
      <span className="srq__thumb">
        {alive ? (
          reply.mediaType === 'text'
            ? <span className="srq__bg" style={{ background: backgroundOf(reply.mediaUrl) }}>{reply.caption}</span>
            : reply.mediaType === 'image'
              ? <img src={src} alt="" loading="lazy" />
              : <video src={src} muted preload="metadata" playsInline />
        ) : (
          <span className="srq__gone" aria-hidden>⌛</span>
        )}
      </span>
      <span className="srq__text">
        <span className="srq__label">
          {kind === 'share'
            ? t('chat.storyShare.label', { name: (reply as StoryShareRef).author })
            : isOwn ? t('chat.storyReply.sent') : t('chat.storyReply.received')}
        </span>
        <span className="srq__caption">{alive ? reply.caption : t('chat.storyReply.expired')}</span>
      </span>
    </>
  );

  return alive ? (
    <Link to={`/?story=${encodeURIComponent(reply.storyId)}`} className={`srq is-${kind}`}>{body}</Link>
  ) : (
    <div className={`srq is-${kind} is-gone`}>{body}</div>
  );
};

export default StoryReplyQuote;
