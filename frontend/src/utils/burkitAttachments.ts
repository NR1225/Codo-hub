import type { BurkitAttachment } from './api';

/* Басты беттегі Бүркітке фото, файл және папка тіркеу.
   Сурет пен PDF Gemini-ге base64 түрінде барады (Бүркіт өзі көреді),
   қалған файлдар мәтін ретінде оқылады (екілік файлдар қабылданбайды). */

export interface Attachment {
  id: string;
  kind: 'image' | 'file' | 'folder';
  name: string;
  /** Суреттің алдын ала көрінісі (object URL, тек осы сессияда) */
  preview?: string;
  /** Папкадан оқылған файлдар саны */
  count?: number;
  /** Бүркітке жіберілетін мазмұн (тарихтан ашылғанда — бос) */
  files: BurkitAttachment[];
}

export const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
export const MAX_ATTACHMENTS = 10;
const MAX_INLINE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const MAX_FOLDER_FILES = 80;
const MAX_FOLDER_CHARS = 200_000;
const MAX_FOLDER_FILE_BYTES = 200 * 1024;
const MAX_TREE_PATHS = 400;
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|\.cache|__pycache__|\.venv|venv)(\/|$)/;

// Бір сұрауда жіберілетін тіркемелердің жалпы көлемі (сервер шегінен сәл төмен)
const SEND_INLINE_BUDGET = 12_000_000;
const SEND_TEXT_BUDGET = 250_000;

const newId = () => Math.random().toString(36).slice(2, 10);

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(`${file.name}: оқу мүмкін болмады`));
    reader.readAsDataURL(file);
  });
}

// Мәтін файлы болмаса (NUL таңбасы бар) — null
async function readText(file: File): Promise<string | null> {
  const text = await file.text();
  return text.includes('\u0000') ? null : text;
}

const mimeOf = (file: File) => (/^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'text/plain');

export async function attachmentFromFile(file: File): Promise<Attachment> {
  if (INLINE_TYPES.has(file.type)) {
    if (file.size > MAX_INLINE_BYTES) throw new Error(`${file.name}: тым үлкен (ең көбі 4 МБ)`);
    const isImage = file.type.startsWith('image/');
    return {
      id: newId(),
      kind: isImage ? 'image' : 'file',
      name: file.name,
      preview: isImage ? URL.createObjectURL(file) : undefined,
      files: [{ name: file.name, mimeType: file.type, data: await readBase64(file) }],
    };
  }
  if (file.size > MAX_TEXT_FILE_BYTES) throw new Error(`${file.name}: тым үлкен (мәтін файлы ең көбі 1 МБ)`);
  const text = await readText(file);
  if (text === null) throw new Error(`${file.name}: бұл түрді оқу мүмкін емес (сурет, PDF және мәтін файлдары ғана)`);
  return {
    id: newId(),
    kind: 'file',
    name: file.name,
    files: [{ name: file.name, mimeType: mimeOf(file), text: text.slice(0, MAX_TEXT_CHARS) }],
  };
}

// Папка: құрылымы + мәтін файлдарының мазмұны (көлем шегіне дейін)
export async function attachmentFromFolder(list: File[]): Promise<Attachment> {
  const pathOf = (f: File) => f.webkitRelativePath || f.name;
  const all = list.filter((f) => !SKIP_DIRS.test(pathOf(f))).sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
  const root = pathOf(list[0] ?? new File([], 'папка')).split('/')[0];
  const files: BurkitAttachment[] = [];
  let chars = 0;
  for (const file of all) {
    if (files.length >= MAX_FOLDER_FILES || chars >= MAX_FOLDER_CHARS) break;
    if (file.size > MAX_FOLDER_FILE_BYTES || INLINE_TYPES.has(file.type) || /^(image|video|audio)\//.test(file.type)) continue;
    const text = await readText(file).catch(() => null);
    if (text === null) continue;
    const clipped = text.slice(0, MAX_FOLDER_CHARS - chars);
    chars += clipped.length;
    files.push({ name: pathOf(file), mimeType: mimeOf(file), text: clipped });
  }
  if (all.length === 0) throw new Error(`${root}: папка бос`);
  const paths = all.slice(0, MAX_TREE_PATHS).map(pathOf);
  if (all.length > MAX_TREE_PATHS) paths.push(`… тағы ${all.length - MAX_TREE_PATHS} файл`);
  const tree: BurkitAttachment = {
    name: `${root}/ (папка құрылымы, ${all.length} файл, мазмұны берілгені — ${files.length})`,
    mimeType: 'text/plain',
    text: paths.join('\n'),
  };
  return { id: newId(), kind: 'folder', name: root, count: all.length, files: [tree, ...files] };
}

/** Хабарлардағы тіркемелер: жаңадан ескіге қарай, жалпы көлем шегіне дейін ғана жіберіледі */
export function budgetFiles(groups: Attachment[][]): BurkitAttachment[][] {
  let inline = 0;
  let text = 0;
  const out: BurkitAttachment[][] = groups.map(() => []);
  for (let i = groups.length - 1; i >= 0; i--) {
    for (const f of groups[i].flatMap((a) => a.files)) {
      const di = f.data?.length ?? 0;
      const dt = f.text?.length ?? 0;
      if (inline + di > SEND_INLINE_BUDGET || text + dt > SEND_TEXT_BUDGET) continue;
      inline += di;
      text += dt;
      out[i].push(f);
    }
  }
  return out;
}
