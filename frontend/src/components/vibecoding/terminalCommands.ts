import type { Project } from '../../contexts/VibecodingContext';

export interface RunCommand {
  /** Мәзірде көрінетін аты */
  label: string;
  /** Shell-ге жіберілетін команда */
  cmd: string;
}

// package.json скрипттерінің ішінен алдымен көрсетілетіндері
const SCRIPT_ORDER = ['dev', 'start', 'serve', 'build', 'test', 'lint'];
const PY_ENTRIES = ['main.py', 'app.py', 'run.py', 'server.py', 'manage.py', 'bot.py'];
const NODE_ENTRIES = ['index.js', 'main.js', 'app.js', 'server.js', 'index.mjs'];

/** Жобаның түбірдегі файлдарына қарап, іске қосу командаларын ұсынамыз */
export function detectRunCommands(project: Project | null | undefined): RunCommand[] {
  if (!project) return [];
  const byPath = new Map(project.files.map(f => [f.path, f]));
  const root = project.files.filter(f => !f.path.includes('/'));
  const out: RunCommand[] = [];

  const pkg = byPath.get('package.json');
  if (pkg) {
    let scripts: Record<string, unknown> = {};
    try {
      scripts = JSON.parse(pkg.content)?.scripts ?? {};
    } catch { /* бұзылған package.json — тек npm install */ }
    const names = Object.keys(scripts).sort((a, b) => {
      const ia = SCRIPT_ORDER.indexOf(a);
      const ib = SCRIPT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const name of names.slice(0, 6)) {
      const cmd = name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`;
      out.push({ label: cmd, cmd });
    }
    out.push({ label: 'npm install', cmd: 'npm install' });
  } else {
    const node = NODE_ENTRIES.find(name => byPath.has(name));
    if (node) out.push({ label: `node ${node}`, cmd: `node ${node}` });
  }

  const pyRoot = root.filter(f => f.name.endsWith('.py'));
  const py = PY_ENTRIES.find(name => byPath.has(name)) ?? (pyRoot.length === 1 ? pyRoot[0].name : undefined);
  if (py) {
    const cmd = py === 'manage.py' ? 'python manage.py runserver' : `python ${py}`;
    out.push({ label: cmd, cmd });
  }
  if (byPath.has('requirements.txt')) {
    out.push({ label: 'pip install -r requirements.txt', cmd: 'pip install -r requirements.txt' });
  }

  if (byPath.has('go.mod') || byPath.has('main.go')) out.push({ label: 'go run .', cmd: 'go run .' });
  if (byPath.has('Cargo.toml')) out.push({ label: 'cargo run', cmd: 'cargo run' });

  const java = root.find(f => f.name === 'Main.java') ?? root.find(f => f.name.endsWith('.java'));
  if (java) {
    const cls = java.name.replace(/\.java$/, '');
    // «;» — bash-та да, PowerShell-де де жұмыс істейді
    out.push({ label: `java ${java.name}`, cmd: `javac ${java.name}; java ${cls}` });
  }

  const cpp = root.find(f => /\.(cpp|cc)$/.test(f.name));
  if (cpp) out.push({ label: `g++ ${cpp.name}`, cmd: `g++ ${cpp.name} -o main; ./main` });
  const c = root.find(f => f.name.endsWith('.c'));
  if (c && !cpp) out.push({ label: `gcc ${c.name}`, cmd: `gcc ${c.name} -o main; ./main` });

  return out;
}

// ─── Команда тарихы (әр жобаға бөлек, localStorage) ─────────────────

const HISTORY_KEY = 'vibe-terminal-history';
const HISTORY_MAX = 12;

function readAll(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function loadHistory(projectId: string | null): string[] {
  const list = readAll()[projectId ?? '~'];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

export function pushHistory(projectId: string | null, cmd: string): string[] {
  const all = readAll();
  const key = projectId ?? '~';
  const list = [cmd, ...(all[key] ?? []).filter(x => x !== cmd)].slice(0, HISTORY_MAX);
  all[key] = list;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch { /* жеке терезе */ }
  return list;
}

/**
 * Терминалдағы жол (абсолют, ./ немесе Windows жолы) → жобаның файлы.
 * Дәл сәйкестік болмаса, жолдың соңы файлдың толық жолымен сәйкес келуі керек.
 */
export function resolveProjectFile(project: Project | null | undefined, raw: string): string | null {
  if (!project) return null;
  const norm = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  let best: string | null = null;
  for (const f of project.files) {
    if (f.path === norm) return f.path;
    if (norm.endsWith(`/${f.path}`) && (!best || f.path.length > best.length)) best = f.path;
  }
  return best;
}
