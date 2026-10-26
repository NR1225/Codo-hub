import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import { useVibecoding } from './VibecodingContext';
import { apiService } from '../utils/api';

/* Бүркіттің (Agent режимі) жобаға және оның Notes папкасына жазған, әлі қаралмаған өзгерістері — Cursor сияқты:
   файл бірден өзгереді, ал бастапқы нұсқасы осында сақталады. Редактор diff көрсетеді,
   әр файлды «Қабылдау» (өзгерісті қалдыру) немесе «Қайтару» (бастапқысына оралу) мүмкін.
   Тек жадта тұрады: бет жаңартылса, өзгерістер файлда қалады (сақталмаған күйде). */

export interface PendingEdit {
  path: string;
  /** AI өзгерткенге дейінгі мазмұн; null — файлды Бүркіт жаңадан жасаған */
  original: string | null;
}

/** Бүркіттің жобаның Notes папкасына жазған жазбасы */
export interface PendingNoteEdit {
  noteId: string;
  title: string;
  /** Бұрынғы мазмұн; null — жазбаны Бүркіт жаңадан жасаған */
  previous: string | null;
}

interface BurkitEditsContextType {
  /** Ашық жобаның қаралмаған өзгерістері */
  pending: PendingEdit[];
  pendingFor: (path: string) => PendingEdit | undefined;
  /** Файлға жазу (бар болса — жаңарту, жоқ болса — жасау) және оны ашу */
  applyEdit: (path: string, content: string) => { created: boolean };
  keep: (path: string) => void;
  undo: (path: string) => void;
  keepAll: () => void;
  undoAll: () => void;
  /** Notes жазбалары (жобаның байланысқан папкасы) */
  pendingNotes: PendingNoteEdit[];
  applyNote: (title: string, content: string) => Promise<{ noteId: string; created: boolean }>;
  keepNote: (noteId: string) => void;
  undoNote: (noteId: string) => Promise<void>;
}

const BurkitEditsContext = createContext<BurkitEditsContextType | undefined>(undefined);

export const useBurkitEdits = () => {
  const ctx = useContext(BurkitEditsContext);
  if (!ctx) throw new Error('useBurkitEdits must be used within BurkitEditsProvider');
  return ctx;
};

// Жолдар санының айырмасы (+қосылған / −өшірілген) — қайталанатын жолдарды ескеретін жылдам бағалау
export function lineStats(original: string | null, current: string): { added: number; removed: number } {
  const before = original === null ? [] : original.split('\n');
  const counts = new Map<string, number>();
  before.forEach((line) => counts.set(line, (counts.get(line) ?? 0) + 1));
  let added = 0;
  current.split('\n').forEach((line) => {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added++;
  });
  let removed = 0;
  counts.forEach((n) => { removed += n; });
  return { added, removed };
}

export const BurkitEditsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { dispatch, activeProject } = useVibecoding();
  // projectId → path → өзгеріс
  const [byProject, setByProject] = useState<Record<string, Record<string, PendingEdit>>>({});
  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;
  const byProjectRef = useRef(byProject);
  byProjectRef.current = byProject;

  // projectId → noteId → жазба
  const [notesByProject, setNotesByProject] = useState<Record<string, Record<string, PendingNoteEdit>>>({});
  const notesRef = useRef(notesByProject);
  notesRef.current = notesByProject;

  const projectId = activeProject?.id;
  const current = useMemo(() => (projectId ? byProject[projectId] ?? {} : {}), [byProject, projectId]);
  const pending = useMemo(() => Object.values(current), [current]);
  const pendingNotes = useMemo(
    () => Object.values((projectId && notesByProject[projectId]) || {}),
    [notesByProject, projectId]
  );

  const setNote = useCallback((pid: string, noteId: string, edit: PendingNoteEdit | null) => {
    setNotesByProject((prev) => {
      const next = { ...(prev[pid] ?? {}) };
      if (edit) next[noteId] = edit;
      else delete next[noteId];
      return { ...prev, [pid]: next };
    });
  }, []);

  const applyNote = useCallback(async (title: string, content: string) => {
    const project = projectRef.current;
    if (!project) throw new Error('Жоба ашылмаған');
    const result = await apiService.writeProjectNote(project.id, title, content);
    // Бір жазбаны бірнеше рет өзгертсе — бастапқы нұсқа ең алғашқысы болып қалады
    const known = notesRef.current[project.id]?.[result.id];
    if (!known) setNote(project.id, result.id, { noteId: result.id, title: result.title, previous: result.previous });
    return { noteId: result.id, created: known ? known.previous === null : result.created };
  }, [setNote]);

  const keepNote = useCallback((noteId: string) => {
    if (projectRef.current) setNote(projectRef.current.id, noteId, null);
  }, [setNote]);

  const undoNote = useCallback(async (noteId: string) => {
    const project = projectRef.current;
    const edit = project && notesRef.current[project.id]?.[noteId];
    if (!project || !edit) return;
    if (edit.previous === null) await apiService.deleteNote(noteId);
    else await apiService.updateNote(noteId, { content: edit.previous });
    setNote(project.id, noteId, null);
  }, [setNote]);

  const setEdit = useCallback((pid: string, path: string, edit: PendingEdit | null) => {
    setByProject((prev) => {
      const next = { ...(prev[pid] ?? {}) };
      if (edit) next[path] = edit;
      else delete next[path];
      return { ...prev, [pid]: next };
    });
  }, []);

  const applyEdit = useCallback((path: string, content: string) => {
    const project = projectRef.current;
    if (!project) return { created: false };
    const file = project.files.find((f) => f.path === path);
    // Бір файлды бірнеше рет өзгертсе — бастапқы нұсқа ең алғашқысы болып қалады
    const known = byProjectRef.current[project.id]?.[path];
    if (file) {
      if (!known) setEdit(project.id, path, { path, original: file.content });
      dispatch({ type: 'UPDATE_FILE_CONTENT', payload: { fileId: file.id, content } });
      dispatch({ type: 'OPEN_FILE', payload: { fileId: file.id } });
      return { created: !!known && known.original === null };
    }
    setEdit(project.id, path, { path, original: null });
    dispatch({ type: 'CREATE_FILE', payload: { name: path.split('/').pop() || path, path, content } });
    return { created: true };
  }, [dispatch, setEdit]);

  const keep = useCallback((path: string) => {
    if (projectRef.current) setEdit(projectRef.current.id, path, null);
  }, [setEdit]);

  const undo = useCallback((path: string) => {
    const project = projectRef.current;
    const edit = project && byProjectRef.current[project.id]?.[path];
    if (!project || !edit) return;
    const file = project.files.find((f) => f.path === path);
    if (file) {
      if (edit.original === null) dispatch({ type: 'DELETE_FILE', payload: { fileId: file.id } });
      else dispatch({ type: 'UPDATE_FILE_CONTENT', payload: { fileId: file.id, content: edit.original } });
    }
    setEdit(project.id, path, null);
  }, [dispatch, setEdit]);

  const keepAll = useCallback(() => {
    if (projectRef.current) {
      const pid = projectRef.current.id;
      setByProject((prev) => ({ ...prev, [pid]: {} }));
      setNotesByProject((prev) => ({ ...prev, [pid]: {} }));
    }
  }, []);

  const undoAll = useCallback(() => {
    pending.forEach((edit) => undo(edit.path));
    pendingNotes.forEach((edit) => { undoNote(edit.noteId).catch(() => {}); });
  }, [pending, undo, pendingNotes, undoNote]);

  const pendingFor = useCallback((path: string) => current[path], [current]);

  const value = useMemo(
    () => ({ pending, pendingFor, applyEdit, keep, undo, keepAll, undoAll, pendingNotes, applyNote, keepNote, undoNote }),
    [pending, pendingFor, applyEdit, keep, undo, keepAll, undoAll, pendingNotes, applyNote, keepNote, undoNote]
  );

  return <BurkitEditsContext.Provider value={value}>{children}</BurkitEditsContext.Provider>;
};
