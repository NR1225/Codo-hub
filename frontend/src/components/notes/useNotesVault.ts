import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService, type NoteDTO, type NoteKind, type NoteMeta } from '../../utils/api';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

const SAVE_DELAY = 700;

/**
 * Қолданушының жеке vault-ы: жазбалар тізімі (метадеректер), ашылған жазбалардың мәтіні (кэш)
 * және кешіктірілген автосақтау. Барлық өзгеріс бірден серверге жіберіледі.
 */
export function useNotesVault() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>('saved');

  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const mergeMeta = useCallback((metas: NoteMeta[]) => {
    if (!metas.length) return;
    setNotes((prev) => {
      const byId = new Map(metas.map((m) => [m.id, m]));
      return prev.map((n) => byId.get(n.id) ?? n);
    });
  }, []);

  const applyNote = useCallback((note: NoteDTO) => {
    const meta: NoteMeta = { ...note };
    delete (meta as Partial<NoteDTO>).content;
    setNotes((prev) => (prev.some((n) => n.id === meta.id) ? prev.map((n) => (n.id === meta.id ? meta : n)) : [meta, ...prev]));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const vault = await apiService.getNoteVault();
      setNotes(vault.notes);
      setFolders(vault.folders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadContent = useCallback(async (id: string): Promise<string | undefined> => {
    if (contentsRef.current[id] !== undefined) return contentsRef.current[id];
    try {
      const note = await apiService.getNote(id);
      setContents((prev) => ({ ...prev, [id]: note.content }));
      applyNote(note);
      return note.content;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }, [applyNote]);

  const saveNow = useCallback(async (id: string) => {
    const timer = pending.current.get(id);
    if (timer) clearTimeout(timer);
    pending.current.delete(id);
    const content = contentsRef.current[id];
    if (content === undefined) return;
    setSaveState('saving');
    try {
      const saved = await apiService.updateNote(id, { content });
      applyNote(saved);
      setSaveState(pending.current.size ? 'dirty' : 'saved');
    } catch {
      setSaveState('error');
    }
  }, [applyNote]);

  /** Барлық күтіп тұрған сақтауларды бірден орындау (атауын өзгертпес/жоймас бұрын) */
  const flush = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((id) => saveNow(id)));
  }, [saveNow]);

  const setContent = useCallback((id: string, content: string) => {
    setContents((prev) => ({ ...prev, [id]: content }));
    contentsRef.current = { ...contentsRef.current, [id]: content };
    setSaveState('dirty');
    const timer = pending.current.get(id);
    if (timer) clearTimeout(timer);
    pending.current.set(id, setTimeout(() => saveNow(id), SAVE_DELAY));
  }, [saveNow]);

  // Бетті жапқанда сақталмаған өзгерістер туралы ескерту
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush]);

  const createNote = useCallback(async (title: string, folder = '', kind: NoteKind = 'note', content = '') => {
    const note = await apiService.createNote({ title, folder, kind, content });
    setContents((prev) => ({ ...prev, [note.id]: note.content }));
    applyNote(note);
    if (note.folder && !folders.includes(note.folder)) {
      setFolders((prev) => [...new Set([...prev, note.folder])].sort((a, b) => a.localeCompare(b)));
    }
    return note;
  }, [applyNote, folders]);

  const updateMeta = useCallback(async (id: string, data: { title?: string; folder?: string; starred?: boolean }) => {
    await flush();
    const saved = await apiService.updateNote(id, data);
    applyNote(saved);
    mergeMeta(saved.updatedNotes);
    if (saved.updatedNotes.length) {
      // Сілтемелері жаңарған жазбалардың мәтінін серверден қайта аламыз
      setContents((prev) => {
        const next = { ...prev, [id]: saved.content };
        saved.updatedNotes.forEach((n) => delete next[n.id]);
        return next;
      });
    }
    if (data.folder !== undefined && saved.folder && !folders.includes(saved.folder)) {
      setFolders((prev) => [...new Set([...prev, saved.folder])].sort((a, b) => a.localeCompare(b)));
    }
    return saved;
  }, [applyNote, flush, folders, mergeMeta]);

  const deleteNote = useCallback(async (id: string) => {
    const timer = pending.current.get(id);
    if (timer) clearTimeout(timer);
    pending.current.delete(id);
    await apiService.deleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setContents((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const createFolder = useCallback(async (path: string) => {
    const res = await apiService.createNoteFolder(path);
    setFolders(res.folders);
  }, []);

  const applyVault = useCallback((vault: { notes: NoteMeta[]; folders: string[] }) => {
    setNotes(vault.notes);
    setFolders(vault.folders);
    const ids = new Set(vault.notes.map((n) => n.id));
    setContents((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
  }, []);

  const renameFolder = useCallback(async (path: string, newPath: string) => {
    await flush();
    applyVault(await apiService.renameNoteFolder(path, newPath));
  }, [applyVault, flush]);

  const deleteFolder = useCallback(async (path: string) => {
    await flush();
    applyVault(await apiService.deleteNoteFolder(path));
  }, [applyVault, flush]);

  return {
    notes,
    folders,
    loading,
    error,
    contents,
    saveState,
    reload,
    loadContent,
    setContent,
    flush,
    createNote,
    updateMeta,
    deleteNote,
    createFolder,
    renameFolder,
    deleteFolder,
  };
}

export type NotesVault = ReturnType<typeof useNotesVault>;
