import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

/**
 * Lightweight editor metadata (cursor position, selection count, word count)
 * kept in its own context so frequent cursor moves only re-render consumers
 * of THIS context (the status bar), not the whole IDE tree.
 */

export interface EditorMeta {
  line: number;
  column: number;
  lineCount: number;
  selected: number;       // selected characters (0 if none)
  selectionLines: number; // lines in selection
  languageId: string;
}

interface EditorMetaContextType {
  meta: EditorMeta;
  setMeta: (m: Partial<EditorMeta>) => void;
}

const DEFAULT_META: EditorMeta = {
  line: 1,
  column: 1,
  lineCount: 0,
  selected: 0,
  selectionLines: 0,
  languageId: 'plaintext',
};

const EditorMetaContext = createContext<EditorMetaContextType | undefined>(undefined);

export const useEditorMeta = () => {
  const ctx = useContext(EditorMetaContext);
  if (!ctx) throw new Error('useEditorMeta must be used within EditorMetaProvider');
  return ctx;
};

export const EditorMetaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [meta, setMetaState] = useState<EditorMeta>(DEFAULT_META);
  // ref to avoid stale closures; we batch updates via rAF-like throttling
  const pendingRef = useRef<EditorMeta>(DEFAULT_META);

  const setMeta = useCallback((m: Partial<EditorMeta>) => {
    pendingRef.current = { ...pendingRef.current, ...m };
    setMetaState(pendingRef.current);
  }, []);

  return (
    <EditorMetaContext.Provider value={{ meta, setMeta }}>
      {children}
    </EditorMetaContext.Provider>
  );
};