import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../../contexts/VibecodingContext';
import {
  apiService,
  type CodoInfoDTO,
  type GitBranchesDTO,
  type GitCommitDTO,
  type GitCommitDetailDTO,
  type GitFileStatusDTO,
  type GitMutationDTO,
  type GitStashDTO,
  type GitStatusDTO,
  type GitWorkspaceChangesDTO,
  type PullRequestDTO,
} from '../../../utils/api';
import {
  BranchIcon, CheckIcon, ChevronIcon, ChevronDownIcon, CloseIcon, PlusIcon, RefreshIcon, ArrowLeftIcon,
  FileIcon, FolderIcon, MoreIcon, UploadIcon, DownloadIcon, CopyIcon,
} from '../icons';
import { FileTypeIcon } from '../fileIcons';
import { buildGraph, graphColor, relativeTime, type GraphRow } from './gitGraph';
import { GIT_BRANCH_EVENT, openGitDiff, type GitDiffTarget } from './gitEvents';
import { BranchPicker, GitMenu, type MenuItem } from './GitMenus';
import { PrCreate, PrDetail, PrList } from './PullRequests';
import './SourceControl.css';

const ROW_H = 26;
const LANE_W = 14;
const VIEW_KEY = 'vx-git-view-mode';

type Kind = 'staged' | 'changes';
type Screen = { kind: 'main' } | { kind: 'pr'; id: string } | { kind: 'newpr' };

interface ChangeItem {
  file: GitFileStatusDTO;
  kind: Kind;
  /** Көрсетілетін әріп: M, A, D, R, U (untracked), ! (қақтығыс) */
  letter: string;
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function splitChanges(files: GitFileStatusDTO[]): { staged: ChangeItem[]; changes: ChangeItem[] } {
  const staged: ChangeItem[] = [];
  const changes: ChangeItem[] = [];
  for (const file of files) {
    const xy = file.index + file.worktree;
    if (CONFLICT.has(xy)) {
      changes.push({ file, kind: 'changes', letter: '!' });
      continue;
    }
    if (file.index === '?') {
      changes.push({ file, kind: 'changes', letter: 'U' });
      continue;
    }
    if (file.index !== ' ') staged.push({ file, kind: 'staged', letter: file.index });
    if (file.worktree !== ' ') changes.push({ file, kind: 'changes', letter: file.worktree });
  }
  const byPath = (a: ChangeItem, b: ChangeItem) => a.file.path.localeCompare(b.file.path);
  return { staged: staged.sort(byPath), changes: changes.sort(byPath) };
}

const letterClass = (letter: string) => {
  switch (letter) {
    case 'A': case 'U': return 'is-added';
    case 'D': return 'is-deleted';
    case 'R': case 'C': return 'is-renamed';
    case '!': return 'is-conflict';
    default: return 'is-modified';
  }
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errorStatus = (e: unknown) => (e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : 0);

// ─── Ағаш көрінісі (папкалар бойынша) ─────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  items: ChangeItem[];
}

function buildTree(items: ChangeItem[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dirs: new Map(), items: [] };
  for (const item of items) {
    const segs = item.file.path.split('/');
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const path = segs.slice(0, i + 1).join('/');
      let next = node.dirs.get(segs[i]);
      if (!next) {
        next = { name: segs[i], path, dirs: new Map(), items: [] };
        node.dirs.set(segs[i], next);
      }
      node = next;
    }
    node.items.push(item);
  }
  // Жалғыз ішкі папкаларды біріктіру: src/components → бір жол
  const compact = (n: TreeNode): TreeNode => {
    n.dirs.forEach((d, k) => n.dirs.set(k, compact(d)));
    if (n.path && n.items.length === 0 && n.dirs.size === 1) {
      const only = [...n.dirs.values()][0];
      return { ...only, name: `${n.name}/${only.name}` };
    }
    return n;
  };
  return compact(root);
}

// ─── Граф жолы (SVG) ──────────────────────────────────────────────

const GraphCell: React.FC<{ row: GraphRow; width: number }> = ({ row, width }) => {
  const mid = ROW_H / 2;
  const x = (c: number) => c * LANE_W + LANE_W / 2;
  return (
    <svg className="vx-git-graph__svg" width={width * LANE_W} height={ROW_H} aria-hidden>
      {row.edges.map((e, i) => {
        const y1 = e.half === 'top' ? 0 : mid;
        const y2 = e.half === 'top' ? mid : ROW_H;
        const x1 = x(e.from);
        const x2 = x(e.to);
        const d = x1 === x2
          ? `M${x1} ${y1}V${y2}`
          : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
        return <path key={i} d={d} stroke={graphColor(e.color)} strokeWidth={2} fill="none" strokeLinecap="round" />;
      })}
      {row.isMerge ? (
        <circle cx={x(row.col)} cy={mid} r={3.5} fill="var(--ide-editor-bg, #111)" stroke={graphColor(row.color)} strokeWidth={2} />
      ) : (
        <circle cx={x(row.col)} cy={mid} r={4} fill={graphColor(row.color)} stroke="var(--ide-editor-bg, #111)" strokeWidth={1.5} />
      )}
    </svg>
  );
};

const RefChip: React.FC<{ name: string }> = ({ name }) => {
  const head = name.startsWith('HEAD -> ');
  const label = head ? name.slice(8) : name.replace(/^tag: /, '');
  const kind = head ? 'is-head'
    : name.startsWith('tag: ') ? 'is-tag'
    : name.startsWith('codo/') ? 'is-codo'
    : name.startsWith('upstream/') ? 'is-upstream'
    : name.includes('/') ? 'is-remote' : 'is-branch';
  return (
    <span className={`vx-git-ref ${kind}`} title={name.startsWith('codo/') ? `${name} — сайт Git-інде сақталған нұсқа` : name}>
      {kind === 'is-codo' && <span className="vx-git-ref__cloud" aria-hidden>☁</span>}
      {label}
    </span>
  );
};

// ─── Негізгі панель ───────────────────────────────────────────────

const SourceControlPanel: React.FC<{ isOverlay?: boolean; onClose?: () => void }> = ({ isOverlay, onClose }) => {
  const { t, i18n } = useTranslation();
  const { activeProject, dispatch, flushProjects, saveErrors } = useVibecoding();
  const projectId = activeProject?.id ?? null;
  // Жоба серверге сақталмаған болса (мысалы, тым үлкен) — git сұраулары 404 береді, сондықтан
  // оларды жібермей, себебін көрсетеміз
  const saveError = projectId ? saveErrors[projectId] : undefined;
  const [missing, setMissing] = useState(false);

  const [status, setStatus] = useState<GitStatusDTO | null>(null);
  const [commits, setCommits] = useState<GitCommitDTO[]>([]);
  const [codo, setCodo] = useState<CodoInfoDTO | null>(null);
  const [branches, setBranches] = useState<GitBranchesDTO | null>(null);
  const [stashes, setStashes] = useState<GitStashDTO[]>([]);
  const [prs, setPrs] = useState<PullRequestDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [openSections, setOpenSections] = useState({ staged: true, changes: true, stash: true, prs: true, graph: true });
  const [closedDirs, setClosedDirs] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<GitCommitDetailDTO | null>(null);
  const [menu, setMenu] = useState<'main' | 'commit' | null>(null);
  const [picker, setPicker] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: 'main' });
  const [viewMode, setViewMode] = useState<'list' | 'tree'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'list'; } catch { return 'list'; }
  });
  const reqId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch { /* жеке терезе */ }
  }, [viewMode]);

  // Қосымша мәліметтер (Codo, бұтақтар, stash, PR) — қате болса панель жұмысын тоқтатпайды
  const loadExtras = useCallback(async (id: number) => {
    if (!projectId) return;
    const [c, b, s, p] = await Promise.allSettled([
      apiService.codoInfo(projectId),
      apiService.gitBranches(projectId),
      apiService.gitStashList(projectId),
      apiService.prList(projectId, 'open'),
    ]);
    if (id !== reqId.current) return;
    if (c.status === 'fulfilled') setCodo(c.value);
    if (b.status === 'fulfilled') setBranches(b.value);
    if (s.status === 'fulfilled') setStashes(s.value);
    if (p.status === 'fulfilled') setPrs(p.value);
  }, [projectId]);

  const refresh = useCallback(async (opts: { flush?: boolean; quiet?: boolean } = {}) => {
    if (!projectId || saveError) return;
    const id = ++reqId.current;
    if (!opts.quiet) setLoading(true);
    try {
      if (opts.flush !== false) await flushProjects().catch(() => {});
      const st = await apiService.gitStatus(projectId);
      if (id !== reqId.current) return;
      setMissing(false);
      setStatus(st);
      if (st.repo) {
        const [log] = await Promise.all([apiService.gitLog(projectId), loadExtras(id)]);
        if (id === reqId.current) setCommits(log);
      } else {
        setCommits([]);
        setCodo(null);
        setBranches(null);
        setStashes([]);
        // Репозиторий жоқ болса да — басқалардан келген PR болуы мүмкін
        apiService.prList(projectId, 'open').then((p) => id === reqId.current && setPrs(p)).catch(() => {});
      }
      setError((prev) => (opts.quiet ? prev : null));
    } catch (e) {
      if (id !== reqId.current) return;
      if (errorStatus(e) === 404) {
        setMissing(true);
        setStatus(null);
      } else {
        setError(errorText(e));
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [projectId, saveError, flushProjects, loadExtras]);

  // Жоба ауысқанда — бәрін қайта жүктеу
  useEffect(() => {
    setStatus(null);
    setCommits([]);
    setCodo(null);
    setBranches(null);
    setStashes([]);
    setPrs([]);
    setExpanded(null);
    setDetail(null);
    setError(null);
    setNotice(null);
    setScreen({ kind: 'main' });
    setMissing(false);
    refresh();
  }, [projectId, refresh]);

  // Файлдар өзгергенде (редактор/терминал) — сәл күтіп, күйді жаңарту
  const filesRef = activeProject?.files;
  useEffect(() => {
    if (!filesRef) return;
    const timer = window.setTimeout(() => refresh({ quiet: true }), 1500);
    return () => window.clearTimeout(timer);
  }, [filesRef, refresh]);

  // Терезеге оралғанда (терминалда git командасы орындалған болуы мүмкін)
  useEffect(() => {
    const onFocus = () => refresh({ quiet: true, flush: false });
    window.addEventListener('focus', onFocus);
    window.addEventListener('vibecoding:git-refresh', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('vibecoding:git-refresh', onFocus);
    };
  }, [refresh]);

  // Мерзімді жаңарту: терминалдағы git командалары (add/commit/checkout) файлдарды
  // өзгертпеуі мүмкін — сондықтан күйді әр 4 секунд сайын тексереміз (бет көрінсе ғана)
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busy && !missing) refresh({ quiet: true, flush: false });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [projectId, refresh, busy, missing]);

  // Статус жолағына ағымдағы бұтақ
  useEffect(() => {
    const branch = status?.repo ? (status.detached ? (status.head?.slice(0, 7) ?? 'HEAD') : status.branch ?? null) : null;
    const changes = status?.repo ? (status.files?.length ?? 0) : 0;
    window.dispatchEvent(new CustomEvent(GIT_BRANCH_EVENT, { detail: { projectId, branch, changes } }));
  }, [status, projectId]);

  // Хабарлама бірнеше секундтан соң жоғалады
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const applyChanges = useCallback((changes: GitWorkspaceChangesDTO | null | undefined) => {
    if (changes && projectId) dispatch({ type: 'APPLY_WORKSPACE_CHANGES', payload: { projectId, changes } });
  }, [dispatch, projectId]);

  /** Операцияны орындау: алдымен редактордағы өзгерістер сақталады, соңында бәрі жаңарады */
  const run = useCallback(async (fn: () => Promise<GitStatusDTO | GitMutationDTO | void>, done?: string) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await flushProjects().catch(() => {});
      const res = await fn();
      if (res && 'repo' in res) setStatus(res);
      else if (res && 'status' in res) {
        setStatus(res.status);
        applyChanges(res.changes);
        if (res.error) throw new Error(res.error);
      }
      setError(null);
      if (done) setNotice(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      refresh({ quiet: true, flush: false });
    }
  }, [projectId, flushProjects, applyChanges, refresh]);

  const { staged, changes } = useMemo(() => splitChanges(status?.files ?? []), [status]);
  const graph = useMemo(() => buildGraph(commits), [commits]);
  const pid = projectId!;

  const stage = (paths: string[]) => run(() => apiService.gitStage(pid, paths));
  const unstage = (paths: string[]) => run(() => apiService.gitUnstage(pid, paths));
  const discard = (items: ChangeItem[]) => {
    if (!items.length) return;
    const names = items.length === 1 ? items[0].file.path : `${items.length} ${t('vibecoding.git.files', 'файл')}`;
    const ok = window.confirm(t('vibecoding.git.discardConfirm', '{{name}} өзгерістерін қайтарасыз ба? Бұл әрекетті болдырмау мүмкін емес.', { name: names }));
    if (!ok) return;
    run(async () => {
      const res = await apiService.gitDiscard(pid, items.map((i) => i.file.path));
      applyChanges(res.changes);
      return res.status;
    });
  };

  const hasHead = !!status?.head;
  const codoBranch = status?.branch && !status.detached ? status.branch : null;

  const pushToCodo = (force = false) => run(async () => {
    const res = await apiService.codoPush(pid, undefined, force);
    setCodo(res.codo);
    return res.status;
  }, t('vibecoding.git.codo.pushed', 'Сайт Git-іне сақталды — код толық жаңартылды'));

  const pullFromCodo = (source: 'codo' | 'upstream' = 'codo') => run(async () => {
    const res = await apiService.codoPull(pid, source);
    setCodo(res.codo);
    return res;
  }, source === 'upstream'
    ? t('vibecoding.git.codo.pulledUpstream', 'Түпнұсқа жобадан жаңартулар алынды')
    : t('vibecoding.git.codo.pulled', 'Сайт Git-інен жаңартулар алынды'));

  const sync = () => run(async () => {
    const pulled = await apiService.codoPull(pid, 'codo');
    applyChanges(pulled.changes);
    if (pulled.error) return pulled;
    const res = await apiService.codoPush(pid);
    setCodo(res.codo);
    return res.status;
  }, t('vibecoding.git.codo.synced', 'Сайт Git-імен синхрондалды'));

  const commit = (opts: { push?: boolean } = {}) => {
    const text = message.trim();
    if ((!text && !amend) || busy) return;
    const all = staged.length === 0;
    run(async () => {
      const res = await apiService.gitCommit(pid, text, all, amend);
      setMessage('');
      setAmend(false);
      if (opts.push) {
        const pushed = await apiService.codoPush(pid);
        setCodo(pushed.codo);
        return pushed.status;
      }
      return res.status;
    }, opts.push ? t('vibecoding.git.codo.committedPushed', 'Коммит жасалып, сайт Git-іне сақталды') : undefined);
  };

  const toggleAmend = async () => {
    if (amend) {
      setAmend(false);
      setMessage('');
      return;
    }
    setAmend(true);
    try {
      const { message: last } = await apiService.gitLastMessage(pid);
      setMessage((m) => m || last);
    } catch { /* хабарлама жоқ */ }
    inputRef.current?.focus();
  };

  const undoCommit = () => {
    if (!window.confirm(t('vibecoding.git.undoConfirm', 'Соңғы коммитті болдырмайсыз ба? Өзгерістер индексте қалады.'))) return;
    run(async () => {
      const res = await apiService.gitUndoCommit(pid);
      setMessage((m) => m || res.message);
      return res.status;
    }, t('vibecoding.git.undone', 'Соңғы коммит болдырылмады'));
  };

  const stash = (stagedOnly = false) => {
    const msg = window.prompt(t('vibecoding.git.stash.prompt', 'Stash хабарламасы (міндетті емес)'), '');
    if (msg === null) return;
    run(() => apiService.gitStash(pid, msg, true, stagedOnly), t('vibecoding.git.stash.saved', 'Өзгерістер stash-ке салынды'));
  };
  const stashAction = (action: 'apply' | 'pop' | 'drop', index: number) => {
    if (action === 'drop' && !window.confirm(t('vibecoding.git.stash.dropConfirm', 'Бұл stash-ті өшіресіз бе?'))) return;
    run(() => apiService.gitStashAction(pid, action, index));
  };

  const checkout = (name: string) => run(() => apiService.gitCheckout(pid, name),
    t('vibecoding.git.branch.switched', '«{{name}}» бұтағына ауыстыңыз', { name: name.replace(/^(codo|upstream)\//, '') }));
  const createBranch = (name: string) => run(() => apiService.gitCreateBranch(pid, name, true),
    t('vibecoding.git.branch.created', '«{{name}}» бұтағы жасалды', { name }));
  const mergeBranch = (name: string) => {
    if (!window.confirm(t('vibecoding.git.branch.mergeConfirm', '«{{name}}» бұтағын «{{current}}»-ға біріктіресіз бе?', { name, current: status?.branch ?? '' }))) return;
    run(() => apiService.gitMerge(pid, name));
  };
  const deleteBranch = (name: string) => {
    if (!window.confirm(t('vibecoding.git.branch.deleteConfirm', '«{{name}}» бұтағын өшіресіз бе?', { name }))) return;
    run(async () => {
      try {
        return await apiService.gitDeleteBranch(pid, name);
      } catch (e) {
        if (/not fully merged/i.test(errorText(e)) &&
          window.confirm(t('vibecoding.git.branch.forceDelete', 'Бұтақ біріктірілмеген. Бәрібір өшіресіз бе?'))) {
          return apiService.gitDeleteBranch(pid, name, true);
        }
        throw e;
      }
    });
  };
  const newBranchPrompt = () => {
    const name = window.prompt(t('vibecoding.git.branch.newPrompt', 'Жаңа бұтақ атауы'), '');
    if (name?.trim()) createBranch(name.trim());
  };

  const showDiff = (item: ChangeItem) => {
    const target: GitDiffTarget = {
      projectId: pid,
      path: item.file.path,
      staged: item.kind === 'staged',
      title: `${item.file.path} (${item.kind === 'staged' ? t('vibecoding.git.indexLabel', 'Индекс') : t('vibecoding.git.workingTree', 'Жұмыс папкасы')})`,
    };
    openGitDiff(target);
  };

  const openFile = (path: string) => {
    if (!projectId) return;
    dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId, path } });
  };

  const toggleCommit = async (sha: string) => {
    if (expanded === sha) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(sha);
    setDetail(null);
    try {
      const d = await apiService.gitCommitDetail(pid, sha);
      setDetail(d);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => setNotice(t('vibecoding.git.copied', 'Көшірілді'))).catch(() => {});
  };

  // ─── Мәзірлер ───

  const mainMenu: MenuItem[] = [
    { label: t('vibecoding.git.codo.push', 'Сайт Git-іне сақтау (push)'), onClick: () => pushToCodo(), disabled: !hasHead || !codoBranch },
    { label: t('vibecoding.git.codo.pull', 'Сайт Git-інен тарту (pull)'), onClick: () => pullFromCodo(), disabled: !codo?.published },
    { label: t('vibecoding.git.codo.fetch', 'Сайт Git-інен жаңартуларды тексеру (fetch)'), onClick: () => run(async () => {
      const res = await apiService.codoFetch(pid);
      setCodo(res.codo);
      return res.status;
    }) },
    ...(codo?.parent ? [{ label: t('vibecoding.git.codo.pullUpstream', 'Түпнұсқадан жаңарту (upstream)'), onClick: () => pullFromCodo('upstream') }] : []),
    { label: t('vibecoding.git.codo.forcePush', 'Мәжбүрлі жіберу (force push)'), danger: true, disabled: !hasHead || !codoBranch, onClick: () => {
      if (window.confirm(t('vibecoding.git.codo.forceConfirm', 'Сайт Git-індегі нұсқа сіздікімен алмастырылады, ондағы басқа коммиттер жоғалады. Жалғастырасыз ба?'))) pushToCodo(true);
    } },
    { label: '', separator: true },
    { label: t('vibecoding.git.branch.new', 'Жаңа бұтақ…'), onClick: newBranchPrompt },
    { label: t('vibecoding.git.branch.switch', 'Бұтақ ауыстыру…'), onClick: () => setPicker(true) },
    { label: t('vibecoding.git.pr.new', 'Жаңа pull request'), onClick: () => setScreen({ kind: 'newpr' }), disabled: !hasHead },
    { label: '', separator: true },
    { label: t('vibecoding.git.stash.all', 'Stash: барлық өзгерістер'), onClick: () => stash(false), disabled: !status?.files?.length },
    { label: t('vibecoding.git.stash.staged', 'Stash: тек индекстегілер'), onClick: () => stash(true), disabled: !staged.length },
    { label: t('vibecoding.git.stash.popLatest', 'Соңғы stash-ті қайтару (pop)'), onClick: () => stashAction('pop', 0), disabled: !stashes.length },
    { label: '', separator: true },
    { label: t('vibecoding.git.undo', 'Соңғы коммитті болдырмау'), onClick: undoCommit, disabled: !hasHead },
    ...(status?.merging ? [{ label: t('vibecoding.git.mergeAbort', 'Merge-ді тоқтату'), danger: true, onClick: () => run(() => apiService.gitMergeAbort(pid)) }] : []),
    { label: '', separator: true },
    { label: t('vibecoding.git.viewList', 'Тізім ретінде көрсету'), checked: viewMode === 'list', onClick: () => setViewMode('list') },
    { label: t('vibecoding.git.viewTree', 'Ағаш ретінде көрсету'), checked: viewMode === 'tree', onClick: () => setViewMode('tree') },
  ];

  const commitMenu: MenuItem[] = [
    { label: t('vibecoding.git.commit', 'Коммит'), onClick: () => commit() },
    { label: t('vibecoding.git.commitPush', 'Коммит және сайт Git-іне сақтау'), onClick: () => commit({ push: true }), disabled: !codoBranch },
    { label: '', separator: true },
    { label: t('vibecoding.git.amend', 'Соңғы коммитті түзету (amend)'), checked: amend, onClick: toggleAmend, disabled: !hasHead },
    { label: t('vibecoding.git.undo', 'Соңғы коммитті болдырмау'), onClick: undoCommit, disabled: !hasHead },
  ];

  const header = (
    <div className="vx-explorer__head">
      {isOverlay && onClose && (
        <button type="button" onClick={onClose} className="vx-icon-btn vx-icon-btn--sm" title={t('common.close', 'Жабу')}>
          <ArrowLeftIcon size={17} />
        </button>
      )}
      <span className="vx-explorer__title">{t('vibecoding.git.title', 'Source Control')}</span>
      <div className="vx-explorer__actions vx-git__head-actions" style={{ opacity: 1 }}>
        {status?.repo && (
          <>
            <button type="button" className="vx-icon-btn vx-icon-btn--sm" disabled={busy || !hasHead || !codoBranch}
              onClick={() => pushToCodo()} title={t('vibecoding.git.codo.push', 'Сайт Git-іне сақтау (push)')}>
              <UploadIcon size={15} />
            </button>
            <button type="button" className="vx-icon-btn vx-icon-btn--sm" disabled={busy || !codo?.published}
              onClick={() => pullFromCodo()} title={t('vibecoding.git.codo.pull', 'Сайт Git-інен тарту (pull)')}>
              <DownloadIcon size={15} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => refresh()}
          className={`vx-icon-btn vx-icon-btn--sm ${loading ? 'vx-git-spin' : ''}`}
          title={t('vibecoding.git.refresh', 'Жаңарту')}
        >
          <RefreshIcon size={15} />
        </button>
        {status?.repo && (
          <span className="vx-git__menu-anchor">
            <button type="button" className="vx-icon-btn vx-icon-btn--sm" onClick={() => setMenu(menu === 'main' ? null : 'main')}
              title={t('vibecoding.git.more', 'Басқа әрекеттер')}>
              <MoreIcon size={15} />
            </button>
            {menu === 'main' && <GitMenu items={mainMenu} onClose={() => setMenu(null)} />}
          </span>
        )}
      </div>
    </div>
  );

  if (!activeProject) {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <p className="vx-git__hint">{t('vibecoding.git.noProject', 'Алдымен жоба ашыңыз')}</p>
      </div>
    );
  }

  // ─── Жоба серверде жоқ — git жұмыс істей алмайды ───
  if (saveError || missing) {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <div className="vx-git__empty">
          <span className="vx-git__orb is-warn"><BranchIcon size={26} /></span>
          <p>
            {saveError
              ? t('vibecoding.git.notSavedReason', 'Жоба серверге сақталмады, сондықтан Git жұмыс істемейді. Себебі: {{reason}}', { reason: saveError })
              : t('vibecoding.git.notSaved', 'Жоба серверде әлі жоқ, сондықтан Git жұмыс істемейді. Жоба сақталған соң «Қайта тексеру» батырмасын басыңыз.')}
          </p>
          <button type="button" className="vx-btn vx-btn--xs" disabled={loading}
            onClick={() => { void flushProjects().catch(() => {}).then(() => refresh()); }}>
            <RefreshIcon size={13} />
            {t('vibecoding.git.recheck', 'Қайта тексеру')}
          </button>
        </div>
      </div>
    );
  }

  // ─── PR экрандары ───
  if (screen.kind === 'pr') {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <div className="vx-git__scroll">
          <PrDetail
            projectId={pid}
            prId={screen.id}
            onBack={() => setScreen({ kind: 'main' })}
            onMutation={(res) => { setStatus(res.status); applyChanges(res.changes); }}
            onChanged={() => refresh({ quiet: true, flush: false })}
          />
        </div>
      </div>
    );
  }
  if (screen.kind === 'newpr') {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <div className="vx-git__scroll">
          <PrCreate
            projectId={pid}
            codo={codo}
            currentBranch={codoBranch}
            localBranches={(branches?.local ?? []).map((b) => b.name)}
            onBack={() => setScreen({ kind: 'main' })}
            onCreated={(pr) => {
              setScreen({ kind: 'pr', id: pr.id });
              refresh({ quiet: true, flush: false });
            }}
          />
        </div>
      </div>
    );
  }

  if (status && !status.repo) {
    return (
      <div className="vx-explorer vx-git">
        {header}
        <div className="vx-git__empty">
          <span className="vx-git__orb"><BranchIcon size={26} /></span>
          <p>{t('vibecoding.git.noRepo', 'Бұл жобада әлі git репозиторийі жоқ. Өзгерістерді бақылау және коммиттер графын көру үшін репозиторий жасаңыз.')}</p>
          <button
            type="button"
            className="vx-btn vx-btn--primary vx-btn--xs"
            disabled={busy}
            onClick={() => run(() => apiService.gitInit(pid))}
          >
            <BranchIcon size={14} />
            {t('vibecoding.git.init', 'Репозиторий жасау')}
          </button>
          {error && <p className="vx-git__error">{error}</p>}
        </div>
        {prs.length > 0 && (
          <div className="vx-git__scroll">
            <div className="vx-git-sec__head"><span className="vx-git-sec__title">Pull requests</span><span className="vx-git-sec__count">{prs.length}</span></div>
            <PrList prs={prs} projectId={pid} onOpen={(id) => setScreen({ kind: 'pr', id })} />
          </div>
        )}
      </div>
    );
  }

  const renderItem = (item: ChangeItem, depth = 0, showDir = true) => {
    const name = item.file.path.split('/').pop() || item.file.path;
    const dir = item.file.path.includes('/') ? item.file.path.slice(0, item.file.path.lastIndexOf('/')) : '';
    const deleted = item.letter === 'D';
    return (
      <div
        key={`${item.kind}:${item.file.path}`}
        className="vx-git-item"
        style={depth ? { paddingLeft: 22 + depth * 12 } : undefined}
        role="button"
        tabIndex={0}
        onClick={() => showDiff(item)}
        onKeyDown={(e) => { if (e.key === 'Enter') showDiff(item); }}
        title={item.file.orig ? `${item.file.orig} → ${item.file.path}` : item.file.path}
      >
        <FileTypeIcon name={name} size={16} />
        <span className={`vx-git-item__name ${deleted ? 'is-struck' : ''}`}>{name}</span>
        {showDir && dir && <span className="vx-git-item__dir">{dir}</span>}
        <span className="vx-git-item__actions" onClick={(e) => e.stopPropagation()}>
          {!deleted && (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.openFile', 'Файлды ашу')} onClick={() => openFile(item.file.path)}>
              <FileIcon size={13} />
            </button>
          )}
          {item.kind === 'changes' && (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.discard', 'Өзгерісті қайтару')} onClick={() => discard([item])} disabled={busy}>
              <span className="vx-git-undo" aria-hidden>↺</span>
            </button>
          )}
          {item.kind === 'changes' ? (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.stage', 'Индекске қосу')} onClick={() => stage([item.file.path])} disabled={busy}>
              <PlusIcon size={13} />
            </button>
          ) : (
            <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.unstage', 'Индекстен алу')} onClick={() => unstage([item.file.path])} disabled={busy}>
              <span className="vx-git-minus" aria-hidden>−</span>
            </button>
          )}
        </span>
        <span className={`vx-git-item__letter ${letterClass(item.letter)}`}>{item.letter}</span>
      </div>
    );
  };

  const renderTree = (node: TreeNode, kind: Kind, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => {
      const key = `${kind}:${d.path}`;
      const open = !closedDirs.has(key);
      out.push(
        <div key={`dir:${key}`} className="vx-git-item vx-git-dir" style={{ paddingLeft: 10 + depth * 12 }} role="button" tabIndex={0}
          onClick={() => setClosedDirs((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })}>
          <span className={`vx-git-sec__chev ${open ? 'is-open' : ''}`}><ChevronIcon size={12} /></span>
          <FolderIcon size={14} open={open} />
          <span className="vx-git-item__name">{d.name}</span>
        </div>,
      );
      if (open) out.push(...renderTree(d, kind, depth + 1));
    });
    node.items.forEach((item) => out.push(renderItem(item, depth, false)));
    return out;
  };

  const renderItems = (items: ChangeItem[], kind: Kind) =>
    viewMode === 'tree' ? renderTree(buildTree(items), kind, 0) : items.map((i) => renderItem(i));

  const section = (
    key: keyof typeof openSections,
    title: string,
    count: number,
    actions: React.ReactNode,
    body: React.ReactNode,
  ) => (
    <div className="vx-git-sec">
      <div className="vx-git-sec__head" onClick={() => setOpenSections((s) => ({ ...s, [key]: !s[key] }))}>
        <span className={`vx-git-sec__chev ${openSections[key] ? 'is-open' : ''}`}><ChevronIcon size={13} /></span>
        <span className="vx-git-sec__title">{title}</span>
        <span className="vx-git-sec__actions" onClick={(e) => e.stopPropagation()}>{actions}</span>
        <span className="vx-git-sec__count">{count}</span>
      </div>
      {openSections[key] && <div className="vx-git-sec__body">{body}</div>}
    </div>
  );

  const canCommit = (!!message.trim() || amend) && !busy && (amend ? hasHead : (staged.length > 0 || changes.length > 0));
  const branchLabel = status?.detached ? `HEAD ${status.head?.slice(0, 7) ?? ''}` : status?.branch ?? '…';

  // ─── Codo синхрондау жолағы ───
  const syncBar = (() => {
    if (!status?.repo || !hasHead || !codoBranch || !codo) return null;
    const { ahead, behind, published } = codo;
    let action: React.ReactNode;
    if (!published) {
      action = (
        <button type="button" className="vx-btn vx-git-sync__btn is-publish" disabled={busy} onClick={() => pushToCodo()}>
          <UploadIcon size={12} />
          {t('vibecoding.git.codo.publish', '«{{branch}}» бұтағын сайт Git-іне сақтау', { branch: codoBranch })}
        </button>
      );
    } else if (ahead && behind) {
      action = (
        <button type="button" className="vx-btn vx-git-sync__btn" disabled={busy} onClick={sync}>
          <RefreshIcon size={12} />
          {t('vibecoding.git.codo.sync', 'Синхрондау')} <span className="vx-git-sync__n">↓{behind} ↑{ahead}</span>
        </button>
      );
    } else if (ahead) {
      action = (
        <button type="button" className="vx-btn vx-git-sync__btn is-push" disabled={busy} onClick={() => pushToCodo()}>
          <UploadIcon size={12} />
          {t('vibecoding.git.codo.push', 'Сайт Git-іне сақтау (push)')} <span className="vx-git-sync__n">↑{ahead}</span>
        </button>
      );
    } else if (behind) {
      action = (
        <button type="button" className="vx-btn vx-git-sync__btn" disabled={busy} onClick={() => pullFromCodo()}>
          <DownloadIcon size={12} />
          {t('vibecoding.git.codo.pull', 'Сайт Git-інен тарту (pull)')} <span className="vx-git-sync__n">↓{behind}</span>
        </button>
      );
    } else {
      action = (
        <span className="vx-git-sync__ok" title={t('vibecoding.git.codo.savedHint', 'Басқалар жобаны жүктегенде (fork) осы нұсқаны алады. Жобалар бетіне шығару — бөлек: «Сайтқа жариялау» батырмасы.')}>
          <CheckIcon size={11} /> {t('vibecoding.git.codo.saved', 'Сайт Git-інде сақталған — код толық жаңартылған')}
        </span>
      );
    }
    const up = codo.upstream;
    return (
      <div className="vx-git-sync">
        {action}
        {up && up.behind > 0 && (
          <button type="button" className="vx-btn vx-git-sync__btn is-upstream" disabled={busy} onClick={() => pullFromCodo('upstream')}
            title={codo.parent ? `${codo.parent.name} · ${codo.parent.owner?.username ?? ''}` : undefined}>
            <DownloadIcon size={12} />
            {t('vibecoding.git.codo.upstreamBehind', 'Түпнұсқада жаңа коммиттер')} <span className="vx-git-sync__n">↓{up.behind}</span>
          </button>
        )}
      </div>
    );
  })();

  return (
    <div className="vx-explorer vx-git">
      {header}

      <div className="vx-git__scroll">
        {/* Коммит жолы */}
        <div className="vx-git-commit">
          <div className="vx-git-branch-row">
            <span className="vx-git__menu-anchor">
              <button type="button" className="vx-git-branch" onClick={() => setPicker((v) => !v)}
                title={t('vibecoding.git.branch.switch', 'Бұтақ ауыстыру…')}>
                <BranchIcon size={13} />
                <span>{branchLabel}</span>
                <ChevronDownIcon size={11} />
              </button>
              {picker && (
                <BranchPicker
                  branches={branches}
                  codo={codo}
                  onClose={() => setPicker(false)}
                  onCheckout={checkout}
                  onCreate={createBranch}
                  onMerge={mergeBranch}
                  onDelete={deleteBranch}
                />
              )}
            </span>
            {!!status?.ahead && <span className="vx-git-branch__sync">↑{status.ahead}</span>}
            {!!status?.behind && <span className="vx-git-branch__sync">↓{status.behind}</span>}
            {codo?.parent && (
              <span className="vx-git-fork" title={t('vibecoding.git.codo.forkOf', 'Fork: {{name}} ({{owner}})', { name: codo.parent.name, owner: codo.parent.owner?.username ?? '?' })}>
                ⑂ {codo.parent.owner?.username ?? ''}
              </span>
            )}
          </div>

          {status?.merging && (
            <div className="vx-git-banner">
              <span>{t('vibecoding.git.merging', 'Merge жүріп жатыр — конфликттерді шешіп, коммит жасаңыз')}</span>
              <button type="button" className="vx-btn vx-btn--xs" disabled={busy} onClick={() => run(() => apiService.gitMergeAbort(pid))}>
                {t('vibecoding.git.mergeAbort', 'Merge-ді тоқтату')}
              </button>
            </div>
          )}

          <textarea
            ref={inputRef}
            className="vx-git-commit__input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit({ push: e.shiftKey });
              }
            }}
            placeholder={amend
              ? t('vibecoding.git.amendPlaceholder', 'Соңғы коммиттің жаңа хабарламасы')
              : t('vibecoding.git.messagePlaceholder', 'Хабарлама (Ctrl+Enter — коммит)')}
            rows={Math.min(message.split('\n').length, 6)}
          />
          <div className="vx-git-commit__actions">
            <button type="button" className="vx-btn vx-btn--primary vx-git-commit__btn vx-git-commit__main" disabled={!canCommit} onClick={() => commit()}>
              <CheckIcon size={12} />
              {amend
                ? t('vibecoding.git.amendBtn', 'Коммитті түзету')
                : staged.length === 0 && changes.length > 0
                  ? t('vibecoding.git.commitAll', 'Барлығын коммиттеу')
                  : t('vibecoding.git.commit', 'Коммит')}
            </button>
            <span className="vx-git__menu-anchor">
              <button type="button" className="vx-btn vx-btn--primary vx-git-commit__btn vx-git-commit__more" disabled={busy}
                onClick={() => setMenu(menu === 'commit' ? null : 'commit')} title={t('vibecoding.git.commitOptions', 'Коммит әрекеттері')}>
                <ChevronDownIcon size={12} />
              </button>
              {menu === 'commit' && <GitMenu items={commitMenu} onClose={() => setMenu(null)} />}
            </span>
          </div>
          {syncBar}
          {notice && <div className="vx-git__notice"><CheckIcon size={11} /> {notice}</div>}
          {error && (
            <div className="vx-git__error">
              <span>{error}</span>
              <button type="button" className="vx-icon-btn vx-icon-btn--xs" onClick={() => setError(null)}><CloseIcon size={11} /></button>
            </div>
          )}
        </div>

        {/* Өзгерістер */}
        {staged.length > 0 && section(
          'staged',
          t('vibecoding.git.stagedChanges', 'Индекстегі өзгерістер'),
          staged.length,
          <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.unstageAll', 'Барлығын индекстен алу')} onClick={() => unstage([])} disabled={busy}>
            <span className="vx-git-minus" aria-hidden>−</span>
          </button>,
          renderItems(staged, 'staged'),
        )}
        {section(
          'changes',
          t('vibecoding.git.changes', 'Өзгерістер'),
          changes.length,
          <>
            {changes.length > 0 && (
              <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.discardAll', 'Барлық өзгерісті қайтару')} onClick={() => discard(changes)} disabled={busy}>
                <span className="vx-git-undo" aria-hidden>↺</span>
              </button>
            )}
            {changes.length > 0 && (
              <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.stageAll', 'Барлығын индекске қосу')} onClick={() => stage([])} disabled={busy}>
                <PlusIcon size={13} />
              </button>
            )}
          </>,
          renderItems(changes, 'changes'),
        )}
        {status && staged.length === 0 && changes.length === 0 && (
          <p className="vx-git__hint">{t('vibecoding.git.clean', 'Өзгеріс жоқ — бәрі коммиттелген')}</p>
        )}
        {status?.truncated && <p className="vx-git__hint">{t('vibecoding.git.truncated', 'Тізім тым ұзын — бір бөлігі ғана көрсетілді')}</p>}

        {/* Stash */}
        {stashes.length > 0 && section(
          'stash',
          t('vibecoding.git.stash.title', 'Stash'),
          stashes.length,
          null,
          stashes.map((s) => (
            <div key={s.index} className="vx-git-item vx-git-stash" title={s.message}>
              <span className="vx-git-stash__idx">{s.index}</span>
              <span className="vx-git-item__name">{s.message.replace(/^(On|WIP on) [^:]+: /, '')}</span>
              <span className="vx-git-item__dir">{relativeTime(s.time, i18n.language)}</span>
              <span className="vx-git-item__actions">
                <button type="button" className="vx-icon-btn vx-icon-btn--xs" disabled={busy} title={t('vibecoding.git.stash.apply', 'Қолдану (stash сақталады)')} onClick={() => stashAction('apply', s.index)}>
                  <CheckIcon size={12} />
                </button>
                <button type="button" className="vx-icon-btn vx-icon-btn--xs" disabled={busy} title={t('vibecoding.git.stash.pop', 'Қайтару (pop)')} onClick={() => stashAction('pop', s.index)}>
                  <DownloadIcon size={12} />
                </button>
                <button type="button" className="vx-icon-btn vx-icon-btn--xs" disabled={busy} title={t('vibecoding.git.stash.drop', 'Өшіру')} onClick={() => stashAction('drop', s.index)}>
                  <CloseIcon size={11} />
                </button>
              </span>
            </div>
          )),
        )}

        {/* Pull requests */}
        {section(
          'prs',
          t('vibecoding.git.pr.section', 'Pull requests'),
          prs.length,
          <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.pr.new', 'Жаңа pull request')}
            onClick={() => setScreen({ kind: 'newpr' })} disabled={!hasHead}>
            <PlusIcon size={13} />
          </button>,
          <PrList prs={prs} projectId={pid} onOpen={(id) => setScreen({ kind: 'pr', id })} />,
        )}

        {/* Граф */}
        <div className="vx-git-sec vx-git-sec--graph">
          <div className="vx-git-sec__head" onClick={() => setOpenSections((s) => ({ ...s, graph: !s.graph }))}>
            <span className={`vx-git-sec__chev ${openSections.graph ? 'is-open' : ''}`}><ChevronIcon size={13} /></span>
            <span className="vx-git-sec__title">{t('vibecoding.git.graph', 'Граф')}</span>
            <span className="vx-git-sec__count">{commits.length}</span>
          </div>
          {openSections.graph && (
            <div className="vx-git-graph">
              {/* Коммиттелмеген өзгерістер — граф басында (VS Code сияқты) */}
              {(staged.length > 0 || changes.length > 0) && (
                <div className="vx-git-graph__row is-wip" onClick={() => inputRef.current?.focus()}
                  title={t('vibecoding.git.wipHint', 'Коммит жасау үшін жоғарыдағы хабарламаны жазыңыз')}>
                  <svg className="vx-git-graph__svg" width={Math.max(graph.maxWidth, 1) * LANE_W} height={ROW_H} aria-hidden>
                    {commits.length > 0 && <path d={`M${LANE_W / 2} ${ROW_H / 2}V${ROW_H}`} stroke={graphColor(0)} strokeWidth={2} strokeDasharray="2 3" />}
                    <circle cx={LANE_W / 2} cy={ROW_H / 2} r={4} fill="none" stroke={graphColor(0)} strokeWidth={1.6} strokeDasharray="2 2" />
                  </svg>
                  <span className="vx-git-graph__text">
                    <span className="vx-git-graph__subject">{t('vibecoding.git.wip', 'Коммиттелмеген өзгерістер')}</span>
                  </span>
                  <span className="vx-git-graph__meta">{staged.length + changes.length} {t('vibecoding.git.files', 'файл')}</span>
                </div>
              )}
              {commits.length === 0 && (
                <p className="vx-git__hint">{t('vibecoding.git.noCommits', 'Әзірге коммит жоқ')}</p>
              )}
              {graph.rows.map((row) => {
                const c = row.commit;
                const open = expanded === c.sha;
                return (
                  <React.Fragment key={c.sha}>
                    <div
                      className={`vx-git-graph__row ${open ? 'is-open' : ''}`}
                      onClick={() => toggleCommit(c.sha)}
                      title={`${c.sha.slice(0, 8)} · ${c.author} · ${new Date(c.time * 1000).toLocaleString(i18n.language)}\n${c.subject}`}
                    >
                      <GraphCell row={row} width={graph.maxWidth} />
                      <span className="vx-git-graph__text">
                        {c.refs.filter((r) => r !== 'codo/HEAD').map((r) => <RefChip key={r} name={r} />)}
                        <span className="vx-git-graph__subject">{c.subject}</span>
                      </span>
                      <span className="vx-git-graph__meta">{c.author} · {relativeTime(c.time, i18n.language)}</span>
                    </div>
                    {open && (
                      <div className="vx-git-detail" style={{ marginLeft: graph.maxWidth * LANE_W }}>
                        {!detail ? (
                          <span className="vx-git__hint">…</span>
                        ) : (
                          <>
                            <div className="vx-git-detail__meta">
                              <code>{detail.sha.slice(0, 10)}</code>
                              <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={t('vibecoding.git.copySha', 'SHA көшіру')} onClick={() => copy(detail.sha)}>
                                <CopyIcon size={11} />
                              </button>
                              · {detail.author} &lt;{detail.email}&gt;
                              <span className="vx-git-detail__acts">
                                <button type="button" className="vx-btn vx-btn--xs" disabled={busy}
                                  onClick={() => {
                                    const name = window.prompt(t('vibecoding.git.branch.fromCommit', 'Осы коммиттен жаңа бұтақ атауы'), '');
                                    if (name?.trim()) run(() => apiService.gitCreateBranch(pid, name.trim(), true, detail.sha));
                                  }}>
                                  <BranchIcon size={11} /> {t('vibecoding.git.branch.here', 'Бұтақ')}
                                </button>
                              </span>
                            </div>
                            {detail.message !== c.subject && <pre className="vx-git-detail__msg">{detail.message}</pre>}
                            {detail.files.map((f) => {
                              const name = f.path.split('/').pop() || f.path;
                              return (
                                <div
                                  key={f.path}
                                  className="vx-git-item"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openGitDiff({ projectId: pid, path: f.path, sha: detail.sha, title: `${f.path} (${detail.sha.slice(0, 7)})` })}
                                  title={f.path}
                                >
                                  <FileTypeIcon name={name} size={15} />
                                  <span className={`vx-git-item__name ${f.status === 'D' ? 'is-struck' : ''}`}>{name}</span>
                                  {f.path.includes('/') && <span className="vx-git-item__dir">{f.path.slice(0, f.path.lastIndexOf('/'))}</span>}
                                  <span className={`vx-git-item__letter ${letterClass(f.status)}`}>{f.status}</span>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourceControlPanel;
