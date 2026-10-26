import React, { useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, detectLanguage } from '../../contexts/VibecodingContext';
import { useEditorMeta } from '../../contexts/EditorMetaContext';
import EditorTabBar from './EditorTabBar';
import Editor, { BeforeMount, DiffEditor, OnMount } from '@monaco-editor/react';
import { CodeIcon, ExplorerIcon, FilePlusIcon, ChevronIcon, SparkleIcon, CheckIcon, CloseIcon } from './icons';
import { useBurkitEdits, lineStats } from '../../contexts/BurkitEditsContext';

// Monaco тақырыбы — беттің қара монохром палитрасымен бірдей
const KH_THEME = 'kh-dark';
const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(KH_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b6b6b', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#e5e5e5',
      'editorLineNumber.foreground': '#3a3a3a',
      'editorLineNumber.activeForeground': '#d4d4d4',
      'editor.lineHighlightBackground': '#141414',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#fafafa',
      'editor.selectionBackground': '#ffffff26',
      'editor.inactiveSelectionBackground': '#ffffff14',
      'editorIndentGuide.background1': '#1c1c1c',
      'editorIndentGuide.activeBackground1': '#3a3a3a',
      'editorWidget.background': '#111111',
      'editorWidget.border': '#262626',
      'editorSuggestWidget.background': '#111111',
      'editorSuggestWidget.border': '#262626',
      'editorSuggestWidget.selectedBackground': '#1f1f1f',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff24',
      'scrollbarSlider.activeBackground': '#ffffff33',
      'minimap.background': '#0a0a0a',
      // Бүркіт өзгерістерінің diff-і
      'diffEditor.insertedLineBackground': '#22c55e1a',
      'diffEditor.insertedTextBackground': '#22c55e33',
      'diffEditor.removedLineBackground': '#ef44441a',
      'diffEditor.removedTextBackground': '#ef444433',
    },
  });
};

const EditorPanel: React.FC = () => {
  const { t } = useTranslation();
  const { dispatch, activeFile, activeProject, editorSettings } = useVibecoding();
  const { setMeta } = useEditorMeta();
  const burkitEdits = useBurkitEdits();
  // Бүркіт өзгерткен, әлі қаралмаған файл — diff көрсетіледі
  const pendingEdit = activeFile ? burkitEdits.pendingFor(activeFile.path) : undefined;
  const pendingStats = useMemo(
    () => (pendingEdit && activeFile ? lineStats(pendingEdit.original, activeFile.content) : null),
    [pendingEdit, activeFile]
  );
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
      if (mod && e.code === 'KeyS') {
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
      <div className="vx-editor">
        <EditorTabBar />
        <div className="vx-editor__empty">
          <div className="vx-welcome">
            <div className="vx-orb vx-orb--spin">
              <CodeIcon size={28} />
            </div>

            <h3 className="vx-welcome__title">
              {t('vibecoding.editor.noFileOpen', 'Файл ашылмаған')}
            </h3>
            <p className="vx-welcome__sub">
              {t('vibecoding.editor.noFileOpenHint', 'Эксплорерден файл таңдаңыз немесе жаңа файл жасаңыз')}
            </p>

            <div className="vx-welcome__actions">
              <button type="button" onClick={handleOpenExplorer} className="vx-btn vx-btn--ghost">
                <ExplorerIcon size={15} />
                {t('vibecoding.editor.openFile', 'Файл таңдау')}
              </button>
              <button type="button" onClick={handleCreateFile} className="vx-btn vx-btn--primary">
                <FilePlusIcon size={15} />
                {t('vibecoding.editor.newFile', 'Жаңа файл')}
              </button>
            </div>

            {/* Пернелер тіркесімі */}
            <div className="vx-welcome__keys">
              {[
                ['B', 'Эксплорер'],
                ['J', 'Терминал'],
                ['I', 'ЖИ'],
                ['P', 'Палитра'],
              ].map(([key, label]) => (
                <div key={key} className="vx-welcome__key">
                  <span>{label}</span>
                  <span className="vx-welcome__kbd">
                    <kbd>Ctrl</kbd>
                    <kbd>{key}</kbd>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vx-editor">
      <EditorTabBar />

      {/* Breadcrumbs */}
      <div className="vibe-breadcrumbs">
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="vibe-breadcrumb-sep"><ChevronIcon size={11} /></span>}
            <span className="vibe-breadcrumb">
              {i === 0 && <CodeIcon size={12} />}
              <span style={i === breadcrumbs.length - 1 ? { color: 'var(--ide-text)' } : undefined}>
                {bc.label}
              </span>
            </span>
          </React.Fragment>
        ))}
      </div>

      {pendingEdit && pendingStats && (
        <div className="vx-review">
          <SparkleIcon size={13} />
          <span className="vx-review__label">
            {pendingEdit.original === null ? 'Бүркіт жасаған файл' : 'Бүркіттің өзгерісі'}
          </span>
          <span className="vx-review__stat is-add">+{pendingStats.added}</span>
          <span className="vx-review__stat is-del">−{pendingStats.removed}</span>
          <div className="vx-review__actions">
            <button type="button" className="vx-review__btn" onClick={() => burkitEdits.undo(pendingEdit.path)}>
              <CloseIcon size={12} />
              Қайтару
            </button>
            <button type="button" className="vx-review__btn is-primary" onClick={() => burkitEdits.keep(pendingEdit.path)}>
              <CheckIcon size={12} />
              Қабылдау
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {pendingEdit ? (
          // Cursor сияқты inline diff: қызыл — өшірілгені, жасыл — қосылғаны
          <DiffEditor
            height="100%"
            language={editorLanguage}
            theme={KH_THEME}
            beforeMount={defineTheme}
            original={pendingEdit.original ?? ''}
            modified={activeFile.content}
            options={{
              renderSideBySide: false,
              readOnly: true,
              originalEditable: false,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
              fontSize: editorSettings.fontSize,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
              fontLigatures: editorSettings.fontLigatures,
              wordWrap: editorSettings.wordWrap,
              padding: { top: 12, bottom: 12 },
              renderOverviewRuler: false,
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
            }}
          />
        ) : (
        <Editor
          height="100%"
          language={editorLanguage}
          theme={KH_THEME}
          beforeMount={defineTheme}
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
            padding: { top: 12, bottom: 12 },
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
            <div className="vx-editor__loading">
              <span className="vx-spinner" />
              <span>{t('vibecoding.editor.loading', 'Редактор жүктелуде...')}</span>
            </div>
          }
        />
        )}
      </div>
    </div>
  );
};

export default EditorPanel;