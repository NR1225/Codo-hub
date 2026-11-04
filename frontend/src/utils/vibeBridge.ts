// Vibecoding панельдері арасындағы көпір (терминал → Codo, терминал → редактор).
// Қабылдаушы панель әлі ашылмаған болуы мүмкін, сондықтан сұраныс модульде
// күтіп тұрады: панель ашылғанда (mount) немесе оқиға келгенде өзі алады.

export const BURKIT_ASK_EVENT = 'vibecoding:burkit-ask';
export const EDITOR_REVEAL_EVENT = 'vibecoding:editor-reveal';

let pendingQuestion: string | null = null;

/** Codo-ға сұрақ жіберу (чат панелі ашылғанда автоматты түрде жіберіледі) */
export function askBurkit(text: string): void {
  pendingQuestion = text;
  window.dispatchEvent(new CustomEvent(BURKIT_ASK_EVENT));
}

export function takeBurkitQuestion(): string | null {
  const q = pendingQuestion;
  pendingQuestion = null;
  return q;
}

export interface RevealRequest {
  path: string;
  line: number;
  column: number;
}

let pendingReveal: RevealRequest | null = null;

/** Редакторда файлдың жолына секіру (файлды ашу — OPEN_PROJECT_FILE арқылы бөлек) */
export function requestReveal(req: RevealRequest): void {
  pendingReveal = req;
  window.dispatchEvent(new CustomEvent(EDITOR_REVEAL_EVENT));
}

/** Редактордағы ағымдағы файл сұралған файл болса ғана алынады */
export function takeReveal(path: string): RevealRequest | null {
  if (!pendingReveal || pendingReveal.path !== path) return null;
  const req = pendingReveal;
  pendingReveal = null;
  return req;
}

// ── Codo → терминал: команданы жобаның терминалында орындау ──

export const TERMINAL_RUN_EVENT = 'vibecoding:terminal-run';

export interface TerminalRunRequest {
  projectId: string;
  command: string;
  /** «run» — «Іске қосу» батырмасының бөлек табы: ондағы алдыңғы процесс (сервер) Ctrl+C-мен
      тоқтатылып, команда сонда қайта орындалады. Әйтпесе — бос (run емес) табта. */
  role?: 'run';
  /** Команда терминалға жіберілгенде шақырылады */
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface RunInTerminalOptions {
  role?: 'run';
  timeoutMs?: number;
}

let pendingRuns: TerminalRunRequest[] = [];

/** Команданы терминал панеліне жіберу (панель әлі ашылмаса — ашылғанда орындалады) */
export function runInTerminal(projectId: string, command: string, opts: RunInTerminalOptions = {}): Promise<void> {
  const { role, timeoutMs = 30_000 } = opts;
  return new Promise((resolve, reject) => {
    // «Іске қосу» қайта басылса — кезектегі ескі іске қосу командасы ауыстырылады
    if (role) {
      pendingRuns.filter((r) => r.role === role && r.projectId === projectId)
        .forEach((r) => r.reject(new Error('Жаңа іске қосумен ауыстырылды')));
      pendingRuns = pendingRuns.filter((r) => !(r.role === role && r.projectId === projectId));
    }
    const req: TerminalRunRequest = { projectId, command, role, resolve: () => {}, reject: () => {} };
    const timer = window.setTimeout(() => {
      pendingRuns = pendingRuns.filter((r) => r !== req);
      reject(new Error('Терминал қосылмады'));
    }, timeoutMs);
    req.resolve = () => { window.clearTimeout(timer); resolve(); };
    req.reject = (e) => { window.clearTimeout(timer); reject(e); };
    pendingRuns.push(req);
    window.dispatchEvent(new CustomEvent(TERMINAL_RUN_EVENT));
  });
}

/** «Іске қосу» табындағы процесті (dev-сервер, скрипт) тоқтату — Ctrl+C */
export const TERMINAL_STOP_EVENT = 'vibecoding:terminal-stop';
export function stopTerminalRun(projectId: string): void {
  window.dispatchEvent(new CustomEvent<{ projectId: string }>(TERMINAL_STOP_EVENT, { detail: { projectId } }));
}

/** Күтіп тұрған командалар (терминал панелі өзі орындайды) */
export function peekTerminalRuns(): TerminalRunRequest[] {
  return pendingRuns;
}

export function takeTerminalRun(req: TerminalRunRequest): void {
  pendingRuns = pendingRuns.filter((r) => r !== req);
}
