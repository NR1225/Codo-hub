import { v4 as uuidv4 } from 'uuid';
import { apiService, CodeFile, VibecodingProjectDTO } from './api';
import type { BlockAction, ProjectOp } from '../components/vibecoding/burkitBlocks';

/* Бүркіттің сайттағы жобалармен жұмысы (```project … блоктары) — басты беттегі де, Vibecoding-тегі де
   Бүркіт осыны қолданады. Жобаны жасау/өшіру/ашу әр бетте әртүрлі (Vibecoding-те — контекст арқылы,
   басты бетте — API арқылы), сондықтан ол бөлігін бет өзі береді (ProjectHost). */

export type ProjectAction = Extract<BlockAction, { kind: 'project' }>;

export interface ProjectSummary {
  id: string;
  name: string;
  shareToken?: string | null;
}

export interface ProjectHost {
  userId: string;
  username: string;
  /** Vibecoding-те ашық жоба (name= көрсетілмесе — осы) */
  currentProjectId?: string | null;
  listVibe: () => Promise<ProjectSummary[]>;
  /** Жаңа жоба; қайтарғаны — оның id-і */
  createVibe: (name: string) => Promise<string>;
  deleteVibe: (id: string) => Promise<void>;
  /** Жобаның соңғы нұсқасын серверге жеткізу (жариялау/бөлісу алдында) */
  flush: () => Promise<void>;
  /** Сервердегі жобаны (көшірмені) бетке қосып, ашу */
  openVibe: (id: string, dto?: VibecodingProjectDTO) => void | Promise<void>;
  navigate: (url: string) => void;
}

export interface ProjectActionResult {
  /** Бүркітке баратын нәтиже */
  text: string;
  /** Қолданушыға көрсетілетін сілтеме (бөлісу сілтемесі, жарияланған жоба) */
  link?: string;
}

/** Қолданушы растамай орындалмайтын әрекеттер (жариялау, жіберу — Авто режимде растаусыз) */
export const CONFIRM_OPS = new Set<ProjectOp>(['publish', 'send', 'unshare', 'delete', 'unpublish']);
/** Авто режимде де әрқашан расталатын (қайтарылмайтын) әрекеттер */
export const ALWAYS_CONFIRM_OPS = new Set<ProjectOp>(['delete', 'unpublish']);

// Басқа беттер (басты беттің жобалар тізімі) Vibecoding жобалары өзгергенін біледі
export const VIBE_PROJECTS_EVENT = 'vibeProjectsUpdated';

export const shareUrl = (token: string) => `${window.location.origin}/vibecoding/shared/${token}`;

/** Чатқа/Бүркітке түсінікті бір жолдық сипаттама */
export function describeProjectAction(action: ProjectAction): string {
  const a = action.attrs;
  const name = a.name ? `«${a.name}»` : 'ашық жоба';
  switch (action.op) {
    case 'list': return 'Жобалар тізімін қарау';
    case 'create': return `Жаңа жоба: «${a.name ?? 'Жаңа жоба'}»`;
    case 'delete': return `Жобаны өшіру: ${name}`;
    case 'switch': return `Жобаны ашу: ${name}`;
    case 'publish': return `Жобалар бетіне жариялау: ${a.title ? `«${a.title}»` : name}`;
    case 'unpublish': return `Жобалар бетінен алып тастау: «${a.title ?? a.id ?? '?'}»`;
    case 'share': return `Бөлісу сілтемесі: ${name}`;
    case 'unshare': return `Бөлісу сілтемесін өшіру: ${name}`;
    case 'send': return `Чатқа жіберу: ${name} → ${a.group ? `«${a.group}» тобы` : `@${(a.to ?? '?').replace(/^@/, '')}`}`;
    case 'open': return `Бөлісілген жобаны қарау: ${a.link ?? '?'}`;
    case 'fork': return `Көшірмесін алу: ${a.link ?? '?'}`;
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/** Атауы бойынша табу: алдымен дәл, сосын ішінде кездесетін (бір ғана болса) */
function pick<T>(items: T[], query: string, label: (item: T) => string): T {
  const q = norm(query);
  const exact = items.filter((i) => norm(label(i)) === q);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((i) => norm(label(i)).includes(q));
  if (exact.length === 0 && partial.length === 1) return partial[0];
  const options = (exact.length > 1 ? exact : partial).map(label);
  throw new Error(options.length
    ? `«${query}» бірнешеу: ${options.slice(0, 10).join(', ')} — нақты атауын жаз.`
    : `«${query}» табылмады.`);
}

async function resolveVibe(host: ProjectHost, name?: string): Promise<ProjectSummary> {
  const list = await host.listVibe();
  if (!name) {
    const current = list.find((p) => p.id === host.currentProjectId);
    if (!current) throw new Error('Жоба атауы көрсетілмеді (name=…), ашық жоба да жоқ.');
    return current;
  }
  return pick(list, name, (p) => p.name);
}

async function myPublished(host: ProjectHost): Promise<CodeFile[]> {
  return apiService.getAllCodesBy(host.username);
}

/** Сілтемеден бөлісу токенін немесе Жобалар бетіндегі жобаның id-ін алу */
function parseLink(link: string): { token?: string; codeId?: string } {
  const value = link.trim();
  const shared = /\/vibecoding\/shared\/([\w-]+)/.exec(value);
  if (shared) return { token: shared[1] };
  const view = /\/view\/([\w-]+)/.exec(value);
  if (view) return { codeId: view[1] };
  if (/^[\w-]{12,64}$/.test(value)) return { token: value };
  throw new Error('Сілтеме танылмады: …/vibecoding/shared/<токен> немесе …/view/<id> болуы керек.');
}

const codesChanged = () => window.dispatchEvent(new Event('codesUpdated'));

export async function runProjectAction(action: ProjectAction, host: ProjectHost, comment = ''): Promise<ProjectActionResult> {
  const a = action.attrs;
  switch (action.op) {
    case 'list': {
      const [vibes, published, friends, groups] = await Promise.all([
        host.listVibe(),
        myPublished(host).catch(() => [] as CodeFile[]),
        apiService.getFriends(host.userId).catch(() => []),
        apiService.getGroups().catch(() => []),
      ]);
      const lines = [
        `Vibecoding жобаларым (${vibes.length}):`,
        ...vibes.map((p) => `- ${p.name}${p.id === host.currentProjectId ? ' (ашық)' : ''}${p.shareToken ? ` · сілтеме: ${shareUrl(p.shareToken)}` : ''}`),
        `Жобалар бетінде жарияланғандарым (${published.length}):`,
        ...published.map((c) => `- ${c.title} · ${window.location.origin}/view/${c.id}`),
        `Достарым: ${friends.map((f) => `@${f.username}`).join(', ') || 'жоқ'}`,
        `Топтарым: ${groups.map((g) => `«${g.name}»`).join(', ') || 'жоқ'}`,
      ];
      return { text: lines.join('\n') };
    }

    case 'create': {
      const name = (a.name ?? '').trim().slice(0, 200) || 'Жаңа жоба';
      await host.createVibe(name);
      return { text: `«${name}» жобасы жасалды және ашылды.` };
    }

    case 'delete': {
      const project = await resolveVibe(host, a.name);
      await host.deleteVibe(project.id);
      return { text: `«${project.name}» жобасы өшірілді.` };
    }

    case 'switch': {
      const project = await resolveVibe(host, a.name);
      await host.openVibe(project.id);
      return { text: `«${project.name}» жобасы ашылды.` };
    }

    case 'publish': {
      const project = await resolveVibe(host, a.name);
      await host.flush();
      const res = await apiService.publishVibecodingProject(project.id, {
        title: a.title?.trim() || undefined,
        description: comment.trim() || undefined,
        tags: a.tags ? a.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      });
      apiService.invalidateCodesCache();
      codesChanged();
      const link = `${window.location.origin}/view/${res.codeId}`;
      const failed = res.failed ? ` ${res.failed} файл жүктелмеді: ${res.failedFiles.slice(0, 10).join(', ')}.` : '';
      // Құпия (.env, кілттер) мен бинарлы файлдар жарияланбайды; кэш/қоқыс — үнсіз
      const skipped = res.skipped?.length ? ` Құпия/бинарлы болғандықтан жарияланбады: ${res.skipped.slice(0, 10).join(', ')}.` : '';
      return { text: `«${res.title}» Жобалар бетіне жарияланды (${res.created} файл): ${link}.${failed}${skipped}`, link };
    }

    case 'unpublish': {
      const published = await myPublished(host);
      const code = a.id ? published.find((c) => c.id === a.id) : pick(published, a.title ?? a.name ?? '', (c) => c.title);
      if (!code) throw new Error('Жарияланған жоба табылмады.');
      await apiService.deleteCodeFile(code.id);
      apiService.invalidateCodesCache();
      codesChanged();
      return { text: `«${code.title}» Жобалар бетінен алынып тасталды.` };
    }

    case 'share': {
      const project = await resolveVibe(host, a.name);
      await host.flush();
      const { token } = await apiService.createProjectShareLink(project.id);
      const link = shareUrl(token);
      return { text: `«${project.name}» жобасының бөлісу сілтемесі: ${link} — оны ашқан адам жобаны көріп, көшірмесін ала алады.`, link };
    }

    case 'unshare': {
      const project = await resolveVibe(host, a.name);
      await apiService.revokeProjectShareLink(project.id);
      return { text: `«${project.name}» жобасының бөлісу сілтемесі өшірілді.` };
    }

    case 'send': {
      // Vibecoding жобасы; ондай атау болмаса — Жобалар бетіндегі жарияланған жоба
      let share: { kind: 'vibe' | 'repo'; projectId: string };
      let title: string;
      try {
        const project = await resolveVibe(host, a.name);
        await host.flush();
        share = { kind: 'vibe', projectId: project.id };
        title = project.name;
      } catch (e) {
        if (!a.name) throw e;
        const code = pick(await myPublished(host), a.name, (c) => c.title);
        share = { kind: 'repo', projectId: code.id };
        title = code.title;
      }
      if (a.group) {
        const group = pick(await apiService.getGroups(), a.group, (g) => g.name);
        await apiService.sendGroupMessage(group.id, comment.trim(), 'project', undefined, share);
        return { text: `«${title}» жобасы «${group.name}» тобына жіберілді.` };
      }
      const to = (a.to ?? '').replace(/^@/, '');
      if (!to) throw new Error('Кімге жіберу керек: to="username" немесе group="Топ атауы".');
      const friend = pick(await apiService.getFriends(host.userId), to, (f) => f.username);
      await apiService.sendMessage(host.userId, friend.id, comment.trim(), 'project', undefined, share);
      return { text: `«${title}» жобасы @${friend.username} досына жіберілді.` };
    }

    case 'open': {
      const { token, codeId } = parseLink(a.link ?? '');
      if (codeId) {
        const code = await apiService.getCodeFile(codeId, true);
        const files = Object.entries(code.folderStructure ?? {})
          .filter(([, v]) => v.type === 'file')
          .map(([path]) => path);
        return {
          text: `Жобалар бетіндегі «${code.title}» (${code.author}), тілі: ${code.language}.` +
            (code.description ? `\nСипаттамасы: ${code.description}` : '') +
            (files.length ? `\nФайлдары (${files.length}):\n${files.slice(0, 200).map((f) => `- ${f}`).join('\n')}` : '') +
            '\nКөшірмесін алу үшін: fork link=… .',
        };
      }
      const shared = await apiService.getSharedProject(token!);
      const readme = shared.files.find((f) => /^readme(\.md)?$/i.test(f.path));
      return {
        text: `Бөлісілген жоба «${shared.name}» (иесі: @${shared.owner ?? '?'}${shared.isOwner ? ', бұл өз жобаң' : ''}).\n` +
          `Файлдары (${shared.files.length}):\n${shared.files.slice(0, 200).map((f) => `- ${f.path}`).join('\n')}` +
          (readme ? `\n\nREADME:\n~~~markdown\n${readme.content.slice(0, 6000)}\n~~~` : ''),
      };
    }

    case 'fork': {
      const { token, codeId } = parseLink(a.link ?? '');
      if (codeId) {
        // Жобалар бетіндегі жоба — Vibecoding өзі көшіріп ашады
        host.navigate(`/vibecoding?repo=${encodeURIComponent(codeId)}`);
        return { text: 'Жобалар бетіндегі жобаның көшірмесі Vibecoding-те ашылды.' };
      }
      const shared = await apiService.getSharedProject(token!);
      if (shared.isOwner && shared.projectId) {
        host.openVibe(shared.projectId);
        return { text: `Бұл өз жобаң — «${shared.name}» ашылды (көшірме жасалмады).` };
      }
      const copy = await apiService.forkProjectByLink(token!, a.name?.trim() || `${shared.name} (көшірме)`);
      await host.openVibe(copy.id, copy);
      return { text: `«${shared.name}» жобасының көшірмесі «${copy.name}» деп жасалып, ашылды.` };
    }
  }
}

/** Бүркіттің жаңа жобасы README-мен басталады (басты бетте — сервер арқылы) */
export async function createProjectOnServer(name: string): Promise<string> {
  const id = uuidv4();
  await apiService.saveVibecodingProject(id, {
    name,
    files: [{ id: uuidv4(), name: 'README.md', path: 'README.md', content: `# ${name}\n`, language: 'markdown' }],
    folders: [],
    createdAt: new Date().toISOString(),
  });
  return id;
}

export interface BurkitSiteContext {
  projects: { name: string; current?: boolean; shared?: boolean }[];
  published: string[];
  friends: string[];
  groups: string[];
}

/** Бүркітке жүйелік мәтін үшін: менің жобаларым, жарияланғандар, достар, топтар */
export async function loadSiteContext(host: ProjectHost): Promise<BurkitSiteContext> {
  const [vibes, published, friends, groups] = await Promise.all([
    host.listVibe().catch(() => [] as ProjectSummary[]),
    myPublished(host).catch(() => [] as CodeFile[]),
    apiService.getFriends(host.userId).catch(() => []),
    apiService.getGroups().catch(() => []),
  ]);
  return {
    projects: vibes.slice(0, 100).map((p) => ({ name: p.name, current: p.id === host.currentProjectId || undefined, shared: !!p.shareToken || undefined })),
    published: published.slice(0, 100).map((c) => c.title),
    friends: friends.slice(0, 200).map((f) => f.username),
    groups: groups.slice(0, 100).map((g) => g.name),
  };
}
