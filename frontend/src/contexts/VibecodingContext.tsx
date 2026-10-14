import React, { createContext, useContext, useReducer, useEffect, ReactNode, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useBreakpoint, Breakpoint } from '../hooks/useBreakpoint';

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
}

// ─── Actions ─────────────────────────────────────────────────────────

type VibecodingAction =
  | { type: 'CREATE_PROJECT'; payload: { name: string } }
  | { type: 'DELETE_PROJECT'; payload: { projectId: string } }
  | { type: 'SWITCH_PROJECT'; payload: { projectId: string } }
  | { type: 'RENAME_PROJECT'; payload: { projectId: string; name: string } }
  | { type: 'CREATE_FILE'; payload: { name: string; path: string; content?: string } }
  | { type: 'DELETE_FILE'; payload: { fileId: string } }
  | { type: 'RENAME_FILE'; payload: { fileId: string; name: string } }
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
  | { type: 'LOAD_STATE'; payload: VibecodingState };

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
                    ? { ...f, name: action.payload.name, language: detectLanguage(action.payload.name), isDirty: true }
                    : f
                ),
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

const defaultProject = createDefaultProject();

const initialState: VibecodingState = loadState() || {
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

// ─── Provider ─────────────────────────────────────────────────────────

interface VibecodingProviderProps {
  children: ReactNode;
}

export const VibecodingProvider: React.FC<VibecodingProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(vibecodingReducer, initialState);
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
  }), [state, activeProject, activeFile, openFiles, breakpoint, isMobile, isTablet, isDesktop]);

  return (
    <VibecodingContext.Provider value={contextValue()}>
      {children}
    </VibecodingContext.Provider>
  );
};