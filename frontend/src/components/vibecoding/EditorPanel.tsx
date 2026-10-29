import React, { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BurkitInlineEdit from './BurkitInlineEdit';
import { apiService } from '../../utils/api';
import { useVibecoding, detectLanguage } from '../../contexts/VibecodingContext';
import { useEditorMeta } from '../../contexts/EditorMetaContext';
import EditorTabBar from './EditorTabBar';
import Editor, { BeforeMount, DiffEditor, OnMount } from '@monaco-editor/react';
import { CodeIcon, ExplorerIcon, FilePlusIcon, ChevronIcon, CheckIcon, CloseIcon } from './icons';
import BurkitLogo from '../BurkitLogo';
import { useBurkitEdits, lineStats } from '../../contexts/BurkitEditsContext';
import { setEditorState, setProblems } from '../../utils/vibeActivity';
import { configureMonacoLocale } from './monacoLocale';
import { EDITOR_REVEAL_EVENT, takeReveal } from '../../utils/vibeBridge';

// Monaco жүктелмей тұрып тілін орнату (контекст мәзірі т.б. сайт тілінде шығуы үшін)
configureMonacoLocale();

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

// Ctrl+K: Бүркіт қайта жазатын жолдар (endLine < startLine — жолдар алынбайды, тек кірістіріледі)
interface InlineTarget {
  path: string;
  startLine: number;
  endLine: number;
  top: number;
}

const EditorPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [inline, setInline] = useState<InlineTarget | null>(null);
  const openInlineRef = useRef<(() => void) | null>(null);
  const inlineDecorations = useRef<string[]>([]);
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
  const revealHandlerRef = useRef<(() => void) | null>(null);
  const markersSubRef = useRef<{ dispose: () => void } | null>(null);

  const handleEditorMount: OnMount = useCallback((editor: any, monaco: any) => {
    editorRef.current = editor;

    // Monaco модельдерінің URI-і = файл жолы (Editor path={...}); Бүркітке қай жол екенін береміз
    const pathOf = (uri: { path?: string } | undefined) => String(uri?.path ?? '').replace(/^\//, '');
    const reportProblems = () => {
      const markers: { severity: number; resource: { path: string }; startLineNumber: number; startColumn: number; message: string }[] =
        monaco.editor.getModelMarkers({});
      setProblems(
        markers
          .filter(m => m.severity >= monaco.MarkerSeverity.Warning)
          .map(m => `${m.severity >= monaco.MarkerSeverity.Error ? 'error' : 'warning'} ${pathOf(m.resource)}:${m.startLineNumber}:${m.startColumn} ${m.message}`),
      );
    };
    markersSubRef.current?.dispose();
    markersSubRef.current = monaco.editor.onDidChangeMarkers(reportProblems);
    reportProblems();

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
      setEditorState(model ? {
        path: pathOf(model.uri),
        line: pos?.lineNumber ?? 1,
        column: pos?.column ?? 1,
        selection: selected > 0 ? model.getValueInRange(sel) : undefined,
      } : undefined);
    };

    // Терминалдағы file.py:12 сілтемесі — файл ашылған соң сол жолға секіреміз
    const applyReveal = () => {
      const current = editor.getModel();
      const req = current ? takeReveal(pathOf(current.uri)) : null;
      if (!req) return;
      const line = Math.min(Math.max(1, req.line), current.getLineCount());
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: Math.max(1, req.column) });
      editor.focus();
    };

    editor.onDidChangeCursorPosition(updateMeta);
    editor.onDidChangeCursorSelection(updateMeta);
    editor.onDidChangeModel(() => {
      updateMeta(); // басқа файлға ауысқанда
      applyReveal();
    });
    // Редактор қайта mount болса (diff-тен оралғанда) — ескі тыңдаушы қалмасын
    if (revealHandlerRef.current) window.removeEventListener(EDITOR_REVEAL_EVENT, revealHandlerRef.current);
    revealHandlerRef.current = applyReveal;
    window.addEventListener(EDITOR_REVEAL_EVENT, applyReveal);
    applyReveal();
    const model = editor.getModel();
    if (model) model.onDidChangeContent(updateMeta);
    updateMeta();

    // Ctrl+K — Бүркітпен орнында өңдеу (Monaco-ның Ctrl+K аккордтарының орнына, Cursor сияқты)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => openInlineRef.current?.());

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
      const reveal = revealHandlerRef.current;
      if (reveal) window.removeEventListener(EDITOR_REVEAL_EVENT, reveal);
      revealHandlerRef.current = null;
      markersSubRef.current?.dispose();
      markersSubRef.current = null;
      setEditorState(undefined);
    };
  }, []);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (activeFile && value !== undefined) {
      dispatch({ type: 'UPDATE_FILE_CONTENT', payload: { fileId: activeFile.id, content: value } });
    }
  }, [activeFile, dispatch]);

  // ─── Ctrl+K: Бүркітпен орнында өңдеу ───

  const closeInline = useCallback(() => {
    const editor = editorRef.current;
    try {
      if (editor) inlineDecorations.current = editor.deltaDecorations(inlineDecorations.current, []);
      editor?.focus();
    } catch {
      inlineDecorations.current = []; // редактор diff-ке ауысып, жойылып кеткен
    }
    setInline(null);
  }, []);

  openInlineRef.current = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activeFile || !activeProject) return;
    const sel = editor.getSelection();
    let startLine: number;
    let endLine: number;
    if (sel && !sel.isEmpty()) {
      startLine = sel.startLineNumber;
      endLine = sel.endLineNumber;
      // Жолдың басына дейін белгіленсе — соңғы жол кірмейді
      if (sel.endColumn === 1 && endLine > startLine) endLine--;
    } else {
      // Белгіленбесе: бос жол — сол жолға жазады, әйтпесе — келесі жолға кірістіреді
      const line = editor.getPosition()?.lineNumber ?? 1;
      const empty = model.getLineContent(line).trim() === '';
      startLine = empty ? line : line + 1;
      endLine = line;
    }
    const anchor = Math.min(Math.max(startLine, 1), model.getLineCount());
    const pos = editor.getScrolledVisiblePosition({ lineNumber: anchor, column: 1 });
    // Өріс белгіленген жолдардың үстінде (орын болмаса — астында)
    const top = pos ? (pos.top > 64 ? pos.top - 62 : pos.top + pos.height + 4) : 8;
    inlineDecorations.current = editor.deltaDecorations(inlineDecorations.current, endLine >= startLine ? [{
      range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: 1 },
      options: { isWholeLine: true, className: 'vx-inline-range' },
    }] : []);
    setInline({ path: activeFile.path, startLine, endLine, top });
  };

  const submitInline = useCallback(async (instruction: string) => {
    const model = editorRef.current?.getModel();
    if (!inline || !model) return;
    const content: string = model.getValue();
    const lang = (i18n.language || 'kk').split('-')[0];
    const { code } = await apiService.burkitInline({
      path: inline.path,
      content,
      startLine: inline.startLine,
      endLine: inline.endLine,
      instruction,
      uiLanguage: lang === 'ru' || lang === 'en' ? lang : 'kk',
    });
    // Жауап күткенде файл өзгерсе — жолдар жылжып кетуі мүмкін
    if (editorRef.current?.getModel()?.getValue() !== content) {
      throw new Error('Файл өзгеріп кетті — Ctrl+K-ны қайта басыңыз.');
    }
    const lines = content.split('\n');
    lines.splice(inline.startLine - 1, Math.max(0, inline.endLine - inline.startLine + 1), ...(code === '' ? [] : code.split('\n')));
    closeInline();
    // Кәдімгі Бүркіт өзгерісі: редакторда diff, «Қабылдау / Қайтару»
    burkitEdits.applyEdit(inline.path, lines.join('\n'));
  }, [inline, i18n.language, burkitEdits, closeInline]);

  // Басқа файлға ауысса — Ctrl+K өрісі жабылады
  const inlinePath = inline?.path;
  useEffect(() => {
    if (inlinePath && inlinePath !== activeFile?.path) closeInline();
  }, [activeFile?.path, inlinePath, closeInline]);

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
          <BurkitLogo size={21} />
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

      <div className="flex-1 overflow-hidden relative">
        {inline && !pendingEdit && (
          <BurkitInlineEdit
            key={`${inline.path}:${inline.startLine}:${inline.endLine}`}
            top={inline.top}
            rangeLabel={inline.endLine < inline.startLine
              ? `${inline.endLine}-жолдан кейін`
              : inline.startLine === inline.endLine ? `${inline.startLine}-жол` : `${inline.startLine}–${inline.endLine} жолдар`}
            onSubmit={submitInline}
            onClose={closeInline}
          />
        )}
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