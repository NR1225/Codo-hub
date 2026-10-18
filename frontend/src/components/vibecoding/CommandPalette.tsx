import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVibecoding, detectLanguage } from '../../contexts/VibecodingContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  FileIcon,
  FilePlusIcon,
  FolderPlusIcon,
  ExplorerIcon,
  TerminalIcon,
  SparkleIcon,
  SunIcon,
  MoonIcon,
  SaveIcon,
  CloseIcon,
  WandIcon,
  SettingsIcon,
  UploadIcon,
  ChatIcon,
  HomeIcon,
  SearchIcon,
  CommandIcon,
} from './icons';
import { langColor } from './langColors';

type Mode = 'files' | 'commands';

interface CommandDef {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  mode: Mode;
  onClose: () => void;
}

/* ── Simple fuzzy scorer: scores by sequential char matches ── */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const tgt = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < tgt.length && qi < q.length; i++) {
    if (tgt[i] === q[qi]) {
      streak++;
      score += 2 + streak;
      // bonus for matching at a word boundary
      if (i === 0 || /[\s\-_./\\]/.test(tgt[i - 1])) score += 3;
      qi++;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1; // not all chars matched
  // prefer shorter targets + earlier matches
  return score - tgt.length * 0.1;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const q = query.toLowerCase();
  const out: React.ReactNode[] = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && text[i].toLowerCase() === q[qi]) {
      out.push(<span key={i} style={{ color: 'var(--ide-accent)', fontWeight: 600 }}>{text[i]}</span>);
      qi++;
    } else {
      out.push(<span key={i}>{text[i]}</span>);
    }
  }
  return out;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ mode, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, dispatch, activeProject } = useVibecoding();
  const { theme, toggleTheme } = useTheme();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* ── Build command list ── */
  const commands: CommandDef[] = useMemo(() => {
    const cmds: CommandDef[] = [
      {
        id: 'new-file',
        title: t('vibecoding.commands.newFile', 'Жаңа файл жасау'),
        subtitle: activeProject?.name,
        icon: <FilePlusIcon size={15} />,
        run: () => {
          if (!activeProject) {
            dispatch({ type: 'CREATE_PROJECT', payload: { name: 'Project 1' } });
          }
          const name = window.prompt(t('vibecoding.fileExplorer.newFileName', 'Жаңа файл атауы'), 'newfile.js');
          if (name?.trim()) {
            dispatch({ type: 'CREATE_FILE', payload: { name: name.trim(), path: name.trim(), content: '' } });
          }
        },
      },
      {
        id: 'new-project',
        title: t('vibecoding.commands.newProject', 'Жаңа жоба жасау'),
        icon: <FolderPlusIcon size={15} />,
        run: () => dispatch({ type: 'CREATE_PROJECT', payload: { name: `Project ${state.projects.length + 1}` } }),
      },
      {
        id: 'toggle-explorer',
        title: t('vibecoding.commands.toggleExplorer', 'Эксплорерді көрсету/жасыру'),
        icon: <ExplorerIcon size={15} />,
        shortcut: 'Ctrl+B',
        run: () => dispatch({ type: 'TOGGLE_LEFT_PANEL' }),
      },
      {
        id: 'toggle-terminal',
        title: t('vibecoding.commands.toggleTerminal', 'Терминалды көрсету/жасыру'),
        icon: <TerminalIcon size={15} />,
        shortcut: 'Ctrl+J',
        run: () => dispatch({ type: 'TOGGLE_BOTTOM_PANEL' }),
      },
      {
        id: 'toggle-chat',
        title: t('vibecoding.commands.toggleChat', 'ЖИ панелін көрсету/жасыру'),
        icon: <SparkleIcon size={15} />,
        shortcut: 'Ctrl+I',
        run: () => dispatch({ type: 'TOGGLE_RIGHT_PANEL' }),
      },
      {
        id: 'save-all',
        title: t('vibecoding.commands.saveAll', 'Бәрін сақтау'),
        icon: <SaveIcon size={15} />,
        shortcut: 'Ctrl+S',
        run: () => dispatch({ type: 'SAVE_ALL' }),
      },
      {
        id: 'close-all',
        title: t('vibecoding.commands.closeAll', 'Барлық беттерді жабу'),
        icon: <CloseIcon size={15} />,
        run: () => dispatch({ type: 'CLOSE_ALL_FILES' }),
      },
      {
        id: 'format',
        title: t('vibecoding.commands.format', 'Құжатты форматтау'),
        icon: <WandIcon size={15} />,
        shortcut: 'Shift+Alt+F',
        run: () => {
          // Dispatch a custom event the editor listens to
          window.dispatchEvent(new CustomEvent('vibecoding:format-document'));
        },
      },
      {
        id: 'theme',
        title: t('vibecoding.commands.toggleTheme', 'Тақырыпты ауыстыру'),
        icon: theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />,
        run: toggleTheme,
      },
      {
        id: 'settings',
        title: t('vibecoding.commands.settings', 'Редактор баптаулары'),
        icon: <SettingsIcon size={15} />,
        run: () => window.dispatchEvent(new CustomEvent('vibecoding:open-settings')),
      },
      {
        id: 'go-upload',
        title: t('vibecoding.commands.upload', 'Жүктеу бетіне өту'),
        icon: <UploadIcon size={15} />,
        run: () => navigate('/upload'),
      },
      {
        id: 'go-chat',
        title: t('vibecoding.commands.chatPage', 'Чат бетіне өту'),
        icon: <ChatIcon size={15} />,
        run: () => navigate('/chat'),
      },
      {
        id: 'go-home',
        title: t('vibecoding.commands.home', 'Басты бетке өту'),
        icon: <HomeIcon size={15} />,
        run: () => navigate('/'),
      },
    ];
    return cmds;
  }, [t, navigate, dispatch, activeProject, state.projects.length, theme, toggleTheme]);

  /* ── Build file list from the active project ── */
  const fileList = activeProject?.files || [];

  /* ── Score + sort entries ── */
  const entries = useMemo(() => {
    if (mode === 'files') {
      return fileList
        .map(f => {
          const score = fuzzyScore(query, f.name);
          return { kind: 'file' as const, file: f, score };
        })
        .filter(e => e.score >= 0)
        .sort((a, b) => b.score - a.score);
    }
    return commands
      .map(c => {
        const score = fuzzyScore(query, c.title);
        return { kind: 'command' as const, command: c, score };
      })
      .filter(e => e.score >= 0)
      .sort((a, b) => b.score - a.score);
  }, [mode, query, fileList, commands]);

  const total = entries.length;

  useEffect(() => {
    setSelected(0);
  }, [query, mode]);

  /* Keep the selected entry scrolled into view */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const execute = useCallback((entry: typeof entries[number] | undefined) => {
    if (!entry) return;
    if (entry.kind === 'file') {
      dispatch({ type: 'OPEN_FILE', payload: { fileId: entry.file.id } });
    } else {
      entry.command.run();
    }
    onClose();
  }, [dispatch, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(total - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(entries[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };


  return (
    <div className="vibe-cp-overlay" onMouseDown={onClose}>
      <div className="vibe-cp" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vibe-cp-input-wrap">
          <span className="vibe-cp-mode">
            {mode === 'files' ? <SearchIcon size={16} /> : <CommandIcon size={16} />}
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              mode === 'files'
                ? t('vibecoding.palette.searchFiles', 'Файлдан іздеу...')
                : t('vibecoding.palette.searchCommands', 'Команданы іздеу...')
            }
            className="vibe-cp-input"
            spellCheck={false}
          />
        </div>

        <div className="vibe-cp-list" ref={listRef}>
          {total === 0 && (
            <div className="vibe-cp-empty">
              {t('vibecoding.palette.noResults', 'Ештеңе табылмады')}
            </div>
          )}
          {entries.map((entry, idx) => {
            const isSel = idx === selected;
            if (entry.kind === 'file') {
              const lang = detectLanguage(entry.file.name);
              return (
                <div
                  key={entry.file.id}
                  data-idx={idx}
                  className={`vibe-cp-item ${isSel ? 'selected' : ''}`}
                  onMouseMove={() => setSelected(idx)}
                  onClick={() => execute(entry)}
                >
                  <span className="vibe-cp-item-icon vibe-cp-item-icon--file" style={{ ['--lang' as string]: langColor(lang) }}>
                    <FileIcon size={15} />
                  </span>
                  <div className="vibe-cp-item-label">
                    <div className="vibe-cp-item-title">{highlightMatch(entry.file.name, query)}</div>
                    <div className="vibe-cp-item-sub">{lang} · {entry.file.path}</div>
                  </div>
                  {entry.file.isDirty && (
                    <span className="vibe-cp-item-dirty" aria-label="unsaved" />
                  )}
                </div>
              );
            }
            const c = entry.command;
            return (
              <div
                key={c.id}
                data-idx={idx}
                className={`vibe-cp-item ${isSel ? 'selected' : ''}`}
                onMouseMove={() => setSelected(idx)}
                onClick={() => execute(entry)}
              >
                <span className="vibe-cp-item-icon">
                  {c.icon}
                </span>
                <div className="vibe-cp-item-label">
                  <div className="vibe-cp-item-title">{highlightMatch(c.title, query)}</div>
                  {c.subtitle && <div className="vibe-cp-item-sub">{c.subtitle}</div>}
                </div>
                {c.shortcut && <span className="vibe-cp-item-kbd">{c.shortcut}</span>}
              </div>
            );
          })}
        </div>

        <div className="vibe-cp-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('vibecoding.palette.navigate', 'навигация')}</span>
          <span><kbd>↵</kbd> {t('vibecoding.palette.open', 'таңдау')}</span>
          <span><kbd>esc</kbd> {t('vibecoding.palette.close', 'жабу')}</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;