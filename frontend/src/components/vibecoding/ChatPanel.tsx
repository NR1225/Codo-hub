import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useVibecoding, VirtualFile } from '../../contexts/VibecodingContext';
import { useBurkitEdits, lineStats } from '../../contexts/BurkitEditsContext';
import {
  SparkleIcon,
  PlusIcon,
  CopyIcon,
  CheckIcon,
  InsertIcon,
  CloseIcon,
  ArrowUpIcon,
  FilePlusIcon,
  SearchIcon,
  WandIcon,
  CodeIcon,
  BracketsIcon,
  EditIcon,
  HistoryIcon,
  RefreshIcon,
  ChevronIcon,
  SettingsIcon,
} from './icons';
import { FileTypeIcon } from './fileIcons';
import BurkitHistory from './BurkitHistory';
import {
  useBurkitHistory,
  titleFromText,
  conversationToMarkdown,
  BurkitConversation,
  BurkitEdit,
  BurkitMessage,
} from './useBurkitHistory';
import { apiService, BurkitError, BurkitStatus, ProjectNotesDTO } from '../../utils/api';
import { getWorkspaceSnapshot } from '../../utils/vibeActivity';

/* Бүркіт — Vibecoding-тегі код көмекшісі (Google Gemini), Cursor сияқты: Agent режимінде
   жобаның файлдарына және оған автоматты байланысқан Notes папкасына өзі жазады, өзгерістер
   «Қабылдау / Қайтару» арқылы қаралады (редакторда diff). Ask режимі тек жауап береді.
   Дизайны басты беттегі Бүркіттікі (SiteAI). Сөйлесулер тарихта сақталады. */

// Бүркітке жіберілетін соңғы хабарлар саны және ашық файлдың ең үлкен көлемі (backend шектеулері)
const MAX_HISTORY = 20;

// Үзілген жауапты жалғастыру сұрауы (чатта көрсетілмейді, тек Бүркітке барады)
const CONTINUE_PROMPT =
  '[Жүйелік хабар] Алдыңғы жауабың бет жаңартылғандықтан үзіліп қалды. Дәл тоқтаған жерінен жалғастыр: ' +
  'бұрын жазылған мәтінді қайталама, кіріспе сөз жазба. Код блогының ортасында тоқтаған болсаң — блокты қайта ' +
  'ашпай, келесі таңбадан бастап жалғастыр.';

const clearPending = (list: BurkitMessage[]) =>
  list.some((m) => m.pending) ? list.map((m) => (m.pending ? { ...m, pending: false } : m)) : list;

/** Сайт тілі ('ru-RU' → 'ru'); белгісіз тіл — қазақша */
function uiLanguageOf(lang: string | undefined): 'kk' | 'ru' | 'en' {
  const code = (lang || 'kk').split('-')[0];
  return code === 'ru' || code === 'en' ? code : 'kk';
}
const MAX_FILE_CHARS = 100_000;
const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';

// «/» командалары: таңдағанда сұрау мәтіні дайындалады
interface SlashCommand {
  name: string;
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'explain', label: 'Кодты түсіндіру', prompt: 'Осы кодты түсіндіріп берші', icon: <SearchIcon size={14} /> },
  { name: 'fix', label: 'Қатені табу және түзету', prompt: 'Осы кодтағы қателерді тауып, түзет', icon: <WandIcon size={14} /> },
  { name: 'refactor', label: 'Рефакторинг', prompt: 'Осы кодты таза және оқылатын етіп қайта жаз', icon: <EditIcon size={14} /> },
  { name: 'tests', label: 'Тест жазу', prompt: 'Осы кодқа тесттер жаз', icon: <BracketsIcon size={14} /> },
  { name: 'doc', label: 'Түсініктеме қосу', prompt: 'Осы кодқа түсініктемелер мен құжаттама қос', icon: <CodeIcon size={14} /> },
];

// Код блогынан жаңа файл жасағанда — тілге қарай кеңейтпе
const LANG_EXT: Record<string, string> = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
  python: 'py', py: 'py', html: 'html', css: 'css', scss: 'scss', json: 'json',
  markdown: 'md', md: 'md', bash: 'sh', sh: 'sh', shell: 'sh', sql: 'sql',
  java: 'java', go: 'go', rust: 'rs', php: 'php', cpp: 'cpp', c: 'c', yaml: 'yml', yml: 'yml',
};

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

interface CodeBlock {
  language: string;
  code: string;
  /** ```python path=src/main.py — Agent режимінде осы файлға жазылады */
  path?: string;
  /** ```markdown note="Жоспар" — жобаның Notes папкасындағы жазбаға жазылады */
  note?: string;
  /** Жазылатын толық мәтін (trim-сіз) */
  raw: string;
}

// path= ішіндегі жолды тазалау: «./», басындағы «/» алынады; «..» бар жол қабылданбайды
function cleanPath(path?: string): string | undefined {
  const clean = path?.trim().replace(/^\.?\/+/, '');
  if (!clean || clean.split('/').some((part) => part === '..' || part === '')) return undefined;
  return clean;
}

// Блоктың бірінші жолы: ```тіл path=… немесе ```тіл note="…"
const FENCE_TARGET = /^```[\w+#.-]*[ \t]+(path|note)=("[^"\n]*"|[^\s`]+)/;

function fenceTarget(line: string): { path?: string; note?: string } {
  const m = FENCE_TARGET.exec(line);
  if (!m) return {};
  const value = m[2].replace(/^"|"$/g, '').trim();
  return m[1] === 'path' ? { path: cleanPath(value) } : { note: value || undefined };
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /^(```([\w+#.-]+)?[^\n]*)\n([\s\S]*?)^```/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({ language: match[2] || 'plaintext', ...fenceTarget(match[1]), code: match[3].trim(), raw: match[3] });
  }
  return blocks;
}

// Жоба файлдарын Бүркітке жіберу: ашық файл бөлек барады, қалғандары — жалпы көлем шегіне дейін
const MAX_PROJECT_CHARS = 150_000;

function projectContext(files: VirtualFile[], activePath?: string) {
  let budget = MAX_PROJECT_CHARS;
  return files.map((f) => {
    if (f.path === activePath || f.content.length > budget) return { path: f.path };
    budget -= f.content.length;
    return { path: f.path, content: f.content };
  });
}

type BurkitMode = 'agent' | 'ask';
const MODE_KEY = 'vibe-burkit-mode';

function loadMode(): BurkitMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'ask' ? 'ask' : 'agent';
  } catch {
    return 'agent';
  }
}

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Gemini кілтін енгізу/ауыстыру/өшіру картасы
interface KeyCardProps {
  status: BurkitStatus | null;
  onChange: (status: BurkitStatus) => void;
  onClose?: () => void;
}

const KeyCard: React.FC<KeyCardProps> = ({ status, onChange, onClose }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<BurkitStatus>) => {
    setBusy(true);
    setError('');
    try {
      onChange(await action());
      setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате орын алды');
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) run(() => apiService.saveBurkitKey(value.trim()));
  };

  return (
    <form className="vx-ai__key" onSubmit={save}>
      <div className="vx-ai__key-head">
        <b>Gemini API кілті</b>
        {onClose && (
          <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={onClose} title="Жабу">
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <p className="vx-ai__key-text">
        {status?.source === 'own' && <>Өз кілтіңіз қосулы: <code>{status.keyHint}</code></>}
        {status?.source === 'shared' && <>Сіз сайттың ортақ кілтін қолданып жатырсыз. Өз кілтіңізді қойсаңыз, сол қолданылады.</>}
        {(!status || status.source === 'none') && (
          <>
            Бүркітті қолдану үшін тегін кілт алыңыз:{' '}
            <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer" className="vx-ai__link">aistudio.google.com</a>
            {' '}→ «Create API key».
          </>
        )}
      </p>
      <div className="vx-ai__key-row">
        <input
          type="password"
          className="vx-ai__key-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status?.source === 'own' ? 'Жаңа кілт' : 'Кілтті осында қойыңыз'}
          autoComplete="off"
          spellCheck={false}
          aria-label="Gemini API кілті"
        />
        <button type="submit" className="vx-ai__key-btn" disabled={busy || !value.trim()}>
          {busy ? '…' : 'Сақтау'}
        </button>
      </div>
      {error && <p className="vx-ai__key-error">{error}</p>}
      {status?.source === 'own' && (
        <button type="button" className="vx-ai__key-remove" disabled={busy} onClick={() => run(() => apiService.deleteBurkitKey())}>
          Кілтті өшіру
        </button>
      )}
      <p className="vx-ai__key-note">Кілт серверде шифрланып сақталады, оны тек сіздің аккаунтыңыз қолданады.</p>
    </form>
  );
};

// Жол ішіндегі markdown: **bold**, *italic*, `code`, [link](url)
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const inlineRegex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let m;
  let k = 0;
  while ((m = inlineRegex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    if (m[1]) parts.push(<strong key={`b-${k}`}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={`i-${k}`}>{m[4]}</em>);
    else if (m[5]) parts.push(<code key={`c-${k}`} className="vx-ai__inline-code">{m[6]}</code>);
    else if (m[7]) {
      parts.push(
        <a key={`a-${k}`} href={m[9]} target="_blank" rel="noopener noreferrer" className="vx-ai__link">
          {m[8]}
        </a>
      );
    }
    lastIndex = m.index + m[0].length;
    k++;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Ескі браузер немесе қауіпсіз емес контекст
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      // көшіру сәтсіз — үнсіз
    }
    document.body.removeChild(textarea);
  }
}

const ChatPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { dispatch, activeFile, activeProject, openFiles, isMobile, isTablet, syncReady } = useVibecoding();
  const history = useBurkitHistory();

  // Бет жаңартылса немесе панель жабылып-ашылса — сол чат пен көрініс қалпына келеді
  const [initialActive] = useState(() => history.readActive());
  const [view, setView] = useState<'chat' | 'history'>(initialActive.state.view);
  const [conversationId, setConversationId] = useState<string | null>(initialActive.conversation?.id ?? null);
  const [messages, setMessages] = useState<BurkitMessage[]>(initialActive.conversation?.messages ?? []);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Ағымдағы файлды контекст ретінде қосу (Copilot-тағы «Current file»)
  const [useContext, setUseContext] = useState(true);
  const [slashIndex, setSlashIndex] = useState(0);
  // Бүркіт қай кілтпен жұмыс істейді (null — әлі жүктелмеді)
  const [status, setStatus] = useState<BurkitStatus | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [mode, setMode] = useState<BurkitMode>(loadMode);
  // Жобаға автоматты байланысқан Notes папкасы (жоба серверге сақталмаған болса — null)
  const [projectNotes, setProjectNotes] = useState<ProjectNotesDTO | null>(null);
  const edits = useBurkitEdits();

  const isOverlay = isMobile || isTablet;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Жауап келіп жатқанда жоба ауысса — файлдарға жазбаймыз
  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  // Тек жаңа хабар қосылғанда тарихқа сақтаймыз (тарихтан ашқанда — жоқ)
  const dirtyRef = useRef(false);
  const conversationsRef = useRef(history.conversations);
  conversationsRef.current = history.conversations;

  const isEmpty = messages.length === 0;
  const contextFile = useContext ? activeFile : null;
  const needsKey = status?.source === 'none';

  useEffect(() => () => abortRef.current?.abort(), []);

  // Қолданушы анықталғанда (кіру аяқталғанда) — оның сақталған чатын ашу
  const { key: historyKey, readActive, saveActive } = history;
  const restoredKeyRef = useRef(historyKey);
  useEffect(() => {
    if (restoredKeyRef.current === historyKey) return;
    restoredKeyRef.current = historyKey;
    const { state, conversation } = readActive();
    setConversationId(conversation?.id ?? null);
    setMessages(conversation?.messages ?? []);
    setView(state.view);
  }, [historyKey, readActive]);

  useEffect(() => {
    if (restoredKeyRef.current !== historyKey) return; // әлі қалпына келтірілмеді
    saveActive({ conversationId, view });
  }, [conversationId, view, historyKey, saveActive]);

  useEffect(() => {
    apiService.getBurkitStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // жеке терезе — режим тек осы сессияда
    }
  }, [mode]);

  const projectId = activeProject?.id;
  const refreshNotes = useCallback(() => {
    if (!projectId) return;
    apiService.getProjectNotes(projectId)
      .then((data) => { if (projectRef.current?.id === projectId) setProjectNotes(data); })
      .catch(() => setProjectNotes(null));
  }, [projectId]);

  useEffect(() => {
    setProjectNotes(null);
    refreshNotes();
  }, [refreshNotes]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  // Өріс мәтінге қарай өседі (ең көбі ~7 жол)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [inputValue, view]);

  // Сөйлесуді тарихқа сақтау
  useEffect(() => {
    if (!dirtyRef.current || !conversationId || messages.length === 0) return;
    dirtyRef.current = false;
    const existing = conversationsRef.current.find((c) => c.id === conversationId);
    const firstUser = messages.find((m) => m.role === 'user');
    history.upsert({
      id: conversationId,
      title: existing?.title ?? titleFromText(firstUser?.content ?? 'Жаңа сөйлесу'),
      createdAt: existing?.createdAt ?? messages[0].timestamp,
      updatedAt: new Date().toISOString(),
      pinned: existing?.pinned,
      projectName: existing?.projectName ?? activeProject?.name,
      messages,
    });
  }, [messages, conversationId, history, activeProject?.name]);

  // «/» жазылса — командалар тізімі
  const slashQuery = /^\/(\w*)$/.exec(inputValue)?.[1];
  const slashMatches = useMemo(
    () => (slashQuery === undefined ? [] : SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery.toLowerCase()))),
    [slashQuery]
  );
  useEffect(() => setSlashIndex(0), [slashQuery]);

  // Бүркіттен жауап: мәтін бөлік-бөлік келіп, бір хабарға жиналады
  // resume — үзілген жауап: жаңа мәтін соның соңына жалғанады
  const respond = useCallback(async (thread: BurkitMessage[], file: typeof activeFile, resume?: BurkitMessage) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    const replyId = resume?.id ?? generateId();
    const project = projectRef.current;
    const agent = mode === 'agent' && !!project;
    let started = !!resume;
    let full = resume?.content ?? '';
    // Үзілгенге дейін жабылған блоктар файлдарға жазылып қойған — қайта жазбаймыз
    let applied = resume ? extractCodeBlocks(full).length : 0;
    const write = (text: string, error?: boolean) => {
      const first = !started;
      started = true;
      dirtyRef.current = true;
      setMessages((prev) => (first
        ? [
            // Жауап басталды — сұрақтың «күтуде» белгісі алынады
            ...prev.map((m) => (m.pending && m.role === 'user' ? { ...m, pending: false } : m)),
            { id: replyId, role: 'assistant', content: text, timestamp: new Date().toISOString(), error, pending: !error },
          ]
        : prev.map((m) => (m.id === replyId ? { ...m, content: m.content + text } : m))));
    };
    const addEdit = (edit: BurkitEdit) => {
      dirtyRef.current = true;
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, edits: [...(m.edits ?? []), edit] } : m)));
    };

    // Жабылған path=/note= блоктарын бірден жазу (Cursor сияқты — жауап аяқталуын күтпей)
    const applyBlocks = () => {
      if (!agent || projectRef.current?.id !== project?.id) return;
      const blocks = extractCodeBlocks(full);
      for (; applied < blocks.length; applied++) {
        const block = blocks[applied];
        if (block.path) {
          const { created } = edits.applyEdit(block.path, block.raw);
          addEdit({ kind: 'file', path: block.path, created });
        } else if (block.note) {
          const title = block.note;
          edits.applyNote(title, block.raw)
            .then(({ noteId, created }) => {
              addEdit({ kind: 'note', path: title, created, noteId });
              refreshNotes();
            })
            .catch((e) => write(`\n\n⚠️ «${title}» жазбасына жазу мүмкін болмады: ${e instanceof Error ? e.message : ''}`));
        }
      }
    };

    try {
      await apiService.streamBurkitChat(
        {
          messages: [
            ...thread
              .filter((m) => !m.error)
              .slice(-MAX_HISTORY)
              .map((m) => ({ role: m.role, content: m.content })),
            ...(resume ? [{ role: 'user' as const, content: CONTINUE_PROMPT }] : []),
          ],
          fileName: file?.path,
          fileContent: file?.content.slice(0, MAX_FILE_CHARS),
          mode: agent ? 'agent' : 'ask',
          uiLanguage: uiLanguageOf(i18n.language),
          workspace: { ...getWorkspaceSnapshot(), openFiles: openFilesRef.current.slice(0, 200).map((f) => f.path) },
          ...(project && {
            projectId: project.id,
            projectName: project.name,
            projectFiles: projectContext(project.files, file?.path),
          }),
        },
        (chunk) => {
          full += chunk;
          write(chunk);
          applyBlocks();
        },
        controller.signal
      );
      dirtyRef.current = true;
      setMessages(clearPending);
    } catch (e) {
      // Бет жаңартылды / панель жабылды — pending белгісі қалады, кейін жалғасады
      // (қолданушы өзі тоқтатса — stop() белгіні алып тастайды)
      if (controller.signal.aborted) return;
      if (e instanceof BurkitError && e.status === 403) {
        setStatus((s) => (s ? { ...s, source: 'none', keyHint: null } : s));
        setKeyOpen(true);
      }
      write(`${started ? '\n\n' : ''}⚠️ ${e instanceof Error ? e.message : t('apiErrors.burkitFailed')}`, !started);
      setMessages(clearPending);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  }, [t, i18n, mode, edits, refreshNotes]);

  const sendMessage = useCallback((text: string) => {
    const content = text.trim();
    if (!content || isLoading) return;
    if (!conversationId) setConversationId(generateId());
    dirtyRef.current = true;
    const thread: BurkitMessage[] = [
      ...messages,
      { id: generateId(), role: 'user', content, timestamp: new Date().toISOString(), context: contextFile?.name, pending: true },
    ];
    setMessages(thread);
    setInputValue('');
    respond(thread, contextFile);
  }, [isLoading, conversationId, messages, contextFile, respond]);

  // Жауапты тоқтату (келген бөлігі сақталады)
  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    dirtyRef.current = true;
    setMessages(clearPending);
  };

  // Бет жаңартылғанда (немесе панель жабылып-ашылғанда) үзілген жауапты жалғастыру
  const resumedRef = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last?.pending || isLoading || !syncReady || !status || status.source === 'none') return;
    if (resumedRef.current === last.id) return; // бір хабарды бір рет қана
    resumedRef.current = last.id;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const file = lastUser?.context && activeFile?.name === lastUser.context ? activeFile : null;
    if (last.role === 'assistant') respond(messages, file, last);
    else respond(messages, file);
  }, [messages, isLoading, syncReady, status, activeFile, respond]);

  // Соңғы жауапты қайта алу
  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || isLoading) return;
    dirtyRef.current = true;
    const thread = messages[messages.length - 1]?.role === 'assistant' ? messages.slice(0, -1) : messages;
    setMessages(thread);
    // Файл әлі ашық болса — оның қазіргі мазмұнымен
    respond(thread, lastUser.context && activeFile?.name === lastUser.context ? activeFile : null);
  };

  const newChat = () => {
    stop();
    setConversationId(null);
    setMessages([]);
    setInputValue('');
    setView('chat');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openConversation = (id: string) => {
    const conv = history.conversations.find((c) => c.id === id);
    if (!conv) return;
    stop();
    setConversationId(conv.id);
    setMessages(conv.messages);
    setView('chat');
  };

  const removeConversation = (id: string) => {
    history.remove(id);
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
    }
  };

  const clearHistory = () => {
    history.clearAll();
    const current = history.conversations.find((c) => c.id === conversationId);
    if (current && !current.pinned) {
      setConversationId(null);
      setMessages([]);
    }
  };

  const exportConversation = (conv: BurkitConversation) => {
    const blob = new Blob([conversationToMarkdown(conv)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40) || 'burkit'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pickSlash = (cmd: SlashCommand) => {
    setInputValue(`${cmd.prompt} `);
    inputRef.current?.focus();
  };

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
        setInputValue('');
        return;
      }
    }
    // Enter — жіберу, Shift+Enter — жаңа жол (әріп теру кезінде IME-ге кедергі жасамау)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const markCopied = (id: string) => {
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  };

  const handleInsertCode = useCallback((code: string) => {
    if (!activeFile) return;
    dispatch({
      type: 'UPDATE_FILE_CONTENT',
      payload: { fileId: activeFile.id, content: activeFile.content + '\n' + code },
    });
  }, [activeFile, dispatch]);

  // Код блогынан жаңа файл: snippet.js, snippet-2.js…
  const handleNewFile = useCallback((code: string, language: string) => {
    const ext = LANG_EXT[language.toLowerCase()] ?? 'txt';
    const taken = new Set(activeProject?.files.map((f) => f.path) ?? []);
    let name = `snippet.${ext}`;
    for (let i = 2; taken.has(name); i++) name = `snippet-${i}.${ext}`;
    dispatch({ type: 'CREATE_FILE', payload: { name, path: name, content: code } });
  }, [activeProject, dispatch]);

  const renderMessageContent = (msg: BurkitMessage) => {
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let openFence = '';
    msg.content.split('\n').forEach((line, i) => {
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        openFence = line;
        return;
      }
      if (inCodeBlock) return;
      const heading = /^#{1,3} (.*)$/.exec(line);
      if (heading) elements.push(<div key={i} className="vx-ai__heading">{renderInlineMarkdown(heading[1])}</div>);
      else if (line.startsWith('- ')) {
        elements.push(
          <div key={i} className="vx-ai__li">
            <span className="vx-ai__bullet" />
            <span>{renderInlineMarkdown(line.slice(2))}</span>
          </div>
        );
      } else elements.push(<div key={i}>{line ? renderInlineMarkdown(line) : <br />}</div>);
    });

    // Жауап әлі келіп жатыр, ал соңғы блок жабылмаған — қай файлға жазып жатқанын көрсету
    const writing = inCodeBlock && isLoading && msg.id === lastAssistantId ? fenceTarget(openFence) : {};
    const writingTarget = writing.path ?? (writing.note && `📓 ${writing.note}`);

    if (msg.role === 'assistant') {
      extractCodeBlocks(msg.content).forEach((block, idx) => {
        const blockId = `${msg.id}-code-${idx}`;
        const copied = copiedId === blockId;
        const ext = LANG_EXT[block.language.toLowerCase()] ?? 'txt';
        const target = block.path ?? block.note;
        elements.push(
          <div key={`code-${idx}`} className={`vx-ai__code ${target ? 'vx-ai__code--target' : ''}`}>
            <div className="vx-ai__code-bar">
              <span className="vx-ai__code-lang">
                {block.note ? <span aria-hidden="true">📓</span> : <FileTypeIcon name={block.path ?? `x.${ext}`} size={15} />}
                {target ?? block.language}
              </span>
              <div className="vx-ai__code-actions">
                <button
                  type="button"
                  onClick={() => copyText(block.code).then(() => markCopied(blockId))}
                  className={`vx-icon-btn vx-icon-btn--xs ${copied ? 'is-done' : ''}`}
                  title={copied ? t('vibecoding.chat.copied') : t('vibecoding.chat.copyCode')}
                >
                  {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
                {activeFile && !target && (
                  <button
                    type="button"
                    onClick={() => handleInsertCode(block.code)}
                    className="vx-icon-btn vx-icon-btn--xs"
                    title={`${t('vibecoding.chat.insertCode')} — ${activeFile.name}`}
                  >
                    <InsertIcon size={13} />
                  </button>
                )}
                {!target && (
                  <button
                    type="button"
                    onClick={() => handleNewFile(block.code, block.language)}
                    className="vx-icon-btn vx-icon-btn--xs"
                    title="Жаңа файл ретінде сақтау"
                  >
                    <FilePlusIcon size={13} />
                  </button>
                )}
              </div>
            </div>
            <pre>
              <code>{block.code}</code>
            </pre>
          </div>
        );
      });
    }

    if (writingTarget) {
      elements.push(
        <div key="writing" className="vx-ai__writing">
          <span className="vx-ai__dots"><span /><span /><span /></span>
          Жазып жатыр: <b>{writingTarget}</b>
        </div>
      );
    }

    if (msg.edits?.length) elements.push(renderEdits(msg.edits));

    return elements;
  };

  // Файлды редакторда ашу (Бүркіт өзгерткен файлдың атын басқанда)
  const openPath = (path: string) => {
    const file = activeProject?.files.find((f) => f.path === path);
    if (file) dispatch({ type: 'OPEN_FILE', payload: { fileId: file.id } });
  };

  // Бір өзгерістің жолы: атауы, +/−, Қайтару / Қабылдау (немесе қаралды белгісі)
  const renderEditRow = (edit: BurkitEdit, key: string) => {
    const isNote = edit.kind === 'note';
    const filePending = !isNote ? edits.pendingFor(edit.path) : undefined;
    const notePending = isNote ? edits.pendingNotes.find((n) => n.noteId === edit.noteId) : undefined;
    const pending = !!(filePending || notePending);
    const file = !isNote ? activeProject?.files.find((f) => f.path === edit.path) : undefined;
    const stats = filePending && file ? lineStats(filePending.original, file.content) : null;
    return (
      <div key={key} className={`vx-ai__edit ${pending ? 'is-pending' : ''}`}>
        {isNote ? (
          <Link to={`/notes?note=${encodeURIComponent(edit.noteId ?? '')}`} target="_blank" className="vx-ai__edit-name">
            <span aria-hidden="true">📓</span>
            {edit.path}
          </Link>
        ) : (
          <button type="button" className="vx-ai__edit-name" onClick={() => openPath(edit.path)}>
            <FileTypeIcon name={edit.path} size={13} />
            {edit.path}
          </button>
        )}
        {edit.created && <span className="vx-ai__edit-tag">жаңа</span>}
        {stats && (
          <span className="vx-ai__edit-stats">
            <span className="is-add">+{stats.added}</span>
            <span className="is-del">−{stats.removed}</span>
          </span>
        )}
        {pending ? (
          <span className="vx-ai__edit-actions">
            <button
              type="button"
              className="vx-icon-btn vx-icon-btn--xs"
              title="Қайтару"
              onClick={() => (isNote ? edits.undoNote(edit.noteId!).then(refreshNotes).catch(() => {}) : edits.undo(edit.path))}
            >
              <CloseIcon size={12} />
            </button>
            <button
              type="button"
              className="vx-icon-btn vx-icon-btn--xs"
              title="Қабылдау"
              onClick={() => (isNote ? edits.keepNote(edit.noteId!) : edits.keep(edit.path))}
            >
              <CheckIcon size={12} />
            </button>
          </span>
        ) : (
          <span className="vx-ai__edit-done">қаралды</span>
        )}
      </div>
    );
  };

  const renderEdits = (list: BurkitEdit[]) => (
    <div key="edits" className="vx-ai__edits">
      {list.map((edit, i) => renderEditRow(edit, `${edit.kind}-${edit.path}-${i}`))}
    </div>
  );

  // Қаралмаған барлық өзгерістер — жазу картасының үстіндегі жолақ (Cursor-дағы «Review»)
  const reviewCount = edits.pending.length + edits.pendingNotes.length;

  // Жаңа чаттағы дайын сұраулар — файл ашық болса сол файлға қатысты
  const quickActions = SLASH_COMMANDS.slice(0, 4);
  const recent = useMemo(
    () => [...history.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [history.conversations]
  );
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  if (view === 'history') {
    return (
      <div className="vx-ai">
        <BurkitHistory
          conversations={history.conversations}
          activeId={conversationId}
          onOpen={openConversation}
          onBack={() => setView('chat')}
          onNew={newChat}
          onRemove={removeConversation}
          onRename={history.rename}
          onTogglePin={history.togglePin}
          onExport={exportConversation}
          onClearAll={clearHistory}
        />
      </div>
    );
  }

  return (
    <div className={`vx-ai ${isEmpty ? 'is-empty' : ''}`}>
      {/* Тақырып: белгішесіз — белгіше тек жаңа чат бетінде */}
      <div className="vx-ai__bar">
        {isOverlay && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: false })}
            className="vx-icon-btn vx-icon-btn--sm"
            title={t('vibecoding.chat.closeChat')}
          >
            <CloseIcon size={16} />
          </button>
        )}
        <span className="vx-ai__bar-title">
          {isEmpty ? 'Бүркіт' : history.conversations.find((c) => c.id === conversationId)?.title ?? 'Бүркіт'}
        </span>
        <div className="vx-ai__bar-actions">
          <button
            type="button"
            onClick={() => setKeyOpen((v) => !v)}
            className={`vx-icon-btn vx-icon-btn--sm ${keyOpen ? 'is-on' : ''}`}
            title="Gemini API кілті"
          >
            <SettingsIcon size={16} />
          </button>
          <button type="button" onClick={() => setView('history')} className="vx-icon-btn vx-icon-btn--sm" title="Тарих">
            <HistoryIcon size={17} />
          </button>
          <button type="button" onClick={newChat} disabled={isEmpty} className="vx-icon-btn vx-icon-btn--sm" title={t('vibecoding.chat.newChat')}>
            <PlusIcon size={17} />
          </button>
        </div>
      </div>

      <div className="vx-ai__scroll ide-scrollbar" ref={scrollRef} aria-live="polite">
        {keyOpen && !(isEmpty && needsKey) && (
          <KeyCard
            status={status}
            onChange={(s) => {
              setStatus(s);
              if (s.source !== 'none') setKeyOpen(false);
            }}
            onClose={() => setKeyOpen(false)}
          />
        )}
        {isEmpty ? (
          // Жаңа чат: ортада жарық жиекті белгіше, атау және дайын сұраулар (басты беттің Бүркіті сияқты)
          <div className="vx-ai__hero">
            <div className="vx-ai__orb" aria-hidden="true">
              <SparkleIcon size={26} />
            </div>
            <h2 className="vx-ai__hero-title">Бүркіт</h2>
            <p className="vx-ai__hero-sub">
              {mode === 'agent' && activeProject ? (
                <>Agent режимі: <b>{activeProject.name}</b> жобасының файлдарына өзім жазамын, сіз тек қабылдайсыз немесе қайтарасыз</>
              ) : activeFile ? (
                <>Ашық файлмен жұмыс істеймін: <b>{activeFile.name}</b></>
              ) : (
                t('vibecoding.chat.subtitle')
              )}
            </p>
            {projectNotes && (
              <Link to="/notes" target="_blank" className="vx-ai__notes-link" title="Жобаға байланысқан Notes папкасы">
                <span aria-hidden="true">📓</span>
                {projectNotes.folder}
                <span className="vx-ai__notes-count">{projectNotes.notes.length} жазба</span>
              </Link>
            )}

            {needsKey ? (
              // Кілт жоқ — дайын сұраулардың орнына кілт енгізу
              <KeyCard status={status} onChange={setStatus} />
            ) : (
              <div className="vx-ai__chips">
                {quickActions.map((cmd, i) => (
                  <button
                    key={cmd.name}
                    type="button"
                    className="vx-ai__chip"
                    style={{ ['--d' as string]: i }}
                    onClick={() => sendMessage(cmd.prompt)}
                  >
                    <span className="vx-ai__chip-icon">{cmd.icon}</span>
                    {cmd.label}
                  </button>
                ))}
              </div>
            )}

            {recent.length > 0 && (
              <div className="vx-ai__recent">
                <div className="vx-ai__recent-head">
                  <span>Соңғы сөйлесулер</span>
                  <button type="button" onClick={() => setView('history')}>
                    Барлығы
                    <ChevronIcon size={12} />
                  </button>
                </div>
                {recent.map((conv) => (
                  <button key={conv.id} type="button" className="vx-ai__recent-item" onClick={() => openConversation(conv.id)}>
                    <HistoryIcon size={13} />
                    <span>{conv.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="vx-ai__thread">
            {messages.map((msg) => (
              <div key={msg.id} className={`vx-ai__msg vx-ai__msg--${msg.role} ${msg.error ? 'is-error' : ''}`}>
                <div className="vx-ai__content">
                  <div className="vx-ai__text">{renderMessageContent(msg)}</div>
                </div>
                {msg.context && (
                  <div className="vx-ai__ref">
                    <FileTypeIcon name={msg.context} size={13} />
                    {msg.context}
                  </div>
                )}
                {/* Хабар астындағы әрекеттер: уақыт, көшіру, қайта жауап */}
                <div className="vx-ai__msg-tools">
                  <span className="vx-ai__time">{formatTime(msg.timestamp)}</span>
                  <button
                    type="button"
                    className={`vx-icon-btn vx-icon-btn--xs ${copiedId === msg.id ? 'is-done' : ''}`}
                    onClick={() => copyText(msg.content).then(() => markCopied(msg.id))}
                    title="Көшіру"
                  >
                    {copiedId === msg.id ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  </button>
                  {msg.id === lastAssistantId && !isLoading && (
                    <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={regenerate} title="Қайта жауап алу">
                      <RefreshIcon size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Жауаптың алғашқы бөлігі келгенше */}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="vx-ai__msg vx-ai__msg--assistant">
                <div className="vx-ai__thinking" aria-label={t('vibecoding.chat.thinking')}>
                  <span className="vx-ai__dots"><span /><span /><span /></span>
                  Бүркіт ойланып жатыр
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Жазу картасы — жиегінде қозғалмалы жарық */}
      <div className="vx-ai__composer">
        {reviewCount > 0 && (
          <div className="vx-ai__review">
            <div className="vx-ai__review-head">
              <span>
                <b>{reviewCount}</b> өзгеріс қаралмаған
              </span>
              <button type="button" className="vx-ai__review-btn" onClick={() => { edits.undoAll(); window.setTimeout(refreshNotes, 300); }}>
                Барлығын қайтару
              </button>
              <button type="button" className="vx-ai__review-btn is-primary" onClick={edits.keepAll}>
                Барлығын қабылдау
              </button>
            </div>
            <div className="vx-ai__review-list ide-scrollbar">
              {edits.pending.map((p) =>
                renderEditRow({ kind: 'file', path: p.path, created: p.original === null }, `rf-${p.path}`)
              )}
              {edits.pendingNotes.map((n) =>
                renderEditRow({ kind: 'note', path: n.title, created: n.previous === null, noteId: n.noteId }, `rn-${n.noteId}`)
              )}
            </div>
          </div>
        )}
        {slashMatches.length > 0 && (
          <div className="vx-ai__slash" role="listbox">
            {slashMatches.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                className={`vx-ai__slash-item ${i === slashIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setSlashIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSlash(cmd)}
              >
                <span className="vx-ai__chip-icon">{cmd.icon}</span>
                <b>/{cmd.name}</b>
                <span>{cmd.label}</span>
              </button>
            ))}
          </div>
        )}

        <div
          className={`vx-ai__box ${isLoading ? 'is-busy' : ''}`}
          // Картаның кез келген жерін басса — мәтін жолына фокус
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('textarea, button')) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Бүркіттен сұраңыз немесе / жазыңыз"
            rows={1}
            className="vx-ai__input"
            aria-label="Бүркіт"
          />
          <div className="vx-ai__box-foot">
            <div className="vx-ai__foot-left">
            <div className="vx-ai__mode" role="radiogroup" aria-label="Бүркіт режимі">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'agent'}
                className={mode === 'agent' ? 'is-on' : ''}
                onClick={() => setMode('agent')}
                title="Agent — файлдар мен Notes жазбаларына өзі жазады"
              >
                Agent
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'ask'}
                className={mode === 'ask' ? 'is-on' : ''}
                onClick={() => setMode('ask')}
                title="Ask — тек жауап береді, ештеңені өзгертпейді"
              >
                Ask
              </button>
            </div>
            {activeFile ? (
              <button
                type="button"
                className={`vx-ai__ctx ${useContext ? 'is-on' : ''}`}
                onClick={() => setUseContext((v) => !v)}
                title={useContext ? 'Файл контекстке қосылған — алып тастау' : 'Ашық файлды контекстке қосу'}
              >
                <FileTypeIcon name={activeFile.name} size={14} />
                <span className="vx-ai__ctx-name">{activeFile.name}</span>
                {useContext ? <CloseIcon size={11} /> : <PlusIcon size={11} />}
              </button>
            ) : (
              <span className="vx-ai__ctx-empty">Файл ашылмаған</span>
            )}
            </div>
            {isLoading ? (
              <button type="button" onClick={stop} className="vx-ai__send is-stop" title="Тоқтату">
                <span className="vx-ai__stop" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => sendMessage(inputValue)}
                disabled={!inputValue.trim()}
                className="vx-ai__send"
                title={t('vibecoding.chat.send')}
              >
                <ArrowUpIcon size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="vx-ai__hint">
          <kbd>Enter</kbd> жіберу · <kbd>Shift+Enter</kbd> жаңа жол · <kbd>/</kbd> командалар
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
