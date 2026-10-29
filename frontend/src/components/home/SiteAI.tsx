import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import type { TFunction } from 'i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CodeFile, apiService, BurkitError, BurkitStatus, VibecodingProjectDTO } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  SparkleIcon,
  ArrowUpIcon,
  ArrowRightIcon,
  RefreshIcon,
  CloseIcon,
  ClockIcon,
  CopyIcon,
  CheckIcon,
  FolderIcon,
  PlusIcon,
  LinkIcon,
  GlobeIcon,
  ForwardIcon,
  EditIcon,
  FileIcon,
} from './icons';
import BurkitLogo from '../BurkitLogo';
import BurkitKeyCard from '../BurkitKeyCard';
import { monogram } from './monogram';
import { extractCodeBlocks } from '../vibecoding/burkitBlocks';
import {
  runProjectAction,
  describeProjectAction,
  loadSiteContext,
  createProjectOnServer,
  ALWAYS_CONFIRM_OPS,
  BurkitSiteContext,
  ProjectHost,
  VIBE_PROJECTS_EVENT,
} from '../../utils/burkitProjectTools';
import { AgentText } from './SiteAIAgent';
import SiteAIHistory from './SiteAIHistory';
import { Attachment, budgetFiles } from '../../utils/burkitAttachments';
import { BurkitAttachButton, BurkitAttachmentChip } from '../BurkitAttach';
import { useBurkitAttachments } from '../useBurkitAttachments';
import { useBurkitHistory, titleFromText, conversationToMarkdown, BurkitConversation, BurkitMessage, BurkitEdit } from '../vibecoding/useBurkitHistory';
import { applyFileBlocks, projectContext, restoreFiles } from '../../utils/burkitProjectFiles';
import type { ProjectOp } from '../vibecoding/burkitBlocks';
import './SiteAI.css';

// Gemini Бүркіті: соңғы хабарлар саны және бір сұрауға құралдармен жасалатын қадамдар
const AI_HISTORY = 20;
const AI_MAX_STEPS = 8;
const TOOL_PREFIX = '[Құрал нәтижесі]';
// Backend бір хабарды 20 000 таңбамен шектейді
const AI_MAX_CHARS = 20_000;
// Тізімді өзгертпейтін әрекеттер: контекст қайта жүктелмейді, Ask режимінде сұраусыз орындалады
const READONLY_OPS = new Set<ProjectOp>(['list', 'open']);

// Үзілген жауапты жалғастыру сұрауы (чатта көрсетілмейді, тек Бүркітке барады) — Vibecoding-тегідей
const CONTINUE_PROMPT =
  '[Жүйелік хабар] Алдыңғы жауабың бет жаңартылғандықтан үзіліп қалды. Дәл тоқтаған жерінен жалғастыр: ' +
  'бұрын жазылған мәтінді қайталама, кіріспе сөз жазба. Код блогының ортасында тоқтаған болсаң — блокты қайта ' +
  'ашпай, келесі таңбадан бастап жалғастыр.';

/* Басты беттің Бүркіті әрқашан автоматты агент: жоба әрекеттерін өзі орындайды,
   тек қайтарылмайтын әрекеттер (өшіру) ғана расталады. */
function needsApproval(op: ProjectOp): boolean {
  return ALWAYS_CONFIRM_OPS.has(op);
}

// «/» командалары: таңдағанда сұрау мәтіні дайындалады (басты беттің Бүркітіне — сайттағы жобалармен жұмыс)
interface SlashCommand {
  name: string;
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'projects', label: 'Жобаларым, достарым, топтарым', prompt: 'Менің жобаларымды, достарымды және топтарымды көрсет', icon: <FolderIcon size={14} /> },
  { name: 'create', label: 'Жаңа Vibecoding жобасы', prompt: 'Жаңа Vibecoding жобасын жаса:', icon: <PlusIcon /> },
  { name: 'share', label: 'Бөлісу сілтемесін жасау', prompt: 'Жобамның бөлісу сілтемесін жаса:', icon: <LinkIcon size={14} /> },
  { name: 'publish', label: 'Жобалар бетіне жариялау', prompt: 'Жобамды Жобалар бетіне жарияла:', icon: <GlobeIcon /> },
  { name: 'send', label: 'Досыма немесе топқа жіберу', prompt: 'Жобамды чатта жібер:', icon: <ForwardIcon size={14} /> },
  { name: 'help', label: 'Не істей аласың?', prompt: 'Сен не істей аласың? Қысқаша айтып бер', icon: <SparkleIcon size={14} /> },
];

const clearPending = (list: AiMessage[]) =>
  list.some((m) => m.pending) ? list.map((m) => (m.pending ? { ...m, pending: false } : m)) : list;

const formatTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const VIBECODING_STORAGE_KEY = 'vibecoding_state';

// Басты беттен өшірілген жоба браузердегі Vibecoding көшірмесінен де алынады (қайта жүктелмеуі үшін)
function forgetLocalProject(id: string) {
  try {
    const raw = localStorage.getItem(VIBECODING_STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (Array.isArray(state.projects)) {
      state.projects = state.projects.filter((p: { id: string }) => p.id !== id);
      if (state.activeProjectId === id) state.activeProjectId = state.projects[0]?.id ?? null;
      localStorage.setItem(VIBECODING_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // бұзылған жазба / жеке терезе
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ескі браузер — үнсіз
  }
}

const MAX_MATCHES = 4;
// Жауап бірден шықпай, «ойланып» барып келеді — сөйлесу сезімі үшін
const THINKING_MS = 650;

// Сайттың мүмкіндіктері — ЖИ тек осыларға және сайттағы жобаларға сілтейді
const SITE_FEATURES: { key: string; to: string; keywords: string[] }[] = [
  { key: 'upload', to: '/upload', keywords: ['жүкте', 'жүктеу', 'қос', 'upload', 'загруз', 'добав'] },
  { key: 'vibecoding', to: '/vibecoding', keywords: ['vibecoding', 'вайб', 'редактор', 'editor', 'ide', 'терминал', 'terminal'] },
  { key: 'chat', to: '/chat', keywords: ['чат', 'chat', 'хабар', 'дос', 'friend', 'message', 'сообщ', 'друз'] },
  { key: 'profile', to: '/profile', keywords: ['профиль', 'profile', 'аватар', 'avatar'] },
  { key: 'settings', to: '/settings', keywords: ['баптау', 'settings', 'настрой', 'құпиясөз', 'пароль', 'password', '2fa', 'тақырып', 'theme'] },
];

// Қарапайым сөйлесу: сәлемдесу, алғыс, көмек т.б. — «мүмкіндіктен тыс» деп жауап бермеу үшін.
// Қысқа кілттер (2–3 әріп) тек толық сәйкес келгенде ғана есептеледі.
type SmallTalk = 'greeting' | 'thanks' | 'help' | 'about' | 'bye';
const SMALL_TALK: { key: SmallTalk; keywords: string[] }[] = [
  {
    key: 'greeting',
    keywords: ['сәлем', 'салем', 'сәләм', 'салам', 'сәлемет', 'салемет', 'амансыз', 'амансың', 'қалайсың', 'қалайсыз', 'калайсын',
      'қайырлы', 'hello', 'hi', 'hey', 'hii', 'привет', 'приветствую', 'здравств', 'здрасте', 'добрый', 'ку', 'салют'],
  },
  { key: 'thanks', keywords: ['рахмет', 'рақмет', 'рахмат', 'спасибо', 'спс', 'благодар', 'thanks', 'thank', 'thx', 'ty'] },
  {
    key: 'help',
    keywords: ['көмек', 'комек', 'help', 'помощь', 'помоги', 'умеешь', 'можешь', 'аласың', 'аласыз', 'істей', 'can', 'what'],
  },
  { key: 'about', keywords: ['кімсің', 'кімсіз', 'кимсин', 'who', 'кто', 'атың', 'есімің'] },
  { key: 'bye', keywords: ['сау', 'көріскенше', 'пока', 'bye', 'goodbye', 'свидания'] },
];

// Жоба сұралып тұрғанын білдіретін сөздер — ұқсасы табылмаса да пайдалы жауап беру үшін
const BUILD_WORDS = ['жаса', 'құр', 'керек', 'қалаймын', 'create', 'make', 'build', 'need', 'want', 'сделай', 'создай', 'нужен', 'нужна', 'нужно', 'хочу'];

// Мағынасы жоқ көмекші сөздер — іздеуге араласпайды
const STOP_WORDS = new Set([
  'не', 'бұл', 'сол', 'мен', 'сен', 'сіз', 'маған', 'саған', 'сізге', 'бе', 'ба', 'ма', 'ме', 'па', 'пе', 'қандай', 'қалай', 'және', 'да', 'де',
  'the', 'is', 'are', 'you', 'me', 'my', 'do', 'to', 'and', 'please',
  'что', 'ты', 'вы', 'мне', 'как', 'это', 'и', 'а', 'пожалуйста',
  // ЖИ-дің өз аты: «Сәлем, Бүркіт» — жоба іздеуге кірмейді
  'бүркіт', 'буркит', 'burkit',
]);

const keywordHit = (w: string, k: string) => (k.length <= 3 ? w === k : w.startsWith(k));

function detectSmallTalk(words: string[]): { intents: SmallTalk[]; rest: string[] } {
  const intents = new Set<SmallTalk>();
  const rest = words.filter((w) => {
    if (STOP_WORDS.has(w)) return false;
    const hit = SMALL_TALK.find((s) => s.keywords.some((k) => keywordHit(w, k)));
    if (hit) intents.add(hit.key);
    return !hit;
  });
  return { intents: SMALL_TALK.map((s) => s.key).filter((k) => intents.has(k)), rest };
}

function findFeatures(words: string[]) {
  return SITE_FEATURES.filter((f) => f.keywords.some((k) => words.some((w) => w.startsWith(k) || (w.length >= 4 && k.startsWith(w)))));
}

interface AiMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  prompt?: string;
  matches?: CodeFile[];
  createdId?: string;
  features?: typeof SITE_FEATURES;
  /** Астында дайын сұраулар көрсетілсін */
  suggest?: boolean;
  /** Gemini Бүркітінің хабары (сөйлесу тарихына кіреді) */
  ai?: boolean;
  /** «[Құрал нәтижесі]» — Бүркіттің әрекеттерінің нәтижесі */
  tool?: boolean;
  error?: boolean;
  /** Орындалған/өткізілген project блоктары */
  ran?: number[];
  /** ISO уақыт (тарих үшін) */
  time?: string;
  /** Жауап аяқталмай қалды (бет жаңартылды) — қайта ашылғанда жалғасады */
  pending?: boolean;
  /** Тіркелген фото/файл/папкалар */
  attachments?: Attachment[];
  /** Бүркіт жобаға жазған файлдар мен жазбалар */
  edits?: BurkitEdit[];
  /** Өзгерістер «Қайтару» арқылы алынды */
  undone?: boolean;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}#+]+/u)
    .filter((w) => w.length >= 2);
}

// ЖИ тек сайттағы жобалармен шектелген: сұрауға ұқсас жобаларды ұпаймен іздейді
function findMatches(codes: CodeFile[], words: string[]): CodeFile[] {
  if (words.length === 0) return [];

  return codes
    .filter((code) => !code.folderId)
    .map((code) => {
      const title = code.title?.toLowerCase() || '';
      const desc = code.description?.toLowerCase() || '';
      const lang = code.language?.toLowerCase() || '';
      const tags = (code.tags || []).map((tag) => tag.toLowerCase());
      const content = code.isFolder ? '' : (code.content || '').toLowerCase().slice(0, 5000);
      let score = 0;
      words.forEach((w) => {
        if (title.includes(w)) score += 3;
        if (tags.some((tag) => tag.includes(w))) score += 2;
        if (lang === w) score += 2;
        if (desc.includes(w)) score += 1;
        if (content.includes(w)) score += 0.5;
      });
      return { code, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)
    .map((m) => m.code);
}

const isBuildWord = (w: string) => BUILD_WORDS.some((k) => w.startsWith(k));

// Сұрауды талдау: сөйлесу ниеті, жоба жасау ниеті, сайт бөлімдері және ұқсас жобалар
function analyze(prompt: string, codes: CodeFile[]) {
  // Сәлемдесу сияқты сөздер жоба іздеуге араласпайды
  const { intents, rest } = detectSmallTalk(tokenize(prompt));
  const wantsProject = rest.some(isBuildWord);
  // «жаса», «керек» сияқты сөздер жоба мазмұнынан іздеуге қосылмайды
  const topic = rest.filter((w) => !isBuildWord(w));
  return { intents, wantsProject, features: findFeatures(topic), matches: findMatches(codes, topic) };
}

// Бүркіт шынымен жауап бере ала ма — тек осындай ұсыныстар көрсетіледі
function isAnswerable(prompt: string, codes: CodeFile[]): boolean {
  const { intents, features, matches } = analyze(prompt, codes);
  return intents.length > 0 || features.length > 0 || matches.length > 0;
}

// Тілдің әдемі жазылуы (тек кіші әріппен жазғанда атауы сәйкес келетіндері — іздеу бұзылмас үшін)
const LANG_NAMES: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', go: 'Go', rust: 'Rust',
  php: 'PHP', html: 'HTML', css: 'CSS', sql: 'SQL', kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', dart: 'Dart',
};
const prettyLang = (lang: string) => LANG_NAMES[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);

// Ең жиі кездесетін тілдер
function topLanguages(list: CodeFile[]): string[] {
  const counts = new Map<string, number>();
  list.forEach((c) => {
    const lang = c.language?.toLowerCase().trim();
    if (lang && lang !== 'text' && lang !== 'plaintext') counts.set(lang, (counts.get(lang) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

/* Адамға бейімделген дайын сұраулар (ең көбі 4):
   жобасы жоқ адамға — жүктеу, өзі жазатын тілдегі жобалар, сайттағы танымал жоба,
   сайттағы басқа танымал тіл, Vibecoding, «Не істей аласың?». Әрқайсысы Бүркіттің
   өзінен өткізіліп тексеріледі — жауабы жоқ ұсыныс көрсетілмейді. */
function buildSuggestions(codes: CodeFile[], username: string | undefined, t: TFunction): string[] {
  const out: string[] = [];
  const add = (text?: string) => {
    if (text && out.length < 4 && !out.includes(text) && isAnswerable(text, codes)) out.push(text);
  };

  const roots = codes.filter((c) => !c.folderId);
  const mine = username ? roots.filter((c) => c.author === username) : [];
  const others = roots.filter((c) => c.author !== username);
  const popularity = (c: CodeFile) => (c.likes?.length || 0) * 3 + (c.views || 0);
  const popular = [...others]
    .sort((a, b) => popularity(b) - popularity(a))
    .map((c) => c.title?.trim())
    .find((title) => title && title.length <= 28);
  const myLang = topLanguages(mine)[0];
  const siteLang = topLanguages(others).find((lang) => lang !== myLang);

  // Кодтар әлі жүктелмей тұрғанда «жобаңыз жоқ» деп қате ұсынбау үшін
  if (username && roots.length > 0 && mine.length === 0) add(t('home.siteAiSuggest.upload'));
  if (myLang) add(t('home.siteAiSuggest.lang', { lang: prettyLang(myLang) }));
  add(popular);
  if (siteLang) add(t('home.siteAiSuggest.lang', { lang: prettyLang(siteLang) }));
  add(t('home.siteAiSuggest.vibecoding'));
  add(t('home.siteAiSuggest.help'));
  return out;
}

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Тарихта Vibecoding-тегі Бүркітпен бірдей пішімде сақталады
function toStored(m: AiMessage): BurkitMessage {
  return {
    id: String(m.id),
    role: m.role,
    content: m.text,
    timestamp: m.time ?? new Date().toISOString(),
    ...(m.error && { error: true }),
    ...(m.tool && { tool: true }),
    ...(m.ran?.length && { ran: m.ran }),
    ...(m.pending && { pending: true }),
    ...(m.attachments?.length && {
      attachments: m.attachments.map((a) => ({ kind: a.kind, name: a.name, ...(a.count && { count: a.count }) })),
    }),
    ...(m.edits?.length && { edits: m.edits }),
  };
}

function fromStored(m: BurkitMessage, index: number): AiMessage {
  return {
    id: index + 1,
    role: m.role,
    text: m.content,
    time: m.timestamp,
    ai: m.role === 'assistant' && !m.error && !m.tool,
    tool: m.tool,
    error: m.error,
    ran: m.ran,
    pending: m.pending,
    // Тарихта тек аттары сақталады — мазмұны қайта жіберілмейді
    attachments: m.attachments?.map((a, i) => ({ ...a, id: `${index}-${i}`, files: [] })),
    edits: m.edits,
  };
}

// Өзгеріс жолы: «Жаңа: src/a.js», «Өшірілді: …», «a → b», «Жазба: …»
function editLabel(e: BurkitEdit): string {
  if (e.kind === 'note') return `Жазба: ${e.path}`;
  if (e.action === 'delete') return `Өшірілді: ${e.path}`;
  if (e.action === 'move') return `${e.from} → ${e.path}`;
  return `${e.created ? 'Жаңа' : 'Өзгертілді'}: ${e.path}`;
}

function titleFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ').slice(0, 60);
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

interface SiteAIProps {
  codes: CodeFile[];
}

const SiteAI: React.FC<SiteAIProps> = ({ codes }) => {
  const { t, i18n } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  // Кірген қолданушыға — Gemini Бүркіті (Vibecoding-тегідей); қонаққа — сайт ішінен іздеу
  const [status, setStatus] = useState<BurkitStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  // Жауап келіп жатыр (ref-тен айырмашылығы — өзгергенде бет қайта салынады)
  const [streaming, setStreaming] = useState(false);
  const siteRef = useRef<BurkitSiteContext | null>(null);
  const aliveRef = useRef(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const heldRef = useRef(new Map<number, string[]>());
  const messagesRef = useRef<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // Тарих: ескі сөйлесулер (Vibecoding-тегідей, бірақ басты беттің өз тізімі)
  const history = useBurkitHistory('site');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  // Тарихтан ашылған хабарлар қайта сақталмайды (ашқаннан «жаңарды» деп жоғарыға шықпасын)
  const loadedRef = useRef<AiMessage[] | null>(null);
  // Сөйлесу ауысқанда/тоқтағанда ескі агент циклі жалғаспауы үшін
  const genRef = useRef(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const resumedRef = useRef<string | null>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const attach = useBurkitAttachments(focusInput);
  const { attached, busy: attaching } = attach;

  messagesRef.current = messages;

  const aiMode = isAuthenticated && !!user;
  const needsKey = aiMode && status?.source === 'none';

  useEffect(() => {
    setStatus(null);
    setStatusChecked(false);
    if (!isAuthenticated) return;
    apiService.getBurkitStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setStatusChecked(true));
  }, [isAuthenticated]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Сөйлесуді бетке жүктеу (тарихтан ашу, жаңа чат)
  const showConversation = (id: string | null, stored: BurkitMessage[] = []) => {
    genRef.current++;
    const list = stored.map(fromStored);
    loadedRef.current = list;
    heldRef.current.clear();
    setLinks({});
    setConversationId(id);
    setMessages(list);
    nextId.current = list.length + 1;
  };

  // Қолданушы ауысқанда (кіргенде) — соңғы ашық сөйлесуі қалпына келеді
  const { key: historyKey, readActive, saveActive, upsert: upsertConversation } = history;
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!aiMode) {
      // Шыққанда алдыңғы қолданушының чаты көрінбейді
      if (loadedRef.current !== null) showConversation(null);
      return;
    }
    const { state, conversation } = readActive();
    showConversation(conversation?.id ?? null, conversation?.messages);
    setView(state.view);
    setRestoredKey(historyKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey, aiMode, readActive]);

  useEffect(() => {
    if (aiMode && restoredKey === historyKey) saveActive({ conversationId, view });
  }, [aiMode, restoredKey, historyKey, conversationId, view, saveActive]);

  // Жаңа хабар келсе — сөйлесу тарихқа сақталады
  useEffect(() => {
    if (!aiMode || !conversationId || messages.length === 0 || messages === loadedRef.current) return;
    const existing = history.conversations.find((c) => c.id === conversationId);
    const stored = messages.slice(-100).map(toStored);
    upsertConversation({
      id: conversationId,
      title: existing?.title ?? (() => {
        const first = messages.find((m) => m.role === 'user' && !m.tool);
        return titleFromText(first?.text || first?.attachments?.[0]?.name || 'Жаңа сөйлесу');
      })(),
      createdAt: existing?.createdAt ?? stored[0].timestamp,
      updatedAt: new Date().toISOString(),
      pinned: existing?.pinned,
      messages: stored,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, conversationId, aiMode, upsertConversation]);

  // Бүркіт осы жерде жұмыс істеп жатқан жоба (create/switch-тен кейін): файлдарына Vibecoding-тегідей жазады
  const [workProject, setWorkProject] = useState<VibecodingProjectDTO | null>(null);
  const workRef = useRef<VibecodingProjectDTO | null>(null);
  workRef.current = workProject;
  const openingRef = useRef<Promise<void> | null>(null);
  // «Қайтару» үшін: жауап id → өзгерген файлдардың бұрынғы мәтіні
  const originalsRef = useRef(new Map<number, { projectId: string; originals: Map<string, string | null> }>());
  const workKey = user ? `site-burkit-project:${user.id}` : null;

  const rememberWork = (id: string | null) => {
    if (!workKey) return;
    try {
      if (id) localStorage.setItem(workKey, id);
      else localStorage.removeItem(workKey);
    } catch {
      // жеке терезе
    }
  };

  const openWork = (id: string, dto?: VibecodingProjectDTO) => {
    const task = (async () => {
      const project = dto ?? (await apiService.getVibecodingProjects()).find((p) => p.id === id);
      if (!project) throw new Error('Жоба табылмады');
      setWorkProject(project);
      workRef.current = project;
      rememberWork(project.id);
    })();
    openingRef.current = task.catch(() => {});
    return task;
  };

  const closeWork = () => {
    setWorkProject(null);
    workRef.current = null;
    rememberWork(null);
  };

  // Бет ашылғанда — соңғы жұмыс жобасы қайта ашылады
  useEffect(() => {
    let id: string | null = null;
    try {
      id = workKey ? localStorage.getItem(workKey) : null;
    } catch {
      id = null;
    }
    if (!id) {
      setWorkProject(null);
      return;
    }
    let cancelled = false;
    apiService.getVibecodingProjects()
      .then((list) => !cancelled && setWorkProject(list.find((p) => p.id === id) ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workKey]);

  // Басты беттегі жоба әрекеттері — сервер арқылы; ашылған жобамен Бүркіт осы жерде жұмыс істейді
  const host = useMemo<ProjectHost | null>(() => (user ? {
    userId: user.id,
    username: user.username,
    get currentProjectId() {
      return workRef.current?.id ?? null;
    },
    listVibe: async () => (await apiService.getVibecodingProjects()).map((p) => ({ id: p.id, name: p.name, shareToken: p.shareToken })),
    createVibe: async (name) => {
      const id = await createProjectOnServer(name);
      window.dispatchEvent(new Event(VIBE_PROJECTS_EVENT));
      await openWork(id);
      return id;
    },
    deleteVibe: async (id) => {
      await apiService.deleteVibecodingProject(id);
      forgetLocalProject(id);
      if (workRef.current?.id === id) closeWork();
      window.dispatchEvent(new Event(VIBE_PROJECTS_EVENT));
    },
    flush: async () => {},
    openVibe: (id, dto) => openWork(id, dto),
    navigate,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null), [user, navigate]);

  // Сайттағы жобалар, достар, топтар — бір рет жүктеліп, жобалар өзгергенде жаңарады
  const refreshSite = () => {
    if (!host) return Promise.resolve(null);
    return loadSiteContext(host)
      .then((ctx) => (siteRef.current = ctx))
      .catch(() => siteRef.current);
  };
  useEffect(() => {
    siteRef.current = null;
    refreshSite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const markRan = (id: number, index: number) => {
    setMessages((prev) => prev.map((m) => (m.id === id && !m.ran?.includes(index) ? { ...m, ran: [...(m.ran ?? []), index] } : m)));
  };

  const executeAction = async (msgId: number, index: number, text: string): Promise<string> => {
    const block = extractCodeBlocks(text)[index];
    if (block?.action?.kind !== 'project') return '';
    const label = describeProjectAction(block.action);
    if (!host) return `${label}: орындалмады — жүйеге кіру керек.`;
    const key = `${msgId}:${index}`;
    setRunningKey(key);
    try {
      const result = await runProjectAction(block.action, host, block.code);
      if (result.link) setLinks((prev) => ({ ...prev, [key]: result.link! }));
      if (!READONLY_OPS.has(block.action.op)) refreshSite();
      return `${label}: ${result.text}`;
    } catch (e) {
      return `${label}: орындалмады — ${e instanceof Error ? e.message : 'қате'}`;
    } finally {
      setRunningKey(null);
    }
  };

  // Хабарлар + тіркемелер (жалпы көлем шегіне дейін, жаңалары бірінші)
  const withFiles = (list: AiMessage[]) => {
    const files = budgetFiles(list.map((m) => m.attachments ?? []));
    return list.map((m, i) => ({
      role: m.role,
      content: (m.text || 'Тіркелген файлдарды қара.').slice(0, AI_MAX_CHARS),
      ...(files[i].length > 0 && { files: files[i] }),
    }));
  };

  // Gemini-ден жауап алу; жауаптағы әрекеттер орындалып, нәтижесі Бүркітке қайтады (агент циклі)
  // resume — бет жаңартылып үзілген жауап: жаңа мәтін соның соңына жалғанады
  const respondAi = async (thread: AiMessage[], step = 0, resume?: AiMessage) => {
    if (!aliveRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setThinking(true);
    setStreaming(true);
    const replyId = resume?.id ?? nextId.current++;
    const gen = genRef.current;
    let full = resume?.text ?? '';
    let started = !!resume;
    try {
      await openingRef.current;
      const site = siteRef.current ?? await refreshSite();
      if (gen !== genRef.current) return;
      const project = workRef.current;
      const catalog = codes
        .filter((c) => !c.folderId)
        .slice(0, 50)
        .map((c) => ({ id: c.id, title: (c.title || '').slice(0, 200), author: c.author?.slice(0, 60), language: c.language?.slice(0, 30) }));
      const lang = (i18n.language || 'kk').split('-')[0];
      await apiService.streamBurkitChat(
        {
          messages: [
            ...withFiles(
              thread
                .filter((m) => (m.ai || m.tool || m.role === 'user') && !m.error)
                .slice(-AI_HISTORY)
            ),
            ...(resume ? [{ role: 'user' as const, content: CONTINUE_PROMPT }] : []),
          ],
          surface: 'home',
          ...(project
            ? { mode: 'agent', projectId: project.id, projectName: project.name, projectFiles: projectContext(project.files) }
            : { mode: 'site' }),
          uiLanguage: lang === 'ru' || lang === 'en' ? lang : 'kk',
          ...(site && { site: { ...site, catalog } }),
        },
        (chunk) => {
          full += chunk;
          if (!started) {
            started = true;
            setThinking(false);
            // Жауап басталды — сұрақтың «күтуде» белгісі алынады
            setMessages((prev) => [
              ...clearPending(prev),
              { id: replyId, role: 'assistant', text: chunk, ai: true, time: new Date().toISOString(), pending: true },
            ]);
          } else {
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: m.text + chunk } : m)));
          }
        },
        controller.signal
      );
      setMessages(clearPending);
    } catch (e) {
      // Бет жаңартылды / жабылды — pending белгісі қалады, қайта ашқанда жалғасады
      // (қолданушы өзі тоқтатса — stop() белгіні алып тастайды)
      if (controller.signal.aborted) return;
      setMessages(clearPending);
      // Кілт жоқ/өшірілген — Vibecoding-тегідей кілт картасы ашылады
      if (e instanceof BurkitError && e.status === 403) {
        setStatus((s) => (s ? { ...s, source: 'none', keyHint: null } : s));
        setKeyOpen(true);
      }
      push({ role: 'assistant', text: `⚠️ ${e instanceof Error ? e.message : t('apiErrors.burkitFailed')}`, error: true });
      return;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setThinking(false);
        setStreaming(false);
      }
    }
    if (controller.signal.aborted || gen !== genRef.current) return;

    const blocks = extractCodeBlocks(full);
    const feedback: string[] = [];
    // Ашық жоба болса — файл блоктары (path=, edit=, delete, move, read, note) Vibecoding-тегідей орындалады
    const project = workRef.current;
    if (project && blocks.some((b) => b.action && b.action.kind !== 'project')) {
      const ops = applyFileBlocks(project, blocks);
      feedback.push(...ops.feedback);
      const edits = [...ops.edits];
      for (const { action, raw } of blocks) {
        if (action?.kind !== 'note') continue;
        try {
          const note = await apiService.writeProjectNote(project.id, action.title, raw);
          edits.push({ kind: 'note', path: action.title, created: note.created, noteId: note.id });
        } catch (e) {
          edits.push({ kind: 'note', path: action.title, created: false, error: e instanceof Error ? e.message : 'қате' });
        }
      }
      if (ops.changed) {
        try {
          const saved = await apiService.saveVibecodingProject(project.id, {
            name: project.name,
            files: ops.files,
            folders: ops.folders,
            createdAt: project.createdAt,
          });
          if (workRef.current?.id === project.id) {
            setWorkProject(saved);
            workRef.current = saved;
          }
          originalsRef.current.set(replyId, { projectId: project.id, originals: ops.originals });
          window.dispatchEvent(new Event(VIBE_PROJECTS_EVENT));
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'қате';
          feedback.push(`Жобаны сақтау мүмкін болмады: ${reason}`);
          edits.forEach((ed, i) => ed.kind === 'file' && !ed.error && (edits[i] = { ...ed, error: 'сақталмады' }));
        }
      }
      if (edits.length > 0) setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, edits } : m)));
    }

    // Расталмайтын әрекеттер бірден; жариялау/жіберу/өшіру — қолданушы басқанша күтеді
    const done = resume?.ran ?? [];
    let held = false;
    for (let i = 0; i < blocks.length; i++) {
      const { action } = blocks[i];
      if (action?.kind !== 'project' || done.includes(i)) continue;
      if (controller.signal.aborted || gen !== genRef.current) return;
      if (needsApproval(action.op)) {
        held = true;
        continue;
      }
      feedback.push(await executeAction(replyId, i, full));
      markRan(replyId, i);
    }
    if (gen !== genRef.current) return;
    const reply: AiMessage = { id: replyId, role: 'assistant', text: full, ai: true };
    if (held) heldRef.current.set(replyId, feedback);
    else if (feedback.length > 0) continueAi(resume ? thread.map((m) => (m.id === replyId ? reply : m)) : [...thread, reply], feedback, step + 1);
  };

  // Жауаптың жобаға енгізген өзгерістерін қайтару
  const undoEdits = async (msg: AiMessage) => {
    const entry = originalsRef.current.get(msg.id);
    const project = workRef.current;
    if (!entry || !project || project.id !== entry.projectId) return;
    try {
      const saved = await apiService.saveVibecodingProject(project.id, {
        name: project.name,
        files: restoreFiles(project.files, entry.originals),
        folders: project.folders,
        createdAt: project.createdAt,
      });
      setWorkProject(saved);
      workRef.current = saved;
      originalsRef.current.delete(msg.id);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, undone: true } : m)));
      window.dispatchEvent(new Event(VIBE_PROJECTS_EVENT));
    } catch (e) {
      push({ role: 'assistant', text: `⚠️ Қайтару мүмкін болмады: ${e instanceof Error ? e.message : 'қате'}`, error: true });
    }
  };

  const continueAi = (base: AiMessage[], feedback: string[], step: number) => {
    if (!aliveRef.current) return;
    if (step > AI_MAX_STEPS) {
      push({ role: 'assistant', text: '⚠️ Бүркіт қатарынан тым көп қадам жасады. Жалғастыру үшін хабар жазыңыз.', error: true });
      return;
    }
    const toolMsg: AiMessage = {
      id: nextId.current++,
      role: 'user',
      text: `${TOOL_PREFIX}\n\n${feedback.join('\n\n')}`,
      tool: true,
      time: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, toolMsg]);
    respondAi([...base, toolMsg], step);
  };

  // «Растау» / «Өткізу»: жауаптың барлық расталатын әрекеті қаралғанда нәтижелер Бүркітке барады
  const actOn = async (msg: AiMessage, index: number, skip: boolean) => {
    if (thinking || streaming || runningKey) return;
    const gen = genRef.current;
    const held = heldRef.current.get(msg.id) ?? [];
    heldRef.current.set(msg.id, held);
    markRan(msg.id, index);
    if (!skip) held.push(await executeAction(msg.id, index, msg.text));
    if (gen !== genRef.current) return;
    const handled = new Set([...(msg.ran ?? []), index]);
    const blocks = extractCodeBlocks(msg.text);
    if (blocks.some((b, i) => b.action?.kind === 'project' && !handled.has(i))) return;
    heldRef.current.delete(msg.id);
    if (held.length > 0) continueAi(messagesRef.current, held, 1);
  };

  const suggestions = useMemo(() => buildSuggestions(codes, user?.username, t), [codes, user?.username, t]);
  const isEmpty = messages.length === 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // Өріс мәтінге қарай өседі (ең көбі ~6 жол), содан кейін ішінде айналады
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const push = (...msgs: Omit<AiMessage, 'id'>[]) => {
    const time = new Date().toISOString();
    setMessages((prev) => [...prev, ...msgs.map((msg) => ({ time, ...msg, id: nextId.current++ }))]);
  };

  const ask = (raw: string) => {
    const prompt = raw.trim();
    const files = aiMode ? attached : [];
    if ((!prompt && files.length === 0) || thinking || streaming || runningKey || attaching) return;
    if (aiMode) {
      // Кілт әлі тексерілмеді немесе жоқ — сұрақ өрісте күтіп тұрады
      if (!statusChecked || needsKey) {
        setInput(prompt);
        if (needsKey) setKeyOpen(true);
        return;
      }
      setInput('');
      attach.clear();
      setView('chat');
      if (!conversationId) setConversationId(generateId());
      heldRef.current.clear();
      const userMsg: AiMessage = {
        id: nextId.current++,
        role: 'user',
        text: prompt,
        time: new Date().toISOString(),
        pending: true,
        ...(files.length > 0 && { attachments: files }),
      };
      setMessages((prev) => [...prev, userMsg]);
      respondAi([...messagesRef.current, userMsg]);
      return;
    }
    setInput('');
    push({ role: 'user', text: prompt });
    setThinking(true);

    timerRef.current = window.setTimeout(() => {
      const { intents, wantsProject, features, matches } = analyze(prompt, codes);
      const replies: Omit<AiMessage, 'id'>[] = [];
      const unmatched = features.length === 0 && matches.length === 0;

      intents.forEach((intent) => {
        // Сәлем/көмек жеке келсе — не істей алатынымды айтып, дайын сұрауларды ұсынамын
        const suggest = unmatched && !wantsProject && (intent === 'greeting' || intent === 'help' || intent === 'about');
        replies.push({ role: 'assistant', text: t(`home.siteAiReply.${intent}`), suggest });
      });
      if (features.length > 0) {
        replies.push({ role: 'assistant', text: t('home.siteAiFeatures'), features });
      }
      if (matches.length > 0) {
        replies.push({ role: 'assistant', text: t('home.siteAiFound', { count: matches.length }), prompt, matches });
      }
      if (unmatched && wantsProject) {
        // Ұқсас жоба жоқ — өзі жасай алатын бөлімдерге бағыттаймын
        replies.push({
          role: 'assistant',
          text: t('home.siteAiNoMatchBuild'),
          features: SITE_FEATURES.filter((f) => f.key === 'vibecoding' || f.key === 'upload'),
        });
      } else if (replies.length === 0) {
        replies.push({ role: 'assistant', text: t('home.siteAiNotFound'), suggest: true });
      }
      push(...replies);
      setThinking(false);
    }, THINKING_MS);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  // «/» жазылса — командалар тізімі (тек Gemini Бүркітінде)
  const slashQuery = aiMode ? /^\/(\w*)$/.exec(input)?.[1] : undefined;
  const slashMatches = useMemo(
    () => (slashQuery === undefined ? [] : SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery.toLowerCase()))),
    [slashQuery]
  );
  useEffect(() => setSlashIndex(0), [slashQuery]);

  const pickSlash = (cmd: SlashCommand) => {
    setInput(`${cmd.prompt} `);
    inputRef.current?.focus();
  };

  // Enter — жіберу, Shift+Enter — жаңа жол (әріп теру кезінде IME-ге кедергі жасамау)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSlashIndex((i) => (i + step + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlash(slashMatches[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setInput('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  };

  // Жауапты тоқтату (келген бөлігі сақталады)
  const stop = () => {
    genRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
    setStreaming(false);
    setMessages(clearPending);
  };

  // Соңғы жауапты қайта алу: соңғы сұрақтан кейінгінің бәрі (жауап, құрал нәтижелері) алынады
  const regenerate = () => {
    if (thinking || streaming || runningKey) return;
    const index = messages.map((m) => m.role === 'user' && !m.tool).lastIndexOf(true);
    if (index < 0) return;
    const thread = messages.slice(0, index + 1);
    heldRef.current.clear();
    setMessages(thread);
    respondAi(thread);
  };

  const copyMessage = (msg: AiMessage) => {
    copyToClipboard(msg.text).then(() => {
      setCopiedId(msg.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === msg.id ? null : cur)), 2000);
    });
  };

  // Бет жаңартылғанда үзілген жауапты жалғастыру (Vibecoding-тегідей)
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!aiMode || !last?.pending || streaming || thinking || runningKey || !status || status.source === 'none') return;
    const key = `${conversationId}:${last.id}`;
    if (resumedRef.current === key) return; // бір хабарды бір рет қана
    resumedRef.current = key;
    if (last.role === 'assistant') respondAi(messages, 0, last);
    else respondAi(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, aiMode, streaming, thinking, runningKey, status, conversationId]);

  const exportConversation = (conv: BurkitConversation) => {
    const blob = new Blob([conversationToMarkdown(conv)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40) || 'burkit'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetChat = () => {
    window.clearTimeout(timerRef.current);
    stop();
    showConversation(null);
    setView('chat');
    setInput('');
    inputRef.current?.focus();
  };

  const handleCreate = async (base: CodeFile, prompt: string) => {
    if (!isAuthenticated || !user) {
      push({ role: 'assistant', text: t('home.siteAiLoginRequired') });
      return;
    }
    setCreatingId(base.id);
    try {
      const title = titleFromPrompt(prompt);
      // Тізімдегі кодтар мазмұнсыз келеді — толық нұсқасын жүктеу
      const full = await apiService.getCodeFile(base.id);
      const created = await apiService.createCodeFile({
        title,
        content: full.content,
        language: base.language,
        author: user.username,
        description: t('home.siteAiBasedOn', { title: base.title, author: base.author }),
        tags: Array.from(new Set([...(base.tags || []), 'site-ai'])),
      });
      window.dispatchEvent(new CustomEvent('codesUpdated'));
      push({ role: 'assistant', text: t('home.siteAiCreated', { title }), createdId: created.id });
    } catch {
      push({ role: 'assistant', text: t('home.siteAiCreateError') });
    } finally {
      setCreatingId(null);
    }
  };

  const lastAiId = [...messages].reverse().find((m) => m.ai)?.id;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant' && !m.tool)?.id;
  const busy = thinking || streaming || !!runningKey;
  const recent = useMemo(
    () => [...history.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [history.conversations]
  );
  const currentTitle = history.conversations.find((c) => c.id === conversationId)?.title;

  const showHistory = aiMode && view === 'history';

  const openConversation = (id: string) => {
    const conv = history.conversations.find((c) => c.id === id);
    if (!conv) return;
    window.clearTimeout(timerRef.current);
    stop();
    showConversation(conv.id, conv.messages);
    setView('chat');
  };

  const removeConversation = (id: string) => {
    history.remove(id);
    if (id === conversationId) {
      stop();
      showConversation(null);
    }
  };

  const clearHistory = () => {
    history.clearAll();
    const current = history.conversations.find((c) => c.id === conversationId);
    if (current && !current.pinned) {
      stop();
      showConversation(null);
    }
  };

  return (
    <section className={`sai ${isEmpty && !showHistory ? 'is-empty' : ''}`} aria-labelledby="site-ai-title">
      {showHistory ? (
        <SiteAIHistory
          conversations={history.conversations}
          activeId={conversationId}
          onOpen={openConversation}
          onBack={() => setView('chat')}
          onNew={resetChat}
          onRemove={removeConversation}
          onTogglePin={history.togglePin}
          onRename={history.rename}
          onExport={exportConversation}
          onClearAll={clearHistory}
        />
      ) : (
      <>
      {/* Сөйлесу басталғанда — жоғарыда жіңішке тақырып жолы */}
      {!isEmpty && (
        <header className="sai__bar">
          <span className="sai__bar-orb">
            <BurkitLogo size={26} />
          </span>
          <h2 id="site-ai-title" className="sai__bar-title">
            {(aiMode && currentTitle) || t('home.siteAiTitle')}
          </h2>
          {aiMode && (
            <>
              <button type="button" className="sai__ghost" onClick={() => setView('history')} title="Ескі сөйлесулер">
                <ClockIcon size={16} />
                <span>Тарих</span>
              </button>
              <button type="button" className="sai__ghost" onClick={() => setKeyOpen((v) => !v)} title="Gemini API кілті">
                <span>Кілт</span>
              </button>
            </>
          )}
          <button type="button" className="sai__ghost" onClick={resetChat}>
            <RefreshIcon />
            <span>{t('home.siteAiNewChat')}</span>
          </button>
        </header>
      )}

      <div className="sai__scroll" ref={listRef} aria-live="polite">
        {aiMode && keyOpen && !(isEmpty && needsKey) && (
          <BurkitKeyCard
            cls="sai"
            closeIcon={<CloseIcon size={14} />}
            status={status}
            onChange={(next) => {
              setStatus(next);
              if (next.source !== 'none') setKeyOpen(false);
            }}
            onClose={() => setKeyOpen(false)}
          />
        )}
        {isEmpty ? (
          // Бос күй: ортада белгіше, тақырып және дайын сұраулар
          <div className="sai__hero">
            <div className="sai__orb" aria-hidden="true">
              <BurkitLogo size={58} />
            </div>
            <h2 id="site-ai-title" className="sai__title">
              {t('home.siteAiTitle')}
            </h2>
            <p className="sai__subtitle">{t('home.siteAiSubtitle')}</p>
            {needsKey ? (
              // Кілт жоқ — дайын сұраулардың орнына кілт енгізу (Vibecoding-тегідей)
              <BurkitKeyCard cls="sai" status={status} onChange={setStatus} />
            ) : (
            <div className="sai__chips">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="sai__chip"
                  style={{ '--d': i } as React.CSSProperties}
                  onClick={() => ask(s)}
                >
                  {s}
                  <ArrowRightIcon />
                </button>
              ))}
            </div>
            )}
            {aiMode && recent.length > 0 && (
              <div className="sai__recent">
                <div className="sai__recent-head">
                  <span>Соңғы сөйлесулер</span>
                  <button type="button" onClick={() => setView('history')}>
                    Барлығы ({history.conversations.length})
                    <ArrowRightIcon />
                  </button>
                </div>
                {recent.map((conv) => (
                  <button key={conv.id} type="button" className="sai__recent-item" onClick={() => openConversation(conv.id)}>
                    <ClockIcon size={14} />
                    <span>{conv.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="sai__thread">
            {messages.map((msg) => (msg.tool ? (
              // Құрал нәтижесі — Бүркітке барған мәтін, ықшам күйде
              <details key={msg.id} className="sai__tool">
                <summary>Бүркіт әрекеттерінің нәтижесі</summary>
                <pre>{msg.text.slice(TOOL_PREFIX.length).trim()}</pre>
              </details>
            ) : (
              <div key={msg.id} className={`sai__msg sai__msg--${msg.role} ${msg.error ? 'is-error' : ''}`}>
                {msg.role === 'assistant' && (
                  <span className="sai__avatar" aria-hidden="true">
                    <BurkitLogo size={26} />
                  </span>
                )}
                <div className="sai__col">
                <div className="sai__content">
                  {msg.ai ? (
                    <AgentText
                      text={msg.text}
                      streaming={msg.id === lastAiId && streaming}
                      stateOf={(index) => ({
                        handled: !!msg.ran?.includes(index),
                        running: runningKey === `${msg.id}:${index}`,
                        canAct: msg.id === lastAiId && !thinking && !streaming && !runningKey,
                        link: links[`${msg.id}:${index}`],
                      })}
                      onAct={(index, skip) => actOn(msg, index, skip)}
                      onCopy={copyToClipboard}
                    />
                  ) : (
                    <>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="sai__atts">
                          {msg.attachments.map((a) => (
                            <BurkitAttachmentChip key={a.id} cls="sai" item={a} />
                          ))}
                        </div>
                      )}
                      {msg.text && <p className="sai__text">{msg.text}</p>}
                    </>
                  )}

                  {msg.edits && msg.edits.length > 0 && (
                    <div className={`sai__edits ${msg.undone ? 'is-undone' : ''}`}>
                      <div className="sai__edits-head">
                        <span>{msg.undone ? 'Өзгерістер қайтарылды' : `${msg.edits.filter((e) => !e.error).length} өзгеріс`}</span>
                        {!msg.undone && originalsRef.current.has(msg.id) && msg.id === lastAiId && !busy && (
                          <button type="button" className="sai__edits-btn" onClick={() => undoEdits(msg)}>Қайтару</button>
                        )}
                        {workProject && (
                          <Link to={`/vibecoding?project=${encodeURIComponent(workProject.id)}`} className="sai__edits-btn">
                            Vibecoding-те ашу
                          </Link>
                        )}
                      </div>
                      {msg.edits.map((e, i) => (
                        <div key={i} className={`sai__edit ${e.error ? 'is-error' : ''}`}>
                          <span className="sai__edit-icon">{e.kind === 'note' ? <EditIcon size={13} /> : <FileIcon size={13} />}</span>
                          <span className="sai__edit-path">{editLabel(e)}</span>
                          {e.error && <span className="sai__edit-err">{e.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.suggest && (
                    <div className="sai__chips sai__chips--inline">
                      {suggestions.map((s) => (
                        <button key={s} type="button" className="sai__chip sai__chip--sm" onClick={() => ask(s)}>
                          {s}
                          <ArrowRightIcon />
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.createdId && (
                    <Link to={`/view/${msg.createdId}`} className="sai__pill">
                      {t('home.siteAiOpenNew')}
                      <ArrowRightIcon />
                    </Link>
                  )}

                  {msg.features && (
                    <ul className="sai__features">
                      {msg.features.map((f) => (
                        <li key={f.key}>
                          <Link to={f.to} className="sai__feature">
                            <span className="sai__feature-text">
                              <strong>{t(`home.siteAiFeature.${f.key}.title`)}</strong>
                              <span>{t(`home.siteAiFeature.${f.key}.desc`)}</span>
                            </span>
                            <span className="sai__feature-arrow">
                              <ArrowRightIcon />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  {msg.matches && (
                    <ul className="sai__matches">
                      {msg.matches.map((code) => (
                        <li key={code.id} className="sai__match">
                          <span className="sai__mono" aria-hidden="true">
                            {code.isFolder ? <FolderIcon size={14} /> : monogram(code.title)}
                          </span>
                          <div className="sai__match-info">
                            <Link to={`/view/${code.id}`} className="sai__match-title">
                              {code.title}
                            </Link>
                            <span className="sai__match-meta">
                              {code.language} · {code.author}
                            </span>
                          </div>
                          {code.isFolder ? (
                            <Link to={`/view/${code.id}`} className="sai__pill" title={t('home.siteAiFolderNote')}>
                              {t('home.siteAiOpenNew')}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="sai__pill sai__pill--solid"
                              disabled={creatingId !== null}
                              onClick={() => handleCreate(code, msg.prompt || code.title)}
                            >
                              <SparkleIcon size={14} />
                              {creatingId === code.id ? t('home.siteAiCreating') : t('home.siteAiCreate')}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Хабар астындағы әрекеттер: уақыт, көшіру, қайта жауап (Vibecoding-тегідей) */}
                {aiMode && !(msg.id === lastAssistantId && streaming) && (
                  <div className="sai__msg-tools">
                    <span className="sai__time">{formatTime(msg.time)}</span>
                    <button
                      type="button"
                      className={`sai__tool-btn ${copiedId === msg.id ? 'is-done' : ''}`}
                      onClick={() => copyMessage(msg)}
                      title="Көшіру"
                    >
                      {copiedId === msg.id ? <CheckIcon /> : <CopyIcon size={13} />}
                    </button>
                    {msg.id === lastAssistantId && !busy && (
                      <button type="button" className="sai__tool-btn" onClick={regenerate} title="Қайта жауап алу">
                        <RefreshIcon />
                      </button>
                    )}
                  </div>
                )}
                </div>
              </div>
            )))}

            {thinking && (
              <div className="sai__msg sai__msg--assistant">
                <span className="sai__avatar is-thinking" aria-hidden="true">
                  <BurkitLogo size={26} />
                </span>
                <div className="sai__thinking">
                  <div className="sai__dots" aria-label={t('home.siteAiThinking')}>
                    <span />
                    <span />
                    <span />
                  </div>
                  {aiMode && <span>Бүркіт ойланып жатыр</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </>
      )}

      <form className="sai__composer" onSubmit={handleSubmit}>
        {aiMode && workProject && (
          <div className="sai__project">
            <FolderIcon size={14} />
            <span className="sai__project-name" title="Бүркіт осы жобаның файлдарымен жұмыс істейді">{workProject.name}</span>
            <span className="sai__project-meta">{workProject.files.length} файл</span>
            <Link to={`/vibecoding?project=${encodeURIComponent(workProject.id)}`} className="sai__project-link">
              Vibecoding-те ашу
            </Link>
            <button type="button" className="sai__project-close" onClick={closeWork} disabled={busy} aria-label="Жобаны жабу" title="Жобаны жабу">
              <CloseIcon size={12} />
            </button>
          </div>
        )}
        {slashMatches.length > 0 && (
          <div className="sai__slash" role="listbox" aria-label="Командалар">
            {slashMatches.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                className={`sai__slash-item ${i === slashIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setSlashIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSlash(cmd)}
              >
                <span className="sai__slash-icon">{cmd.icon}</span>
                <b>/{cmd.name}</b>
                <span>{cmd.label}</span>
              </button>
            ))}
          </div>
        )}
        {/* Өрістің кез келген жерін басса — мәтін жолына фокус */}
        <div
          className={`sai__box ${aiMode ? 'has-attach' : ''}`}
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('textarea, button, input')) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
          onDragOver={(e) => aiMode && e.dataTransfer.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => {
            if (!aiMode || e.dataTransfer.files.length === 0) return;
            e.preventDefault();
            void attach.add(Array.from(e.dataTransfer.files));
          }}
        >
          {aiMode && (attached.length > 0 || attaching || attach.error) && (
            <div className="sai__atts sai__atts--draft">
              {attached.map((a) => (
                <BurkitAttachmentChip key={a.id} cls="sai" item={a} onRemove={() => attach.remove(a.id)} />
              ))}
              {attaching && <span className="sai__att is-loading">Оқылып жатыр…</span>}
              {attach.error && <span className="sai__att-error">{attach.error}</span>}
            </div>
          )}
          {aiMode && <BurkitAttachButton cls="sai" disabled={attaching} onFiles={(files, folder) => void attach.add(files, folder)} />}
          <textarea
            ref={inputRef}
            rows={1}
            className="sai__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              // Көшірілген суретті (скриншот) тікелей қоюға болады
              if (!aiMode || e.clipboardData.files.length === 0) return;
              e.preventDefault();
              void attach.add(Array.from(e.clipboardData.files));
            }}
            placeholder="Жазу"
            aria-label={t('home.siteAiTitle')}
          />
          {streaming ? (
            // Жауап келіп жатыр — тоқтату (келген бөлігі сақталады)
            <button type="button" className="sai__send sai__send--stop" onClick={stop} aria-label="Тоқтату" title="Тоқтату">
              <span className="sai__stop-square" />
            </button>
          ) : (
            <button
              type="submit"
              className="sai__send"
              disabled={(!input.trim() && !(aiMode && attached.length)) || thinking || attaching || !!runningKey || (aiMode && !statusChecked)}
              aria-label={t('home.siteAiSend')}
              title={t('home.siteAiSend')}
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </form>
    </section>
  );
};

export default SiteAI;
