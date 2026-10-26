import type { NoteMeta } from '../../utils/api';

/** Жазбаның толық жолы: «Папка/Атау» немесе «Атау» */
export const notePath = (note: Pick<NoteMeta, 'folder' | 'title'>): string =>
  note.folder ? `${note.folder}/${note.title}` : note.title;

/**
 * [[мақсат]] сілтемесін жазбаға айналдыру (Obsidian ережелері):
 * «Папка/Атау» — дәл жол, әйтпесе атауы бойынша (регистрге тәуелсіз);
 * бірнеше болса — md-жазба, содан кейін ең қысқа жолды аламыз.
 */
export function resolveLink(target: string, notes: NoteMeta[]): NoteMeta | undefined {
  const clean = target.trim().replace(/\.md$/i, '').toLowerCase();
  if (!clean) return undefined;
  const exact = notes.find((n) => notePath(n).toLowerCase() === clean);
  if (exact) return exact;
  const base = clean.split('/').pop()!;
  const matches = notes.filter((n) => n.title.toLowerCase() === base);
  matches.sort(
    (a, b) => Number(a.kind !== 'note') - Number(b.kind !== 'note') || a.folder.length - b.folder.length
  );
  return matches[0];
}

/** Берілген жазбаға сілтеме жасайтын жазбалар */
export function backlinksOf(note: NoteMeta, notes: NoteMeta[]): NoteMeta[] {
  return notes.filter(
    (other) => other.id !== note.id && other.links.some((link) => resolveLink(link, notes)?.id === note.id)
  );
}

export interface OutlineItem {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  );
}

/** Код блоктарынан тыс Markdown тақырыптары (# ...) */
export function outlineOf(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const used = new Map<string, number>();
  let inFence = false;
  content.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const text = m[2].replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, t, a) => a || t);
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    items.push({ level: m[1].length, text, slug: count ? `${base}-${count}` : base, line: index });
  });
  return items;
}

/** Атауы бойынша нақты (бұлыңғыр) іздеу: таңбалар ретімен кездесуі керек */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 1;
  if (s === q) return 1000;
  if (s.startsWith(q)) return 500 - s.length;
  const idx = s.indexOf(q);
  if (idx >= 0) return 300 - idx;
  let pos = 0;
  let score = 0;
  for (const ch of q) {
    const found = s.indexOf(ch, pos);
    if (found < 0) return -1;
    score += found === pos ? 3 : 1;
    pos = found + 1;
  }
  return score;
}

/** n-ші тапсырма жолын ( - [ ] / - [x] ) ауыстыру — код блоктарын есептемей */
export function toggleTask(content: string, index: number): string {
  let inFence = false;
  let seen = -1;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(lines[i]);
    if (m && ++seen === index) {
      lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
      break;
    }
  }
  return lines.join('\n');
}

/** Күнделік жазбасының атауы: 2026-10-26 */
export const dailyTitle = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const DAILY_FOLDER = 'Daily';
