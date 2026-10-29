import { useCallback, useRef, useState } from 'react';
import { Attachment, attachmentFromFile, attachmentFromFolder, MAX_ATTACHMENTS } from '../utils/burkitAttachments';

// Бүркітке тіркелетін фото/файл/папкалар күйі (басты бет пен Vibecoding-ке ортақ)
export function useBurkitAttachments(onDone?: () => void) {
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const countRef = useRef(0);
  countRef.current = attached.length;

  const add = useCallback(async (list: File[], folder = false) => {
    if (list.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const room = MAX_ATTACHMENTS - countRef.current;
      if (room <= 0) throw new Error(`Ең көбі ${MAX_ATTACHMENTS} тіркеме`);
      const added: Attachment[] = [];
      const errors: string[] = [];
      if (folder) {
        added.push(await attachmentFromFolder(list));
      } else {
        for (const file of list.slice(0, room)) {
          try {
            added.push(await attachmentFromFile(file));
          } catch (e) {
            errors.push(e instanceof Error ? e.message : file.name);
          }
        }
        if (list.length > room) errors.push(`Ең көбі ${MAX_ATTACHMENTS} тіркеме`);
      }
      setAttached((prev) => [...prev, ...added]);
      if (errors.length) setError(errors.join(' · '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Тіркеу мүмкін болмады');
    } finally {
      setBusy(false);
      onDone?.();
    }
  }, [onDone]);

  const remove = useCallback((id: string) => {
    setAttached((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((a) => a.id !== id);
    });
    setError(null);
  }, []);

  // Жіберілгенде: көріністері хабарда қалады, сондықтан revoke жасалмайды
  const clear = useCallback(() => {
    setAttached([]);
    setError(null);
  }, []);

  return { attached, error, busy, add, remove, clear };
}
