import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

/* Бүркіт сөйлесулерінің тарихы — браузерде (localStorage), әр қолданушыға бөлек.
   Сақтау сәтсіз болса (жеке терезе, толы жад) — тарих тек осы сессияда тұрады. */

export interface BurkitMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** ISO уақыт */
  timestamp: string;
  /** Хабармен бірге жіберілген файл (контекст) */
  context?: string;
  /** Тіркелген фото/файл/папкалардың аттары (мазмұны тарихта сақталмайды) */
  attachments?: { kind: 'image' | 'file' | 'folder'; name: string; count?: number }[];
  /** Қате туралы хабар — Бүркітке келесі сұраумен жіберілмейді */
  error?: boolean;
  /** Бүркіт (Agent) жобаға жазған файлдар мен Notes жазбалары */
  edits?: BurkitEdit[];
  /** Жауап аяқталмай қалды (бет жаңартылды / панель жабылды) — қайта ашылғанда жалғасады.
      user хабарында — жауап әлі басталмаған, assistant хабарында — жартылай жазылған */
  pending?: boolean;
  /** «[Құрал нәтижесі]» — Бүркіттің read/run блоктарының нәтижесі (қолданушы жазбаған, ықшам көрсетіледі) */
  tool?: boolean;
  /** Assistant хабарындағы орындалған/өткізілген run блоктары (блоктың реттік нөмірі) */
  ran?: number[];
}

export interface BurkitEdit {
  kind: 'file' | 'note';
  /** Файлдың жолы немесе жазбаның атауы */
  path: string;
  created: boolean;
  noteId?: string;
  /** Файл өшірілді немесе жылжытылды (from — бастапқы жолы) */
  action?: 'delete' | 'move';
  from?: string;
  /** Өзгеріс орындалмады (себебі) */
  error?: string;
}

export interface BurkitConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  /** Сөйлесу қай жобада басталды */
  projectName?: string;
  messages: BurkitMessage[];
}

const MAX_CONVERSATIONS = 100;

/** Тарих қай беттің Бүркітіне тиесілі: vibe — Vibecoding, site — басты бет */
export type BurkitScope = 'vibe' | 'site';

const storageKey = (scope: BurkitScope, userId?: string) => `${scope}-burkit-history:${userId ?? 'guest'}`;
// Қай сөйлесу ашық тұрғаны — бет жаңартылғанда сол чатқа қайту үшін
const activeKey = (historyKey: string) => historyKey.replace('-burkit-history:', '-burkit-active:');

export type BurkitView = 'chat' | 'history';

export interface BurkitActiveState {
  conversationId: string | null;
  view: BurkitView;
}

function load(key: string): BurkitConversation[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(key: string, list: BurkitConversation[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Жад толы немесе бұғатталған — тарих тек осы сессияда қалады
  }
}

// Бірінші сұраудан қысқа атау
export function titleFromText(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  const short = clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1) || 'Жаңа сөйлесу';
}

const DAY = 24 * 60 * 60 * 1000;

/** Тарих тізіміндегі топ: Бүгін, Кеше, Осы аптада… */
export function historyGroupLabel(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = today.getTime() - new Date(iso).setHours(0, 0, 0, 0);
  if (diff <= 0) return 'Бүгін';
  if (diff <= DAY) return 'Кеше';
  if (diff < 7 * DAY) return 'Осы аптада';
  if (diff < 30 * DAY) return 'Осы айда';
  return 'Ертерек';
}

/** Бүгін болса — сағаты, әйтпесе — күні */
export function historyShortTime(iso: string): string {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function useBurkitHistory(scope: BurkitScope = 'vibe') {
  const { user } = useAuth();
  const key = storageKey(scope, user?.id);
  const [conversations, setConversations] = useState<BurkitConversation[]>(() => load(key));

  // Қолданушы ауысса — өз тарихы жүктеледі
  useEffect(() => setConversations(load(key)), [key]);

  const update = useCallback((fn: (list: BurkitConversation[]) => BurkitConversation[]) => {
    setConversations((prev) => {
      const next = fn(prev);
      save(key, next);
      return next;
    });
  }, [key]);

  /** Сөйлесуді сақтау: бар болса жаңартады, жоқ болса басына қосады */
  const upsert = useCallback((conv: BurkitConversation) => {
    update((list) => {
      const rest = list.filter((c) => c.id !== conv.id);
      // Бекітілмегендердің ең ескілері лимиттен асса өшіріледі
      const next = [conv, ...rest];
      if (next.length <= MAX_CONVERSATIONS) return next;
      const oldestUnpinned = [...next].reverse().find((c) => !c.pinned);
      return oldestUnpinned ? next.filter((c) => c !== oldestUnpinned) : next;
    });
  }, [update]);

  const remove = useCallback((id: string) => update((list) => list.filter((c) => c.id !== id)), [update]);

  const rename = useCallback((id: string, title: string) => {
    update((list) => list.map((c) => (c.id === id ? { ...c, title } : c)));
  }, [update]);

  const togglePin = useCallback((id: string) => {
    update((list) => list.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  }, [update]);

  const clearAll = useCallback(() => update((list) => list.filter((c) => c.pinned)), [update]);

  /** Сақталған ашық чат (тарихтан тікелей оқылады — React күйі әлі жаңармаса да) */
  const readActive = useCallback((): { state: BurkitActiveState; conversation: BurkitConversation | null } => {
    let state: BurkitActiveState = { conversationId: null, view: 'chat' };
    try {
      const raw = JSON.parse(localStorage.getItem(activeKey(key)) || 'null');
      if (raw && typeof raw === 'object') {
        state = {
          conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
          view: raw.view === 'history' ? 'history' : 'chat',
        };
      }
    } catch {
      // бұзылған жазба — жаңа чаттан бастаймыз
    }
    const conversation = state.conversationId ? load(key).find((c) => c.id === state.conversationId) ?? null : null;
    return { state, conversation };
  }, [key]);

  const saveActive = useCallback((state: BurkitActiveState) => {
    try {
      localStorage.setItem(activeKey(key), JSON.stringify(state));
    } catch {
      // сақталмаса — тек осы сессияда
    }
  }, [key]);

  return { key, conversations, upsert, remove, rename, togglePin, clearAll, readActive, saveActive };
}

// Сөйлесуді Markdown файлына айналдыру (жүктеп алу үшін)
export function conversationToMarkdown(conv: BurkitConversation): string {
  const lines = [`# ${conv.title}`, '', `_${new Date(conv.createdAt).toLocaleString()}_`, ''];
  conv.messages.forEach((m) => {
    lines.push(`### ${m.role === 'user' ? 'Сіз' : 'Бүркіт'}${m.context ? ` · ${m.context}` : ''}`, '', m.content, '');
  });
  return lines.join('\n');
}
