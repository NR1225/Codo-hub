/* Vibecoding бетінде не болып жатқанын жинайтын жеңіл жад (React-тен тыс).
   Бүркіт әр сұрауда осының суретін (snapshot) алады: соңғы оқиғалар, терминал шығысы,
   алдын ала көріністің консолі, редактордағы курсор/белгіленген мәтін және қателер. */

export interface WorkspaceSnapshot {
  events: string[];
  terminal?: string;
  terminalConnected: boolean;
  preview?: string;
  previewConsole: string[];
  editor?: { path: string; line: number; column: number; selection?: string };
  problems: string[];
}

const MAX_EVENTS = 60;
const MAX_TERMINAL_CHARS = 12_000;
const MAX_CONSOLE_LINES = 150;
const MAX_LINE_CHARS = 2_000;
const MAX_SELECTION_CHARS = 8_000;

interface ActivityEvent {
  at: number;
  text: string;
  /** Бірдей кілтті қатарлас оқиғалар біріктіріледі (мысалы, бір файлды теру) */
  key?: string;
  count: number;
}

const events: ActivityEvent[] = [];
let terminal = '';
const terminalSessions = new Set<string>(); // қосулы терминал табтары
let terminalInput = '';
let preview: string | null = null;
let previewConsole: string[] = [];
let editor: WorkspaceSnapshot['editor'];
let problems: string[] = [];

const clip = (text: string, max = MAX_LINE_CHARS) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function logEvent(text: string, key?: string) {
  const last = events[events.length - 1];
  if (key && last?.key === key) {
    last.at = Date.now();
    last.count += 1;
    return;
  }
  events.push({ at: Date.now(), text: clip(text, 500), key, count: 1 });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

// ── Терминал ──
// ANSI түс/курсор кодтары мен \r-ді алып тастаймыз — Бүркітке тек мәтін керек
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function appendTerminalOutput(data: string) {
  // Жалғыз \r жолды басынан қайта жазады (прогресс-бар т.б.) — тек соңғы нұсқасы қалады
  terminal = (terminal + data.replace(ANSI, ''))
    .replace(/\r\n/g, '\n')
    .replace(/[^\n]*\r(?!\n|$)/g, '');
  if (terminal.length > MAX_TERMINAL_CHARS) terminal = terminal.slice(-MAX_TERMINAL_CHARS);
}

/** Пернелерден команданы жинау: Enter басылғанда оқиға ретінде жазылады */
export function trackTerminalInput(data: string) {
  if (data.startsWith('\x1b')) return; // көрсеткі пернелер т.б.
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      const cmd = terminalInput.trim();
      terminalInput = '';
      if (cmd) logEvent(`Терминалда команда: ${cmd}`);
    } else if (ch === '\x7f' || ch === '\b') {
      terminalInput = terminalInput.slice(0, -1);
    } else if (ch === '\x03') {
      terminalInput = '';
      logEvent('Терминалда Ctrl+C (тоқтату)');
    } else if (ch >= ' ') {
      terminalInput += ch;
    }
  }
}

export function setTerminalConnected(tabId: string, connected: boolean) {
  if (connected === terminalSessions.has(tabId)) return;
  if (connected) terminalSessions.add(tabId);
  else terminalSessions.delete(tabId);
  logEvent(connected ? 'Терминал қосылды' : 'Терминал ажыратылды');
}

// ── Алдын ала көрініс ──
export function setPreview(entry: string | null) {
  if (entry === preview) return;
  preview = entry;
  logEvent(entry ? `Жоба іске қосылды (алдын ала көрініс): ${entry}` : 'Алдын ала көрініс жабылды');
}

export function clearPreviewConsole() {
  previewConsole = [];
}

export function pushPreviewConsole(level: string, text: string) {
  previewConsole.push(`[${level}] ${clip(text)}`);
  if (previewConsole.length > MAX_CONSOLE_LINES) previewConsole = previewConsole.slice(-MAX_CONSOLE_LINES);
  if (level === 'error') logEvent(`Консольде қате: ${clip(text, 300)}`, `console-error:${text}`);
}

// ── Редактор ──
export function setEditorState(state: WorkspaceSnapshot['editor']) {
  editor = state && { ...state, selection: state.selection ? clip(state.selection, MAX_SELECTION_CHARS) : undefined };
}

export function setProblems(list: string[]) {
  problems = list.slice(0, 100).map(p => clip(p, 500));
}

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s} с бұрын`;
  if (s < 3600) return `${Math.round(s / 60)} мин бұрын`;
  return `${Math.round(s / 3600)} сағ бұрын`;
}

export function getWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    events: events.map(e => `${ago(e.at)}: ${e.text}${e.count > 1 ? ` (×${e.count})` : ''}`),
    terminal: terminal.trim() ? terminal : undefined,
    terminalConnected: terminalSessions.size > 0,
    preview: preview ?? undefined,
    previewConsole: preview ? [...previewConsole] : [],
    editor,
    problems: [...problems],
  };
}
