import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, detectLanguage } from '../../contexts/VibecodingContext';
import { CloseIcon } from './icons';
import { langColor } from './langColors';
import { FileTypeIcon } from './fileIcons';

const EditorTabBar: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, openFiles } = useVibecoding();

  const handleCloseTab = useCallback((e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    dispatch({ type: 'CLOSE_FILE', payload: { fileId } });
  }, [dispatch]);

  const handleSelectTab = useCallback((fileId: string) => {
    dispatch({ type: 'SET_ACTIVE_FILE', payload: { fileId } });
  }, [dispatch]);

  if (openFiles.length === 0) return null;

  return (
    <div className="vx-tabs vibe-hide-scrollbar select-none" role="tablist">
      {openFiles.map((file) => {
        const isActive = file.id === state.activeFileId;
        const color = langColor(detectLanguage(file.name));

        return (
          <div
            key={file.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleSelectTab(file.id)}
            className={`vx-tab ${isActive ? 'is-active' : ''} ${file.isDirty ? 'is-dirty' : ''}`}
            style={{ ['--lang' as string]: color }}
            title={file.path}
          >
            <span className="vx-tab__icon"><FileTypeIcon name={file.name} size={18} /></span>
            <span className="vx-tab__name">{file.name}</span>
            {/* Сақталмаған файлда — нүкте, ховерде жабу батырмасына ауысады */}
            <span className="vx-tab__dirty" />
            <button
              type="button"
              onClick={(e) => handleCloseTab(e, file.id)}
              className="vx-tab__close"
              title={t('vibecoding.editor.closeTab', 'Жабу')}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default EditorTabBar;
