import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, detectLanguage, VirtualFile, normalizePath } from '../../contexts/VibecodingContext';
import {
  FolderIcon,
  FolderPlusIcon,
  FilePlusIcon,
  FileIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
  ChevronIcon,
  ChevronDownIcon,
  MoreIcon,
  SearchIcon,
  CloseIcon,
  ArrowLeftIcon,
  BranchIcon,
} from './icons';
import { langColor, fileExt } from './langColors';

// ─── Папка ағашы ───────────────────────────────────────────────────

interface DirNode {
  name: string;
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

// Файлды көрсету үшін оның барлық ата-папкаларының жолдары
function ancestorDirs(path: string): string[] {
  const segs = path.split('/').filter(Boolean).slice(0, -1);
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'));
}

const INDENT_PX = 14;

// Жол үшін контекст мәзірі (папка мен файлға ортақ)
interface MenuItem {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}

const RowMenu: React.FC<{ items: (MenuItem | 'divider')[]; onClose: () => void }> = ({ items, onClose }) => (
  <>
    <div
      className="fixed inset-0 z-[100]"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    />
    <div className="vx-menu" role="menu" onClick={(e) => e.stopPropagation()}>
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
            <span className="vx-menu__label">{item.label}</span>
            {item.hint && <kbd className="vx-menu__hint">{item.hint}</kbd>}
          </button>
        )
      )}
    </div>
  </>
);

interface FolderNodeProps {
  name: string;
  depth: number;
  isOpen: boolean;
  onToggle: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete: () => void;
}

const FolderNode: React.FC<FolderNodeProps> = ({ name, depth, isOpen, onToggle, onNewFile, onNewFolder, onDelete }) => {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={`vx-row vx-row--dir ${isOpen ? 'is-open' : ''}`}
      style={{ paddingLeft: 6 + depth * INDENT_PX }}
      onClick={onToggle}
      role="treeitem"
      aria-expanded={isOpen}
    >
      {/* Ішкі деңгейдің бағыттаушы сызықтары */}
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="vx-row__guide" style={{ left: 13 + i * INDENT_PX }} />
      ))}
      <span className="vx-row__chevron">
        <ChevronIcon size={12} />
      </span>
      <span className="vx-row__folder">
        <FolderIcon size={15} open={isOpen} />
      </span>
      <span className="vx-row__name">{name}</span>

      <span className="vx-row__actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="vx-icon-btn vx-icon-btn--sm"
          title="Әрекеттер"
        >
          <MoreIcon size={14} />
        </button>
        {showMenu && (
          <RowMenu
            onClose={() => setShowMenu(false)}
            items={[
              { icon: <FilePlusIcon size={14} />, label: 'Жаңа файл', onClick: onNewFile },
              { icon: <FolderPlusIcon size={14} />, label: 'Жаңа папка', onClick: onNewFolder },
              'divider',
              { icon: <TrashIcon size={14} />, label: 'Папканы жою', danger: true, onClick: onDelete },
            ]}
          />
        )}
      </span>
    </div>
  );
};

interface FileNodeProps {
  file: VirtualFile;
  depth: number;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

const FileNode: React.FC<FileNodeProps> = ({ file, depth, isActive, onSelect, onDelete, onRename }) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.name);
  const [showMenu, setShowMenu] = useState(false);

  const color = langColor(detectLanguage(file.name));

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue !== file.name) {
      onRename(renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <div
      className={`vx-row vx-row--file ${isActive ? 'is-active' : ''}`}
      style={{ paddingLeft: 6 + depth * INDENT_PX + 16, ['--lang' as string]: color }}
      onClick={onSelect}
      title={file.path}
      role="treeitem"
      aria-selected={isActive}
    >
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="vx-row__guide" style={{ left: 13 + i * INDENT_PX }} />
      ))}
      {/* Файл белгішесі + тілдің жарық нүктесі */}
      <span className="vx-row__file">
        <FileIcon size={15} />
        <span className="vx-row__lang" />
      </span>

      {isRenaming ? (
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          className="vx-row__rename"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="vx-row__name">{file.name}</span>
      )}

      {!isRenaming && <span className="vx-row__ext">{fileExt(file.name)}</span>}

      {file.isDirty && !isRenaming && <span className="vx-row__dirty" aria-label="unsaved" />}

      {!isRenaming && (
        <span className="vx-row__actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="vx-icon-btn vx-icon-btn--sm"
            title="Әрекеттер"
          >
            <MoreIcon size={14} />
          </button>
          {showMenu && (
            <RowMenu
              onClose={() => setShowMenu(false)}
              items={[
                { icon: <EditIcon size={14} />, label: 'Атауын өзгерту', hint: 'F2', onClick: () => setIsRenaming(true) },
                'divider',
                { icon: <TrashIcon size={14} />, label: 'Жою', hint: 'Del', danger: true, onClick: onDelete },
              ]}
            />
          )}
        </span>
      )}
    </div>
  );
};

const FileExplorerPanel: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, activeProject, isMobile, isTablet } = useVibecoding();
  // Жаңа файл немесе папка жасау: parent — қай папканың ішінде ('' — түбір)
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: string } | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const showNewFile = creating !== null;
  const startCreating = useCallback((kind: 'file' | 'folder', parent = '') => {
    setCreating({ kind, parent });
    setNewFileName('');
  }, []);
  const cancelCreating = useCallback(() => {
    setCreating(null);
    setNewFileName('');
  }, []);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isOverlay = isMobile || isTablet;

  const handleCreateFile = useCallback(() => {
    if (!creating) return;
    // "src/utils.ts" сияқты жол жазылса — файл/папка сол папкада жасалады
    const path = normalizePath(`${creating.parent}/${newFileName}`);
    if (!path || path === normalizePath(creating.parent)) return;
    if (creating.kind === 'folder') {
      dispatch({ type: 'CREATE_FOLDER', payload: { path } });
      setExpandedDirs(prev => new Set([...prev, ...ancestorDirs(`${path}/_`)]));
    } else {
      const name = path.split('/').pop() || path;
      dispatch({ type: 'CREATE_FILE', payload: { name, path, content: '' } });
    }
    cancelCreating();
  }, [dispatch, newFileName, creating, cancelCreating]);

  const handleDeleteFolder = useCallback((path: string) => {
    const count = activeProject?.files.filter(f => f.path.startsWith(`${path}/`)).length ?? 0;
    const message = count > 0
      ? `"${path}" папкасы ішіндегі ${count} файлмен бірге жойылады. Жалғастырасыз ба?`
      : `"${path}" папкасын жою керек пе?`;
    if (!window.confirm(message)) return;
    dispatch({ type: 'DELETE_FOLDER', payload: { path } });
  }, [dispatch, activeProject]);

  const handleDeleteFile = useCallback((fileId: string) => {
    dispatch({ type: 'DELETE_FILE', payload: { fileId } });
  }, [dispatch]);

  const handleRenameFile = useCallback((fileId: string, name: string) => {
    dispatch({ type: 'RENAME_FILE', payload: { fileId, name } });
  }, [dispatch]);

  const handleSelectFile = useCallback((fileId: string) => {
    dispatch({ type: 'OPEN_FILE', payload: { fileId } });
  }, [dispatch]);

  const handleSwitchProject = useCallback((projectId: string) => {
    dispatch({ type: 'SWITCH_PROJECT', payload: { projectId } });
    setShowProjectMenu(false);
  }, [dispatch]);

  const handleCreateProject = useCallback(() => {
    dispatch({ type: 'CREATE_PROJECT', payload: { name: `Project ${state.projects.length + 1}` } });
    setShowProjectMenu(false);
  }, [dispatch, state.projects.length]);

  const filteredFiles = useMemo(() =>
    activeProject?.files.filter(f => (f.path || f.name).toLowerCase().includes(searchQuery.toLowerCase())) || [],
    [activeProject, searchQuery]
  );

  // Іздеу кезінде бос папкаларды көрсетпейміз — тек сәйкес файлдар
  const tree = useMemo(
    () => buildFileTree(filteredFiles, searchQuery ? [] : activeProject?.folders ?? []),
    [filteredFiles, searchQuery, activeProject?.folders]
  );

  // Ашық папкалар (жоба ауысқанда — тек жоғарғы деңгей ашық)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!activeProject) return;
    setExpandedDirs(new Set(buildFileTree(activeProject.files, activeProject.folders).dirs.map(d => d.path)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id]);

  // Белсенді файлдың папкаларын автоматты ашу (жаңа файл жасағанда да)
  const activeFilePath = activeProject?.files.find(f => f.id === state.activeFileId)?.path;
  useEffect(() => {
    if (!activeFilePath) return;
    setExpandedDirs(prev => {
      const missing = ancestorDirs(activeFilePath).filter(d => !prev.has(d));
      return missing.length ? new Set([...prev, ...missing]) : prev;
    });
  }, [activeFilePath]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renderDir = (node: DirNode, depth: number): React.ReactNode => (
    <>
      {node.dirs.map((dir) => {
        // Іздеу кезінде сәйкес папкалардың бәрі ашық тұрады
        const isOpen = !!searchQuery || expandedDirs.has(dir.path);
        return (
          <React.Fragment key={`d:${dir.path}`}>
            <FolderNode
              name={dir.name}
              depth={depth}
              isOpen={isOpen}
              onToggle={() => toggleDir(dir.path)}
              onNewFile={() => {
                setExpandedDirs(prev => new Set([...prev, dir.path]));
                startCreating('file', dir.path);
              }}
              onNewFolder={() => {
                setExpandedDirs(prev => new Set([...prev, dir.path]));
                startCreating('folder', dir.path);
              }}
              onDelete={() => handleDeleteFolder(dir.path)}
            />
            {isOpen && renderDir(dir, depth + 1)}
          </React.Fragment>
        );
      })}
      {node.files.map((file) => (
        <FileNode
          key={file.id}
          file={file}
          depth={depth}
          isActive={file.id === state.activeFileId}
          onSelect={() => handleSelectFile(file.id)}
          onDelete={() => handleDeleteFile(file.id)}
          onRename={(name) => handleRenameFile(file.id, name)}
        />
      ))}
    </>
  );

  if (!activeProject) {
    return (
      <div className="vx-explorer">
        <div className="vx-empty">
          <div className="vx-orb">
            <FolderIcon size={26} open />
          </div>
          <p className="vx-empty__title">{t('vibecoding.fileExplorer.emptyProject')}</p>
          <button type="button" onClick={handleCreateProject} className="vx-btn vx-btn--primary">
            <FolderPlusIcon size={15} />
            {t('vibecoding.fileExplorer.newProject')}
          </button>
        </div>
      </div>
    );
  }

  const dirtyCount = activeProject.files.filter(f => f.isDirty).length;

  return (
    <div className="vx-explorer select-none">
      {/* Overlay close button (mobile/tablet only) */}
      {isOverlay && (
        <div className="vx-explorer__overlay-head">
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false })}
            className="vx-icon-btn"
            title="Жабу"
          >
            <ArrowLeftIcon size={16} />
          </button>
          <span>{t('vibecoding.fileExplorer.title')}</span>
        </div>
      )}

      {/* Жоба таңдау — басты беттің sidebar жолындай */}
      <div className="vx-project">
        <button
          type="button"
          onClick={() => setShowProjectMenu(!showProjectMenu)}
          className={`vx-project__btn ${showProjectMenu ? 'is-open' : ''}`}
        >
          <span className="vx-mono">{activeProject.name.charAt(0).toUpperCase() || 'P'}</span>
          <span className="vx-project__info">
            <span className="vx-project__name">{activeProject.name}</span>
            <span className="vx-project__meta">
              {activeProject.files.length} файл
              {dirtyCount > 0 && <> · <span className="vx-project__dirty">{dirtyCount} өзгертілді</span></>}
            </span>
          </span>
          <span className="vx-project__chevron">
            <ChevronDownIcon size={14} />
          </span>
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
                  <span className="vx-mono vx-mono--sm">{proj.name.charAt(0).toUpperCase() || 'P'}</span>
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

      {/* Іздеу өрісі */}
      <div className="vx-search">
        <SearchIcon size={15} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Файл іздеу..."
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} className="vx-icon-btn vx-icon-btn--sm" title="Тазалау">
            <CloseIcon size={12} />
          </button>
        )}
      </div>

      {/* Бөлім тақырыбы */}
      <div className="vx-section">
        <span className="vx-section__title">{t('vibecoding.fileExplorer.title')}</span>
        <div className="vx-section__actions">
          <button
            type="button"
            onClick={() => (creating?.kind === 'file' && !creating.parent ? cancelCreating() : startCreating('file'))}
            className={`vx-icon-btn ${creating?.kind === 'file' ? 'is-on' : ''}`}
            title={t('vibecoding.fileExplorer.newFile')}
          >
            <FilePlusIcon size={15} />
          </button>
          <button
            type="button"
            onClick={() => (creating?.kind === 'folder' && !creating.parent ? cancelCreating() : startCreating('folder'))}
            className={`vx-icon-btn ${creating?.kind === 'folder' ? 'is-on' : ''}`}
            title="Жаңа папка"
          >
            <FolderPlusIcon size={15} />
          </button>
        </div>
      </div>

      {/* Жаңа файл / папка енгізу */}
      {showNewFile && (
        <div className="vx-create">
          <span className="vx-create__icon">
            {creating?.kind === 'folder' ? <FolderIcon size={14} /> : <FileIcon size={14} />}
          </span>
          {creating?.parent && (
            <span className="vx-create__parent" title={creating.parent}>
              {creating.parent}/
            </span>
          )}
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFile();
              if (e.key === 'Escape') cancelCreating();
            }}
            placeholder={creating?.kind === 'folder' ? 'папка-аты' : 'filename.ext'}
            autoFocus
          />
          <button type="button" onClick={cancelCreating} className="vx-icon-btn vx-icon-btn--sm" title="Болдырмау">
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      {/* Файлдар ағашы */}
      <div className="vx-tree ide-scrollbar">
        {filteredFiles.length === 0 ? (
          <div className="vx-tree__empty">
            <span className="vx-tree__empty-icon">
              {searchQuery ? <SearchIcon size={20} /> : <FileIcon size={20} />}
            </span>
            {searchQuery ? 'Ештеңе табылмады' : t('vibecoding.fileExplorer.emptyProject')}
          </div>
        ) : (
          <div role="tree">{renderDir(tree, 0)}</div>
        )}
      </div>
    </div>
  );
};

export default FileExplorerPanel;
