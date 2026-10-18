import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiService, Message, PresenceInfo } from '../../utils/api';
import { websocketService } from '../../utils/websocket';
import './ChatComfort.css';

/* Чат ыңғайлылығы (Telegram сияқты):
   онлайн / соңғы рет болды, күн бөлгіштері, «төменге түсу» батырмасы, черновиктер */

const locale = (lang: string) => (lang.startsWith('kk') ? 'kk-KZ' : lang.startsWith('ru') ? 'ru-RU' : 'en-US');

/* ═════════ Онлайн күйі ═════════ */

// Барлық компонентке ортақ кэш: WebSocket 'presence' оқиғасы бір рет тыңдалады
const presenceCache = new Map<string, PresenceInfo>();
const presenceSubscribers = new Set<() => void>();
let presenceWsBound = false;

const notifyPresence = () => presenceSubscribers.forEach((fn) => fn());

const bindPresenceWs = () => {
  if (presenceWsBound) return;
  presenceWsBound = true;
  websocketService.on('presence', (data: { userId?: string; online?: boolean; lastSeen?: string | null }) => {
    if (!data.userId) return;
    presenceCache.set(data.userId, { online: !!data.online, lastSeen: data.lastSeen ?? null });
    notifyPresence();
  });
};

/** Берілген қолданушылардың онлайн күйі; әр минут сайын қайта рендер («5 минут бұрын» жаңарсын) */
export const usePresence = (userIds: string[]): Record<string, PresenceInfo | undefined> => {
  const [, setTick] = useState(0);
  const idsKey = Array.from(new Set(userIds.filter(Boolean))).sort().join(',');

  useEffect(() => {
    bindPresenceWs();
    const rerender = () => setTick((n) => n + 1);
    presenceSubscribers.add(rerender);
    const timer = window.setInterval(rerender, 60_000);
    return () => {
      presenceSubscribers.delete(rerender);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!idsKey) return;
    let alive = true;
    apiService
      .getPresence(idsKey.split(','))
      .then((res) => {
        if (!alive) return;
        Object.entries(res).forEach(([id, info]) => presenceCache.set(id, info));
        notifyPresence();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [idsKey]);

  const out: Record<string, PresenceInfo | undefined> = {};
  idsKey.split(',').forEach((id) => {
    if (id) out[id] = presenceCache.get(id);
  });
  return out;
};

/** «желіде», «жаңа ғана желіде еді», «бүгін 14:20-да болды», «кеше 14:20-да болды» ... */
export const presenceText = (p: PresenceInfo | undefined, t: TFunction, lang: string): string => {
  if (!p) return '';
  if (p.online) return t('chat.presence.online');
  if (!p.lastSeen) return t('chat.presence.longAgo');
  const seen = new Date(p.lastSeen);
  const now = new Date();
  if (now.getTime() - seen.getTime() < 60_000) return t('chat.presence.justNow');
  const time = seen.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' });
  const day = dayDiff(seen, now);
  if (day === 0) return t('chat.presence.todayAt', { time });
  if (day === 1) return t('chat.presence.yesterdayAt', { time });
  const date = seen.toLocaleDateString(locale(lang), {
    day: 'numeric',
    month: 'long',
    ...(seen.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return t('chat.presence.dateAt', { date });
};

/* ═════════ Күн бөлгіштері ═════════ */

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);

/** Хабарламаның алдында күн бөлгіші керек пе (алдыңғысымен күні басқа болса) */
export const isNewDay = (message: Message, prev?: Message): boolean => {
  if (!prev) return true;
  return startOfDay(new Date(message.createdAt)) !== startOfDay(new Date(prev.createdAt));
};

export const DayDivider: React.FC<{ date: string }> = ({ date }) => {
  const { t, i18n } = useTranslation();
  const d = new Date(date);
  const now = new Date();
  const diff = dayDiff(d, now);
  const label =
    diff === 0
      ? t('chat.day.today')
      : diff === 1
        ? t('chat.day.yesterday')
        : d.toLocaleDateString(locale(i18n.language), {
            day: 'numeric',
            month: 'long',
            ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
            ...(diff > 1 && diff < 7 ? { weekday: 'long' } : {}),
          });
  return (
    <div className="cht-day" role="separator">
      <span>{label}</span>
    </div>
  );
};

/* ═════════ «Төменге түсу» батырмасы ═════════ */

const NEAR_BOTTOM_PX = 120;
const SHOW_BUTTON_PX = 320;

/**
 * Хабарлама келгенде: төменде отырса — бірге төмен түседі; жоғарыда оқып отырса —
 * лақтырмайды, тек «↓ N» батырмасында жаңа хабарламалар саны өседі.
 */
export const useStickToBottom = (
  containerRef: React.RefObject<HTMLDivElement>,
  messages: Message[],
  currentUserId: string,
  chatKey: string,
) => {
  const [showButton, setShowButton] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const nearBottom = useRef(true);
  const lastId = useRef<string | null>(null);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const el = containerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      setNewCount(0);
    },
    [containerRef],
  );

  // Чат ауысты — есептегіштер нөлге
  useEffect(() => {
    lastId.current = null;
    nearBottom.current = true;
    setNewCount(0);
    setShowButton(false);
  }, [chatKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottom.current = distance < NEAR_BOTTOM_PX;
      setShowButton(distance > SHOW_BUTTON_PX);
      if (nearBottom.current) setNewCount(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, chatKey]);

  useLayoutEffect(() => {
    const newest = messages[messages.length - 1];
    const prevLastId = lastId.current;
    lastId.current = newest?.id ?? null;
    if (!newest || newest.id === prevLastId) return;

    // Алғашқы жүктелу — бірден төменге
    if (prevLastId === null) {
      requestAnimationFrame(() => scrollToBottom(false));
      return;
    }
    const prevIndex = messages.findIndex((m) => m.id === prevLastId);
    const added = prevIndex >= 0 ? messages.slice(prevIndex + 1) : [newest];
    const mineAdded = added.some((m) => m.fromUserId === currentUserId);
    if (mineAdded || nearBottom.current) {
      requestAnimationFrame(() => scrollToBottom(true));
    } else {
      setNewCount((n) => n + added.filter((m) => m.fromUserId !== currentUserId && m.type !== 'system').length);
    }
  }, [messages, currentUserId, scrollToBottom]);

  return { showButton: showButton || newCount > 0, newCount, scrollToBottom };
};

export const JumpToBottom: React.FC<{ visible: boolean; count: number; onClick: () => void }> = ({
  visible,
  count,
  onClick,
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`cht-jump ${visible ? 'is-visible' : ''}`}
      onClick={onClick}
      aria-label={t('chat.jumpDown')}
      title={t('chat.jumpDown')}
      tabIndex={visible ? 0 : -1}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9.5 12 15.5 18 9.5" />
      </svg>
      {count > 0 && <span className="cht-jump__badge">{count > 99 ? '99+' : count}</span>}
    </button>
  );
};

/* ═════════ Черновиктер (тек осы браузерде) ═════════ */

const DRAFT_PREFIX = 'kh-chat-draft:';
const DRAFT_EVENT = 'kh-chat-draft';

export const draftKeyFor = (kind: 'dm' | 'group', id: string) => `${kind}:${id}`;

export const loadDraft = (key: string): string => {
  try {
    return localStorage.getItem(DRAFT_PREFIX + key) || '';
  } catch {
    return '';
  }
};

export const saveDraft = (key: string, text: string) => {
  try {
    const prev = localStorage.getItem(DRAFT_PREFIX + key) || '';
    if (prev === (text.trim() ? text : '')) return;
    if (text.trim()) localStorage.setItem(DRAFT_PREFIX + key, text);
    else localStorage.removeItem(DRAFT_PREFIX + key);
    window.dispatchEvent(new Event(DRAFT_EVENT));
  } catch {
    // Жеке режим / жад толы — черновиксіз-ақ жұмыс істейміз
  }
};

/** Чат тізімі черновик өзгергенде қайта рендерленуі үшін */
export const useDraftVersion = () => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(DRAFT_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener(DRAFT_EVENT, bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  return version;
};
