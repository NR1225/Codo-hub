import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, EditorSettings as EditorSettingsType } from '../../contexts/VibecodingContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSliders,
  faFont,
  faIndent,
  faAlignLeft,
  faMap,
  faListOl,
  faLink,
  faCode,
  faEye,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';

interface EditorSettingsProps {
  onClose: () => void;
}

const EditorSettingsPanel: React.FC<EditorSettingsProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const { editorSettings, dispatch } = useVibecoding();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const set = <K extends keyof EditorSettingsType>(key: K, value: EditorSettingsType[K]) =>
    dispatch({ type: 'SET_EDITOR_SETTINGS', payload: { [key]: value } });

  const Stepper = ({ value, onDec, onInc }: { value: number; onDec: () => void; onInc: () => void }) => (
    <div className="vibe-stepper">
      <button onClick={onDec} aria-label="-">−</button>
      <span className="vibe-stepper-val">{value}</span>
      <button onClick={onInc} aria-label="+">+</button>
    </div>
  );

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <div className={`vibe-toggle ${on ? 'on' : ''}`} onClick={onToggle} role="switch" aria-checked={on} />
  );

  return (
    <div className="vibe-settings" ref={ref}>
      <div className="vibe-settings-head">
        <FontAwesomeIcon icon={faSliders} />
        {t('vibecoding.settings.title', 'Редактор баптаулары')}
      </div>

      <div className="vibe-settings-body">
        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faFont} /> {t('vibecoding.settings.fontSize', 'Шрифт өлшемі')}
          </span>
          <Stepper
            value={editorSettings.fontSize}
            onDec={() => set('fontSize', Math.max(9, editorSettings.fontSize - 1))}
            onInc={() => set('fontSize', Math.min(28, editorSettings.fontSize + 1))}
          />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faIndent} /> {t('vibecoding.settings.tabSize', 'Tab өлшемі')}
          </span>
          <Stepper
            value={editorSettings.tabSize}
            onDec={() => set('tabSize', Math.max(1, editorSettings.tabSize - 1))}
            onInc={() => set('tabSize', Math.min(8, editorSettings.tabSize + 1))}
          />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faAlignLeft} /> {t('vibecoding.settings.wordWrap', 'Сөзді бүктеме')}
          </span>
          <Toggle
            on={editorSettings.wordWrap === 'on'}
            onToggle={() => set('wordWrap', editorSettings.wordWrap === 'on' ? 'off' : 'on')}
          />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faMap} /> {t('vibecoding.settings.minimap', 'Минимап')}
          </span>
          <Toggle on={editorSettings.minimap} onToggle={() => set('minimap', !editorSettings.minimap)} />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faListOl} /> {t('vibecoding.settings.lineNumbers', 'Жол нөмірлері')}
          </span>
          <Toggle
            on={editorSettings.lineNumbers === 'on'}
            onToggle={() => set('lineNumbers', editorSettings.lineNumbers === 'on' ? 'off' : 'on')}
          />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faLink} /> {t('vibecoding.settings.ligatures', 'Лигатуралар')}
          </span>
          <Toggle on={editorSettings.fontLigatures} onToggle={() => set('fontLigatures', !editorSettings.fontLigatures)} />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faCode} /> {t('vibecoding.settings.autoClose', 'Автожабу брекет')}
          </span>
          <Toggle on={editorSettings.autoClosingBrackets} onToggle={() => set('autoClosingBrackets', !editorSettings.autoClosingBrackets)} />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faLink} /> {t('vibecoding.settings.linkedEditing', 'Байланысқан өңдеу (HTML)')}
          </span>
          <Toggle on={editorSettings.linkedEditing} onToggle={() => set('linkedEditing', !editorSettings.linkedEditing)} />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faEye} /> {t('vibecoding.settings.smoothCaret', 'Біркелкі курсор')}
          </span>
          <Toggle on={editorSettings.smoothCaret} onToggle={() => set('smoothCaret', !editorSettings.smoothCaret)} />
        </div>

        <div className="vibe-setting-row">
          <span className="vibe-setting-label">
            <FontAwesomeIcon icon={faWandMagicSparkles} /> {t('vibecoding.settings.bracketColor', 'Брекет түсі')}
          </span>
          <Toggle on={editorSettings.bracketPairColorization} onToggle={() => set('bracketPairColorization', !editorSettings.bracketPairColorization)} />
        </div>
      </div>
    </div>
  );
};

export default EditorSettingsPanel;