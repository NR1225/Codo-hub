import { v4 as uuidv4 } from 'uuid';
import type { VibecodingProjectDTO, VibecodingProjectFile } from './api';
import type { BurkitEdit } from '../components/vibecoding/useBurkitHistory';
import { applySearchReplace, CodeBlock } from '../components/vibecoding/burkitBlocks';
import { detectLanguage } from '../contexts/VibecodingContext';

/* Басты беттегі Бүркіт жобаның файлдарымен жұмыс істейді (Vibecoding-тегі Agent сияқты):
   path=/edit=/delete/move блоктары жоба көшірмесіне қолданылады, содан кейін серверге сақталады. */

const MAX_PROJECT_CHARS = 150_000;
const MAX_READ_CHARS = 60_000;

/** Бүркітке жоба файлдары: жалпы көлем шегіне дейін мазмұнымен, қалғаны тек жолымен */
export function projectContext(files: { path: string; content: string }[]) {
  let budget = MAX_PROJECT_CHARS;
  return files.map((f) => {
    if (f.content.length > budget) return { path: f.path };
    budget -= f.content.length;
    return { path: f.path, content: f.content };
  });
}

export interface FileOpsResult {
  files: VibecodingProjectFile[];
  folders: string[];
  edits: BurkitEdit[];
  /** Бүркітке келесі қадамда баратын нәтижелер (read, сәтсіз өзгерістер, run) */
  feedback: string[];
  /** «Қайтару» үшін: өзгерген файлдардың бұрынғы мәтіні (null — файл жоқ еді) */
  originals: Map<string, string | null>;
  changed: boolean;
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

function makeFile(path: string, content: string): VibecodingProjectFile {
  const name = path.split('/').pop() || path;
  return { id: uuidv4(), name, path, content, language: detectLanguage(name) };
}

/** Жауаптағы файл блоктарын жоба көшірмесіне қолдану (note блоктарын бет өзі жазады) */
export function applyFileBlocks(project: VibecodingProjectDTO, blocks: CodeBlock[]): FileOpsResult {
  let files = project.files.map((f) => ({ ...f }));
  let folders = [...(project.folders ?? [])];
  const edits: BurkitEdit[] = [];
  const feedback: string[] = [];
  const originals = new Map<string, string | null>();
  const remember = (path: string) => {
    if (!originals.has(path)) originals.set(path, files.find((f) => f.path === path)?.content ?? null);
  };
  const find = (path: string) => files.find((f) => f.path === path);

  for (const { action, raw } of blocks) {
    if (!action) continue;
    if (action.kind === 'write') {
      remember(action.path);
      const existing = find(action.path);
      if (existing) existing.content = raw;
      else files.push(makeFile(action.path, raw));
      edits.push({ kind: 'file', path: action.path, created: !existing });
    } else if (action.kind === 'edit') {
      const existing = find(action.path);
      if (!existing) {
        edits.push({ kind: 'file', path: action.path, created: false, error: 'файл жоқ' });
        feedback.push(`edit=${action.path}: мұндай файл жоқ. Жаңа файлды path= блогымен жаса.`);
        continue;
      }
      const result = applySearchReplace(existing.content, raw);
      if (result.applied > 0) {
        remember(action.path);
        existing.content = result.content;
        edits.push({ kind: 'file', path: action.path, created: false });
      }
      if (result.failed.length > 0) {
        if (result.applied === 0) edits.push({ kind: 'file', path: action.path, created: false, error: 'табылмады' });
        feedback.push(
          `edit=${action.path}: ${result.failed.length} SEARCH бөлігі файлдан табылмады (қалғаны орындалды):\n` +
          result.failed.map((s) => `~~~\n${s}\n~~~`).join('\n') +
          '\nФайлдың қазіргі мәтінін read арқылы оқып, дәл мәтінмен қайтала.'
        );
      }
    } else if (action.kind === 'delete') {
      const gone = files.filter((f) => inside(f.path, action.path));
      if (gone.length === 0 && !folders.some((d) => inside(d, action.path))) {
        feedback.push(`delete ${action.path}: мұндай файл немесе папка жоқ.`);
        continue;
      }
      gone.forEach((f) => remember(f.path));
      files = files.filter((f) => !inside(f.path, action.path));
      folders = folders.filter((d) => !inside(d, action.path));
      edits.push({ kind: 'file', path: action.path, created: false, action: 'delete' });
    } else if (action.kind === 'move') {
      const moving = files.filter((f) => inside(f.path, action.from));
      if (moving.length === 0 || files.some((f) => inside(f.path, action.to))) {
        feedback.push(`move ${action.from} → ${action.to}: орындалмады (бастапқы жол жоқ немесе жаңа жол бос емес).`);
        continue;
      }
      moving.forEach((f) => {
        const to = action.to + f.path.slice(action.from.length);
        remember(f.path);
        remember(to);
        f.path = to;
        f.name = to.split('/').pop() || to;
      });
      folders = folders.map((d) => (inside(d, action.from) ? action.to + d.slice(action.from.length) : d));
      edits.push({ kind: 'file', path: action.to, from: action.from, created: false, action: 'move' });
    } else if (action.kind === 'read') {
      const file = find(action.path);
      feedback.push(file
        ? `Файл ${action.path}:\n\`\`\`\n${file.content.slice(0, MAX_READ_CHARS)}\n\`\`\``
        : `read ${action.path}: мұндай файл жоқ.`);
    } else if (action.kind === 'run') {
      feedback.push('run: басты бетте терминал жоқ, команда орындалмады. Қолданушыға жобаны Vibecoding-те ашып, сонда орындауды айт.');
    }
  }
  return { files, folders, edits, feedback, originals, changed: originals.size > 0 };
}

/** «Қайтару»: файлдарды бұрынғы мәтініне келтіру (null — файл өшіріледі) */
export function restoreFiles(files: VibecodingProjectFile[], originals: Map<string, string | null>): VibecodingProjectFile[] {
  let out = files.map((f) => ({ ...f }));
  originals.forEach((content, path) => {
    const existing = out.find((f) => f.path === path);
    if (content === null) out = out.filter((f) => f.path !== path);
    else if (existing) existing.content = content;
    else out.push(makeFile(path, content));
  });
  return out;
}
