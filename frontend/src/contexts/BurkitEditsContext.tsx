import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import { useVibecoding } from './VibecodingContext';
import { apiService } from '../utils/api';

/* Бүркіттің (Agent режимі) жобаға және оның Notes папкасына жазған, әлі қаралмаған өзгерістері — Cursor сияқты:
   файл бірден өзгереді (жасалады, өшіріледі, жылжиды), ал бастапқы нұсқасы осында сақталады. Редактор diff
   көрсетеді, әр файлды «Қабылдау» (өзгерісті қалдыру) немесе «Қайтару» (бастапқысына оралу) мүмкін.
   Тек жадта тұрады: бет жаңартылса, өзгерістер файлда қалады (сақталмаған күйде). */

export interface PendingEdit {
  path: string;
  /** AI өзгерткенге дейінгі мазмұн; null — файлды Бүркіт жаңадан жасаған */
  original: string | null;
  /** Файлды Бүркіт өшірді (original — оның мазмұны) */
  deleted?: boolean;
  /** Бүркіт жылжытты / атын өзгертті: бастапқы жолы */
  movedFrom?: string;
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
  /** Файлдың ең соңғы мазмұны (осы кадрда жазылғанын да ескереді); жоқ болса — null */
  readFile: (path: string) => string | null;
  /** Жобадағы файлдардың ең соңғы жолдары */
  listPaths: () => string[];
  /** Файлға жазу (бар болса — жаңарту, жоқ болса — жасау) және оны ашу */
  applyEdit: (path: string, content: string) => { created: boolean };
  /** Файлды немесе папканы өшіру; өшірілген файлдардың жолдары */
  applyDelete: (path: string) => string[];
  /** Файлды/папканы жылжыту; жылжыған файлдар саны (0 — мүмкін болмады) */
  applyMove: (from: string, to: string) => number;
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

const inside = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

export const BurkitEditsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { dispatch, activeProject } = useVibecoding();
  // projectId → path → өзгеріс. Ref — шынайы көзі (бір кадрда бірнеше өзгеріс бір-бірін көреді)
  const [byProject, setByProject] = useState<Record<string, Record<string, PendingEdit>>>({});
  const byProjectRef = useRef(byProject);
  // Осы кадрда жазылған, бірақ жоба күйіне әлі жетпеген файлдар (null — өшірілген).
  // Жоба жаңарса — бәрі күйде, қабат тазаланады
  const liveRef = useRef(new Map<string, string | null>());
  const projectRef = useRef(activeProject);
  if (projectRef.current !== activeProject) liveRef.current.clear();
  projectRef.current = activeProject;

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

  /** Бір жобаның өзгерістерін ауыстыру: ref бірден, күй — келесі кадрда */
  const updatePending = useCallback((pid: string, change: (map: Record<string, PendingEdit>) => void) => {
    const next = { ...(byProjectRef.current[pid] ?? {}) };
    change(next);
    byProjectRef.current = { ...byProjectRef.current, [pid]: next };
    setByProject(byProjectRef.current);
  }, []);

  const readFile = useCallback((path: string): string | null => {
    const live = liveRef.current;
    if (live.has(path)) return live.get(path) ?? null;
    return projectRef.current?.files.find((f) => f.path === path)?.content ?? null;
  }, []);

  const listPaths = useCallback((): string[] => {
    const paths = new Set(projectRef.current?.files.map((f) => f.path) ?? []);
    liveRef.current.forEach((content, path) => {
      if (content === null) paths.delete(path);
      else paths.add(path);
    });
    return [...paths];
  }, []);

  const applyEdit = useCallback((path: string, content: string) => {
    const project = projectRef.current;
    if (!project) return { created: false };
    const previous = readFile(path);
    let created = false;
    updatePending(project.id, (map) => {
      const known = map[path];
      // Бір файлды бірнеше рет өзгертсе — бастапқы нұсқа ең алғашқысы болып қалады
      const edit: PendingEdit = known
        ? { path, original: known.original, movedFrom: known.movedFrom }
        : { path, original: previous };
      created = edit.original === null;
      map[path] = edit;
    });
    dispatch({ type: 'WRITE_FILE', payload: { path, content } });
    liveRef.current.set(path, content);
    return { created };
  }, [dispatch, readFile, updatePending]);

  const applyDelete = useCallback((path: string) => {
    const project = projectRef.current;
    if (!project) return [];
    const paths = listPaths().filter((p) => inside(p, path));
    updatePending(project.id, (map) => {
      paths.forEach((p) => {
        const known = map[p];
        const original = known ? known.original : readFile(p);
        delete map[p];
        // Бүркіт өзі жасаған файл — өшсе, ізі қалмайды
        if (original === null) return;
        const at = known?.movedFrom ?? p;
        map[at] = { path: at, original, deleted: true };
      });
    });
    // DELETE_FOLDER файлды да, папканы да (ішіндегісімен) жолы бойынша өшіреді
    dispatch({ type: 'DELETE_FOLDER', payload: { path } });
    paths.forEach((p) => liveRef.current.set(p, null));
    return paths;
  }, [dispatch, listPaths, readFile, updatePending]);

  const applyMove = useCallback((from: string, to: string) => {
    const project = projectRef.current;
    if (!project || from === to || inside(to, from)) return 0;
    const all = listPaths();
    const paths = all.filter((p) => inside(p, from));
    if (paths.length === 0 || all.some((p) => inside(p, to))) return 0;
    const contents = new Map(paths.map((p) => [p, readFile(p)]));
    updatePending(project.id, (map) => {
      paths.forEach((p) => {
        const np = to + p.slice(from.length);
        const known = map[p];
        delete map[p];
        const original = known ? known.original : contents.get(p) ?? null;
        // Бүркіт жасаған файлдың «бастапқы орны» жоқ
        const movedFrom = original === null ? undefined : known?.movedFrom ?? p;
        map[np] = { path: np, original, ...(movedFrom && movedFrom !== np && { movedFrom }) };
      });
    });
    dispatch({ type: 'MOVE_PATH', payload: { from, to } });
    paths.forEach((p) => {
      liveRef.current.set(p, null);
      liveRef.current.set(to + p.slice(from.length), contents.get(p) ?? '');
    });
    return paths.length;
  }, [dispatch, listPaths, readFile, updatePending]);

  const keep = useCallback((path: string) => {
    if (projectRef.current) updatePending(projectRef.current.id, (map) => { delete map[path]; });
  }, [updatePending]);

  const undo = useCallback((path: string) => {
    const project = projectRef.current;
    const edit = project && byProjectRef.current[project.id]?.[path];
    if (!project || !edit) return;
    const live = liveRef.current;
    if (edit.original === null) {
      dispatch({ type: 'DELETE_FOLDER', payload: { path } });
      live.set(path, null);
    } else if (edit.deleted) {
      dispatch({ type: 'WRITE_FILE', payload: { path, content: edit.original, open: false } });
      live.set(path, edit.original);
    } else {
      const target = edit.movedFrom ?? path;
      if (edit.movedFrom) {
        dispatch({ type: 'MOVE_PATH', payload: { from: path, to: edit.movedFrom } });
        live.set(path, null);
      }
      dispatch({ type: 'WRITE_FILE', payload: { path: target, content: edit.original, open: false } });
      live.set(target, edit.original);
    }
    updatePending(project.id, (map) => { delete map[path]; });
  }, [dispatch, updatePending]);

  const keepAll = useCallback(() => {
    if (projectRef.current) {
      const pid = projectRef.current.id;
      updatePending(pid, (map) => { Object.keys(map).forEach((k) => delete map[k]); });
      setNotesByProject((prev) => ({ ...prev, [pid]: {} }));
    }
  }, [updatePending]);

  const undoAll = useCallback(() => {
    const project = projectRef.current;
    if (!project) return;
    Object.keys(byProjectRef.current[project.id] ?? {}).forEach(undo);
    pendingNotes.forEach((edit) => { undoNote(edit.noteId).catch(() => {}); });
  }, [undo, pendingNotes, undoNote]);

  const pendingFor = useCallback((path: string) => current[path], [current]);

  const value = useMemo(
    () => ({
      pending, pendingFor, readFile, listPaths, applyEdit, applyDelete, applyMove, keep, undo, keepAll, undoAll,
      pendingNotes, applyNote, keepNote, undoNote,
    }),
    [pending, pendingFor, readFile, listPaths, applyEdit, applyDelete, applyMove, keep, undo, keepAll, undoAll,
      pendingNotes, applyNote, keepNote, undoNote]
  );

  return <BurkitEditsContext.Provider value={value}>{children}</BurkitEditsContext.Provider>;
};
