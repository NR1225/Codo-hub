import React, { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useVibecoding, VirtualFile, normalizePath } from '../../contexts/VibecodingContext';
import {
  FolderIcon,
  FolderPlusIcon,
  FilePlusIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
  ChevronIcon,
  ChevronDownIcon,
  SearchIcon,
  CloseIcon,
  ArrowLeftIcon,
  BranchIcon,
  CollapseIcon,
  CopyIcon,
  LayersIcon,
} from './icons';
import { FileTypeIcon, FolderTypeIcon } from './fileIcons';
import { ARCHITECTURE_TEMPLATES, ArchitectureTemplate } from './architectureTemplates';

// ─── Папка ағашы ───────────────────────────────────────────────────

interface DirNode {
  /** Көрсетілетін атау — ықшам папкада "src/components" сияқты бірнеше бөлік */
  name: string;
  /** Толық жол (ықшам папкада — ең ішкі папканың жолы) */
  path: string;
  dirs: DirNode[];
  files: VirtualFile[];
}

// file.path бойынша ағаш құру: папкалар алдымен, сосын файлдар (әліпби бойынша)
function buildFileTree(files: VirtualFile[], folders: string[] = []): DirNode {
  const root: DirNode = { name: '', path: '', dirs: [], files: [] };
  const ensureDir = (segs: string[]): DirNode => {
    let node = root;
    segs.forEach((seg) => {
      const path = node.path ? `${node.path}/${seg}` : seg;
      let child = node.dirs.find((d) => d.name === seg);
      if (!child) {
        child = { name: seg, path, dirs: [], files: [] };
        node.dirs.push(child);
      }
      node = child;
    });
    return node;
  };
  folders.forEach((folder) => ensureDir(folder.split('/').filter(Boolean)));
  files.forEach((file) => {
    const segs = (file.path || file.name).split('/').filter(Boolean).slice(0, -1);
    ensureDir(segs).files.push(file);
  });
  const sort = (node: DirNode) => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.name.localeCompare(b.name));
    node.dirs.forEach(sort);
  };
  sort(root);
  return root;
}

// VS Code-тағы ықшам папкалар: ішінде тек бір папка бар тізбек бір жолға біріктіріледі
// ("src" → "components" → "ui" = "src/components/ui"). stopAt — біріктірілмейтін жолдар
// (ішінде файл жасалып не аты өзгертіліп жатқан папка).
function compactTree(node: DirNode, stopAt: Set<string>): DirNode {
  return {
    ...node,
    dirs: node.dirs.map((dir) => {
      let d = dir;
      let name = dir.name;
      while (d.files.length === 0 && d.dirs.length === 1 && !stopAt.has(d.path)) {
        d = d.dirs[0];
        name += `/${d.name}`;
      }
      return compactTree({ ...d, name }, stopAt);
    }),
  };
}

// Файлды көрсету үшін оның барлық ата-папкаларының жолдары
function ancestorDirs(path: string): string[] {
  const segs = path.split('/').filter(Boolean).slice(0, -1);
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'));
}

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
const baseOf = (path: string) => path.split('/').pop() || path;
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

// Жол биіктігі CSS-тегі .vx-row биіктігімен бірдей — жабысқақ тақырыптар осымен орналасады
const ROW_H = 26;
// VS Code сияқты: әр деңгей 12px
const INDENT_PX = 12;
const BASE_PAD = 10;
const indentOf = (depth: number) => BASE_PAD + depth * INDENT_PX;

// Пернетақтамен жылжу үшін көрінетін жолдардың жазық тізімі
interface VisibleRow {
  key: string;
  kind: 'dir' | 'file';
  path: string;
  fileId?: string;
  parent: string;
}

// ─── Контекст мәзірі (тінтуірдің оң батырмасы / ұзақ басу) ─────────

interface MenuItem {
  icon: React.ReactNode;
  label: string;
  /** Атаудың астындағы түсіндірме (мысалы, үлгінің сипаттамасы) */
  sub?: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}
type MenuEntry = MenuItem | 'divider';

interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

const ContextMenu: React.FC<ContextMenuState & { onClose: () => void }> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Экраннан шықпауы үшін орнын түзету
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // .vibe-root ішіне рендерлейміз — CSS айнымалылары сақталады, панельдің overflow-ы кеспейді
  const host = document.querySelector('.vibe-root') ?? document.body;
  return createPortal(
    <div
      ref={ref}
      className="vx-menu vx-menu--context"
      role="menu"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={`div-${i}`} className="vx-menu__divider" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`vx-menu__item ${item.danger ? 'is-danger' : ''}`}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span className="vx-menu__icon">{item.icon}</span>
            {item.sub ? (
              <span className="vx-menu__label vx-menu__label--stack">
                {item.label}
                <small>{item.sub}</small>
              </span>
            ) : (
              <span className="vx-menu__label">{item.label}</span>
            )}
            {item.hint && <kbd className="vx-menu__hint">{item.hint}</kbd>}
          </button>
        )
      )}
    </div>,
    host
  );
};

// ─── Атау енгізу өрісі (жаңа файл / атауын өзгерту) ───────────────

const NameInput: React.FC<{
  initial: string;
  placeholder?: string;
  selectBase?: boolean;
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}> = ({ initial, placeholder, selectBase, onChange, onSubmit, onCancel }) => {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (submit && v && v !== initial) onSubmit(v);
    else onCancel();
  };
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onFocus={(e) => {
        // Файлда кеңейтпесіз бөлігін белгілеу (VS Code сияқты)
        const dot = selectBase ? initial.lastIndexOf('.') : -1;
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length);
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className="vx-row__input"
      autoFocus
    />
  );
};

// ─── Панель ───────────────────────────────────────────────────────

const FileExplorerPanel: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, activeProject, isMobile, isTablet } = useVibecoding();
  const isOverlay = isMobile || isTablet;

  // Жаңа файл немесе папка жасау: parent — қай папканың ішінде ('' — түбір)
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: string } | null>(null);
  const [createName, setCreateName] = useState('');
  // Аты өзгертіліп жатқан жол кілті: "d:<path>" немесе "f:<id>"
  const [renaming, setRenaming] = useState<string | null>(null);
  // Таңдалған жол (VS Code-тағы фокус): жаңа файл осы папкада жасалады
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // Сүйреп тастау: қай папкаға түседі ('' — түбір, null — ешқайда)
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragRef = useRef<{ path: string } | null>(null);
  const dropRef = useRef<string | null>(null);
  const expandTimer = useRef<number>();
  const treeRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const files = useMemo(() => activeProject?.files ?? [], [activeProject]);
  const folders = useMemo(() => activeProject?.folders ?? [], [activeProject]);

  // Жол бос па — жылжыту/атын өзгерту алдында тексеру
  const pathTaken = useCallback(
    (path: string) => {
      const inside = (p: string) => p === path || p.startsWith(`${path}/`);
      return files.some((f) => inside(f.path)) || folders.some(inside);
    },
    [files, folders]
  );

  const expand = useCallback((...paths: string[]) => {
    setExpandedDirs((prev) => {
      const missing = paths.filter((p) => p && !prev.has(p));
      return missing.length ? new Set([...prev, ...missing]) : prev;
    });
  }, []);

  const startCreating = useCallback((kind: 'file' | 'folder', parent = '') => {
    setTreeCollapsed(false);
    if (parent) expand(parent, ...ancestorDirs(`${parent}/_`));
    setCreating({ kind, parent });
    setCreateName('');
  }, [expand]);

  const handleCreate = useCallback((name: string) => {
    if (!creating) return;
    // "src/utils.ts" сияқты жол жазылса — файл/папка сол папкада жасалады
    const path = normalizePath(`${creating.parent}/${name}`);
    // "components/" сияқты соңы "/" болса — файл емес, папка жасалады
    const asFolder = creating.kind === 'folder' || name.endsWith('/');
    setCreating(null);
    if (!path || path === normalizePath(creating.parent)) return;
    if (pathTaken(path)) {
      window.alert(`"${path}" бар — басқа атау таңдаңыз.`);
      return;
    }
    if (asFolder) {
      dispatch({ type: 'CREATE_FOLDER', payload: { path } });
      expand(...ancestorDirs(`${path}/_`));
      setSelected(`d:${path}`);
    } else {
      dispatch({ type: 'CREATE_FILE', payload: { name: baseOf(path), path, content: '' } });
    }
  }, [dispatch, creating, pathTaken, expand]);

  // Атын өзгерту және жылжыту — бір әрекет (MOVE_PATH)
  const movePath = useCallback((from: string, to: string, isDir: boolean) => {
    if (from === to) return;
    if (pathTaken(to)) {
      window.alert(`"${to}" бар — басқа атау таңдаңыз.`);
      return;
    }
    dispatch({ type: 'MOVE_PATH', payload: { from, to } });
    if (isDir) {
      // Ашық папкалар жаңа жолмен ашық қалады
      setExpandedDirs((prev) => new Set([...prev].map((p) =>
        p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p
      )));
      setSelected(`d:${to}`);
    }
    expand(...ancestorDirs(to));
  }, [dispatch, pathTaken, expand]);

  const moveInto = useCallback((from: string, targetDir: string) => {
    if (targetDir === from || targetDir.startsWith(`${from}/`) || parentOf(from) === targetDir) return;
    const isDir = !files.some((f) => f.path === from);
    movePath(from, joinPath(targetDir, baseOf(from)), isDir);
  }, [files, movePath]);

  const handleDeleteFolder = useCallback((path: string) => {
    const count = files.filter((f) => f.path.startsWith(`${path}/`)).length;
    const message = count > 0
      ? `"${path}" папкасы ішіндегі ${count} файлмен бірге жойылады. Жалғастырасыз ба?`
      : `"${path}" папкасын жою керек пе?`;
    if (!window.confirm(message)) return;
    dispatch({ type: 'DELETE_FOLDER', payload: { path } });
  }, [dispatch, files]);

  const handleDeleteFile = useCallback((fileId: string) => {
    dispatch({ type: 'DELETE_FILE', payload: { fileId } });
  }, [dispatch]);

  const handleDuplicate = useCallback((file: VirtualFile) => {
    const dir = parentOf(file.path);
    const dot = file.name.lastIndexOf('.');
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
    const ext = dot > 0 ? file.name.slice(dot) : '';
    let name = `${stem} copy${ext}`;
    for (let i = 2; pathTaken(joinPath(dir, name)); i++) name = `${stem} copy ${i}${ext}`;
    dispatch({ type: 'CREATE_FILE', payload: { name, path: joinPath(dir, name), content: file.content } });
  }, [dispatch, pathTaken]);

  // Дайын құрылымды таңдалған папканың ішіне қосу (барлары өзгермейді)
  const applyTemplate = useCallback((tpl: ArchitectureTemplate, baseDir: string) => {
    setTreeCollapsed(false);
    tpl.folders.forEach((folder) => {
      const path = joinPath(baseDir, folder);
      if (!pathTaken(path)) dispatch({ type: 'CREATE_FOLDER', payload: { path } });
    });
    tpl.files?.forEach((file) => {
      const path = joinPath(baseDir, file.path);
      if (!pathTaken(path)) dispatch({ type: 'CREATE_FILE', payload: { name: baseOf(path), path, content: file.content } });
    });
    const created = [...tpl.folders, ...(tpl.files ?? []).map((f) => f.path)].map((p) => joinPath(baseDir, p));
    expand(baseDir, ...created.flatMap((p) => ancestorDirs(`${p}/_`)));
  }, [dispatch, pathTaken, expand]);

  const handleSwitchProject = useCallback((projectId: string) => {
    dispatch({ type: 'SWITCH_PROJECT', payload: { projectId } });
    setShowProjectMenu(false);
  }, [dispatch]);

  const handleCreateProject = useCallback(() => {
    dispatch({ type: 'CREATE_PROJECT', payload: { name: `Project ${state.projects.length + 1}` } });
    setShowProjectMenu(false);
  }, [dispatch, state.projects.length]);

  const copyPath = useCallback((path: string) => {
    navigator.clipboard?.writeText(path).catch(() => {});
  }, []);

  const openMenu = useCallback((e: React.MouseEvent, items: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const collapseAll = useCallback(() => setExpandedDirs(new Set()), []);

  // «Құрылым қосу» мәзірі: батырманың астында ашылады
  const openTemplates = (e: React.MouseEvent, baseDir: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: ARCHITECTURE_TEMPLATES.map((tpl) => ({
        icon: <LayersIcon size={14} />,
        label: tpl.title,
        sub: tpl.description,
        onClick: () => applyTemplate(tpl, baseDir),
      })),
    });
  };

  // Ағаш: сүзгі → толық ағаш → ықшам папкалар
  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? files.filter((f) => (f.path || f.name).toLowerCase().includes(q)) : files;
  }, [files, searchQuery]);

  const renamingDir = renaming?.startsWith('d:') ? renaming.slice(2) : null;
  const tree = useMemo(() => {
    const full = buildFileTree(filteredFiles, searchQuery ? [] : folders);
    const stopAt = new Set([creating?.parent, renamingDir].filter((p): p is string => !!p));
    return compactTree(full, stopAt);
  }, [filteredFiles, searchQuery, folders, creating?.parent, renamingDir]);

  // Іздеу кезінде сәйкес папкалардың бәрі ашық тұрады
  const isOpen = useCallback((path: string) => !!searchQuery || expandedDirs.has(path), [searchQuery, expandedDirs]);

  const visibleRows = useMemo(() => {
    const out: VisibleRow[] = [];
    const walk = (node: DirNode) => {
      node.dirs.forEach((dir) => {
        out.push({ key: `d:${dir.path}`, kind: 'dir', path: dir.path, parent: node.path });
        if (isOpen(dir.path)) walk(dir);
      });
      node.files.forEach((f) => out.push({ key: `f:${f.id}`, kind: 'file', path: f.path, fileId: f.id, parent: node.path }));
    };
    walk(tree);
    return out;
  }, [tree, isOpen]);

  // Ашық папкалар (жоба ауысқанда — тек жоғарғы деңгей ашық)
  useEffect(() => {
    if (!activeProject) return;
    setExpandedDirs(new Set(buildFileTree(activeProject.files, activeProject.folders).dirs.map((d) => d.path)));
    setSelected(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id]);

  // Белсенді файлдың папкаларын автоматты ашу және файлды таңдау
  const activeFilePath = files.find((f) => f.id === state.activeFileId)?.path;
  useEffect(() => {
    if (!activeFilePath || !state.activeFileId) return;
    expand(...ancestorDirs(activeFilePath));
    setSelected(`f:${state.activeFileId}`);
  }, [activeFilePath, state.activeFileId, expand]);

  // Ашық файл көрінетін жерге айналдырылады
  useEffect(() => {
    if (!state.activeFileId) return;
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-key="f:${state.activeFileId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [state.activeFileId, visibleRows]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Жаңа файл/папка қай папкада жасалады: таңдалған папка немесе таңдалған файлдың папкасы
  const targetDir = useMemo(() => {
    const row = visibleRows.find((r) => r.key === selected);
    if (!row) return '';
    return row.kind === 'dir' ? row.path : row.parent;
  }, [visibleRows, selected]);

  const focusRow = (key: string) => {
    setSelected(key);
    treeRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };

  // ── Пернетақта (VS Code сияқты): ↑ ↓ ← → Home End Enter F2 Delete ──
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    // Өріске жазу мен жолдағы батырмалар өз пернелерін өздері өңдейді
    if (['INPUT', 'BUTTON'].includes((e.target as HTMLElement).tagName)) return;
    const idx = visibleRows.findIndex((r) => r.key === selected);
    const row = visibleRows[idx];
    const go = (i: number) => {
      const next = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, i))];
      if (next) focusRow(next.key);
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(idx + 1); break;
      case 'ArrowUp': e.preventDefault(); go(idx < 0 ? 0 : idx - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(visibleRows.length - 1); break;
      case 'ArrowRight':
        if (row?.kind !== 'dir') break;
        e.preventDefault();
        if (!isOpen(row.path)) toggleDir(row.path);
        else go(idx + 1);
        break;
      case 'ArrowLeft':
        if (!row) break;
        e.preventDefault();
        if (row.kind === 'dir' && isOpen(row.path) && !searchQuery) toggleDir(row.path);
        else if (row.parent) focusRow(`d:${row.parent}`);
        break;
      case 'Enter':
      case ' ':
        if (!row) break;
        e.preventDefault();
        if (row.kind === 'dir') toggleDir(row.path);
        else if (row.fileId) dispatch({ type: 'OPEN_FILE', payload: { fileId: row.fileId } });
        break;
      case 'F2':
        if (!row) break;
        e.preventDefault();
        setRenaming(row.key);
        break;
      case 'Delete':
        if (!row) break;
        e.preventDefault();
        if (row.kind === 'dir') handleDeleteFolder(row.path);
        else if (row.fileId) handleDeleteFile(row.fileId);
        break;
    }
  };

  // ── Сүйреп тастау ──
  const setDrop = (target: string | null) => {
    dropRef.current = target;
    setDropTarget(target);
  };

  const onRowDragStart = (e: React.DragEvent, path: string) => {
    dragRef.current = { path };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
  };

  const onDragEnd = () => {
    dragRef.current = null;
    window.clearTimeout(expandTimer.current);
    setDrop(null);
  };

  const onDirDragOver = (e: React.DragEvent, path: string) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropRef.current === path) return;
    setDrop(path);
    // Жабық папканың үстінде біраз тұрса — ашылады (VS Code сияқты)
    window.clearTimeout(expandTimer.current);
    if (!expandedDirs.has(path)) {
      expandTimer.current = window.setTimeout(() => expand(path), 600);
    }
  };

  const onTreeDragOver = (e: React.DragEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    if (dropRef.current !== '') {
      window.clearTimeout(expandTimer.current);
      setDrop('');
    }
  };

  const onTreeDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const drag = dragRef.current;
    const target = dropRef.current;
    onDragEnd();
    if (drag && target !== null) moveInto(drag.path, target);
  };

  const onTreeDragLeave = (e: React.DragEvent) => {
    if (!treeRef.current?.contains(e.relatedTarget as Node)) {
      window.clearTimeout(expandTimer.current);
      setDrop(null);
    }
  };

  // ── Жолдар ──
  const rootMenuItems: MenuEntry[] = [
    { icon: <FilePlusIcon size={14} />, label: t('vibecoding.fileExplorer.newFile'), onClick: () => startCreating('file') },
    { icon: <FolderPlusIcon size={14} />, label: 'Жаңа папка', onClick: () => startCreating('folder') },
    'divider',
    { icon: <CollapseIcon size={14} />, label: 'Барлық папкаларды жию', onClick: collapseAll },
  ];

  const createRow = (depth: number) => {
    if (!creating) return null;
    const asFolder = creating.kind === 'folder' || createName.endsWith('/');
    const lastSeg = baseOf(normalizePath(createName)) || (asFolder ? 'folder' : '');
    return (
      <div className="vx-create">
        <div className="vx-row vx-row--create" style={{ paddingLeft: indentOf(depth) + (asFolder ? 0 : 16) }}>
          {asFolder && (
            <span className="vx-row__chevron">
              <ChevronIcon size={14} />
            </span>
          )}
          <span className="vx-row__icon">
            {asFolder ? <FolderTypeIcon name={lastSeg} /> : <FileTypeIcon name={lastSeg} />}
          </span>
          <NameInput
            initial=""
            placeholder={creating.kind === 'folder' ? 'папка аты' : 'файл аты, мысалы app.js'}
            onChange={setCreateName}
            onSubmit={handleCreate}
            onCancel={() => setCreating(null)}
          />
        </div>
        <div className="vx-create__hint" style={{ paddingLeft: indentOf(depth) + 16 }}>
          {creating.kind === 'folder'
            ? <>Ішкі папкалар: <code>api/routes</code></>
            : <>Папкамен бірге: <code>components/Button.jsx</code> · папка: <code>utils/</code></>}
          {creating.parent && <> · ішінде <code>{creating.parent}/</code></>}
        </div>
      </div>
    );
  };

  const renderFile = (file: VirtualFile, depth: number) => {
    const key = `f:${file.id}`;
    const isActive = file.id === state.activeFileId;
    const isRenaming = renaming === key;
    return (
      <div
        key={key}
        data-key={key}
        className={`vx-row vx-row--file ${isActive ? 'is-active' : ''} ${selected === key ? 'is-selected' : ''}`}
        // Файлда шеврон жоқ — оның орнына бос орын, белгіше папка белгішесімен бір сызықта
        style={{ paddingLeft: indentOf(depth) + 16 }}
        onClick={() => {
          setSelected(key);
          if (!isRenaming) dispatch({ type: 'OPEN_FILE', payload: { fileId: file.id } });
        }}
        onFocus={() => setSelected(key)}
        onContextMenu={(e) => {
          setSelected(key);
          openMenu(e, [
            { icon: <EditIcon size={14} />, label: 'Атауын өзгерту', hint: 'F2', onClick: () => setRenaming(key) },
            { icon: <CopyIcon size={14} />, label: 'Көшірмесін жасау', onClick: () => handleDuplicate(file) },
            { icon: <CopyIcon size={14} />, label: 'Жолды көшіру', onClick: () => copyPath(file.path) },
            'divider',
            { icon: <TrashIcon size={14} />, label: 'Жою', hint: 'Del', danger: true, onClick: () => handleDeleteFile(file.id) },
          ]);
        }}
        draggable={!isRenaming}
        onDragStart={(e) => onRowDragStart(e, file.path)}
        onDragEnd={onDragEnd}
        title={file.path}
        role="treeitem"
        aria-selected={isActive}
        tabIndex={selected === key ? 0 : -1}
      >
        <span className="vx-row__icon">
          <FileTypeIcon name={file.name} />
        </span>
        {isRenaming ? (
          <NameInput
            initial={file.name}
            selectBase
            onSubmit={(name) => {
              setRenaming(null);
              movePath(file.path, joinPath(parentOf(file.path), name), false);
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <span className="vx-row__name">{file.name}</span>
        )}
        {file.isDirty && !isRenaming && <span className="vx-row__dirty" aria-label="unsaved" />}
      </div>
    );
  };

  const renderDir = (node: DirNode, depth: number): React.ReactNode => (
    <>
      {creating?.parent === node.path && createRow(depth)}
      {node.dirs.map((dir) => {
        const key = `d:${dir.path}`;
        const open = isOpen(dir.path);
        const isRenaming = renaming === key;
        // Ықшам папкада алдыңғы бөліктер сұр, соңғысы — ақ
        const segs = dir.name.split('/');
        return (
          <div
            key={key}
            className={`vx-group ${dropTarget === dir.path ? 'is-drop' : ''}`}
            role="group"
            onDragOver={(e) => onDirDragOver(e, dir.path)}
          >
            <div
              data-key={key}
              className={`vx-row vx-row--dir ${open ? 'is-open' : ''} ${selected === key ? 'is-selected' : ''}`}
              // Жабысқақ тақырып: терең ағашта қай папкада тұрғаның көрініп тұрады
              style={{ paddingLeft: indentOf(depth), top: depth * ROW_H, zIndex: 40 - depth }}
              onClick={() => {
                setSelected(key);
                if (!isRenaming) toggleDir(dir.path);
              }}
              onFocus={() => setSelected(key)}
              onContextMenu={(e) => {
                setSelected(key);
                openMenu(e, [
                  { icon: <FilePlusIcon size={14} />, label: t('vibecoding.fileExplorer.newFile'), onClick: () => startCreating('file', dir.path) },
                  { icon: <FolderPlusIcon size={14} />, label: 'Жаңа папка', onClick: () => startCreating('folder', dir.path) },
                  'divider',
                  { icon: <EditIcon size={14} />, label: 'Атауын өзгерту', hint: 'F2', onClick: () => setRenaming(key) },
                  { icon: <CopyIcon size={14} />, label: 'Жолды көшіру', onClick: () => copyPath(dir.path) },
                  'divider',
                  { icon: <TrashIcon size={14} />, label: 'Папканы жою', hint: 'Del', danger: true, onClick: () => handleDeleteFolder(dir.path) },
                ]);
              }}
              draggable={!isRenaming}
              onDragStart={(e) => onRowDragStart(e, dir.path)}
              onDragEnd={onDragEnd}
              title={dir.path}
              role="treeitem"
              aria-expanded={open}
              tabIndex={selected === key ? 0 : -1}
            >
              <span className="vx-row__chevron">
                <ChevronIcon size={14} />
              </span>
              <span className="vx-row__icon">
                <FolderTypeIcon name={segs[segs.length - 1]} open={open} />
              </span>
              {isRenaming ? (
                <NameInput
                  initial={baseOf(dir.path)}
                  onSubmit={(name) => {
                    setRenaming(null);
                    movePath(dir.path, joinPath(parentOf(dir.path), name), true);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <>
                  <span className="vx-row__name">
                    {segs.length > 1 && <span className="vx-row__compact">{segs.slice(0, -1).join('/')}/</span>}
                    {segs[segs.length - 1]}
                  </span>
                  {/* Тінтуір апарғанда — осы папкаға тікелей қосу */}
                  <span className="vx-row__actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={`Жаңа файл — ${dir.path}/`} onClick={() => startCreating('file', dir.path)}>
                      <FilePlusIcon size={13} />
                    </button>
                    <button type="button" className="vx-icon-btn vx-icon-btn--xs" title={`Жаңа папка — ${dir.path}/`} onClick={() => startCreating('folder', dir.path)}>
                      <FolderPlusIcon size={13} />
                    </button>
                  </span>
                </>
              )}
            </div>
            {open && (
              <div className="vx-group__children" style={{ ['--guide-x' as string]: `${indentOf(depth) + 7}px` }}>
                {renderDir(dir, depth + 1)}
              </div>
            )}
          </div>
        );
      })}
      {node.files.map((file) => renderFile(file, depth))}
    </>
  );

  if (!activeProject) {
    return (
      <div className="vx-explorer">
        <div className="vx-empty">
          <div className="vx-orb">
            <FolderTypeIcon name="" open size={28} />
          </div>
          <p className="vx-empty__title">{t('vibecoding.fileExplorer.emptyProject')}</p>
          <button type="button" onClick={handleCreateProject} className="vx-btn vx-btn--primary vx-btn--xs">
            <FolderPlusIcon size={14} />
            {t('vibecoding.fileExplorer.newProject')}
          </button>
        </div>
      </div>
    );
  }

  const dirtyCount = files.filter((f) => f.isDirty).length;
  const folderCount = new Set([...folders, ...files.flatMap((f) => ancestorDirs(f.path))]).size;
  const hasItems = tree.files.length > 0 || tree.dirs.length > 0 || !!creating;

  return (
    <div className="vx-explorer select-none">
      {/* Тақырып: атауы + әрекеттер (VS Code сияқты) */}
      <div className="vx-explorer__head">
        {isOverlay && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false })}
            className="vx-icon-btn vx-icon-btn--sm"
            title="Жабу"
          >
            <ArrowLeftIcon size={17} />
          </button>
        )}
        <span className="vx-explorer__title">{t('vibecoding.fileExplorer.title')}</span>
        <div className="vx-explorer__actions">
          <button
            type="button"
            onClick={(e) => openTemplates(e, targetDir)}
            className="vx-icon-btn vx-icon-btn--sm"
            title={`Дайын құрылым қосу${targetDir ? ` — ${targetDir}/` : ''}`}
          >
            <LayersIcon size={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSearch((v) => !v);
              setSearchQuery('');
            }}
            className={`vx-icon-btn vx-icon-btn--sm ${showSearch ? 'is-on' : ''}`}
            title="Файлдарды сүзу"
          >
            <SearchIcon size={17} />
          </button>
          <button type="button" onClick={collapseAll} className="vx-icon-btn vx-icon-btn--sm" title="Барлық папкаларды жию">
            <CollapseIcon size={17} />
          </button>
        </div>
      </div>

      {/* Сүзгі өрісі */}
      {showSearch && (
        <div className="vx-filter">
          <SearchIcon size={13} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                setShowSearch(false);
              }
            }}
            placeholder="Файлдарды сүзу..."
            autoFocus
          />
          {searchQuery && <span className="vx-filter__count">{filteredFiles.length}</span>}
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="vx-icon-btn vx-icon-btn--xs" title="Тазалау">
              <CloseIcon size={11} />
            </button>
          )}
        </div>
      )}

      {/* Жоба жолы: басқанда ағаш жиналады, оң жақта — жоба ауыстыру */}
      <div className="vx-proj">
        <button
          type="button"
          className={`vx-proj__toggle ${treeCollapsed ? '' : 'is-open'}`}
          onClick={() => {
            setTreeCollapsed((v) => !v);
            setSelected(null);
          }}
          onContextMenu={(e) => openMenu(e, rootMenuItems)}
          aria-expanded={!treeCollapsed}
        >
          <span className="vx-row__chevron">
            <ChevronIcon size={14} />
          </span>
          <span className="vx-proj__name">{activeProject.name}</span>
          {dirtyCount > 0 && (
            <span className="vx-proj__dirty" title={`${dirtyCount} өзгертілді`}>{dirtyCount}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowProjectMenu((v) => !v)}
          className={`vx-icon-btn vx-icon-btn--sm ${showProjectMenu ? 'is-on' : ''}`}
          title={t('vibecoding.fileExplorer.projects')}
        >
          <ChevronDownIcon size={16} />
        </button>

        {showProjectMenu && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setShowProjectMenu(false)} />
            <div className="vx-menu vx-menu--projects">
              <div className="vx-menu__heading">
                <BranchIcon size={12} />
                {t('vibecoding.fileExplorer.projects')}
              </div>
              {state.projects.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => handleSwitchProject(proj.id)}
                  className={`vx-menu__item ${proj.id === activeProject.id ? 'is-current' : ''}`}
                >
                  <span className="vx-menu__icon">
                    <FolderIcon size={14} />
                  </span>
                  <span className="vx-menu__label">{proj.name}</span>
                  <span className="vx-menu__count">{proj.files.length}</span>
                </button>
              ))}
              <div className="vx-menu__divider" />
              <button type="button" onClick={handleCreateProject} className="vx-menu__item">
                <span className="vx-menu__icon">
                  <PlusIcon size={14} />
                </span>
                <span className="vx-menu__label">{t('vibecoding.fileExplorer.newProject')}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Файлдар ағашы */}
      {!treeCollapsed && (
        <div
          ref={treeRef}
          className={`vx-tree ide-scrollbar ${dropTarget === '' ? 'is-drop' : ''}`}
          onContextMenu={(e) => openMenu(e, rootMenuItems)}
          onKeyDown={onTreeKeyDown}
          // Ешбір жол таңдалмаса — ағаштың өзіне Tab арқылы келуге болады
          tabIndex={selected ? -1 : 0}
          onDragOver={onTreeDragOver}
          onDragLeave={onTreeDragLeave}
          onDrop={onTreeDrop}
          onClick={(e) => {
            // Бос жерді басса — таңдау алынады, жаңа файл түбірде жасалады
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          {hasItems ? (
            <div role="tree" aria-label={activeProject.name}>{renderDir(tree, 0)}</div>
          ) : (
            searchQuery ? (
              <div className="vx-tree__empty">Ештеңе табылмады</div>
            ) : (
              <div className="vx-start">
                <p className="vx-start__title">Жоба бос — неден бастаймыз?</p>
                <button type="button" className="vx-start__item" onClick={() => startCreating('file')}>
                  <FilePlusIcon size={16} />
                  <span>
                    <b>{t('vibecoding.fileExplorer.newFile')}</b>
                    <small>мысалы index.html немесе main.py</small>
                  </span>
                </button>
                <button type="button" className="vx-start__item" onClick={() => startCreating('folder')}>
                  <FolderPlusIcon size={16} />
                  <span>
                    <b>Жаңа папка</b>
                    <small>файлдарды топтау үшін</small>
                  </span>
                </button>
                <button type="button" className="vx-start__item" onClick={(e) => openTemplates(e, '')}>
                  <LayersIcon size={16} />
                  <span>
                    <b>Дайын құрылым</b>
                    <small>веб-сайт, React, Node.js, Python…</small>
                  </span>
                </button>
                <ul className="vx-start__tips">
                  <li><kbd>Оң батырма</kbd> — әрекеттер мәзірі</li>
                  <li><kbd>F2</kbd> — атын өзгерту</li>
                  <li>Файлды папкаға сүйреп апарып жылжытыңыз</li>
                </ul>
              </div>
            )
          )}
        </div>
      )}

      {/* Төменгі жол: жоба көлемі */}
      {files.length > 0 && (
        <div className="vx-explorer__foot">
          <span>{files.length} файл</span>
          <span>·</span>
          <span>{folderCount} папка</span>
          {targetDir && (
            <span className="vx-explorer__target" title="Жаңа файлдар осы папкада жасалады">
              <FolderTypeIcon name={baseOf(targetDir)} size={14} />
              {targetDir}/
            </span>
          )}
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
};

export default FileExplorerPanel;
