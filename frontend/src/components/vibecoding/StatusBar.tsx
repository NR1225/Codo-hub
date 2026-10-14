import React from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, detectLanguage } from '../../contexts/VibecodingContext';
import { useEditorMeta } from '../../contexts/EditorMetaContext';
import { useTheme } from '../../contexts/ThemeContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCodeBranch,
  faCircleExclamation,
  faCircleCheck,
  faBell,
  faMagnifyingGlassPlus,
  faMagnifyingGlassMinus,
} from '@fortawesome/free-solid-svg-icons';

interface StatusBarProps {
  onOpenSettings?: () => void;
  onTogglePalette?: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({ onOpenSettings, onTogglePalette }) => {
  const { t } = useTranslation();
  const { dispatch, activeFile, activeProject, editorSettings } = useVibecoding();
  const { meta } = useEditorMeta();
  const { theme, toggleTheme } = useTheme();

  const dirtyCount = activeProject ? activeProject.files.filter(f => f.isDirty).length : 0;
  const language = activeFile ? detectLanguage(activeFile.name) : 'plaintext';

  const handleSaveAll = () => dispatch({ type: 'SAVE_ALL' });

  const zoomIn = () =>
    dispatch({ type: 'SET_EDITOR_SETTINGS', payload: { fontSize: Math.min(28, editorSettings.fontSize + 1) } });
  const zoomOut = () =>
    dispatch({ type: 'SET_EDITOR_SETTINGS', payload: { fontSize: Math.max(9, editorSettings.fontSize - 1) } });

  return (
    <div className="vibe-statusbar" role="status" aria-label="Status bar">
      <div className="vibe-statusbar-left">
        {/* Git branch (decorative — local editor) */}
        <span className="vibe-statusbar-item" title={t('vibecoding.status.branch', 'Бұтақ')}>
          <FontAwesomeIcon icon={faCodeBranch} className="text-[10px]" />
          <span>main</span>
        </span>

        <span className="vibe-statusbar-divider" />

        {/* Sync / save status */}
        {dirtyCount > 0 ? (
          <span
            className="vibe-statusbar-item"
            onClick={handleSaveAll}
            title={t('vibecoding.status.saveAllHint', 'Бәрін сақтау')}
          >
            <FontAwesomeIcon icon={faCircleExclamation} className="text-[10px]" />
            <span>{dirtyCount} {t('vibecoding.status.unsaved', 'сақталмаған')}</span>
          </span>
        ) : (
          <span className="vibe-statusbar-item" title={t('vibecoding.status.saved', 'Бәрі сақталған')}>
            <FontAwesomeIcon icon={faCircleCheck} className="text-[10px]" />
            <span>{t('vibecoding.status.saved', 'Сақталды')}</span>
          </span>
        )}
      </div>

      <div className="vibe-statusbar-right">
        {/* Cursor position */}
        <span className="vibe-statusbar-item" title={t('vibecoding.status.cursor', 'Курсор')}>
          Ln {meta.line}, Col {meta.column}
        </span>

        <span className="vibe-statusbar-divider" />

        {/* Selection */}
        {meta.selected > 0 && (
          <span className="vibe-statusbar-item" title={t('vibecoding.status.selection', 'Таңдау')}>
            {meta.selected} sel{meta.selectionLines > 1 ? ` (${meta.selectionLines})` : ''}
          </span>
        )}

        {/* Spaces + tab size */}
        <span
          className="vibe-statusbar-item"
          onClick={onOpenSettings}
          title={t('vibecoding.status.indent', 'Шегініс')}
        >
          Spaces: {editorSettings.tabSize}
        </span>

        {/* Encoding */}
        <span className="vibe-statusbar-item" title="UTF-8">UTF-8</span>

        {/* EOL */}
        <span className="vibe-statusbar-item" title="EOL">LF</span>

        <span className="vibe-statusbar-divider" />

        {/* Language */}
        <span
          className="vibe-statusbar-item"
          onClick={onOpenSettings}
          title={t('vibecoding.status.language', 'Тіл режимі')}
        >
          {language.toUpperCase()}
        </span>

        {/* Line count */}
        <span className="vibe-statusbar-item" title={t('vibecoding.status.lines', 'Жолдар')}>
          {meta.lineCount} {t('vibecoding.status.lines', 'жол')}
        </span>

        <span className="vibe-statusbar-divider" />

        {/* Zoom */}
        <span className="vibe-statusbar-item" onClick={zoomOut} title={t('vibecoding.status.zoomOut', 'Кішірейту')}>
          <FontAwesomeIcon icon={faMagnifyingGlassMinus} className="text-[10px]" />
        </span>
        <span className="vibe-statusbar-item" onClick={zoomIn} title={t('vibecoding.status.zoomIn', 'Үлкейту')}>
          <FontAwesomeIcon icon={faMagnifyingGlassPlus} className="text-[10px]" />
        </span>

        {/* Theme */}
        <span
          className="vibe-statusbar-item"
          onClick={toggleTheme}
          title={t('vibecoding.status.toggleTheme', 'Тақырып ауыстыру')}
        >
          {theme === 'dark' ? 'Dark' : 'Light'}
        </span>

        {/* Command palette */}
        <span
          className="vibe-statusbar-item"
          onClick={onTogglePalette}
          title={t('vibecoding.status.commandPalette', 'Командалар палитрасы (Ctrl+Shift+P)')}
        >
          <FontAwesomeIcon icon={faBell} className="text-[10px]" />
        </span>
      </div>
    </div>
  );
};

export default StatusBar;