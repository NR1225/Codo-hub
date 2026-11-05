import { useSyncExternalStore } from 'react';

/* Vibecoding бетін басқару орталығы (React-тен тыс):
   • «Іске қосу» күйі — тулбардағы батырма, көрініс панелі және Codo бірдей көреді;
   • көрініс (preview) контроллері — Codo `ui` блоктары арқылы бетті қайта жүктейді,
     консольді оқиды, JS орындайды, беттер мен экран өлшемін ауыстырады. */

// ── Іске қосу күйі ──

export type RunPhase = 'idle' | 'planning' | 'starting' | 'running' | 'error';
export type RunKind = 'web' | 'server' | 'console';

export interface RunState {
  phase: RunPhase;
  kind: RunKind | null;
  projectId: string | null;
  command: string | null;
  framework: string | null;
  url: string | null;
  error: string | null;
  startedAt: number | null;
}

const IDLE: RunState = {
  phase: 'idle', kind: null, projectId: null, command: null, framework: null, url: null, error: null, startedAt: null,
};

let runState: RunState = IDLE;
const runListeners = new Set<() => void>();

export function getRunState(): RunState {
  return runState;
}

export function setRunState(patch: Partial<RunState> | ((prev: RunState) => Partial<RunState>)): void {
  const next = { ...runState, ...(typeof patch === 'function' ? patch(runState) : patch) };
  if ((Object.keys(next) as (keyof RunState)[]).every(k => next[k] === runState[k])) return;
  runState = next;
  runListeners.forEach(l => l());
}

export function resetRunState(): void {
  setRunState(IDLE);
}

export function subscribeRunState(listener: () => void): () => void {
  runListeners.add(listener);
  return () => { runListeners.delete(listener); };
}

export function useRunState(): RunState {
  return useSyncExternalStore(subscribeRunState, getRunState, getRunState);
}

// ── Көрініс панелі ашық па (тулбардағы белгіше үшін) ──

let previewOpen = false;

export function setPreviewOpenState(open: boolean): void {
  if (open === previewOpen) return;
  previewOpen = open;
}

export function getPreviewOpen(): boolean {
  return previewOpen;
}

// ── Бет оқиғалары (IDELayout тыңдайды) ──

export const VIBE_EVENTS = {
  run: 'vibecoding:run',
  stop: 'vibecoding:stop',
  openPreview: 'vibecoding:open-preview',
  closePreview: 'vibecoding:close-preview',
  togglePreview: 'vibecoding:toggle-preview',
  maximizePreview: 'vibecoding:maximize-preview',
} as const;

export function emitVibe(name: keyof typeof VIBE_EVENTS, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(VIBE_EVENTS[name], { detail }));
}

// ── Көрініс панелі ──

export interface PreviewEvalResult {
  ok: boolean;
  text: string;
}

export interface PreviewController {
  /** Қазір не көрсетіліп тұр: файл / сервер адресі / экран өлшемі */
  describe: () => string;
  /** Беттегі JS-ті орындау (нәтижесін күтеді). quiet — консольде көрсетпей */
  evaluate: (code: string, timeoutMs?: number, quiet?: boolean) => Promise<PreviewEvalResult>;
  reload: () => void;
  /** Консоль жолдары (ескісінен жаңасына) */
  consoleLines: (limit?: number) => string[];
  /** Сәтсіз / баяу желі сұраулары */
  networkIssues: (limit?: number) => string[];
  /** Жоба ішіндегі басқа HTML бетке өту (тек статикалық режимде) */
  navigate: (path: string) => boolean;
  setDevice: (id: string) => boolean;
  devices: () => string[];
  clearConsole: () => void;
  /** Консольдегі соңғы жол нөмірі — «осыдан кейінгі жолдар» үшін */
  consoleMark: () => number;
  consoleSince: (mark: number) => string[];
}

let previewController: PreviewController | null = null;
const previewListeners = new Set<() => void>();

export function registerPreview(controller: PreviewController): () => void {
  previewController = controller;
  previewListeners.forEach(l => l());
  return () => {
    if (previewController === controller) {
      previewController = null;
      previewListeners.forEach(l => l());
    }
  };
}

export function getPreview(): PreviewController | null {
  return previewController;
}

/** Көрініс панелі ашылып, контроллері тіркелгенше күту */
export function waitForPreview(timeoutMs: number): Promise<PreviewController | null> {
  if (previewController) return Promise.resolve(previewController);
  return new Promise(resolve => {
    const finish = () => {
      window.clearTimeout(timer);
      previewListeners.delete(onChange);
      resolve(previewController);
    };
    const onChange = () => { if (previewController) finish(); };
    const timer = window.setTimeout(finish, timeoutMs);
    previewListeners.add(onChange);
  });
}

export const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));
