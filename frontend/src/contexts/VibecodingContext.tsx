import React, { createContext, useContext, useReducer, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useBreakpoint, Breakpoint } from '../hooks/useBreakpoint';
import { useAuth } from './AuthContext';
import { apiService, VibecodingProjectDTO } from '../utils/api';

// ─── Types ───────────────────────────────────────────────────────────

export interface VirtualFile {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export interface Project {
  id: string;
  name: string;
  files: VirtualFile[];
  /** Қолмен жасалған папкалар (бос папкалар да сақталуы үшін) */
  folders?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PanelSizes {
  left: number;
  center: number;
  right: number;
  bottom: number;
}

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  lineNumbers: 'on' | 'off';
  fontLigatures: boolean;
  autoClosingBrackets: boolean;
  linkedEditing: boolean;
  smoothCaret: boolean;
  bracketPairColorization: boolean;
}

interface VibecodingState {
  projects: Project[];
  activeProjectId: string | null;
  openFileIds: string[];
  activeFileId: string | null;
  panelSizes: PanelSizes;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  bottomPanelVisible: boolean;
  editorSettings: EditorSettings;
  /** localStorage-тағы жобалар кімдікі (сервермен синхрондалған қолданушы) */
  ownerId?: string;
}

// ─── Actions ─────────────────────────────────────────────────────────

type VibecodingAction =
  | { type: 'CREATE_PROJECT'; payload: { name: string } }
  | { type: 'DELETE_PROJECT'; payload: { projectId: string } }
  | { type: 'SWITCH_PROJECT'; payload: { projectId: string } }
  | { type: 'RENAME_PROJECT'; payload: { projectId: string; name: string } }
  | { type: 'CREATE_FILE'; payload: { name: string; path: string; content?: string } }
  | { type: 'DELETE_FILE'; payload: { fileId: string } }
  | { type: 'CREATE_FOLDER'; payload: { path: string } }
  | { type: 'DELETE_FOLDER'; payload: { path: string } }
  | { type: 'RENAME_FILE'; payload: { fileId: string; name: string } }
  /** Файлды/папканы жылжыту немесе атын өзгерту: from жолы (ішіндегілерімен) to жолына көшеді */
  | { type: 'MOVE_PATH'; payload: { from: string; to: string } }
  | { type: 'UPDATE_FILE_CONTENT'; payload: { fileId: string; content: string } }
  | { type: 'OPEN_FILE'; payload: { fileId: string } }
  | { type: 'CLOSE_FILE'; payload: { fileId: string } }
  | { type: 'SET_ACTIVE_FILE'; payload: { fileId: string | null } }
  | { type: 'CLOSE_ALL_FILES' }
  | { type: 'CLOSE_OTHER_FILES'; payload: { fileId: string } }
  | { type: 'SET_PANEL_SIZES'; payload: Partial<PanelSizes> }
  | { type: 'TOGGLE_LEFT_PANEL' }
  | { type: 'TOGGLE_RIGHT_PANEL' }
  | { type: 'TOGGLE_BOTTOM_PANEL' }
  | { type: 'SET_LEFT_PANEL_VISIBLE'; payload: boolean }
  | { type: 'SET_RIGHT_PANEL_VISIBLE'; payload: boolean }
  | { type: 'SET_BOTTOM_PANEL_VISIBLE'; payload: boolean }
  | { type: 'SAVE_FILE'; payload: { fileId: string } }
  | { type: 'SAVE_ALL' }
  | { type: 'SET_EDITOR_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'LOAD_STATE'; payload: VibecodingState }
  | { type: 'LOAD_PROJECTS'; payload: { projects: Project[]; ownerId: string } }
  | { type: 'UPSERT_PROJECT'; payload: { project: Project } }
  | { type: 'OPEN_PROJECT_FILE'; payload: { projectId: string; path?: string } }
  /** Терминалда өзгерген файлдар (жоба папкасы → редактор) */
  | { type: 'APPLY_WORKSPACE_CHANGES'; payload: { projectId: string; changes: WorkspaceChanges } };

export interface WorkspaceChanges {
  upserts: { path: string; content: string }[];
  deletes: string[];
  folders: string[];
  deletedFolders: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust',
    go: 'go', java: 'java', cpp: 'cpp', c: 'c',
    cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', sql: 'sql', sh: 'shell', bash: 'shell',
    dockerfile: 'dockerfile', toml: 'ini', env: 'plaintext',
    txt: 'plaintext', csv: 'plaintext',
  };
  return map[ext] || 'plaintext';
}

/** "/src//utils/" → "src/utils" */
export function normalizePath(path: string): string {
  return path.split('/').map(s => s.trim()).filter(Boolean).join('/');
}

/** Файл/папка жолының барлық ата-папкалары: "a/b/c.ts" → ["a", "a/b"] */
export function parentPaths(path: string): string[] {
  const segs = normalizePath(path).split('/').slice(0, -1);
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'));
}

const DEFAULT_PANEL_SIZES: PanelSizes = {
  left: 20,
  center: 55,
  right: 25,
  bottom: 30,
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'on',
  minimap: true,
  lineNumbers: 'on',
  fontLigatures: true,
  autoClosingBrackets: true,
  linkedEditing: true,
  smoothCaret: true,
  bracketPairColorization: true,
};

function createDefaultProject(): Project {
  const id = uuidv4();
  const mainFileId = uuidv4();
  return {
    id,
    name: 'My Project',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: [{
      id: mainFileId,
      name: 'index.html',
      path: 'index.html',
      content: '<!DOCTYPE html>\n<html lang="kk">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Vibecoding</title>\n</head>\n<body>\n  <h1>Сәлем, Әлем!</h1>\n</body>\n</html>',
      language: 'html',
      isDirty: false,
    }],
  };
}

// ─── Reducer ─────────────────────────────────────────────────────────

function vibecodingReducer(state: VibecodingState, action: VibecodingAction): VibecodingState {
  switch (action.type) {
    case 'CREATE_PROJECT': {
      const newProject: Project = {
        id: uuidv4(),
        name: action.payload.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        files: [],
      };
      return {
        ...state,
        projects: [...state.projects, newProject],
        activeProjectId: newProject.id,
        openFileIds: [],
        activeFileId: null,
      };
    }

    case 'DELETE_PROJECT': {
      const remaining = state.projects.filter(p => p.id !== action.payload.projectId);
      return {
        ...state,
        projects: remaining,
        activeProjectId: state.activeProjectId === action.payload.projectId
          ? (remaining[0]?.id || null)
          : state.activeProjectId,
        openFileIds: state.activeProjectId === action.payload.projectId ? [] : state.openFileIds,
        activeFileId: state.activeProjectId === action.payload.projectId ? null : state.activeFileId,
      };
    }

    case 'SWITCH_PROJECT': {
      return {
        ...state,
        activeProjectId: action.payload.projectId,
        openFileIds: [],
        activeFileId: null,
      };
    }

    case 'RENAME_PROJECT': {
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === action.payload.projectId
            ? { ...p, name: action.payload.name, updatedAt: new Date().toISOString() }
            : p
        ),
      };
    }

    case 'CREATE_FILE': {
      if (!state.activeProjectId) return state;
      const fileId = uuidv4();
      const newFile: VirtualFile = {
        id: fileId,
        name: action.payload.name,
        path: action.payload.path,
        content: action.payload.content || '',
        language: detectLanguage(action.payload.name),
        isDirty: true,
      };
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? { ...p, files: [...p.files, newFile], updatedAt: new Date().toISOString() }
            : p
        ),
        openFileIds: [...state.openFileIds, fileId],
        activeFileId: fileId,
      };
    }

    case 'DELETE_FILE': {
      if (!state.activeProjectId) return state;
      const newOpenFiles = state.openFileIds.filter(id => id !== action.payload.fileId);
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? { ...p, files: p.files.filter(f => f.id !== action.payload.fileId), updatedAt: new Date().toISOString() }
            : p
        ),
        openFileIds: newOpenFiles,
        activeFileId: state.activeFileId === action.payload.fileId
          ? (newOpenFiles[0] || null)
          : state.activeFileId,
      };
    }

    case 'CREATE_FOLDER': {
      if (!state.activeProjectId) return state;
      const path = normalizePath(action.payload.path);
      if (!path) return state;
      return {
        ...state,
        projects: state.projects.map(p => {
          if (p.id !== state.activeProjectId) return p;
          // Ата-папкалармен бірге қосамыз — "a/b" жасалса "a" да тізімде болады
          const folders = new Set(p.folders ?? []);
          parentPaths(`${path}/_`).forEach(dir => folders.add(dir));
          return { ...p, folders: Array.from(folders), updatedAt: new Date().toISOString() };
        }),
      };
    }

    // Папканы ішіндегі барлық файлдар мен ішкі папкаларымен бірге жою
    case 'DELETE_FOLDER': {
      if (!state.activeProjectId) return state;
      const path = normalizePath(action.payload.path);
      if (!path) return state;
      const inside = (p: string) => p === path || p.startsWith(`${path}/`);
      const project = state.projects.find(p => p.id === state.activeProjectId);
      const removedIds = new Set(project?.files.filter(f => inside(f.path)).map(f => f.id) ?? []);
      const newOpenFiles = state.openFileIds.filter(id => !removedIds.has(id));
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? {
                ...p,
                files: p.files.filter(f => !removedIds.has(f.id)),
                folders: (p.folders ?? []).filter(f => !inside(f)),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
        openFileIds: newOpenFiles,
        activeFileId: state.activeFileId && removedIds.has(state.activeFileId)
          ? (newOpenFiles[0] || null)
          : state.activeFileId,
      };
    }

    case 'RENAME_FILE': {
      if (!state.activeProjectId) return state;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? {
                ...p,
                files: p.files.map(f =>
                  f.id === action.payload.fileId
                    ? {
                        ...f,
                        name: action.payload.name,
                        // Жолдың соңғы бөлігін де ауыстырамыз — файл өз папкасында қалады
                        path: [...f.path.split('/').slice(0, -1), action.payload.name].join('/'),
                        language: detectLanguage(action.payload.name),
                        isDirty: true,
                      }
                    : f
                ),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      };
    }

    case 'MOVE_PATH': {
      if (!state.activeProjectId) return state;
      const from = normalizePath(action.payload.from);
      const to = normalizePath(action.payload.to);
      // Өзіне немесе өз ішіне жылжытуға болмайды
      if (!from || !to || from === to || to.startsWith(`${from}/`)) return state;
      const project = state.projects.find(p => p.id === state.activeProjectId);
      if (!project) return state;
      const taken = (p: string) => p === to || p.startsWith(`${to}/`);
      if (project.files.some(f => taken(f.path)) || (project.folders ?? []).some(taken)) return state;
      const remap = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
      const folders = new Set((project.folders ?? []).map(remap));
      // Бастапқы папка бос қалса да жоғалмайды, жаңа орынның ата-папкалары қосылады
      parentPaths(from).forEach(dir => folders.add(dir));
      parentPaths(to).forEach(dir => folders.add(dir));
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? {
                ...p,
                files: p.files.map(f => {
                  const path = remap(f.path);
                  if (path === f.path) return f;
                  const name = path.split('/').pop() || path;
                  return { ...f, path, name, language: detectLanguage(name), isDirty: true };
                }),
                folders: Array.from(folders),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      };
    }

    case 'UPDATE_FILE_CONTENT': {
      if (!state.activeProjectId) return state;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? {
                ...p,
                files: p.files.map(f =>
                  f.id === action.payload.fileId
                    ? { ...f, content: action.payload.content, isDirty: true }
                    : f
                ),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      };
    }

    case 'OPEN_FILE': {
      const { fileId } = action.payload;
      const openIds = state.openFileIds.includes(fileId)
        ? state.openFileIds
        : [...state.openFileIds, fileId];
      return {
        ...state,
        openFileIds: openIds,
        activeFileId: fileId,
      };
    }

    case 'CLOSE_FILE': {
      const newIds = state.openFileIds.filter(id => id !== action.payload.fileId);
      return {
        ...state,
        openFileIds: newIds,
        activeFileId: state.activeFileId === action.payload.fileId
          ? (newIds[newIds.length - 1] || null)
          : state.activeFileId,
      };
    }

    case 'SET_ACTIVE_FILE': {
      return { ...state, activeFileId: action.payload.fileId };
    }

    case 'CLOSE_ALL_FILES': {
      return { ...state, openFileIds: [], activeFileId: null };
    }

    case 'CLOSE_OTHER_FILES': {
      return {
        ...state,
        openFileIds: [action.payload.fileId],
        activeFileId: action.payload.fileId,
      };
    }

    case 'SET_PANEL_SIZES': {
      return { ...state, panelSizes: { ...state.panelSizes, ...action.payload } };
    }

    case 'TOGGLE_LEFT_PANEL': {
      return { ...state, leftPanelVisible: !state.leftPanelVisible };
    }
    case 'TOGGLE_RIGHT_PANEL': {
      return { ...state, rightPanelVisible: !state.rightPanelVisible };
    }
    case 'TOGGLE_BOTTOM_PANEL': {
      return { ...state, bottomPanelVisible: !state.bottomPanelVisible };
    }

    case 'SET_LEFT_PANEL_VISIBLE': {
      return { ...state, leftPanelVisible: action.payload };
    }
    case 'SET_RIGHT_PANEL_VISIBLE': {
      return { ...state, rightPanelVisible: action.payload };
    }
    case 'SET_BOTTOM_PANEL_VISIBLE': {
      return { ...state, bottomPanelVisible: action.payload };
    }

    case 'SAVE_FILE': {
      if (!state.activeProjectId) return state;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? {
                ...p,
                files: p.files.map(f =>
                  f.id === action.payload.fileId ? { ...f, isDirty: false } : f
                ),
              }
            : p
        ),
      };
    }

    case 'SAVE_ALL': {
      if (!state.activeProjectId) return state;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === state.activeProjectId
            ? { ...p, files: p.files.map(f => ({ ...f, isDirty: false })) }
            : p
        ),
      };
    }

    case 'SET_EDITOR_SETTINGS': {
      return { ...state, editorSettings: { ...state.editorSettings, ...action.payload } };
    }

    case 'LOAD_STATE': {
      return action.payload;
    }

    // Сырттан келген жобаны қосу немесе ауыстыру (мысалы, жүктелген репозиторий)
    case 'UPSERT_PROJECT': {
      const { project } = action.payload;
      const exists = state.projects.some(p => p.id === project.id);
      return {
        ...state,
        projects: exists
          ? state.projects.map(p => (p.id === project.id ? project : p))
          : [...state.projects, project],
      };
    }

    // Жобаға ауысып, жолы берілсе — сол файлды ашу
    case 'OPEN_PROJECT_FILE': {
      const { projectId, path } = action.payload;
      const project = state.projects.find(p => p.id === projectId);
      if (!project) return state;
      const file = path ? project.files.find(f => f.path === path) : undefined;
      const sameProject = state.activeProjectId === projectId;
      const baseOpen = sameProject ? state.openFileIds : [];
      return {
        ...state,
        activeProjectId: projectId,
        openFileIds: file && !baseOpen.includes(file.id) ? [...baseOpen, file.id] : baseOpen,
        activeFileId: file ? file.id : sameProject ? state.activeFileId : null,
      };
    }

    case 'APPLY_WORKSPACE_CHANGES': {
      const { projectId, changes } = action.payload;
      const project = state.projects.find(p => p.id === projectId);
      if (!project) return state;
      const removed = new Set(changes.deletes.map(normalizePath));
      const byPath = new Map(changes.upserts.map(u => [normalizePath(u.path), u.content]));
      let changed = removed.size > 0;
      const files = project.files
        .filter(f => !removed.has(f.path))
        .map(f => {
          if (!byPath.has(f.path)) return f;
          const content = byPath.get(f.path)!;
          byPath.delete(f.path);
          if (content === f.content) return f;
          changed = true;
          return { ...f, content, isDirty: false };
        });
      byPath.forEach((content, path) => {
        changed = true;
        const name = path.split('/').pop() || path;
        files.push({ id: uuidv4(), name, path, content, language: detectLanguage(name), isDirty: false });
      });
      const gone = new Set(changes.deletedFolders.map(normalizePath));
      // Ішінде файл қалған папка өшпейді
      const folders = new Set((project.folders ?? []).filter(f => !gone.has(f) || files.some(x => x.path.startsWith(`${f}/`))));
      changes.folders.forEach(f => {
        const path = normalizePath(f);
        if (path && !folders.has(path)) {
          folders.add(path);
          changed = true;
        }
      });
      if (gone.size) changed = true;
      if (!changed) return state;
      const fileIds = new Set(files.map(f => f.id));
      const isActive = state.activeProjectId === projectId;
      const openFileIds = isActive ? state.openFileIds.filter(id => fileIds.has(id)) : state.openFileIds;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === projectId
            ? { ...p, files, folders: Array.from(folders), updatedAt: new Date().toISOString() }
            : p
        ),
        openFileIds,
        activeFileId: isActive && state.activeFileId && !fileIds.has(state.activeFileId)
          ? (openFileIds[openFileIds.length - 1] || null)
          : state.activeFileId,
      };
    }

    // Сервердегі жобалармен ауыстыру (сервер — негізгі дерек көзі)
    case 'LOAD_PROJECTS': {
      const { projects, ownerId } = action.payload;
      const keepActive = projects.some(p => p.id === state.activeProjectId);
      const activeProjectId = keepActive ? state.activeProjectId : projects[0]?.id ?? null;
      const activeProject = projects.find(p => p.id === activeProjectId);
      const fileExists = (id: string) => !!activeProject?.files.some(f => f.id === id);
      return {
        ...state,
        projects,
        ownerId,
        activeProjectId,
        openFileIds: keepActive ? state.openFileIds.filter(fileExists) : [],
        activeFileId: keepActive && state.activeFileId && fileExists(state.activeFileId) ? state.activeFileId : null,
      };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────

interface VibecodingContextType {
  state: VibecodingState;
  dispatch: React.Dispatch<VibecodingAction>;
  activeProject: Project | null;
  activeFile: VirtualFile | null;
  openFiles: VirtualFile[];
  editorSettings: EditorSettings;
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Сервердегі жобалар жүктеліп болды (немесе синхрондау қажет емес) */
  syncReady: boolean;
  /** Күтіп тұрған өзгерістерді серверге дереу жіберу (мысалы, терминал ашылар алдында) */
  flushProjects: () => Promise<void>;
}

const VibecodingContext = createContext<VibecodingContextType | undefined>(undefined);

export const useVibecoding = () => {
  const context = useContext(VibecodingContext);
  if (!context) {
    throw new Error('useVibecoding must be used within a VibecodingProvider');
  }
  return context;
};

const STORAGE_KEY = 'vibecoding_state';

function loadState(): VibecodingState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as VibecodingState;
      // Merge with defaults so newly-added editor settings keys are filled in
      parsed.editorSettings = { ...DEFAULT_EDITOR_SETTINGS, ...(parsed.editorSettings || {}) };
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function saveState(state: VibecodingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// Әр ашылғанда localStorage-тан қайта оқылады — модуль жүктелген кездегі
// ескі күй қолданылмауы үшін (мысалы, басты беттен басқа жоба таңдалғанда).
function createInitialState(): VibecodingState {
  const saved = loadState();
  if (saved) return saved;
  const defaultProject = createDefaultProject();
  return {
    projects: [defaultProject],
    activeProjectId: defaultProject.id,
    openFileIds: [defaultProject.files[0].id],
    activeFileId: defaultProject.files[0].id,
    panelSizes: DEFAULT_PANEL_SIZES,
    leftPanelVisible: true,
    rightPanelVisible: true,
    bottomPanelVisible: true,
    editorSettings: DEFAULT_EDITOR_SETTINGS,
  };
}

// ─── Сервермен синхрондау ─────────────────────────────────────────────

function toServerPayload(project: Project) {
  return {
    name: project.name,
    createdAt: project.createdAt,
    files: project.files.map(({ id, name, path, content, language }) => ({ id, name, path, content, language })),
    folders: project.folders ?? [],
  };
}

// Өзгеріс бар-жоғын салыстыруға арналған «сурет»
function snapshotOf(project: Project): string {
  const { name, files, folders } = toServerPayload(project);
  return JSON.stringify({ name, files, folders });
}

function fromServer(dto: VibecodingProjectDTO): Project {
  return {
    id: dto.id,
    name: dto.name,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    files: dto.files.map(f => ({ ...f, isDirty: false })),
    folders: dto.folders ?? [],
  };
}

const SYNC_DEBOUNCE_MS = 1200;

// ─── Provider ─────────────────────────────────────────────────────────

interface VibecodingProviderProps {
  children: ReactNode;
}

export const VibecodingProvider: React.FC<VibecodingProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(vibecodingReducer, undefined, createInitialState);
  const { breakpoint, isMobile, isTablet, isDesktop } = useBreakpoint();

  const activeProject = state.projects.find(p => p.id === state.activeProjectId) || null;
  const activeFile = activeProject?.files.find(f => f.id === state.activeFileId) || null;
  const openFiles = activeProject
    ? state.openFileIds
        .map(id => activeProject.files.find(f => f.id === id))
        .filter((f): f is VirtualFile => f !== undefined)
    : [];

  // Auto-hide panels on mobile/tablet breakpoint changes
  useEffect(() => {
    if (isMobile) {
      dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false });
      dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: false });
      dispatch({ type: 'SET_BOTTOM_PANEL_VISIBLE', payload: false });
    } else if (isTablet) {
      dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false });
      dispatch({ type: 'SET_RIGHT_PANEL_VISIBLE', payload: false });
      // Keep bottom panel visible on tablet (toggle by user)
    }
    // On desktop, respect saved state (no auto-change)
  }, [isMobile, isTablet]);

  // ── Сервермен синхрондау: кіргенде жүктеу, өзгергенде сақтау ──
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const syncReady = !authLoading && (!isAuthenticated || remoteLoaded);
  const syncedRef = useRef<Map<string, string> | null>(null); // projectId → соңғы сақталған сурет
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    let cancelled = false;
    syncedRef.current = null;
    setRemoteLoaded(false);

    (async () => {
      try {
        const remote = await apiService.getVibecodingProjects();
        if (cancelled) return;
        const local = stateRef.current;
        const localIsMine = !local.ownerId || local.ownerId === user.id;

        if (remote.length === 0 && localIsMine && local.projects.length > 0) {
          // Бірінші рет: браузердегі жобаларды серверге көшіру
          await Promise.all(local.projects.map(p => apiService.saveVibecodingProject(p.id, toServerPayload(p))));
          if (cancelled) return;
          syncedRef.current = new Map(local.projects.map(p => [p.id, snapshotOf(p)]));
          dispatch({ type: 'LOAD_PROJECTS', payload: { projects: local.projects, ownerId: user.id } });
          return;
        }

        const projects = remote.map(fromServer);
        if (projects.length === 0) {
          // Серверде де, браузерде де жоба жоқ — әдепкі жобамен бастау
          projects.push(createDefaultProject());
        }
        syncedRef.current = new Map(
          projects.filter(p => remote.some(r => r.id === p.id)).map(p => [p.id, snapshotOf(p)])
        );
        dispatch({ type: 'LOAD_PROJECTS', payload: { projects, ownerId: user.id } });
      } catch (err) {
        // Сервер қолжетімсіз — localStorage-пен жұмыс істей береміз
        console.error('Vibecoding sync load failed:', err);
      } finally {
        if (!cancelled) setRemoteLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  // Тек қолданушы ауысқанда қайта жүктеу — user объектінің өзгерісі маңызды емес
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  // Өзгерген жобаларды сақтау, жойылғандарын серверден өшіру
  const flushToServer = useCallback(async () => {
    const synced = syncedRef.current;
    if (!synced) return;
    const projects = stateRef.current.projects;
    const current = new Set(projects.map(p => p.id));
    const saves: Promise<unknown>[] = [];

    projects.forEach(project => {
      const snap = snapshotOf(project);
      if (synced.get(project.id) === snap) return;
      synced.set(project.id, snap); // қайталап жібермеу үшін алдын ала белгілейміз
      saves.push(apiService.saveVibecodingProject(project.id, toServerPayload(project)).catch(err => {
        synced.delete(project.id); // келесі жолы қайта жіберіледі
        console.error('Vibecoding project save failed:', err);
      }));
    });

    Array.from(synced.keys()).forEach(id => {
      if (current.has(id)) return;
      synced.delete(id);
      apiService.deleteVibecodingProject(id).catch(err => console.error('Vibecoding project delete failed:', err));
    });
    await Promise.all(saves);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !syncedRef.current) return;
    const timer = setTimeout(flushToServer, SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state.projects, isAuthenticated, flushToServer]);

  // Беттен шыққанда күтіп тұрған өзгерістерді бірден жіберу
  useEffect(() => () => { void flushToServer(); }, [flushToServer]);

  // Persist state to localStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => saveState(state), 500);
    return () => clearTimeout(timer);
  }, [state]);

  const contextValue = useCallback(() => ({
    state,
    dispatch,
    activeProject,
    activeFile,
    openFiles,
    editorSettings: state.editorSettings,
    breakpoint,
    isMobile,
    isTablet,
    isDesktop,
    syncReady,
    flushProjects: flushToServer,
  }), [state, activeProject, activeFile, openFiles, breakpoint, isMobile, isTablet, isDesktop, syncReady, flushToServer]);

  return (
    <VibecodingContext.Provider value={contextValue()}>
      {children}
    </VibecodingContext.Provider>
  );
};