import React from 'react';
import { useTranslation } from 'react-i18next';
import { GridIcon, ListIcon } from '../home/icons';
import { ViewMode } from './codeUtils';

/* Тор / тізім ауыстырғышы (стильдері — CodesPage.css, .cdx-seg) */
const ViewToggle: React.FC<{ value: ViewMode; onChange: (value: ViewMode) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const options: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'grid', label: t('home.gridView'), icon: <GridIcon /> },
    { mode: 'list', label: t('home.listView'), icon: <ListIcon /> },
  ];

  return (
    <div className="cdx-seg" role="group" aria-label={t('home.viewMode')}>
      {options.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          className={value === opt.mode ? 'is-active' : ''}
          onClick={() => onChange(opt.mode)}
          aria-pressed={value === opt.mode}
          aria-label={opt.label}
          title={opt.label}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
};

export default ViewToggle;
