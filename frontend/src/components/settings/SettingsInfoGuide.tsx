import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCode, faTerminal, faNoteSticky, faComments, faFileCode, faKeyboard, faChevronRight, faLayerGroup,
} from '@fortawesome/free-solid-svg-icons';
import BurkitLogo from '../BurkitLogo';

/* Баптаулар → Ақпарат: сайттың мүмкіндіктері мен пернетақта тіркесімдері бір жерде.
   Тіркесімдер кодтағы өңдеушілермен бірдей болуы керек (VibecodingPage, TerminalPanel/useTerminal, NotesPage). */

interface Feature {
  id: string;
  to: string;
  icon: IconDefinition | 'burkit';
}

const FEATURES: Feature[] = [
  { id: 'vibecoding', to: '/vibecoding', icon: faCode },
  { id: 'terminal', to: '/vibecoding', icon: faTerminal },
  { id: 'burkit', to: '/vibecoding', icon: 'burkit' },
  { id: 'notes', to: '/notes', icon: faNoteSticky },
  { id: 'chat', to: '/chat', icon: faComments },
  { id: 'codes', to: '/codes', icon: faFileCode },
];

/** Бір тіркесім: keys — бірінен соң бірі басылатын пернелер; бірнеше нұсқа «/» арқылы */
interface Shortcut {
  label: string;
  keys: string[][];
}

type Group = 'vibecoding' | 'terminal' | 'notes';

const SHORTCUTS: Record<Group, Shortcut[]> = {
  vibecoding: [
    { label: 'quickOpen', keys: [['Ctrl', 'P']] },
    { label: 'commands', keys: [['Ctrl', 'Shift', 'P']] },
    { label: 'run', keys: [['Ctrl', 'Enter']] },
    { label: 'save', keys: [['Ctrl', 'S']] },
    { label: 'format', keys: [['Shift', 'Alt', 'F']] },
    { label: 'explorer', keys: [['Ctrl', 'B']] },
    { label: 'terminal', keys: [['Ctrl', 'J']] },
    { label: 'burkit', keys: [['Ctrl', 'I']] },
    { label: 'settings', keys: [['Ctrl', ',']] },
  ],
  terminal: [
    { label: 'newTerminal', keys: [['Ctrl', 'Shift', '`']] },
    { label: 'split', keys: [['Ctrl', 'Shift', '5']] },
    { label: 'nextTab', keys: [['Alt', '→'], ['Alt', '←']] },
    { label: 'jumpTab', keys: [['Alt', '1…5']] },
    { label: 'find', keys: [['Ctrl', 'F']] },
    { label: 'copyPaste', keys: [['Ctrl', 'Shift', 'C'], ['Ctrl', 'Shift', 'V']] },
    { label: 'zoom', keys: [['Ctrl', '+'], ['Ctrl', '−']] },
    { label: 'zoomReset', keys: [['Ctrl', '0']] },
    { label: 'rename', keys: [['F2']] },
    { label: 'restore', keys: [['Esc']] },
  ],
  notes: [
    { label: 'switchNote', keys: [['Ctrl', 'O']] },
    { label: 'editPreview', keys: [['Ctrl', 'E']] },
    { label: 'searchNotes', keys: [['Ctrl', 'Shift', 'F']] },
    { label: 'sidebar', keys: [['Ctrl', '\\']] },
    { label: 'graph', keys: [['Ctrl', 'G']] },
    { label: 'newNote', keys: [['Alt', 'N']] },
    { label: 'daily', keys: [['Alt', 'D']] },
    { label: 'history', keys: [['Alt', '←'], ['Alt', '→']] },
    { label: 'save', keys: [['Ctrl', 'S']] },
  ],
};

const GROUPS: Group[] = ['vibecoding', 'terminal', 'notes'];

// macOS-та Ctrl орнына ⌘, Alt орнына ⌥ көрсетеміз (өңдеушілер metaKey-ді де қабылдайды)
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const keyLabel = (key: string) => (IS_MAC ? ({ Ctrl: '⌘', Alt: '⌥', Shift: '⇧' } as Record<string, string>)[key] ?? key : key);

const SettingsInfoGuide: React.FC = () => {
  const { t } = useTranslation();
  const [group, setGroup] = useState<Group>('vibecoding');
  const items = useMemo(() => SHORTCUTS[group], [group]);

  return (
    <>
      <section className="stg-card stg-card--wide">
        <div className="stg-card__head">
          <h2 className="stg-card__title">
            <FontAwesomeIcon icon={faLayerGroup} /> {t('settings.info.featuresTitle')}
          </h2>
          <p className="stg-text stg-text--muted">{t('settings.info.featuresDesc')}</p>
        </div>
        <ul className="stg-features">
          {FEATURES.map((f) => (
            <li key={f.id}>
              <Link to={f.to} className="stg-feature">
                <span className="stg-feature__icon">
                  {f.icon === 'burkit' ? <BurkitLogo size={18} /> : <FontAwesomeIcon icon={f.icon} />}
                </span>
                <span className="stg-feature__body">
                  <span className="stg-feature__title">{t(`settings.info.f.${f.id}.title`)}</span>
                  <span className="stg-feature__desc">{t(`settings.info.f.${f.id}.desc`)}</span>
                </span>
                <span className="stg-feature__arrow" aria-label={t('settings.info.open')}>
                  <FontAwesomeIcon icon={faChevronRight} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="stg-card stg-card--wide">
        <div className="stg-card__head stg-card__head--row">
          <div>
            <h2 className="stg-card__title">
              <FontAwesomeIcon icon={faKeyboard} /> {t('settings.info.shortcutsTitle')}
            </h2>
            <p className="stg-text stg-text--muted">{t('settings.info.shortcutsDesc')}</p>
          </div>
          <div className="stg-segment stg-segment--inline" role="tablist">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={group === g}
                className={`stg-segment__btn ${group === g ? 'is-active' : ''}`}
                onClick={() => setGroup(g)}
              >
                {t(`settings.info.g.${g}`)}
              </button>
            ))}
          </div>
        </div>

        <ul className="stg-keys" role="tabpanel">
          {items.map((s) => (
            <li key={s.label} className="stg-keys__row">
              <span className="stg-keys__label">{t(`settings.info.k.${s.label}`)}</span>
              <span className="stg-keys__combo">
                {s.keys.map((combo, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="stg-keys__or">/</span>}
                    {combo.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && !IS_MAC && <span className="stg-keys__plus">+</span>}
                        <kbd className="stg-kbd">{keyLabel(k)}</kbd>
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </span>
            </li>
          ))}
        </ul>

        {group === 'terminal' && <p className="stg-note">{t('settings.info.shortcutsNote')}</p>}
      </section>
    </>
  );
};

export default SettingsInfoGuide;
