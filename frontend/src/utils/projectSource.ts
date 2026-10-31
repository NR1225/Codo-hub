/* Жобаны жүктеу көздері: папка таңдағыш, сүйреп әкелінген папка және ZIP.
   Барлығы бір форматқа келтіріледі — жолы бекітілген File тізімі («жоба/src/a.ts»),
   сосын scanProject оны uploadRules бойынша сүзіп, жүктеу алдындағы шолуды құрады. */

import ignore, { Ignore } from 'ignore';
import { classifyUploadPath, innerPath, isSkipped, protectionOf, ProtectionKind } from './uploadRules';
import { withPath, filePath, isImageFile } from './fileHandler';

/** Ашылмай/кірілмей өткізілген қоқыс: папка (сүйреп әкелгенде) немесе ZIP ішіндегі файл */
interface PrunedJunk {
  path: string;
  bytes: number;
  isDir: boolean;
}

export interface CollectedProject {
  files: File[];
  pruned: PrunedJunk[];
}

export interface LanguageShare {
  name: string;
  bytes: number;
  files: number;
}

export interface ProjectScan {
  name: string;
  files: File[];
  bytes: number;
  /** Алынып тасталған қоқыс: файл саны, көлемі және негізгі көздері (node_modules, dist…) */
  junkFiles: number;
  junkBytes: number;
  junkSources: { name: string; bytes: number }[];
  /** Жүктеледі, бірақ қорғалады: құпия мен базаны тек иесі, тест деректерін — жоба мүшелері көреді */
  protectedFiles: { path: string; kind: ProtectionKind }[];
  languages: LanguageShare[];
  mainLanguage: string;
}

/* ---------- Көздер ---------- */

/** Папка таңдағыштан (webkitdirectory) — жолдар браузерден келеді */
export const collectFromInput = (list: FileList): CollectedProject => ({
  files: Array.from(list),
  pruned: [],
});

type Entry = FileSystemEntry;

const readEntries = (dir: FileSystemDirectoryEntry) =>
  new Promise<Entry[]>((resolve, reject) => {
    const reader = dir.createReader();
    const all: Entry[] = [];
    // readEntries бір шақыруда ~100 жазба ғана береді — бос келгенше оқу керек
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });

const entryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: Entry, path: string, out: CollectedProject): Promise<void> {
  if (entry.isFile) {
    out.files.push(withPath(await entryFile(entry as FileSystemFileEntry), path));
    return;
  }
  // Қоқыс папкасының ішіне мүлде кірмейміз (node_modules ондаған мың файл болуы мүмкін)
  if (path.includes('/') && classifyUploadPath(`${innerPath(path)}/_`) === 'junk') {
    out.pruned.push({ path, bytes: 0, isDir: true });
    return;
  }
  const children = await readEntries(entry as FileSystemDirectoryEntry);
  await Promise.all(children.map((child) => walk(child, `${path}/${child.name}`, out)));
}

/* ---------- Папка таңдағыш (File System Access API) ----------
   webkitdirectory бүкіл папканы (node_modules-пен бірге, ондаған мың файл) оқып, браузер
   «N файлды жүктеу керек пе?» деп сұрайды. showDirectoryPicker-де қоқыс папкасына кірмейміз. */

interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
}

interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

type DirectoryPicker = (options?: { mode?: 'read'; id?: string }) => Promise<DirHandle>;

/** Chrome/Edge — бар; Firefox/Safari — жоқ (сонда webkitdirectory қолданылады) */
export const canPickDirectory = () =>
  typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/** Папка таңдату. Қолданушы бас тартса — null */
export async function pickDirectory(): Promise<DirHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  try {
    return await picker({ mode: 'read', id: 'codo-project' });
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null;
    throw err;
  }
}

async function walkHandle(handle: DirHandle | FileHandle, path: string, out: CollectedProject): Promise<void> {
  if (handle.kind === 'file') {
    out.files.push(withPath(await handle.getFile(), path));
    return;
  }
  if (path.includes('/') && classifyUploadPath(`${innerPath(path)}/_`) === 'junk') {
    out.pruned.push({ path, bytes: 0, isDir: true });
    return;
  }
  const children: (DirHandle | FileHandle)[] = [];
  for await (const child of handle.values()) children.push(child);
  await Promise.all(children.map((child) => walkHandle(child, `${path}/${child.name}`, out)));
}

export async function collectFromHandle(dir: DirHandle): Promise<CollectedProject> {
  const out: CollectedProject = { files: [], pruned: [] };
  await walkHandle(dir, dir.name, out);
  return out;
}

/** Сүйреп әкелінген элементтер. Жалғыз .zip болса — null (оны collectFromZip өңдейді) */
export async function collectFromDrop(dt: DataTransfer): Promise<CollectedProject | null> {
  // Entry-лерді await-ке дейін алу керек: оқиғадан кейін DataTransfer тазаланады
  const entries = Array.from(dt.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is Entry => !!e);
  if (entries.length === 0) return { files: [], pruned: [] };
  if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) return null;

  const out: CollectedProject = { files: [], pruned: [] };
  if (entries.length === 1 && entries[0].isDirectory) {
    await walk(entries[0], entries[0].name, out);
  } else {
    // Бірнеше файл/папка — ортақ «project» түбіріне жиналады
    await Promise.all(entries.map((e) => walk(e, `project/${e.name}`, out)));
  }
  return out;
}

export interface ZipOptions {
  /** Жалғыз түбірлік папканың орнына осы ат (GitHub архивіндегі «owner-repo-sha» → «repo») */
  rootName?: string;
  /** Тек осы ішкі папка жүктеледі (түбірсіз жол, мысалы «packages/core») */
  subdir?: string;
}

/** ZIP архиві: қоқыс файлдары ашылмайды, тек саналады */
export async function collectFromZip(zipFile: File, options: ZipOptions = {}): Promise<CollectedProject> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  let entries = Object.values(zip.files).filter((e) => !e.dir);

  // Архивтің ішінде жалғыз түбірлік папка болса — сол жобаның аты, әйтпесе архивтің аты
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  const singleRoot = tops.size === 1 && entries.every((e) => e.name.includes('/'));
  const root = options.rootName || zipFile.name.replace(/\.zip$/i, '') || 'project';

  // Түбірден кейінгі жол: ішкі папка сүзгісі мен атауды ауыстыру осыған сүйенеді
  const rel = (name: string) => (singleRoot ? name.slice(name.indexOf('/') + 1) : name);
  const subdir = options.subdir?.replace(/^\/+|\/+$/g, '');
  if (subdir) entries = entries.filter((e) => rel(e.name).startsWith(`${subdir}/`));

  const out: CollectedProject = { files: [], pruned: [] };
  await Promise.all(
    entries.map(async (entry) => {
      const inner = subdir ? rel(entry.name).slice(subdir.length + 1) : rel(entry.name);
      const path = singleRoot && !options.rootName && !subdir ? entry.name : `${root}/${inner}`;
      if (isSkipped(classifyUploadPath(innerPath(path)))) {
        const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
        out.pruned.push({ path, bytes: size, isDir: false });
        return;
      }
      const data = await entry.async('arraybuffer');
      const name = path.split('/').pop() || entry.name;
      out.files.push(withPath(new File([data], name, { lastModified: entry.date?.getTime() }), path));
    })
  );
  return out;
}

/* ---------- Шолу ---------- */

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', vue: 'JavaScript', svelte: 'JavaScript',
  py: 'Python', ipynb: 'Python', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', dart: 'Dart',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++', cs: 'C#',
  go: 'Go', rs: 'Rust', php: 'PHP', rb: 'Ruby', r: 'R', m: 'MATLAB',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  json: 'JSON', xml: 'XML', yml: 'YAML', yaml: 'YAML', md: 'Markdown',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'Shell', sql: 'SQL',
};
// Негізгі тілді анықтағанда конфигурация/құжат тілдері есепке алынбайды
const SUPPORTING = new Set(['JSON', 'XML', 'YAML', 'Markdown']);

const languageOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? LANGUAGE_BY_EXT[name.slice(dot + 1).toLowerCase()] : undefined;
};

/** Жобадағы .gitignore файлдары (түбірден тереңге қарай): dir — түбірсіз папка жолы, «» — түбір */
async function loadGitignores(files: File[]): Promise<{ dir: string; ig: Ignore }[]> {
  const rules = await Promise.all(
    files
      .filter((f) => f.name === '.gitignore')
      .map(async (f) => {
        const inner = innerPath(filePath(f));
        const dir = inner.includes('/') ? inner.slice(0, inner.lastIndexOf('/')) : '';
        return { dir, ig: ignore().add(await f.text()) };
      })
  );
  return rules.sort((a, b) => a.dir.split('/').length - b.dir.split('/').length || a.dir.length - b.dir.length);
}

/** .gitignore бойынша өткізіле ме: тереңірек файлдың ережесі (соның ішінде «!») жоғарғысын жеңеді */
const gitIgnored = (inner: string, rules: { dir: string; ig: Ignore }[]) => {
  let ignored = false;
  for (const { dir, ig } of rules) {
    if (dir && !inner.startsWith(`${dir}/`)) continue;
    const rel = dir ? inner.slice(dir.length + 1) : inner;
    if (!rel) continue;
    const res = ig.test(rel);
    if (res.ignored) ignored = true;
    else if (res.unignored) ignored = false;
  }
  return ignored;
};

/** Файл .gitignore-дағы папканың ішінде ме (backend/data/backups/x.db → backend/data/backups/) */
const inIgnoredDir = (inner: string, rules: { dir: string; ig: Ignore }[]) => {
  const parts = inner.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (gitIgnored(`${parts.slice(0, i).join('/')}/`, rules)) return true;
  }
  return false;
};

/** Шыққан файлдарды ережемен сүзу + жоба шолуы (тілдер, қоқыс, құпия).
    Жобаның .gitignore-ы да ескеріледі: онда көрсетілген деректер, жүктемелер т.б. жүктелмейді */
export async function scanProject({ files, pruned }: CollectedProject): Promise<ProjectScan> {
  const name = (files[0] ? filePath(files[0]) : pruned[0]?.path ?? 'project').split('/')[0] || 'project';
  const kept: File[] = [];
  const protectedFiles: ProjectScan['protectedFiles'] = [];
  const junkBy = new Map<string, number>();
  let bytes = 0;
  let junkFiles = 0;
  let junkBytes = 0;
  const gitignores = await loadGitignores(files);

  // Қоқыстың көзі: жолдағы алғашқы қоқыс папкасы (node_modules) немесе файлдың өз аты
  const junkSource = (inner: string) => {
    const parts = inner.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (classifyUploadPath(`${parts.slice(0, i + 1).join('/')}/_`) === 'junk') return parts[i];
    }
    return parts[parts.length - 1];
  };
  const addJunk = (inner: string, size: number) => {
    const source = junkSource(inner);
    junkBy.set(source, (junkBy.get(source) ?? 0) + size);
    junkBytes += size;
  };

  for (const file of files) {
    const path = filePath(file);
    const inner = innerPath(path);
    const kind = classifyUploadPath(inner);
    // .env, база, тест деректері әдетте .gitignore-да тұрады — бірақ олар қорғалып жүктеледі.
    // Тек файлдың өзі ignore болса: .gitignore-дағы папканың ішіндегісі (сақтық көшірмелер,
    // терминал папкалары т.б.) жобаның бөлігі емес, қорғалған болса да жүктелмейді
    const ignoredDir = gitignores.length > 0 && inIgnoredDir(inner, gitignores);
    const protection = isSkipped(kind) || ignoredDir ? null : protectionOf(inner);
    if (isSkipped(kind)) {
      junkFiles++;
      addJunk(inner, file.size);
    } else if (!protection && gitignores.length && gitIgnored(inner, gitignores)) {
      junkFiles++;
      junkBy.set('.gitignore', (junkBy.get('.gitignore') ?? 0) + file.size);
      junkBytes += file.size;
    } else {
      if (protection) protectedFiles.push({ path, kind: protection });
      kept.push(file);
      bytes += file.size;
    }
  }
  for (const item of pruned) {
    const inner = innerPath(item.path);
    if (item.isDir) {
      const source = inner.split('/').pop() || inner;
      junkBy.set(source, junkBy.get(source) ?? 0);
    } else {
      junkFiles++;
      addJunk(inner, item.bytes);
    }
  }

  const langs = new Map<string, LanguageShare>();
  for (const file of kept) {
    if (isImageFile(file.name)) continue;
    const lang = languageOf(file.name);
    if (!lang) continue;
    const share = langs.get(lang) ?? { name: lang, bytes: 0, files: 0 };
    share.bytes += file.size;
    share.files++;
    langs.set(lang, share);
  }
  const languages = [...langs.values()].sort((a, b) => b.bytes - a.bytes);
  const main = languages.find((l) => !SUPPORTING.has(l.name)) ?? languages[0];

  return {
    name,
    files: kept,
    bytes,
    junkFiles,
    junkBytes,
    junkSources: [...junkBy.entries()]
      .map(([source, size]) => ({ name: source, bytes: size }))
      .sort((a, b) => b.bytes - a.bytes),
    protectedFiles,
    languages,
    mainLanguage: main?.name ?? 'Other',
  };
}

/* ---------- Ағаш (шолу үшін) ---------- */

export interface PreviewNode {
  name: string;
  path: string;
  size: number;
  files: number;
  children: PreviewNode[];
  isFile: boolean;
}

/** Жүктелетін файлдардың ағашы (түбірлік папкасыз), папкалар алдымен */
export function buildPreviewTree(files: File[]): PreviewNode[] {
  const root: PreviewNode = { name: '', path: '', size: 0, files: 0, children: [], isFile: false };
  for (const file of files) {
    const parts = innerPath(filePath(file)).split('/').filter(Boolean);
    let node = root;
    node.size += file.size;
    node.files++;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.isFile === isFile);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join('/'), size: 0, files: 0, children: [], isFile };
        node.children.push(child);
      }
      child.size += file.size;
      child.files++;
      node = child;
    });
  }
  const sort = (nodes: PreviewNode[]) => {
    nodes.sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
