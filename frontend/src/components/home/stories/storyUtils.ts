import type { OpinionReview, StoryGroup, StoryMentionKind, User } from '../../../utils/api';
import { API_BASE_URL } from '../../../utils/constants';

export const IMAGE_DURATION_MS = 6000;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const CAPTION_MAX = 300;
// Стикерлер — backend/services/story_service.py REACTIONS-пен бірдей болуы керек
export const REACTIONS = [
  '❤️', '🔥', '👏', '😂', '😮', '😍', '🤩', '🥳',
  '😎', '🤯', '😢', '😡', '🙏', '💯', '👍', '👎',
  '🚀', '💡', '🎉', '🤔', '💪', '⭐', '🏆', '☕',
];
export const REPLY_MAX = 1000;

/* Codo қасқыр стикерлері — эмодзилерден бөлек бөлім; реакция мәні «wolf:<аты>» */
export const WOLF_STICKERS = ['smile', 'happy', 'love', 'laugh', 'wink', 'wow', 'sad', 'angry', 'cool', 'fire', 'think', 'sleepy', 'code', '100', 'sweat', 'thanks'].map((n) => `wolf:${n}`);
export const ALL_STICKERS = [...REACTIONS, ...WOLF_STICKERS];

/** «wolf:<аты>» → суреттің адресі; эмодзи болса null */
export const stickerSrc = (value: string): string | null =>
  value.startsWith('wolf:') ? `/stickers/wolf/${encodeURIComponent(value.slice(5))}.svg` : null;

/* Жылдам стикерлер: қолданушы жиі қолданатындары бірінші; әлі қолданбаса — ең көп басылатындар */
const STICKER_USAGE_KEY = 'codo-sticker-usage';
const POPULAR_STICKERS = ['❤️', '🔥', '😂', '👏', '😍', '🎉'];
export const QUICK_STICKER_COUNT = 6;
export const LIKE_STICKER = '❤️';

export function readStickerUsage(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STICKER_USAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** Стикер қолданылды — санын арттырып, жаңа кестені қайтарады */
export function bumpStickerUsage(emoji: string): Record<string, number> {
  const usage = readStickerUsage();
  usage[emoji] = (usage[emoji] || 0) + 1;
  try {
    localStorage.setItem(STICKER_USAGE_KEY, JSON.stringify(usage));
  } catch {
    // localStorage қолжетімсіз болса — елемеу
  }
  return usage;
}

/** Жиі қолданылғандар (саны бойынша), қалған орын — танымал стикерлермен */
export function quickStickers(usage: Record<string, number>): string[] {
  const used = Object.entries(usage)
    .filter(([emoji, n]) => n > 0 && ALL_STICKERS.includes(emoji))
    .sort((a, b) => b[1] - a[1])
    .map(([emoji]) => emoji);
  const list = [...used, ...POPULAR_STICKERS.filter((e) => !used.includes(e))];
  return list.slice(0, QUICK_STICKER_COUNT);
}

/** Стористің сілтемесі: басты бет ашылғанда сол сторис бірден ашылады (HomeStories) */
export const storyLink = (id: string) => `${window.location.origin}/?story=${encodeURIComponent(id)}`;

export const ACCEPT_MEDIA = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

const SEEN_KEY = 'codo-seen-stories';
const SEEN_LIMIT = 500;

/** Көрілген сторис id-лері (тек осы браузерде) */
export function readSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_LIMIT)));
  } catch {
    // localStorage қолжетімсіз болса — елемеу
  }
}

export const isGroupSeen = (group: StoryGroup, seen: Set<string>) => group.items.every((item) => seen.has(item.id));

/** Топтың алғашқы көрілмеген сторисі (бәрі көрілсе — біріншісі) */
export const firstUnseenIndex = (group: StoryGroup, seen: Set<string>) =>
  Math.max(0, group.items.findIndex((item) => !seen.has(item.id)));

/* Фотосыз сторис фоны: mediaUrl = «bg:<аты>», mediaType = 'text'.
   Аттары серверде де бар: backend/services/story_service.py → STORY_BACKGROUNDS */
export const STORY_BACKGROUNDS: Record<string, string> = {
  aurora: 'linear-gradient(160deg, #4f46e5 0%, #7c3aed 45%, #db2777 100%)',
  ocean: 'linear-gradient(160deg, #0ea5e9 0%, #2563eb 55%, #1e3a8a 100%)',
  sunset: 'linear-gradient(160deg, #fb923c 0%, #ef4444 50%, #9d174d 100%)',
  forest: 'linear-gradient(160deg, #22c55e 0%, #0f766e 60%, #064e3b 100%)',
  midnight: 'linear-gradient(160deg, #334155 0%, #0f172a 60%, #020617 100%)',
  mint: 'linear-gradient(160deg, #2dd4bf 0%, #0d9488 50%, #0e7490 100%)',
  gold: 'linear-gradient(160deg, #fbbf24 0%, #f59e0b 45%, #b45309 100%)',
  code: 'radial-gradient(circle at 25% 15%, #2563eb 0%, transparent 50%), linear-gradient(160deg, #111827 0%, #030712 100%)',
};
export const BACKGROUND_IDS = Object.keys(STORY_BACKGROUNDS);

/** Әр жаңа сторис — басқа фонмен басталады */
export const randomBackground = () => BACKGROUND_IDS[Math.floor(Math.random() * BACKGROUND_IDS.length)];

/** «bg:<аты>» → CSS фон */
export const backgroundOf = (mediaUrl: string) =>
  STORY_BACKGROUNDS[mediaUrl.replace(/^bg:/, '')] ?? STORY_BACKGROUNDS.aurora;

/** /api/uploads/... → бэкенд хостындағы толық адрес */
export const mediaSrc = (url: string) => {
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  const host = API_BASE_URL.replace(/\/api$/, '');
  return url.startsWith('/api') ? `${host}${url}` : `${host}/api${url}`;
};

export const avatarSrc = (avatar?: string | null) => {
  if (!avatar) return null;
  return mediaSrc(avatar);
};

/** «5 мин», «3 сағ» — сторис 24 сағат тұратындықтан күн керек емес */
export function shortAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return t('home.story.justNow');
  if (minutes < 60) return t('home.story.minutesAgo', { count: minutes });
  return t('home.story.hoursAgo', { count: Math.floor(minutes / 60) });
}

/** Рет: өз сторисім → көрілмегендер (жаңасы бірінші) → толық көрілгендер соңында */
export function sortGroups(groups: StoryGroup[], seen: Set<string>, ownId?: string): StoryGroup[] {
  const rank = (g: StoryGroup) => (g.authorId === ownId ? 0 : isGroupSeen(g, seen) ? 2 : 1);
  const latest = (g: StoryGroup) => new Date(g.items[g.items.length - 1].createdAt).getTime();
  return [...groups].sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a));
}

/* ---------- Стористегі пікір (мақтау/шағым) — StoryMentionPicker ---------- */
export const OPINION_MIN = 10;
export const OPINION_MAX = 300;
export const EVIDENCE_MIN = 20;
export const EVIDENCE_MAX = 2000;

export interface MentionValue {
  user: Pick<User, 'id' | 'username' | 'avatar'>;
  kind: StoryMentionKind | null;
  text: string;
  evidence: string;
  projectId: string | null;
  /** Бүркіттің шешімі — тек қазіргі мәтін/дәлел/жоба үшін (өзгерсе тазарады) */
  review: OpinionReview | null;
  /** Бүркіт қабылдамады — модератор қолмен тексереді (сторис оған дейін жасырын) */
  manual?: boolean;
}

export const inRange = (s: string, min: number, max: number) => s.trim().length >= min && s.trim().length <= max;

/** Белгілеу жариялауға дайын ба */
export const mentionReady = (v: MentionValue | null) =>
  !v || (!!v.kind && inRange(v.text, OPINION_MIN, OPINION_MAX)
    && (v.kind === 'praise' || (!!v.review?.accepted && !!v.review.token)
      || (!!v.manual && inRange(v.evidence, EVIDENCE_MIN, EVIDENCE_MAX))));
