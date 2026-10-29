import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useVibecoding, VirtualFile } from '../../contexts/VibecodingContext';
import { useBurkitEdits, lineStats } from '../../contexts/BurkitEditsContext';
import BurkitLogo from '../BurkitLogo';
import BurkitKeyCard from '../BurkitKeyCard';
import {
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
  TerminalIcon,
  TrashIcon,
  PlayIcon,
  FolderIcon,
} from './icons';
import { FileTypeIcon } from './fileIcons';
import { BurkitAttachButton, BurkitAttachmentChip } from '../BurkitAttach';
import { useBurkitAttachments } from '../useBurkitAttachments';
import { Attachment, budgetFiles } from '../../utils/burkitAttachments';
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
import { getWorkspaceSnapshot, subscribeTerminalOutput } from '../../utils/vibeActivity';
import { BURKIT_ASK_EVENT, takeBurkitQuestion, runInTerminal } from '../../utils/vibeBridge';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fromServer } from '../../contexts/VibecodingContext';
import {
  runProjectAction,
  describeProjectAction,
  loadSiteContext,
  CONFIRM_OPS,
  ALWAYS_CONFIRM_OPS,
  BurkitSiteContext,
  ProjectHost,
} from '../../utils/burkitProjectTools';
import type { BlockAction, CodeBlock } from './burkitBlocks';
import {
  extractCodeBlocks,
  parseFence,
  actionLabel,
  applySearchReplace,
  parseMentions,
  mentionCandidates,
} from './burkitBlocks';

/* Бүркіт — Vibecoding-тегі код көмекшісі (Google Gemini), Cursor/Claude сияқты агент: Agent режимінде
   жобаның файлдарын жазады, бөлшектеп өңдейді, өшіреді, жылжытады, оқиды, терминалда команда орындайды
   (burkitBlocks.ts) және нәтижесін көріп, жұмысты өзі жалғастырады. Файлдар мен Notes өзгерістері
   «Қабылдау / Қайтару» арқылы қаралады (редакторда diff). Ask режимі тек жауап береді (файл оқи алады).
   Хабарда @файл / @папка — сол файлдар контекстке бірінші болып қосылады.
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

// Жоба файлдарын Бүркітке жіберу: ашық файл бөлек барады, қалғандары — жалпы көлем шегіне дейін.
// @ арқылы атап өтілген файлдар (немесе папкалардың ішіндегілері) бірінші орынға алынады
const MAX_PROJECT_CHARS = 150_000;

function projectContext(files: VirtualFile[], activePath?: string, mentions: string[] = []) {
  let budget = MAX_PROJECT_CHARS;
  const mentioned = (p: string) => mentions.some((m) => p === m || p.startsWith(`${m}/`));
  const included = new Set<string>();
  [...files.filter((f) => mentioned(f.path)), ...files].forEach((f) => {
    if (included.has(f.path) || f.path === activePath || f.content.length > budget) return;
    budget -= f.content.length;
    included.add(f.path);
  });
  return files.map((f) => (included.has(f.path) ? { path: f.path, content: f.content } : { path: f.path }));
}

// Бір пайдаланушы хабарына Бүркіт өзі жасай алатын қадамдар (құрал нәтижесі → жалғасы)
const MAX_AUTO_STEPS = 10;
const TOOL_PREFIX = '[Құрал нәтижесі]';
// read нәтижесінде бір файлдың ең үлкен көлемі
const MAX_READ_CHARS = 60_000;
const MAX_RUN_OUTPUT = 8_000;
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'cmd']);

// Жауап аяқталған соң орындалатын блоктар: командалар (тек Agent) және сайттағы жоба әрекеттері
function isActionBlock(block: CodeBlock, agent: boolean): boolean {
  const { action } = block;
  return (action?.kind === 'run' && agent && !!block.code) || action?.kind === 'project';
}

// Ask режимінде де сұраусыз орындалатын (ештеңені өзгертпейтін) жоба әрекеттері
const READONLY_OPS = new Set(['list', 'open']);

function needsApproval(action: BlockAction | undefined, autoRun: boolean, agent: boolean): boolean {
  if (action?.kind === 'run') return !autoRun;
  if (action?.kind !== 'project') return false;
  if (!agent && !READONLY_OPS.has(action.op)) return true;
  return CONFIRM_OPS.has(action.op) && (!autoRun || ALWAYS_CONFIRM_OPS.has(action.op));
}

// Құрал нәтижесінің бір жолдық атауы: орындалған командалар мен оқылған файлдар
function toolSummary(content: string): string {
  const parts = [
    ...[...content.matchAll(/^\$ (.+)$/gm)].map((m) => `$ ${m[1]}`),
    ...[...content.matchAll(/^Файл (\S+):$/gm)].map((m) => `оқылды: ${m[1]}`),
  ];
  return parts.length > 0 ? parts.join(' · ') : 'Құрал нәтижесі';
}

// Терминал шығысын тазалау: \r\n → \n, жалғыз \r жолды қайта жазады (прогресс-бар)
function cleanOutput(text: string): string {
  const out = text.replace(/\r\n/g, '\n').replace(/[^\n]*\r(?!\n|$)/g, '').replace(/\r/g, '');
  return out.length > MAX_RUN_OUTPUT ? `…${out.slice(-MAX_RUN_OUTPUT)}` : out;
}

type BurkitMode = 'agent' | 'ask';

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Жол ішіндегі markdown: **bold**, *italic*, `code`, [link](url)
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const inlineRegex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|((?<![\w])@[\w.\-/]*[\w/])/g;
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
    } else if (m[10]) parts.push(<span key={`m-${k}`} className="vx-ai__mention">{m[10]}</span>);
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
  const { dispatch, activeFile, activeProject, openFiles, isMobile, isTablet, syncReady, flushProjects } = useVibecoding();
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
  const [statusChecked, setStatusChecked] = useState(false);
  // Терминалдан келген сұрақ («Бүркіттен сұрау») — Бүркіт бос болғанда жіберіледі
  const [incoming, setIncoming] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  // Бүркіт әрқашан автоматты агент: файлдарға жазады, командаларды сұрамай орындайды
  // (тек қайтарылмайтын жоба әрекеттері расталады)
  const mode: BurkitMode = 'agent';
  // Жобаға автоматты байланысқан Notes папкасы (жоба серверге сақталмаған болса — null)
  const [projectNotes, setProjectNotes] = useState<ProjectNotesDTO | null>(null);
  const edits = useBurkitEdits();
  const autoRun = true;
  // Қазір орындалып жатқан әрекет (команда / жоба әрекеті): «хабар id:блок нөмірі»
  const [runningAction, setRunningAction] = useState<string | null>(null);
  // Бүркіт көрсеткен сілтемелер (бөлісу сілтемесі т.б.): «хабар id:блок нөмірі» → url
  const [actionLinks, setActionLinks] = useState<Record<string, string>>({});
  // Сайттағы жобалар, достар, топтар — project блоктары үшін Бүркітке барады
  const [siteContext, setSiteContext] = useState<BurkitSiteContext | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { state: vibeState } = useVibecoding();
  const projectsRef = useRef(vibeState.projects);
  projectsRef.current = vibeState.projects;
  // Курсор орны — @ ескертулер тізімі үшін
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Қолмен орындалатын командалары бар жауаптың жиналған нәтижелері (replyId → нәтижелер)
  const heldRef = useRef(new Map<string, string[]>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Тіркемелердің мазмұны тек жадта (хабар id → тіркемелер); тарихта тек аттары сақталады
  const filesRef = useRef(new Map<string, Attachment[]>());

  const isOverlay = isMobile || isTablet;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const attach = useBurkitAttachments(focusInput);
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
    apiService.getBurkitStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setStatusChecked(true));
  }, []);

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

  // «@» жазылса — жобаның файлдары мен папкалары (курсорға дейінгі сөз)
  const mentionQuery = activeProject && caret >= 0 ? /(?:^|\s)@([^\s@]*)$/.exec(inputValue.slice(0, caret))?.[1] : undefined;
  const mentionMatches = useMemo(
    () => (mentionQuery === undefined || !activeProject
      ? []
      : mentionCandidates(activeProject.files.map((f) => f.path), mentionQuery)),
    [mentionQuery, activeProject]
  );
  useEffect(() => setMentionIndex(0), [mentionQuery]);

  const markRan = useCallback((replyId: string, index: number) => {
    dirtyRef.current = true;
    setMessages((prev) => prev.map((m) => (
      m.id === replyId && !m.ran?.includes(index) ? { ...m, ran: [...(m.ran ?? []), index] } : m
    )));
  }, []);

  // Команданы жобаның терминалында орындап, шығысын жинау. Аяқталды деп shell шақыруы (…$)
  // қайта шыққанда санаймыз; шығыс ұзақ тоқтаса — команда әлі жұмыс істеп тұр (сервер т.б.)
  const runCommand = useCallback(async (command: string, signal: AbortSignal): Promise<string> => {
    const project = projectRef.current;
    if (!project) return `$ ${command}\nОрындалмады: жоба ашылмаған.`;

    let unsubscribe = () => {};
    try {
      // Терминал папкасы серверде — Бүркіт жазған файлдар алдымен сонда жетсін
      await flushProjects().catch(() => {});
      dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: true });
      let out = '';
      let last = Date.now();
      unsubscribe = subscribeTerminalOutput((text) => {
        out += text;
        last = Date.now();
      });
      await runInTerminal(project.id, command);
      const started = Date.now();
      const result = await new Promise<'done' | 'running' | 'stopped'>((resolve) => {
        const timer = window.setInterval(() => {
          const now = Date.now();
          const idle = now - last;
          let state: 'done' | 'running' | 'stopped' | null = null;
          if (signal.aborted) state = 'stopped';
          else if (idle > 700 && now - started > 900 && /[$#%>]\s*$/.test(cleanOutput(out))) state = 'done';
          else if ((idle > 6_000 && now - started > 2_000) || now - started > 120_000) state = 'running';
          if (state) {
            window.clearInterval(timer);
            resolve(state);
          }
        }, 250);
      });
      const note = result === 'running'
        ? '\n(Команда әлі жұмыс істеп тұр — бұл оның алғашқы шығысы.)'
        : result === 'stopped' ? '\n(Қолданушы күтуді тоқтатты.)' : '';
      return `$ ${command}\n~~~text\n${cleanOutput(out).trim() || '(шығыс жоқ)'}\n~~~${note}`;
    } catch (e) {
      return `$ ${command}\nОрындалмады: ${e instanceof Error ? e.message : 'терминал қатесі'}`;
    } finally {
      unsubscribe();
    }
  }, [dispatch, flushProjects]);

  // Сайттағы жобалармен жұмыс (project блоктары): Vibecoding-те жобалар контекст арқылы өзгереді
  const host = useMemo<ProjectHost | null>(() => (user ? {
    userId: user.id,
    username: user.username,
    get currentProjectId() { return projectRef.current?.id ?? null; },
    listVibe: async () => projectsRef.current.map((p) => ({ id: p.id, name: p.name })),
    createVibe: async (name) => {
      const id = generateId();
      dispatch({ type: 'CREATE_PROJECT', payload: { name, id } });
      return id;
    },
    deleteVibe: async (id) => {
      dispatch({ type: 'DELETE_PROJECT', payload: { projectId: id } });
    },
    flush: () => flushProjects().catch(() => {}),
    openVibe: (id, dto) => {
      if (dto) dispatch({ type: 'UPSERT_PROJECT', payload: { project: fromServer(dto) } });
      dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId: id } });
    },
    navigate,
  } : null), [user, dispatch, flushProjects, navigate]);

  const refreshSite = useCallback(() => {
    if (host) loadSiteContext(host).then(setSiteContext).catch(() => {});
  }, [host]);
  useEffect(refreshSite, [refreshSite]);

  // Бір әрекет блогын орындау; қайтарғаны — Бүркітке баратын нәтиже
  const executeBlock = useCallback(async (block: CodeBlock, signal: AbortSignal, replyId: string, index: number): Promise<string> => {
    const key = `${replyId}:${index}`;
    setRunningAction(key);
    try {
      if (block.action?.kind === 'run') return await runCommand(block.code, signal);
      if (block.action?.kind !== 'project') return '';
      const label = describeProjectAction(block.action);
      if (!host) return `${label}: орындалмады — жүйеге кіру керек.`;
      try {
        const result = await runProjectAction(block.action, host, block.code);
        if (result.link) setActionLinks((prev) => ({ ...prev, [key]: result.link! }));
        if (block.action.op !== 'list' && block.action.op !== 'open') refreshSite();
        return `${label}: ${result.text}`;
      } catch (e) {
        return `${label}: орындалмады — ${e instanceof Error ? e.message : 'қате'}`;
      }
    } finally {
      setRunningAction(null);
    }
  }, [runCommand, host, refreshSite]);

  // Құрал нәтижелерін Бүркітке жіберіп, жұмысты жалғастыру (агент циклі)
  const respondRef = useRef<((thread: BurkitMessage[], file: VirtualFile | null, resume?: BurkitMessage, step?: number) => void) | null>(null);
  const continueWith = useCallback((base: BurkitMessage[], feedback: string[], file: VirtualFile | null, step: number) => {
    dirtyRef.current = true;
    if (step > MAX_AUTO_STEPS) {
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: 'assistant',
        content: '⚠️ Бүркіт қатарынан тым көп қадам жасады. Жалғастыру үшін хабар жазыңыз.',
        timestamp: new Date().toISOString(),
        error: true,
      }]);
      return;
    }
    const toolMsg: BurkitMessage = {
      id: generateId(),
      role: 'user',
      tool: true,
      content: `${TOOL_PREFIX}\n\n${feedback.join('\n\n')}`,
      timestamp: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, toolMsg]);
    respondRef.current?.([...base, toolMsg], file, undefined, step);
  }, []);

  // Хабарлар + тіркемелер (жалпы көлем шегіне дейін, жаңалары бірінші)
  const withFiles = (list: BurkitMessage[]) => {
    const files = budgetFiles(list.map((m) => filesRef.current.get(m.id) ?? []));
    return list.map((m, i) => ({
      role: m.role,
      content: m.content || 'Тіркелген файлдарды қара.',
      ...(files[i].length > 0 && { files: files[i] }),
    }));
  };

  // Бүркіттен жауап: мәтін бөлік-бөлік келіп, бір хабарға жиналады
  // resume — үзілген жауап: жаңа мәтін соның соңына жалғанады; step — агент циклінің қадамы
  const respond = useCallback(async (thread: BurkitMessage[], file: VirtualFile | null, resume?: BurkitMessage, step = 0) => {
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
    // Келесі қадамда Бүркітке баратын нәтижелер (read, run, сәтсіз өзгерістер)
    const feedback: string[] = [];
    const lastUserText = [...thread].reverse().find((m) => m.role === 'user' && !m.tool)?.content ?? '';
    const mentions = project ? parseMentions(lastUserText, project.files.map((f) => f.path)) : [];
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

    // Жабылған блоктарды бірден орындау (Cursor сияқты — жауап аяқталуын күтпей); read/run — соңында
    const applyBlocks = () => {
      if (!agent || projectRef.current?.id !== project?.id) return;
      const blocks = extractCodeBlocks(full);
      for (; applied < blocks.length; applied++) {
        const { action, raw } = blocks[applied];
        if (!action) continue;
        if (action.kind === 'write') {
          const { created } = edits.applyEdit(action.path, raw);
          addEdit({ kind: 'file', path: action.path, created });
        } else if (action.kind === 'edit') {
          const current = edits.readFile(action.path);
          if (current === null) {
            addEdit({ kind: 'file', path: action.path, created: false, error: 'файл жоқ' });
            feedback.push(`edit=${action.path}: мұндай файл жоқ. Жаңа файлды path= блогымен жаса.`);
            continue;
          }
          const result = applySearchReplace(current, raw);
          if (result.applied > 0) {
            const { created } = edits.applyEdit(action.path, result.content);
            addEdit({ kind: 'file', path: action.path, created });
          }
          if (result.failed.length > 0) {
            if (result.applied === 0) addEdit({ kind: 'file', path: action.path, created: false, error: 'табылмады' });
            feedback.push(
              `edit=${action.path}: ${result.failed.length} SEARCH бөлігі файлдан табылмады (қалғаны орындалды):\n` +
              result.failed.map((s) => `~~~\n${s}\n~~~`).join('\n') +
              '\nФайлдың қазіргі мәтінін read арқылы оқып, дәл мәтінмен қайтала.'
            );
          }
        } else if (action.kind === 'delete') {
          const removed = edits.applyDelete(action.path);
          if (removed.length > 0) addEdit({ kind: 'file', path: action.path, created: false, action: 'delete' });
          else feedback.push(`delete ${action.path}: мұндай файл немесе папка жоқ.`);
        } else if (action.kind === 'move') {
          const moved = edits.applyMove(action.from, action.to);
          if (moved > 0) addEdit({ kind: 'file', path: action.to, from: action.from, created: false, action: 'move' });
          else feedback.push(`move ${action.from} → ${action.to}: орындалмады (бастапқы жол жоқ немесе жаңа жол бос емес).`);
        } else if (action.kind === 'note') {
          const title = action.title;
          edits.applyNote(title, raw)
            .then(({ noteId, created }) => {
              addEdit({ kind: 'note', path: title, created, noteId });
              refreshNotes();
            })
            .catch((e) => addEdit({ kind: 'note', path: title, created: false, error: e instanceof Error ? e.message : 'қате' }));
        }
      }
    };

    let next: BurkitMessage[] | null = null;
    try {
      await apiService.streamBurkitChat(
        {
          messages: [
            ...withFiles(thread.filter((m) => !m.error).slice(-MAX_HISTORY)),
            ...(resume ? [{ role: 'user' as const, content: CONTINUE_PROMPT }] : []),
          ],
          fileName: file?.path,
          fileContent: file?.content.slice(0, MAX_FILE_CHARS),
          mode: agent ? 'agent' : 'ask',
          uiLanguage: uiLanguageOf(i18n.language),
          workspace: { ...getWorkspaceSnapshot(), openFiles: openFilesRef.current.slice(0, 200).map((f) => f.path) },
          // Жобалар тізімі әрқашан ең соңғы күйден (жоба жасалып/өшіп жатуы мүмкін)
          ...(siteContext && {
            site: {
              ...siteContext,
              projects: projectsRef.current.slice(0, 100).map((p) => ({ name: p.name, current: p.id === project?.id || undefined })),
            },
          }),
          ...(project && {
            projectId: project.id,
            projectName: project.name,
            projectFiles: projectContext(project.files, file?.path, mentions),
            mentions,
          }),
        },
        (chunk) => {
          full += chunk;
          write(chunk);
          applyBlocks();
        },
        controller.signal
      );

      // Жауап аяқталды: файлдарды оқу және командалар
      const blocks = extractCodeBlocks(full);
      if (project && projectRef.current?.id === project.id) {
        blocks.forEach(({ action }) => {
          if (action?.kind !== 'read') return;
          const content = edits.readFile(action.path);
          feedback.push(content === null
            ? `read ${action.path}: мұндай файл жоқ.`
            : `Файл ${action.path}:\n\`\`\`\n${content.length > MAX_READ_CHARS ? `${content.slice(0, MAX_READ_CHARS)}\n…(қысқартылды)` : content}\n\`\`\``);
        });
      }
      // Командалар мен жоба әрекеттері — ретімен; растау керектері қолданушыны күтеді
      const done = resume?.ran ?? [];
      let held = false;
      for (let i = 0; i < blocks.length; i++) {
        const { action } = blocks[i];
        if (done.includes(i) || !isActionBlock(blocks[i], agent)) continue;
        if (controller.signal.aborted) break;
        if (action?.kind === 'run' && projectRef.current?.id !== project?.id) break;
        if (needsApproval(action, autoRun, agent)) {
          held = true;
          continue;
        }
        feedback.push(await executeBlock(blocks[i], controller.signal, replyId, i));
        markRan(replyId, i);
      }
      // Қолданушы «Іске қосу» басқанша нәтижелер күтіп тұрады
      if (held) heldRef.current.set(replyId, feedback.splice(0));
      dirtyRef.current = true;
      setMessages(clearPending);
      if (feedback.length > 0 && !controller.signal.aborted) {
        const reply: BurkitMessage = { id: replyId, role: 'assistant', content: full, timestamp: new Date().toISOString() };
        next = resume ? thread.map((m) => (m.id === replyId ? reply : m)) : [...thread, reply];
      }
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
    if (next) continueWith(next, feedback, file, step + 1);
  }, [t, i18n, mode, edits, refreshNotes, autoRun, executeBlock, markRan, continueWith, siteContext]);
  respondRef.current = respond;

  // run / project блогы: «Іске қосу» / «Өткізу». Жауаптың барлық әрекеті қаралғанда нәтижелер Бүркітке барады
  const handleRunBlock = useCallback(async (msg: BurkitMessage, index: number, skip: boolean) => {
    if (isLoading) return;
    const blocks = extractCodeBlocks(msg.content);
    const block = blocks[index];
    if (!block) return;
    const held = heldRef.current.get(msg.id) ?? [];
    heldRef.current.set(msg.id, held);
    markRan(msg.id, index);
    if (!skip) {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      try {
        held.push(await executeBlock(block, controller.signal, msg.id, index));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsLoading(false);
        }
      }
      if (controller.signal.aborted) return;
    }
    const handled = new Set([...(msg.ran ?? []), index]);
    if (blocks.some((b, i) => isActionBlock(b, mode === 'agent') && !handled.has(i))) return;
    heldRef.current.delete(msg.id);
    if (held.length > 0) continueWith(messagesRef.current, held, contextFile, 1);
  }, [isLoading, markRan, executeBlock, continueWith, contextFile, mode]);

  // Кәдімгі shell блогын терминалға жіберу (нәтижесі Бүркітке бармайды)
  const handleSendToTerminal = useCallback(async (command: string) => {
    const project = projectRef.current;
    if (!project) return;
    await flushProjects().catch(() => {});
    dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: true });
    runInTerminal(project.id, command).catch(() => {});
  }, [dispatch, flushProjects]);

  const sendMessage = useCallback((text: string, files: Attachment[] = []) => {
    const content = text.trim();
    if ((!content && files.length === 0) || isLoading) return;
    if (!conversationId) setConversationId(generateId());
    dirtyRef.current = true;
    heldRef.current.clear();
    const id = generateId();
    if (files.length > 0) filesRef.current.set(id, files);
    const thread: BurkitMessage[] = [
      ...messages,
      {
        id,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        context: contextFile?.name,
        pending: true,
        ...(files.length > 0 && {
          attachments: files.map((a) => ({ kind: a.kind, name: a.name, ...(a.count && { count: a.count }) })),
        }),
      },
    ];
    setMessages(thread);
    setInputValue('');
    setCaret(0);
    respond(thread, contextFile);
  }, [isLoading, conversationId, messages, contextFile, respond]);

  useEffect(() => {
    const grab = () => {
      const q = takeBurkitQuestion();
      if (q) setIncoming(q);
    };
    grab(); // панель сұрақпен бірге ашылған болса
    window.addEventListener(BURKIT_ASK_EVENT, grab);
    return () => window.removeEventListener(BURKIT_ASK_EVENT, grab);
  }, []);

  useEffect(() => {
    if (!incoming || isLoading || !statusChecked) return;
    setIncoming(null);
    setView('chat');
    // Кілт жоқ болса — сұрақ енгізу өрісінде күтіп тұрады
    if (needsKey) setInputValue(incoming);
    else sendMessage(incoming);
  }, [incoming, isLoading, statusChecked, needsKey, sendMessage]);

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

  // @ тізімінен таңдау: курсорға дейінгі «@сөз» толық жолмен ауысады
  const pickMention = (candidate: { path: string; folder: boolean }) => {
    const before = inputValue.slice(0, caret).replace(/@([^\s@]*)$/, `@${candidate.path}${candidate.folder ? '/' : ''} `);
    setInputValue(before + inputValue.slice(caret));
    setCaret(before.length);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setMentionIndex((i) => (i + step + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(mentionMatches[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCaret(-1); // тізім жабылады (келесі теруге дейін)
        return;
      }
    }
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
      submit();
    }
  };

  // Мәтін + тіркемелер бірге жіберіледі
  const submit = () => {
    if (isLoading || attach.busy || (!inputValue.trim() && attach.attached.length === 0)) return;
    sendMessage(inputValue, attach.attached);
    attach.clear();
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

  // Әрекет блогының күйі: орындалып жатыр / қаралды / «Өткізу · Іске қосу» батырмалары
  const renderActionState = (msg: BurkitMessage, idx: number, canAct: boolean, runLabel: string) => (
    <div className="vx-ai__run">
      {runningAction === `${msg.id}:${idx}` ? (
        <span className="vx-ai__run-state">
          <span className="vx-ai__dots"><span /><span /><span /></span>
          Орындалып жатыр…
        </span>
      ) : msg.ran?.includes(idx) ? (
        <span className="vx-ai__run-state is-done">
          <CheckIcon size={11} />
          Қаралды
        </span>
      ) : canAct && !isLoading ? (
        <>
          <button type="button" className="vx-ai__run-btn" onClick={() => handleRunBlock(msg, idx, true)}>
            Өткізу
          </button>
          <button type="button" className="vx-ai__run-btn is-primary" onClick={() => handleRunBlock(msg, idx, false)}>
            <PlayIcon size={11} />
            {runLabel}
          </button>
        </>
      ) : (
        <span className="vx-ai__run-state">Орындалмаған</span>
      )}
    </div>
  );

  // Сайттағы жоба әрекеті (жариялау, бөлісу, жіберу…) — сипаттамасы, сілтемесі, растау батырмалары
  const renderProjectAction = (
    msg: BurkitMessage,
    idx: number,
    action: Extract<BlockAction, { kind: 'project' }>,
    note: string,
    isLast: boolean
  ) => {
    const key = `${msg.id}:${idx}`;
    const link = actionLinks[key];
    const danger = ALWAYS_CONFIRM_OPS.has(action.op);
    return (
      <div key={`code-${idx}`} className={`vx-ai__code vx-ai__code--target vx-ai__code--project ${danger ? 'is-danger' : ''}`}>
        <div className="vx-ai__code-bar">
          <span className="vx-ai__code-lang">
            {action.op === 'delete' || action.op === 'unpublish' ? <TrashIcon size={14} /> : <FolderIcon size={14} />}
            {describeProjectAction(action)}
          </span>
        </div>
        {note && <p className="vx-ai__project-note">{note}</p>}
        {link && (
          <div className="vx-ai__project-link">
            <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
            <button
              type="button"
              className={`vx-icon-btn vx-icon-btn--xs ${copiedId === key ? 'is-done' : ''}`}
              onClick={() => copyText(link).then(() => markCopied(key))}
              title="Сілтемені көшіру"
            >
              {copiedId === key ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          </div>
        )}
        {renderActionState(msg, idx, isLast, danger ? 'Растау' : 'Орындау')}
      </div>
    );
  };

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
    const writing = inCodeBlock && isLoading && msg.id === lastAssistantId ? parseFence(openFence).action : undefined;
    const writingTarget = actionLabel(writing);

    if (msg.role === 'assistant') {
      const isLast = msg.id === lastAssistantId;
      extractCodeBlocks(msg.content).forEach((block, idx) => {
        const blockId = `${msg.id}-code-${idx}`;
        const copied = copiedId === blockId;
        const ext = LANG_EXT[block.language.toLowerCase()] ?? 'txt';
        const { action } = block;
        const target = actionLabel(action);
        if (action?.kind === 'project') {
          elements.push(renderProjectAction(msg, idx, action, block.code, isLast));
          return;
        }
        const isRun = action?.kind === 'run';
        // Құрал блоктары (delete/move/read) — мәтінсіз, бір жол
        const compact = action?.kind === 'delete' || action?.kind === 'move' || action?.kind === 'read';
        const shell = !action && SHELL_LANGS.has(block.language.toLowerCase());
        const icon = action?.kind === 'note' ? <span aria-hidden="true">📓</span>
          : isRun || shell ? <TerminalIcon size={14} />
          : action?.kind === 'delete' ? <TrashIcon size={14} />
          : action?.kind === 'read' ? <SearchIcon size={14} />
          : <FileTypeIcon name={action?.kind === 'write' || action?.kind === 'edit' ? action.path : action?.kind === 'move' ? action.to : `x.${ext}`} size={15} />;
        const label = isRun ? 'Терминал'
          : action?.kind === 'delete' ? `Өшіру: ${action.path}`
          : action?.kind === 'move' ? `Жылжыту: ${action.from} → ${action.to}`
          : action?.kind === 'read' ? `Оқу: ${action.path}`
          : action?.kind === 'edit' ? `${action.path} · өңдеу`
          : target ?? block.language;
        elements.push(
          <div
            key={`code-${idx}`}
            className={`vx-ai__code ${action ? 'vx-ai__code--target' : ''} ${compact ? 'vx-ai__code--compact' : ''} ${isRun ? 'vx-ai__code--run' : ''}`}
          >
            <div className="vx-ai__code-bar">
              <span className="vx-ai__code-lang">
                {icon}
                {label}
              </span>
              <div className="vx-ai__code-actions">
                {!compact && (
                  <button
                    type="button"
                    onClick={() => copyText(block.code).then(() => markCopied(blockId))}
                    className={`vx-icon-btn vx-icon-btn--xs ${copied ? 'is-done' : ''}`}
                    title={copied ? t('vibecoding.chat.copied') : t('vibecoding.chat.copyCode')}
                  >
                    {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  </button>
                )}
                {shell && activeProject && (
                  <button
                    type="button"
                    onClick={() => handleSendToTerminal(block.code)}
                    className="vx-icon-btn vx-icon-btn--xs"
                    title="Терминалда іске қосу"
                  >
                    <PlayIcon size={12} />
                  </button>
                )}
                {activeFile && !action && (
                  <button
                    type="button"
                    onClick={() => handleInsertCode(block.code)}
                    className="vx-icon-btn vx-icon-btn--xs"
                    title={`${t('vibecoding.chat.insertCode')} — ${activeFile.name}`}
                  >
                    <InsertIcon size={13} />
                  </button>
                )}
                {!action && (
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
            {!compact && (
              <pre>
                <code>{isRun ? `$ ${block.code}` : block.code}</code>
              </pre>
            )}
            {isRun && renderActionState(msg, idx, isLast && mode === 'agent', 'Іске қосу')}
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
    const stats = filePending && file && !filePending.deleted ? lineStats(filePending.original, file.content) : null;
    if (edit.error) {
      return (
        <div key={key} className="vx-ai__edit is-failed">
          <span className="vx-ai__edit-name">
            {isNote ? <span aria-hidden="true">📓</span> : <FileTypeIcon name={edit.path} size={13} />}
            {edit.path}
          </span>
          <span className="vx-ai__edit-tag is-error">{edit.error}</span>
        </div>
      );
    }
    return (
      <div key={key} className={`vx-ai__edit ${pending ? 'is-pending' : ''} ${edit.action === 'delete' ? 'is-deleted' : ''}`}>
        {edit.action === 'delete' ? (
          <span className="vx-ai__edit-name">
            <TrashIcon size={13} />
            {edit.path}
          </span>
        ) : isNote ? (
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
        {edit.action === 'delete' && <span className="vx-ai__edit-tag is-error">өшірілді</span>}
        {edit.action === 'move' && edit.from && <span className="vx-ai__edit-tag" title={`Бұрынғы жолы: ${edit.from}`}>← {edit.from}</span>}
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
          <BurkitKeyCard
            cls="vx-ai"
            closeClassName="vx-icon-btn vx-icon-btn--xs"
            closeIcon={<CloseIcon size={12} />}
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
              <BurkitLogo size={50} />
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
              <BurkitKeyCard cls="vx-ai" status={status} onChange={setStatus} />
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
            {messages.map((msg) => (msg.tool ? (
              // Құрал нәтижесі (read/run) — Бүркітке барған мәтін, ықшам күйде
              <details key={msg.id} className="vx-ai__tool">
                <summary>
                  <TerminalIcon size={12} />
                  <span>{toolSummary(msg.content)}</span>
                  <ChevronIcon size={11} />
                </summary>
                <pre className="ide-scrollbar">{msg.content.slice(TOOL_PREFIX.length).trim()}</pre>
              </details>
            ) : (
              <div key={msg.id} className={`vx-ai__msg vx-ai__msg--${msg.role} ${msg.error ? 'is-error' : ''}`}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="vx-ai__atts">
                    {msg.attachments.map((a, i) => {
                      const live = filesRef.current.get(msg.id)?.[i];
                      return <BurkitAttachmentChip key={i} cls="vx-ai" item={live ?? { ...a, id: String(i), files: [] }} />;
                    })}
                  </div>
                )}
                {msg.content && (
                  <div className="vx-ai__content">
                    <div className="vx-ai__text">{renderMessageContent(msg)}</div>
                  </div>
                )}
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
            )))}

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
                renderEditRow({
                  kind: 'file',
                  path: p.path,
                  created: p.original === null,
                  ...(p.deleted ? { action: 'delete' as const } : p.movedFrom ? { action: 'move' as const, from: p.movedFrom } : {}),
                }, `rf-${p.path}`)
              )}
              {edits.pendingNotes.map((n) =>
                renderEditRow({ kind: 'note', path: n.title, created: n.previous === null, noteId: n.noteId }, `rn-${n.noteId}`)
              )}
            </div>
          </div>
        )}
        {mentionMatches.length > 0 && (
          <div className="vx-ai__slash" role="listbox" aria-label="Файлды атап өту">
            {mentionMatches.map((c, i) => (
              <button
                key={`${c.folder ? 'd' : 'f'}-${c.path}`}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                className={`vx-ai__slash-item ${i === mentionIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setMentionIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(c)}
              >
                <span className="vx-ai__chip-icon">
                  {c.folder ? <FolderIcon size={14} /> : <FileTypeIcon name={c.path} size={14} />}
                </span>
                <b>{c.path.split('/').pop()}{c.folder ? '/' : ''}</b>
                <span>{c.path}</span>
              </button>
            ))}
          </div>
        )}
        {mentionMatches.length === 0 && slashMatches.length > 0 && (
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
            if (!(e.target as HTMLElement).closest('textarea, button, input')) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
          onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => {
            if (e.dataTransfer.files.length === 0) return;
            e.preventDefault();
            void attach.add(Array.from(e.dataTransfer.files));
          }}
        >
          {(attach.attached.length > 0 || attach.busy || attach.error) && (
            <div className="vx-ai__atts vx-ai__atts--draft">
              {attach.attached.map((a) => (
                <BurkitAttachmentChip key={a.id} cls="vx-ai" item={a} onRemove={() => attach.remove(a.id)} />
              ))}
              {attach.busy && <span className="vx-ai__att is-loading">Оқылып жатыр…</span>}
              {attach.error && <span className="vx-ai__att-error">{attach.error}</span>}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onBlur={() => setCaret(-1)}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              // Көшірілген суретті (скриншот) тікелей қоюға болады
              if (e.clipboardData.files.length === 0) return;
              e.preventDefault();
              void attach.add(Array.from(e.clipboardData.files));
            }}
            placeholder="Жазу"
            rows={1}
            className="vx-ai__input"
            aria-label="Бүркіт"
          />
          <div className="vx-ai__box-foot">
            <div className="vx-ai__foot-left">
            <BurkitAttachButton
              cls="vx-ai"
              iconSize={15}
              disabled={attach.busy}
              onFiles={(files, folder) => void attach.add(files, folder)}
            />
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
                onClick={submit}
                disabled={(!inputValue.trim() && attach.attached.length === 0) || attach.busy}
                className="vx-ai__send"
                title={t('vibecoding.chat.send')}
              >
                <ArrowUpIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
