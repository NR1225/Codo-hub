// Vibecoding панельдері арасындағы көпір (терминал → Бүркіт, терминал → редактор).
// Қабылдаушы панель әлі ашылмаған болуы мүмкін, сондықтан сұраныс модульде
// күтіп тұрады: панель ашылғанда (mount) немесе оқиға келгенде өзі алады.

export const BURKIT_ASK_EVENT = 'vibecoding:burkit-ask';
export const EDITOR_REVEAL_EVENT = 'vibecoding:editor-reveal';

let pendingQuestion: string | null = null;

/** Бүркітке сұрақ жіберу (чат панелі ашылғанда автоматты түрде жіберіледі) */
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

// ── Бүркіт → терминал: команданы жобаның терминалында орындау ──

export const TERMINAL_RUN_EVENT = 'vibecoding:terminal-run';

export interface TerminalRunRequest {
  projectId: string;
  command: string;
  /** Команда терминалға жіберілгенде шақырылады */
  resolve: () => void;
  reject: (error: Error) => void;
}

let pendingRuns: TerminalRunRequest[] = [];

/** Команданы терминал панеліне жіберу (панель әлі ашылмаса — ашылғанда орындалады) */
export function runInTerminal(projectId: string, command: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const req: TerminalRunRequest = { projectId, command, resolve: () => {}, reject: () => {} };
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

/** Күтіп тұрған командалар (терминал панелі өзі орындайды) */
export function peekTerminalRuns(): TerminalRunRequest[] {
  return pendingRuns;
}

export function takeTerminalRun(req: TerminalRunRequest): void {
  pendingRuns = pendingRuns.filter((r) => r !== req);
}
