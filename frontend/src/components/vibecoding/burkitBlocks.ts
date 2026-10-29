/* Бүркіт жауабындағы код блоктары — оның «құралдары» (Agent режимі):
   ```python path=a.py      — файлды толық жазу
   ```python edit=a.py      — SEARCH/REPLACE бөліктерімен ішінара өзгерту
   ```delete path=a.py      — файлды/папканы өшіру
   ```move from=a to=b      — жылжыту / атын өзгерту
   ```read path=a.py        — файлды оқу (мазмұны келесі хабарда Бүркітке барады)
   ```bash run              — терминалда команда орындау
   ```markdown note="Атау"  — жобаның Notes жазбасына жазу
   ```project send name=… to=… — сайттағы жобалармен әрекет (utils/burkitProjectTools.ts) */

export type ProjectOp =
  | 'list' | 'create' | 'delete' | 'switch' | 'publish' | 'unpublish'
  | 'share' | 'unshare' | 'send' | 'open' | 'fork';

const PROJECT_OPS: ProjectOp[] = ['list', 'create', 'delete', 'switch', 'publish', 'unpublish', 'share', 'unshare', 'send', 'open', 'fork'];

export type BlockAction =
  | { kind: 'write'; path: string }
  | { kind: 'edit'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'read'; path: string }
  | { kind: 'run' }
  | { kind: 'note'; title: string }
  | { kind: 'project'; op: ProjectOp; attrs: Record<string, string> };

export interface CodeBlock {
  language: string;
  /** Көрсетілетін мәтін (trim-мен) */
  code: string;
  /** Жазылатын толық мәтін (trim-сіз) */
  raw: string;
  action?: BlockAction;
}

// Жолды тазалау: «./», басындағы «/» алынады; «..» немесе бос бөлігі бар жол қабылданбайды
export function cleanPath(path?: string): string | undefined {
  const clean = path?.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (!clean || clean.split('/').some((part) => part === '..' || part === '' || part === '.')) return undefined;
  return clean;
}

const ATTR = /([\w-]+)=("[^"\n]*"|[^\s`]+)/g;

/** Блоктың бірінші жолы: ```тіл атрибуттар */
export function parseFence(line: string): { language: string; action?: BlockAction } {
  const m = /^```([\w+#.-]*)(.*)$/.exec(line);
  if (!m) return { language: 'plaintext' };
  const language = m[1] || 'plaintext';
  const rest = m[2];
  const attrs: Record<string, string> = {};
  for (const a of rest.matchAll(ATTR)) attrs[a[1].toLowerCase()] = a[2].replace(/^"|"$/g, '').trim();
  const flags = rest.replace(ATTR, ' ').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lang = language.toLowerCase();

  if (lang === 'project') {
    const op = (attrs.action ?? flags[0]) as ProjectOp | undefined;
    return { language, action: op && PROJECT_OPS.includes(op) ? { kind: 'project', op, attrs } : undefined };
  }
  const path = cleanPath(attrs.path);
  if (lang === 'delete') return { language, action: path ? { kind: 'delete', path } : undefined };
  if (lang === 'read') return { language, action: path ? { kind: 'read', path } : undefined };
  if (lang === 'move' || lang === 'rename') {
    const from = cleanPath(attrs.from);
    const to = cleanPath(attrs.to);
    return { language, action: from && to ? { kind: 'move', from, to } : undefined };
  }
  const edit = cleanPath(attrs.edit);
  if (edit) return { language, action: { kind: 'edit', path: edit } };
  if (path) return { language, action: { kind: 'write', path } };
  if (attrs.note) return { language, action: { kind: 'note', title: attrs.note } };
  if (flags.includes('run')) return { language, action: { kind: 'run' } };
  return { language };
}

export function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /^(```[^\n]*)\n([\s\S]*?)^```/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({ ...parseFence(match[1]), code: match[2].trim(), raw: match[2] });
  }
  return blocks;
}

/** Блоктың нысаны — чатта «Жазып жатыр: …» т.б. үшін */
export function actionLabel(action?: BlockAction): string | undefined {
  if (!action) return undefined;
  switch (action.kind) {
    case 'write':
    case 'edit':
      return action.path;
    case 'delete':
      return `🗑 ${action.path}`;
    case 'move':
      return `${action.from} → ${action.to}`;
    case 'read':
      return `👁 ${action.path}`;
    case 'note':
      return `📓 ${action.title}`;
    case 'run':
    case 'project':
      return undefined;
  }
}

// ── SEARCH/REPLACE ──

const HUNK = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;

export interface ReplaceResult {
  content: string;
  /** Табылмаған SEARCH бөліктері */
  failed: string[];
  applied: number;
}

// Жолдар тізбегін іздеу: алдымен соңындағы бос орынсыз, сосын шегініссіз салыстыру
function findLines(lines: string[], search: string[], norm: (s: string) => string): number {
  const target = search.map(norm);
  for (let i = 0; i + target.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length && ok; j++) ok = norm(lines[i + j]) === target[j];
    if (ok) return i;
  }
  return -1;
}

export function applySearchReplace(original: string, raw: string): ReplaceResult {
  let content = original;
  const failed: string[] = [];
  let applied = 0;
  for (const m of raw.matchAll(HUNK)) {
    const search = m[1];
    const replace = m[2];
    if (!search.trim()) {
      // Бос SEARCH — тек бос файлға жазуға болады
      if (!content.trim()) {
        content = replace;
        applied++;
      } else failed.push(search);
      continue;
    }
    const at = content.indexOf(search);
    if (at >= 0) {
      let end = at + search.length;
      // Тұтас жолдар өшірілсе — артынан бос жол қалмасын
      if (replace === '' && content[end] === '\n' && (at === 0 || content[at - 1] === '\n')) end++;
      content = content.slice(0, at) + replace + content.slice(end);
      applied++;
      continue;
    }
    const lines = content.split('\n');
    const searchLines = search.replace(/\n+$/, '').split('\n');
    let i = findLines(lines, searchLines, (s) => s.trimEnd());
    if (i < 0) i = findLines(lines, searchLines, (s) => s.trim());
    if (i < 0) {
      failed.push(search);
      continue;
    }
    lines.splice(i, searchLines.length, ...(replace === '' ? [] : replace.split('\n')));
    content = lines.join('\n');
    applied++;
  }
  return { content, failed, applied };
}

// ── @ ескертулер ──

/** Хабардағы @жол белгілері, жобадағы файлға немесе папкаға сәйкес келетіндері ғана */
export function parseMentions(text: string, paths: string[]): string[] {
  const files = new Set(paths);
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
    const token = cleanPath(m[1].replace(/[.,;:!?)]+$/, ''));
    if (!token) continue;
    if (files.has(token) || paths.some((p) => p.startsWith(`${token}/`))) out.add(token);
  }
  return [...out];
}

/** @ таңдау тізімі: файлдар мен папкалар, сұрауға ең жақыны алдымен */
export function mentionCandidates(paths: string[], query: string, limit = 8): { path: string; folder: boolean }[] {
  const folders = new Set<string>();
  paths.forEach((p) => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  });
  const q = query.toLowerCase();
  const all = [
    ...[...folders].map((path) => ({ path, folder: true })),
    ...paths.map((path) => ({ path, folder: false })),
  ].filter((c) => c.path.toLowerCase().includes(q));
  const score = (c: { path: string; folder: boolean }) => {
    const base = (c.path.split('/').pop() ?? c.path).toLowerCase();
    return (base.startsWith(q) ? 0 : 2) + (c.folder ? 1 : 0);
  };
  return all.sort((a, b) => score(a) - score(b) || a.path.length - b.path.length).slice(0, limit);
}
