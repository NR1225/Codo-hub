import React, { useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useVibecoding, detectLanguage } from '../../contexts/VibecodingContext';
import { useEditorMeta } from '../../contexts/EditorMetaContext';
import EditorTabBar from './EditorTabBar';
import Editor, { OnMount } from '@monaco-editor/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCode,
  faFileAlt,
  faFolderTree,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';

const EditorPanel: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { dispatch, activeFile, activeProject, editorSettings } = useVibecoding();
  const { setMeta } = useEditorMeta();
  const editorRef = useRef<any>(null);
  const formatHandlerRef = useRef<(() => void) | null>(null);

  const handleEditorMount: OnMount = useCallback((editor: any, _monaco: any) => {
    editorRef.current = editor;

    // Cursor position + selection → status bar meta
    const updateMeta = () => {
      const pos = editor.getPosition();
      const model = editor.getModel();
      const sel = editor.getSelection();
      const selected = sel ? model?.getValueInRange(sel)?.length ?? 0 : 0;
      const selectionLines = sel
        ? Math.abs(sel.endLineNumber - sel.startLineNumber) + (selected > 0 ? 1 : 0)
        : 0;
      setMeta({
        line: pos?.lineNumber ?? 1,
        column: pos?.column ?? 1,
        lineCount: model?.getLineCount() ?? 0,
        selected,
        selectionLines: selected > 0 ? selectionLines : 0,
        languageId: activeFile ? detectLanguage(activeFile.name) : 'plaintext',
      });
    };

    editor.onDidChangeCursorPosition(updateMeta);
    editor.onDidChangeCursorSelection(updateMeta);
    const model = editor.getModel();
    if (model) model.onDidChangeContent(updateMeta);
    updateMeta();

    // Format document event (from command palette)
    const onFormat = () => {
      try { editor.getAction('editor.action.formatDocument')?.run(); } catch { /* ignore */ }
    };
    formatHandlerRef.current = onFormat;
    window.addEventListener('vibecoding:format-document', onFormat);
  }, [setMeta, activeFile]);

  // Cleanup the format listener on unmount
  useEffect(() => {
    return () => {
      const handler = formatHandlerRef.current;
      if (handler) window.removeEventListener('vibecoding:format-document', handler);
      formatHandlerRef.current = null;
    };
  }, []);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (activeFile && value !== undefined) {
      dispatch({ type: 'UPDATE_FILE_CONTENT', payload: { fileId: activeFile.id, content: value } });
    }
  }, [activeFile, dispatch]);

  // Ctrl+S to "save" (mark the file clean). Ctrl+B/J/P handled at the page level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeFile) dispatch({ type: 'SAVE_FILE', payload: { fileId: activeFile.id } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFile, dispatch]);

  const editorLanguage = useMemo(() => {
    if (!activeFile) return 'plaintext';
    return detectLanguage(activeFile.name);
  }, [activeFile]);

  // Empty state when no file is open
  const handleOpenExplorer = useCallback(() => {
    dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: true });
  }, [dispatch]);

  const handleCreateFile = useCallback(() => {
    if (!activeProject) {
      dispatch({ type: 'CREATE_PROJECT', payload: { name: 'Project 1' } });
    }
    const name = window.prompt(t('vibecoding.fileExplorer.newFileName', 'Жаңа файл атауы'), 'newfile.js');
    if (name?.trim()) {
      dispatch({
        type: 'CREATE_FILE',
        payload: { name: name.trim(), path: name.trim(), content: '' },
      });
    }
  }, [dispatch, activeProject, t]);

  // Breadcrumb path segments
  const breadcrumbs = useMemo(() => {
    if (!activeFile || !activeProject) return [];
    return [
      { label: activeProject.name, icon: 'project' as const },
      { label: activeFile.path, icon: 'file' as const },
    ];
  }, [activeFile, activeProject]);

  if (!activeFile) {
    return (
      <div className="h-full flex flex-col bg-[var(--ide-editor-bg)] relative">
        <EditorTabBar />
        <div className="flex-1 flex items-center justify-center text-[var(--ide-text-muted)] p-4">
          <div className="vibe-empty-card vibe-glass animate-fadeIn">
            <div className="vibe-holo-icon">
              <FontAwesomeIcon
                icon={faCode}
                className="text-3xl"
                style={{ color: 'var(--ide-accent)' }}
              />
            </div>

            <h3 className="text-lg font-bold text-[var(--ide-text)] mb-2 relative z-10">
              {t('vibecoding.editor.noFileOpen', 'Файл ашылмаған')}
            </h3>
            <p className="text-xs opacity-70 max-w-[280px] mx-auto leading-relaxed mb-6 relative z-10">
              {t('vibecoding.editor.noFileOpenHint', 'Эксплорерден файл таңдаңыз немесе жаңа файл жасаңыз')}
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap relative z-10">
              <button onClick={handleOpenExplorer} className="vibe-btn vibe-btn-secondary">
                <FontAwesomeIcon icon={faFolderTree} className="text-[10px]" />
                {t('vibecoding.editor.openFile', 'Файл таңдау')}
              </button>
              <button onClick={handleCreateFile} className="vibe-btn">
                <FontAwesomeIcon icon={faFileAlt} className="text-[10px]" />
                {t('vibecoding.editor.newFile', 'Жаңа файл')}
              </button>
            </div>

            {/* Keyboard shortcut hints */}
            <div className="flex items-center justify-center gap-4 mt-7 text-[10px] opacity-50 relative z-10 flex-wrap">
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--ide-hover)', color: 'var(--ide-text-muted)' }}>Ctrl</kbd>
                <span>+</span>
                <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--ide-hover)', color: 'var(--ide-text-muted)' }}>B</kbd>
                <span className="ml-1">Эксплорер</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--ide-hover)', color: 'var(--ide-text-muted)' }}>Ctrl</kbd>
                <span>+</span>
                <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--ide-hover)', color: 'var(--ide-text-muted)' }}>J</kbd>
                <span className="ml-1">Терминал</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--ide-hover)', color: 'var(--ide-text-muted)' }}>Ctrl</kbd>
                <span>+</span>
                <kbd className="px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--ide-hover)', color: 'var(--ide-text-muted)' }}>P</kbd>
                <span className="ml-1">Палитра</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--ide-editor-bg)]">
      <EditorTabBar />

      {/* Breadcrumbs */}
      <div className="vibe-breadcrumbs">
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={i}>
            {i > 0 && <FontAwesomeIcon icon={faChevronRight} className="vibe-breadcrumb-sep text-[8px]" />}
            <span className="vibe-breadcrumb">
              {i === 0 && <FontAwesomeIcon icon={faCode} className="text-[9px]" style={{ color: 'var(--ide-accent)' }} />}
              <span style={i === breadcrumbs.length - 1 ? { color: 'var(--ide-text)' } : undefined}>
                {bc.label}
              </span>
            </span>
          </React.Fragment>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={editorLanguage}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={activeFile.content}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          path={activeFile.path}
          options={{
            minimap: { enabled: editorSettings.minimap, scale: 2 },
            fontSize: editorSettings.fontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
            fontLigatures: editorSettings.fontLigatures,
            wordWrap: editorSettings.wordWrap,
            tabSize: editorSettings.tabSize,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            suggestOnTriggerCharacters: true,
            lineNumbers: editorSettings.lineNumbers,
            renderLineHighlight: 'all',
            bracketPairColorization: { enabled: editorSettings.bracketPairColorization },
            guides: { bracketPairs: true, indentation: true },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: editorSettings.smoothCaret ? 'on' : 'off',
            formatOnPaste: true,
            formatOnType: true,
            autoClosingBrackets: editorSettings.autoClosingBrackets ? 'always' : 'never',
            autoClosingQuotes: editorSettings.autoClosingBrackets ? 'always' : 'never',
            linkedEditing: editorSettings.linkedEditing,
            multiCursorModifier: 'ctrlCmd',
            mouseWheelScrollSensitivity: 2,
            tabCompletion: 'on',
            dragAndDrop: true,
            copyWithSyntaxHighlighting: true,
            renderWhitespace: 'selection',
            renderControlCharacters: false,
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
              useShadows: false,
            },
            fixedOverflowWidgets: true,
          }}
          loading={
            <div className="flex items-center justify-center h-full bg-[var(--ide-editor-bg)] text-[var(--ide-text-muted)]">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-[var(--ide-accent)] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">{t('vibecoding.editor.loading', 'Редактор жүктелуде...')}</span>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
};

export default EditorPanel;